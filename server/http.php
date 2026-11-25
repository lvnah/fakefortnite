<?php
declare(strict_types=1);

/**
 * server/http.php — partie « site web » du serveur de jeu.
 *
 * Permet de tout faire avec UN SEUL site alwaysdata (type Programme utilisateur) :
 *   /api.php/…        -> API REST (routes.php)
 *   /ws  (WebSocket)  -> jeu temps réel (géré par ws.php)
 *   /ws, /status      -> état du serveur en JSON (simple visite)
 *   tout le reste     -> fichiers du dossier public/ (index.html, js, css…)
 */

require_once __DIR__ . '/routes.php';

const HTTP_MIME = [
    'html' => 'text/html; charset=utf-8',
    'js'   => 'text/javascript; charset=utf-8',
    'mjs'  => 'text/javascript; charset=utf-8',
    'css'  => 'text/css; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'txt'  => 'text/plain; charset=utf-8',
    'svg'  => 'image/svg+xml',
    'png'  => 'image/png',
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'gif'  => 'image/gif',
    'webp' => 'image/webp',
    'ico'  => 'image/x-icon',
    'mp3'  => 'audio/mpeg',
    'ogg'  => 'audio/ogg',
    'wav'  => 'audio/wav',
    'm4a'  => 'audio/mp4',
    'aac'  => 'audio/aac',
    'flac' => 'audio/flac',
    'opus' => 'audio/ogg',
    'oga'  => 'audio/ogg',
    'weba' => 'audio/webm',
    'webm' => 'audio/webm',
    'woff' => 'font/woff',
    'woff2' => 'font/woff2',
    'glb'  => 'model/gltf-binary',
    'gltf' => 'model/gltf+json',
];

function publicDir(): string
{
    static $dir = null;
    if ($dir === null) {
        $dir = (string) realpath((string) (getenv('PUBLIC_DIR') ?: dirname(__DIR__) . '/public'));
    }
    return $dir;
}

/**
 * Traite une requête HTTP ordinaire (pas une connexion WebSocket).
 * @param array<string,string> $headers en-têtes en minuscules
 * @param callable():array $status
 * @return array{0:int, 1:array<string,string>, 2:string} code, en-têtes, corps
 */
function httpHandle(string $method, string $target, array $headers, string $body, callable $status): array
{
    $path = rawurldecode((string) (parse_url($target, PHP_URL_PATH) ?? '/'));

    // --- API
    if ($path === '/api.php' || str_starts_with($path, '/api.php/')) {
        $token = $headers['x-player-token'] ?? '';
        [$code, $data] = apiRoute($method, substr($path, 8) ?: '/', $token, $body);
        return [$code, [
            'Content-Type' => 'application/json; charset=utf-8',
            'Cache-Control' => 'no-store',
            'Access-Control-Allow-Origin' => '*',
            'Access-Control-Allow-Methods' => 'GET, POST, PATCH, OPTIONS',
            'Access-Control-Allow-Headers' => 'Content-Type, X-Player-Token',
        ], $data === null ? '' : (string) json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];
    }

    if ($method !== 'GET' && $method !== 'HEAD') {
        return [405, ['Content-Type' => 'text/plain; charset=utf-8', 'Allow' => 'GET, HEAD'], 'Méthode non autorisée'];
    }

    // --- état du serveur
    if ($path === '/ws' || $path === '/status') {
        return [200, ['Content-Type' => 'application/json', 'Cache-Control' => 'no-store'], (string) json_encode($status())];
    }

    // --- fichiers du jeu
    return httpStatic($path, $headers);
}

/** Cherche un fichier sans tenir compte des majuscules ; false si introuvable. */
function findNoCase(string $root, string $rel): string|false
{
    $cur = $root;
    foreach (explode('/', $rel) as $part) {
        if ($part === '' || $part === '.' || $part === '..') {
            return false;
        }
        if (file_exists($cur . '/' . $part)) {
            $cur .= '/' . $part;
            continue;
        }
        $found = null;
        foreach (is_dir($cur) ? (scandir($cur) ?: []) : [] as $e) {
            if (strcasecmp($e, $part) === 0) {
                $found = $e;
                break;
            }
        }
        if ($found === null) {
            return false;
        }
        $cur .= '/' . $found;
    }
    return realpath($cur);
}

/** @return array{0:int, 1:array<string,string>, 2:string} */
function httpStatic(string $path, array $headers): array
{
    static $cache = [];   // chemin => [signature, contenu, contenu gzip|null]
    $notFound = [404, ['Content-Type' => 'text/plain; charset=utf-8'], 'Introuvable'];

    $root = publicDir();
    if ($root === '' || str_contains($path, "\0")) {
        return $notFound;
    }
    $file = realpath($root . '/' . ltrim($path, '/'));
    // vos sons : majuscules / minuscules indifférentes (« Coffre.MP3 » envoyé depuis Windows)
    if ($file === false && str_starts_with($path, '/sfx/')) {
        $file = findNoCase($root, ltrim($path, '/'));
    }
    // sons personnels pas encore créés : réponse vide (évite une erreur 404 dans la console)
    if ($file === false && rtrim($path, '/') === '/sfx/sons-perso.json') {
        return [200, ['Content-Type' => 'application/json; charset=utf-8', 'Cache-Control' => 'no-cache'], '{"sons":{}}'];
    }
    if ($file !== false && is_dir($file)) {
        $file = realpath($file . '/index.html');
    }
    // pas de sortie du dossier public/, pas de fichiers cachés, pas de code PHP
    if ($file === false || !is_file($file) || !str_starts_with($file, $root . DIRECTORY_SEPARATOR)
        || str_contains(substr($file, strlen($root)), '/.')) {
        return $notFound;
    }
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    if ($ext === 'php' || !isset(HTTP_MIME[$ext])) {
        return $notFound;
    }

    clearstatcache(true, $file);   // fichier remplacé pendant que le serveur tourne : on relit sa date
    $mtime = (int) filemtime($file);
    $size = (int) filesize($file);
    $etag = '"' . dechex($mtime) . '-' . dechex($size) . '"';
    $out = [
        'Content-Type' => HTTP_MIME[$ext],
        'Cache-Control' => 'no-cache',   // le navigateur revalide : une mise à jour est vue tout de suite
        'ETag' => $etag,
        'X-Content-Type-Options' => 'nosniff',
    ];
    if (($headers['if-none-match'] ?? '') === $etag) {
        return [304, $out, ''];
    }

    if (!isset($cache[$file]) || $cache[$file][0] !== $etag) {
        $data = (string) file_get_contents($file);
        $text = str_starts_with(HTTP_MIME[$ext], 'text/') || in_array($ext, ['json', 'svg', 'gltf', 'glb'], true);
        $gz = ($text && strlen($data) > 1024 && function_exists('gzencode')) ? gzencode($data, 6) : null;
        $cache[$file] = [$etag, $data, $gz === false ? null : $gz];
    }
    [, $data, $gz] = $cache[$file];

    if ($gz !== null && str_contains($headers['accept-encoding'] ?? '', 'gzip')) {
        $out['Content-Encoding'] = 'gzip';
        $out['Vary'] = 'Accept-Encoding';
        return [200, $out, $gz];
    }
    if ($gz !== null) {
        $out['Vary'] = 'Accept-Encoding';
    }
    return [200, $out, $data];
}
