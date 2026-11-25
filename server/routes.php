<?php
declare(strict_types=1);

/**
 * server/routes.php — routes de l'API REST (pseudo, skin, statistiques).
 *
 * Utilisées par le serveur de jeu (server.php, un seul site alwaysdata)
 * et par server/api.php (si le jeu est servi par Apache/PHP).
 *
 *   GET    /skins            liste des skins
 *   GET    /leaderboard      classement par victoires
 *   POST   /player           crée un joueur  { "name", "skin" } -> { "token", ... }
 *   GET    /player           profil courant (en-tête X-Player-Token)
 *   PATCH  /player           modifie pseudo et/ou skin
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
            return [200, ['skins' => SKINS]];
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

        if ($path === '/player' && ($method === 'GET' || $method === 'PATCH')) {
            $player = $token !== '' ? findPlayerByToken($token) : null;
            if ($player === null) {
                return [401, ['error' => 'jeton invalide ou absent']];
            }
            if ($method === 'GET') {
                return [200, publicProfile($player)];
            }
            $name = isset($body['name']) && is_string($body['name'])
                ? sanitizeName($body['name'])
                : $player['name'];
            $skin = isset($body['skin']) && is_string($body['skin'])
                ? validSkin($body['skin'])
                : $player['skin'];
            updatePlayer((int) $player['id'], $name, $skin);
            return [200, publicProfile(findPlayerByToken($player['token']))];
        }

        return [404, ['error' => 'route inconnue']];
    } catch (Throwable $e) {
        error_log('[api] ' . $e->getMessage());
        return [500, ['error' => 'erreur serveur']];
    }
}
