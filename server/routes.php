<?php
declare(strict_types=1);

/**
 * server/routes.php — routes de l'API REST (pseudo, skin, statistiques).
 *
 * Utilisées par le serveur de jeu (server.php, un seul site alwaysdata)
 * et par server/api.php (si le jeu est servi par Apache/PHP).
 *
 *   GET    /skins            liste des tenues et des skins d'armes
 *   GET    /pass              paliers du passe de combat
 *   GET    /leaderboard       classement par victoires
 *   POST   /player            crée un profil invité { "name", "skin" } -> { "token", ... }
 *   GET    /player            profil courant (en-tête X-Player-Token)
 *   PATCH  /player            modifie pseudo, tenue et skin d'arme
 *   POST   /register          crée un compte { "name", "password" } (reprend le profil invité)
 *   POST   /login             connexion    { "name", "password" } -> { "token", ... }
 */

require_once __DIR__ . '/db.php';

/**
 * @return array{0:int, 1:?array} code HTTP et données JSON (null pour 204)
 */
function apiRoute(string $method, string $path, string $token, string $raw): array
{
    $path = rtrim($path, '/') ?: '/';
    if ($method === 'OPTIONS') {
        return [204, null];
    }

    try {
        if ($path === '/skins' && $method === 'GET') {
            return [200, ['skins' => SKINS, 'wskins' => WEAPON_SKINS]];
        }

        if ($path === '/pass' && $method === 'GET') {
            return [200, ['tiers' => battlePass(), 'skins' => SKINS, 'wskins' => WEAPON_SKINS]];
        }

        if ($path === '/leaderboard' && $method === 'GET') {
            return [200, ['top' => leaderboard(20)]];
        }

        $body = json_decode($raw !== '' ? $raw : '[]', true);
        $body = is_array($body) ? $body : [];

        if ($path === '/player' && $method === 'POST') {
            $name = sanitizeName(is_string($body['name'] ?? null) ? $body['name'] : '');
            $skin = validSkin(is_string($body['skin'] ?? null) ? $body['skin'] : 'knight');
            return [201, createPlayer($name, $skin)];
        }

        if ($path === '/register' && $method === 'POST') {
            $name = sanitizeName(is_string($body['name'] ?? null) ? $body['name'] : '');
            $pass = is_string($body['password'] ?? null) ? $body['password'] : '';
            $skin = validSkin(is_string($body['skin'] ?? null) ? $body['skin'] : FREE_SKIN);
            $guest = $token !== '' ? findPlayerByToken($token) : null;
            return registerAccount($name, $pass, $skin, $guest);
        }

        if ($path === '/login' && $method === 'POST') {
            $name = sanitizeName(is_string($body['name'] ?? null) ? $body['name'] : '');
            $pass = is_string($body['password'] ?? null) ? $body['password'] : '';
            return loginAccount($name, $pass);
        }

        if ($path === '/player' && ($method === 'GET' || $method === 'PATCH')) {
            $player = $token !== '' ? findPlayerByToken($token) : null;
            if ($player === null) {
                return [401, ['error' => 'jeton invalide ou absent']];
            }
            if ($method === 'GET') {
                return [200, publicProfile($player)];
            }
            // un compte garde son pseudo (il sert à se connecter) ; un invité peut en changer
            $name = isset($body['name']) && is_string($body['name']) && ($player['pass'] ?? '') === ''
                ? sanitizeName($body['name'])
                : $player['name'];
            // on ne peut porter que ce que le passe de combat a débloqué
            $own = ownedSkins(levelInfo((int) $player['xp'])['level']);
            $skin = isset($body['skin']) && is_string($body['skin']) && in_array($body['skin'], $own['skins'], true)
                ? $body['skin']
                : $player['skin'];
            $wskin = isset($body['wskin']) && is_string($body['wskin']) && in_array($body['wskin'], $own['wskins'], true)
                ? $body['wskin']
                : validWeaponSkin((string) ($player['wskin'] ?? FREE_WSKIN));
            if (!in_array($skin, $own['skins'], true)) {
                $skin = FREE_SKIN;
            }
            updatePlayer((int) $player['id'], $name, $skin, $wskin);
            return [200, publicProfile(findPlayerByToken($player['token']))];
        }

        return [404, ['error' => 'route inconnue']];
    } catch (Throwable $e) {
        error_log('[api] ' . $e->getMessage());
        return [500, ['error' => 'erreur serveur']];
    }
}
