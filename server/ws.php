<?php
/**
 * server/ws.php — serveur WebSocket natif (RFC 6455) et boucle d'événements.
 *
 * Remplace Ratchet/ReactPHP : aucune dépendance Composer, uniquement les
 * extensions PHP de base (sockets stream_*, sha1, base64). Il suffit donc de
 * démarrer server/server.php, sans installer quoi que ce soit.
 *
 * Périmètre volontairement limité au besoin du jeu :
 *  - handshake HTTP/1.1 Upgrade, clés masquées obligatoires côté client ;
 *  - trames texte/binaire, fragmentation, ping/pong, fermeture ;
 *  - messages limités à 256 Ko, en-têtes à 8 Ko ;
 *  - requêtes HTTP ordinaires (page, API) confiées à l'application (onHttp, voir http.php),
 *    corps limité à 64 Ko, une requête par connexion ;
 *  - pas de TLS : alwaysdata s'en charge devant (https / wss).
 */
declare(strict_types=1);

interface ConnectionInterface
{
    public function send($data);
    public function close();
}

interface MessageComponentInterface
{
    public function onOpen(ConnectionInterface $conn): void;
    public function onClose(ConnectionInterface $conn): void;
    public function onError(ConnectionInterface $conn, \Exception $e): void;
    public function onMessage(ConnectionInterface $from, $msg): void;
}

final class WsConnection implements ConnectionInterface
{
    public const MAX_HEADER = 8192;
    public const MAX_MESSAGE = 262144;
    public const MAX_BODY = 65536;

    /** @var resource */
    public $sock;
    public bool $handshaken = false;
    public bool $closing = false;
    public string $in = '';
    public string $out = '';
    private string $fragments = '';
    private int $fragOpcode = 0;

    public function __construct($sock)
    {
        $this->sock = $sock;
    }

    public function send($data)
    {
        if (!$this->closing) {
            $this->out .= self::frame((string) $data, 0x1);
        }
    }

    public function close()
    {
        if ($this->closing) {
            return;
        }
        $this->closing = true;
        $this->out .= self::frame('', 0x8);
    }

    public static function frame(string $payload, int $opcode): string
    {
        $len = strlen($payload);
        $head = chr(0x80 | $opcode);
        if ($len < 126) {
            $head .= chr($len);
        } elseif ($len <= 0xFFFF) {
            $head .= chr(126) . pack('n', $len);
        } else {
            $head .= chr(127) . pack('J', $len);
        }
        return $head . $payload;
    }

    /**
     * Extrait les trames complètes du tampon d'entrée.
     * Retourne une liste de [opcode, payload] ; les messages fragmentés sont recollés.
     * @return array<int, array{0:int,1:string}>
     */
    public function takeFrames(): array
    {
        $messages = [];
        while (true) {
            $n = strlen($this->in);
            if ($n < 2) {
                break;
            }
            $b1 = ord($this->in[0]);
            $b2 = ord($this->in[1]);
            $fin = (bool) ($b1 & 0x80);
            $opcode = $b1 & 0x0F;
            $masked = (bool) ($b2 & 0x80);
            $len = $b2 & 0x7F;
            $off = 2;

            if ($len === 126) {
                if ($n < 4) {
                    break;
                }
                $len = unpack('n', substr($this->in, 2, 2))[1];
                $off = 4;
            } elseif ($len === 127) {
                if ($n < 10) {
                    break;
                }
                $len = unpack('J', substr($this->in, 2, 8))[1];
                $off = 10;
            }

            if ($len > self::MAX_MESSAGE) {
                throw new \RuntimeException('trame trop grande');
            }
            if (!$masked) {
                // RFC 6455 : un client doit masquer ses trames.
                throw new \RuntimeException('trame non masquée');
            }
            if ($n < $off + 4 + $len) {
                break;
            }

            $mask = substr($this->in, $off, 4);
            $payload = substr($this->in, $off + 4, $len);
            $this->in = (string) substr($this->in, $off + 4 + $len);
            $payload = $payload ^ str_repeat($mask, intdiv($len, 4) + 1);
            $payload = substr($payload, 0, $len);

            if ($opcode >= 0x8) {
                // trames de contrôle : jamais fragmentées, jamais plus de 125 octets
                if ($len > 125 || !$fin) {
                    throw new \RuntimeException('trame de contrôle invalide');
                }
                $messages[] = [$opcode, $payload];
                continue;
            }

            if ($opcode !== 0x0) {
                $this->fragOpcode = $opcode;
                $this->fragments = '';
            }
            $this->fragments .= $payload;
            if (strlen($this->fragments) > self::MAX_MESSAGE) {
                throw new \RuntimeException('message trop grand');
            }
            if ($fin) {
                $messages[] = [$this->fragOpcode, $this->fragments];
                $this->fragments = '';
                $this->fragOpcode = 0;
            }
        }
        return $messages;
    }
}

final class WsServerLoop
{
    /** @var array<int, WsConnection> */
    private array $conns = [];
    /** @var resource|null */
    private $server = null;

    /** @param callable():void $tick appelée à chaque pas de simulation */
    public function __construct(
        private MessageComponentInterface $app,
        private string $host,
        private int $port,
        private $tick,
        private float $dt,
    ) {
    }

    /** « hôte:port », avec crochets pour une adresse IPv6 (alwaysdata écoute en IPv6). */
    public static function address(string $host, int $port): string
    {
        $host = trim($host, '[] ');
        return (str_contains($host, ':') ? "[$host]" : $host) . ':' . $port;
    }

    public function run(): void
    {
        $errno = 0;
        $errstr = '';
        $addr = self::address($this->host, $this->port);
        $server = @stream_socket_server("tcp://$addr", $errno, $errstr);
        if ($server === false) {
            fwrite(STDERR, "[ws] impossible d'écouter sur $addr : $errstr ($errno)\n");
            exit(1);
        }
        stream_set_blocking($server, false);
        $this->server = $server;

        $next = microtime(true) + $this->dt;
        while (true) {
            $read = [$server];
            $write = [];
            foreach ($this->conns as $c) {
                $read[] = $c->sock;
                if ($c->out !== '') {
                    $write[] = $c->sock;
                }
            }

            $wait = max(0.0, $next - microtime(true));
            $ex = null;
            $ready = @stream_select($read, $write, $ex, (int) $wait, (int) (($wait - floor($wait)) * 1e6));
            if ($ready === false) {
                usleep(1000);
            }

            if (in_array($server, $read, true)) {
                $this->accept();
            }
            foreach ($read as $sock) {
                if ($sock === $server) {
                    continue;
                }
                $c = $this->connFor($sock);
                if ($c !== null) {
                    $this->readFrom($c);
                }
            }
            foreach ($write as $sock) {
                $c = $this->connFor($sock);
                if ($c !== null) {
                    $this->writeTo($c);
                }
            }

            $now = microtime(true);
            if ($now >= $next) {
                ($this->tick)();
                $next += $this->dt;
                if ($now - $next > 1.0) {
                    // retard important (machine saturée) : on ne rattrape pas plus d'une seconde
                    $next = $now + $this->dt;
                }
            }
        }
    }

    private function accept(): void
    {
        while (($sock = @stream_socket_accept($this->server, 0)) !== false) {
            stream_set_blocking($sock, false);
            $id = (int) $sock;
            $this->conns[$id] = new WsConnection($sock);
        }
    }

    /** @param resource $sock */
    private function connFor($sock): ?WsConnection
    {
        return $this->conns[(int) $sock] ?? null;
    }

    private function readFrom(WsConnection $c): void
    {
        $data = @fread($c->sock, 65536);
        if ($data === false || ($data === '' && feof($c->sock))) {
            $this->drop($c, false);
            return;
        }
        $c->in .= $data;

        try {
            if (!$c->handshaken) {
                if ($c->closing) {
                    $c->in = '';   // réponse HTTP déjà prête : on ignore la suite
                    return;
                }
                if (strlen($c->in) > WsConnection::MAX_HEADER && strpos($c->in, "\r\n\r\n") === false) {
                    throw new \RuntimeException('en-têtes trop longs');
                }
                $end = strpos($c->in, "\r\n\r\n");
                if ($end === false) {
                    return;
                }
                $head = substr($c->in, 0, $end);
                // corps de la requête (POST/PATCH de l'API) : on attend qu'il soit complet
                $len = preg_match('/\r\ncontent-length:[ \t]*(\d+)/i', $head, $cl) ? (int) $cl[1] : 0;
                if ($len > WsConnection::MAX_BODY) {
                    $c->out .= self::httpResponse(413, ['Content-Type' => 'text/plain'], 'Requête trop grande');
                    $c->closing = true;
                    return;
                }
                if (preg_match('/\r\ntransfer-encoding:[ \t]*chunked/i', $head)) {
                    // corps envoyé en morceaux (certains proxys) : on attend le dernier morceau
                    $rest = (string) substr($c->in, $end + 4);
                    $body = self::dechunk($rest, $used);
                    if ($body === null) {
                        if (strlen($rest) > WsConnection::MAX_BODY + 4096) {
                            $c->out .= self::httpResponse(413, ['Content-Type' => 'text/plain'], 'Requête trop grande');
                            $c->closing = true;
                        }
                        return;
                    }
                    $c->in = (string) substr($rest, $used);
                } else {
                    if (strlen($c->in) < $end + 4 + $len) {
                        return;
                    }
                    $body = (string) substr($c->in, $end + 4, $len);
                    $c->in = (string) substr($c->in, $end + 4 + $len);
                }
                $this->handshake($c, $head, $body);
                if (!$c->handshaken) {
                    return;   // requête HTTP ordinaire : seule la réponse part
                }
            }

            foreach ($c->takeFrames() as [$opcode, $payload]) {
                if ($opcode === 0x8) {
                    $c->close();
                    $this->flush($c);
                    $this->drop($c, true);
                    return;
                }
                if ($opcode === 0x9) {
                    $c->out .= WsConnection::frame($payload, 0xA);
                    continue;
                }
                if ($opcode === 0xA) {
                    continue;
                }
                $this->app->onMessage($c, $payload);
            }
        } catch (\Throwable $e) {
            $this->app->onError($c, $e instanceof \Exception ? $e : new \RuntimeException($e->getMessage()));
            $c->close();
            $this->flush($c);
            $this->drop($c, true);
        }
    }

    /** Décode un corps « chunked ». Retourne null tant qu'il est incomplet. */
    public static function dechunk(string $data, ?int &$used): ?string
    {
        $out = '';
        $pos = 0;
        while (true) {
            $eol = strpos($data, "\r\n", $pos);
            if ($eol === false) {
                return null;
            }
            $size = hexdec(trim(explode(';', substr($data, $pos, $eol - $pos))[0]));
            $pos = $eol + 2;
            if ($size === 0) {
                $end = strpos($data, "\r\n", $pos);   // fin (sans en-têtes de fin en pratique)
                if ($end === false) {
                    return null;
                }
                $used = $end + 2;
                return $out;
            }
            if (strlen($data) < $pos + $size + 2) {
                return null;
            }
            $out .= substr($data, $pos, (int) $size);
            $pos += (int) $size + 2;
            if (strlen($out) > WsConnection::MAX_BODY) {
                throw new \RuntimeException('corps trop grand');
            }
        }
    }

    /** @param array<string,string> $headers */
    public static function httpResponse(int $code, array $headers, string $body, ?int $length = null): string
    {
        $reasons = [200 => 'OK', 201 => 'Created', 204 => 'No Content', 304 => 'Not Modified', 400 => 'Bad Request',
            401 => 'Unauthorized', 404 => 'Not Found', 405 => 'Method Not Allowed', 413 => 'Payload Too Large',
            500 => 'Internal Server Error'];
        $out = "HTTP/1.1 $code " . ($reasons[$code] ?? 'OK') . "\r\n";
        foreach ($headers as $k => $v) {
            $out .= "$k: $v\r\n";
        }
        if ($code !== 204 && $code !== 304) {
            $out .= 'Content-Length: ' . ($length ?? strlen($body)) . "\r\n";
        }
        return $out . "Connection: close\r\n\r\n" . $body;
    }

    private function handshake(WsConnection $c, string $head, string $body = ''): void
    {
        $lines = explode("\r\n", $head);
        $requestLine = (string) array_shift($lines);
        $headers = [];
        foreach ($lines as $line) {
            $pos = strpos($line, ':');
            if ($pos !== false) {
                $headers[strtolower(trim(substr($line, 0, $pos)))] = trim(substr($line, $pos + 1));
            }
        }
        $key = $headers['sec-websocket-key'] ?? '';
        $upgrade = strtolower($headers['upgrade'] ?? '');

        // Requête HTTP ordinaire (page du jeu, API, état) : un seul site suffit.
        if ($upgrade === '' && preg_match('#^([A-Z]+) (\S+) HTTP/1\.[01]$#', $requestLine, $m)) {
            if (method_exists($this->app, 'onHttp')) {
                [$code, $hdrs, $resp] = $this->app->onHttp($m[1], $m[2], $headers, $body);
            } else {
                [$code, $hdrs, $resp] = [200, ['Content-Type' => 'application/json'], '{"ok":true}'];
            }
            $c->out .= self::httpResponse($code, $hdrs, $m[1] === 'HEAD' ? '' : $resp, strlen($resp));
            $c->closing = true;
            return;
        }
        if (!preg_match('#^GET \S+ HTTP/1\.1$#', $requestLine)) {
            throw new \RuntimeException('requête HTTP invalide');
        }
        if ($key === '' || $upgrade !== 'websocket' || base64_decode($key, true) === false) {
            $c->out .= "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
            $c->closing = true;
            return;
        }
        $accept = base64_encode(sha1($key . '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', true));
        $c->out .= "HTTP/1.1 101 Switching Protocols\r\n"
            . "Upgrade: websocket\r\n"
            . "Connection: Upgrade\r\n"
            . "Sec-WebSocket-Accept: $accept\r\n\r\n";
        $c->handshaken = true;
        $this->app->onOpen($c);
    }

    private function writeTo(WsConnection $c): void
    {
        $n = @fwrite($c->sock, $c->out);
        if ($n === false) {
            $this->drop($c, true);
            return;
        }
        $c->out = (string) substr($c->out, $n);
        if ($c->closing && $c->out === '') {
            $this->drop($c, true);
        }
    }

    /** Envoi immédiat du tampon (utilisé avant fermeture). */
    private function flush(WsConnection $c): void
    {
        $tries = 0;
        while ($c->out !== '' && $tries++ < 50) {
            $n = @fwrite($c->sock, $c->out);
            if ($n === false || $n === 0) {
                break;
            }
            $c->out = (string) substr($c->out, $n);
        }
    }

    private function drop(WsConnection $c, bool $closeSocket): void
    {
        $id = (int) $c->sock;
        if (!isset($this->conns[$id])) {
            return;
        }
        unset($this->conns[$id]);
        if ($c->handshaken) {
            $this->app->onClose($c);
        }
        if ($closeSocket && is_resource($c->sock)) {
            @fclose($c->sock);
        }
    }
}
