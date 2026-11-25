<?php
declare(strict_types=1);

/**
 * server/db.php — persistance SQLite partagée par l'API REST et le serveur de jeu.
 *
 * Règle de sécurité : les victoires et les frags ne sont écrits QUE par le
 * serveur de jeu (recordMatch). L'API les expose en lecture seule.
 */

const SKINS = [
    'knight'       => 'Chevalier',
    'barbarian'    => 'Barbare',
    'mage'         => 'Mage',
    'rogue'        => 'Voleuse',
    'hooded'       => 'Capuche',
    'skel_warrior' => 'Squelette guerrier',
    'skel_mage'    => 'Squelette mage',
    'skel_rogue'   => 'Squelette voleur',
    'skel_minion'  => 'Sbire squelette',
    'homme'        => 'Grand gaillard',
    'femme'        => 'Voyageuse',
];

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $dir = __DIR__ . '/data';
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        throw new RuntimeException('Dossier server/data inaccessible');
    }

    $pdo = new PDO('sqlite:' . $dir . '/game.sqlite', null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS players (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            token      TEXT    NOT NULL UNIQUE,
            name       TEXT    NOT NULL,
            skin       TEXT    NOT NULL DEFAULT 'classic',
            wins       INTEGER NOT NULL DEFAULT 0,
            kills      INTEGER NOT NULL DEFAULT 0,
            matches    INTEGER NOT NULL DEFAULT 0,
            created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        SQL);

    return $pdo;
}

function sanitizeName(string $raw): string
{
    $name = trim((string) preg_replace('/[^\p{L}\p{N} _\-]/u', '', $raw));
    $name = mb_substr($name, 0, 16);
    return mb_strlen($name) >= 2 ? $name : 'Joueur' . random_int(100, 999);
}

function validSkin(string $skin): string
{
    return array_key_exists($skin, SKINS) ? $skin : 'knight';
}

/** Profil public : jamais le jeton. */
function publicProfile(array $p): array
{
    return [
        'id'      => (int) $p['id'],
        'name'    => $p['name'],
        'skin'    => $p['skin'],
        'wins'    => (int) $p['wins'],
        'kills'   => (int) $p['kills'],
        'matches' => (int) $p['matches'],
    ];
}

function findPlayerByToken(string $token): ?array
{
    $st = db()->prepare('SELECT * FROM players WHERE token = ?');
    $st->execute([$token]);
    $row = $st->fetch();
    return $row === false ? null : $row;
}

function createPlayer(string $name, string $skin): array
{
    $token = bin2hex(random_bytes(24));
    db()->prepare('INSERT INTO players (token, name, skin) VALUES (?, ?, ?)')
        ->execute([$token, $name, $skin]);

    $profile = findPlayerByToken($token);
    return ['token' => $token] + publicProfile($profile);
}

function updatePlayer(int $id, string $name, string $skin): void
{
    db()->prepare('UPDATE players SET name = ?, skin = ? WHERE id = ?')
        ->execute([$name, $skin, $id]);
}

function leaderboard(int $limit = 20): array
{
    $st = db()->prepare('SELECT id, name, skin, wins, kills, matches FROM players
                         ORDER BY wins DESC, kills DESC LIMIT ?');
    $st->bindValue(1, $limit, PDO::PARAM_INT);
    $st->execute();
    return array_map('publicProfile', $st->fetchAll());
}

/** Appelée uniquement par le serveur de jeu en fin de partie. */
function recordMatch(string $token, bool $won, int $kills): void
{
    db()->prepare('UPDATE players
                   SET matches = matches + 1, wins = wins + ?, kills = kills + ?
                   WHERE token = ?')
        ->execute([$won ? 1 : 0, $kills, $token]);
}
