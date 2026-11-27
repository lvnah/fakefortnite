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
];

/**
 * Skins d'armes débloqués par le passe de combat. Le client (public/js/items.js)
 * connaît les mêmes identifiants et sait les peindre.
 */
const WEAPON_SKINS = [
    'standard' => 'Standard',
    'woodland' => 'Camo forêt',
    'desert'   => 'Camo désert',
    'arctic'   => 'Camo arctique',
    'urban'    => 'Camo urbain',
    'tiger'    => 'Rayures tigre',
    'carbon'   => 'Carbone',
    'steel'    => 'Acier poli',
    'crimson'  => 'Rouge sang',
    'venom'    => 'Venin',
    'neon'     => 'Néon',
    'gold'     => 'Or massif',
];

/** Débloqué dès le premier niveau, sans passe de combat. */
const FREE_SKIN   = 'knight';
const FREE_WSKIN  = 'standard';

/**
 * Passe de combat : un palier par niveau gagné, une récompense à chaque fois.
 * Le palier n est obtenu en atteignant le niveau n + 1.
 */
function battlePass(): array
{
    static $pass = null;
    if ($pass !== null) {
        return $pass;
    }
    $skins = array_values(array_diff(array_keys(SKINS), [FREE_SKIN]));
    $wskins = array_values(array_diff(array_keys(WEAPON_SKINS), [FREE_WSKIN]));
    $pass = [];
    $tier = 1;
    // on alterne tenue et skin d'arme, les plus voyants à la fin
    while ($skins !== [] || $wskins !== []) {
        if ($wskins !== []) {
            $pass[] = ['tier' => $tier++, 'kind' => 'wskin', 'id' => array_shift($wskins), 'name' => ''];
        }
        if ($skins !== []) {
            $pass[] = ['tier' => $tier++, 'kind' => 'skin', 'id' => array_shift($skins), 'name' => ''];
        }
    }
    foreach ($pass as $i => $r) {
        $pass[$i]['name'] = $r['kind'] === 'skin' ? SKINS[$r['id']] : WEAPON_SKINS[$r['id']];
    }
    return $pass;
}

/** Expérience nécessaire pour passer du niveau $level au suivant. */
function xpNeeded(int $level): int
{
    return 600 + 100 * max(0, $level - 1);
}

/** Niveau, progression dans le niveau et total à atteindre, à partir de l'expérience. */
function levelInfo(int $xp): array
{
    $level = 1;
    $rest = max(0, $xp);
    while ($level < 100 && $rest >= xpNeeded($level)) {
        $rest -= xpNeeded($level);
        $level++;
    }
    return ['xp' => max(0, $xp), 'level' => $level, 'into' => $rest, 'need' => xpNeeded($level)];
}

/** Récompenses acquises au niveau donné (palier n obtenu au niveau n + 1). */
function passRewards(int $level): array
{
    return array_values(array_filter(battlePass(), static fn (array $r): bool => $r['tier'] < $level));
}

/** Tenues et skins d'armes dont le joueur dispose. */
function ownedSkins(int $level): array
{
    $skins = [FREE_SKIN];
    $wskins = [FREE_WSKIN];
    foreach (passRewards($level) as $r) {
        if ($r['kind'] === 'skin') {
            $skins[] = $r['id'];
        } else {
            $wskins[] = $r['id'];
        }
    }
    return ['skins' => $skins, 'wskins' => $wskins];
}

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
    $pdo->exec('PRAGMA foreign_keys = ON');
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

    // migrations : les colonnes ajoutées après coup (comptes, expérience, passe)
    $cols = array_column($pdo->query('PRAGMA table_info(players)')->fetchAll(), 'name');
    foreach ([
        'pass'  => "TEXT NOT NULL DEFAULT ''",
        'uname' => 'TEXT',
        'xp'    => 'INTEGER NOT NULL DEFAULT 0',
        'wskin' => "TEXT NOT NULL DEFAULT 'standard'",
    ] as $col => $def) {
        if (!in_array($col, $cols, true)) {
            $pdo->exec("ALTER TABLE players ADD COLUMN $col $def");
        }
    }
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS players_uname ON players (uname)');

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

function validWeaponSkin(string $skin): string
{
    return array_key_exists($skin, WEAPON_SKINS) ? $skin : FREE_WSKIN;
}

/** Profil public : jamais le jeton ni le mot de passe. */
function publicProfile(array $p): array
{
    $lvl = levelInfo((int) ($p['xp'] ?? 0));
    $own = ownedSkins($lvl['level']);
    return [
        'id'      => (int) $p['id'],
        'name'    => $p['name'],
        'skin'    => $p['skin'],
        'wskin'   => $p['wskin'] ?? FREE_WSKIN,
        'wins'    => (int) $p['wins'],
        'kills'   => (int) $p['kills'],
        'matches' => (int) $p['matches'],
        'account' => ($p['pass'] ?? '') !== '',
        'xp'      => $lvl['xp'],
        'level'   => $lvl['level'],
        'into'    => $lvl['into'],
        'need'    => $lvl['need'],
        'skins'   => $own['skins'],
        'wskins'  => $own['wskins'],
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

function updatePlayer(int $id, string $name, string $skin, string $wskin): void
{
    db()->prepare('UPDATE players SET name = ?, skin = ?, wskin = ? WHERE id = ?')
        ->execute([$name, $skin, $wskin, $id]);
}

// ----------------------------------------------------------------- comptes

function findPlayerByName(string $name): ?array
{
    $st = db()->prepare('SELECT * FROM players WHERE uname = ?');
    $st->execute([mb_strtolower($name)]);
    $row = $st->fetch();
    return $row === false ? null : $row;
}

/**
 * Crée un compte (pseudo + mot de passe) ou transforme le profil invité courant
 * en compte, pour que sa progression ne soit pas perdue.
 *
 * @return array{0:int, 1:array} code HTTP et corps de la réponse
 */
function registerAccount(string $name, string $password, string $skin, ?array $guest): array
{
    if (mb_strlen($password) < 6) {
        return [400, ['error' => 'mot de passe trop court (6 caractères minimum)']];
    }
    if (findPlayerByName($name) !== null) {
        return [409, ['error' => 'ce pseudo est déjà pris']];
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    if ($guest !== null && ($guest['pass'] ?? '') === '') {
        db()->prepare('UPDATE players SET name = ?, uname = ?, pass = ?, skin = ? WHERE id = ?')
            ->execute([$name, mb_strtolower($name), $hash, $skin, (int) $guest['id']]);
        $p = findPlayerByToken($guest['token']);
        return [200, ['token' => $guest['token']] + publicProfile($p)];
    }
    $token = bin2hex(random_bytes(24));
    db()->prepare('INSERT INTO players (token, name, uname, pass, skin) VALUES (?, ?, ?, ?, ?)')
        ->execute([$token, $name, mb_strtolower($name), $hash, $skin]);
    return [201, ['token' => $token] + publicProfile(findPlayerByToken($token))];
}

/** @return array{0:int, 1:array} */
function loginAccount(string $name, string $password): array
{
    $p = findPlayerByName($name);
    if ($p === null || ($p['pass'] ?? '') === '' || !password_verify($password, $p['pass'])) {
        return [401, ['error' => 'pseudo ou mot de passe incorrect']];
    }
    return [200, ['token' => $p['token']] + publicProfile($p)];
}

// ------------------------------------------------- expérience et passe de combat

/**
 * Ajoute de l'expérience et renvoie le résultat : niveau avant / après et
 * récompenses du passe débloquées au passage. Appelée par le serveur de jeu.
 */
function grantXp(string $token, int $gain): ?array
{
    $p = findPlayerByToken($token);
    if ($p === null || $gain <= 0) {
        return null;
    }
    $before = levelInfo((int) $p['xp'])['level'];
    db()->prepare('UPDATE players SET xp = xp + ? WHERE token = ?')->execute([$gain, $token]);
    $after = levelInfo((int) $p['xp'] + $gain);
    $won = array_values(array_filter(
        battlePass(),
        static fn (array $r): bool => $r['tier'] >= $before && $r['tier'] < $after['level'],
    ));
    return ['gain' => $gain, 'before' => $before, 'rewards' => $won] + $after;
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
