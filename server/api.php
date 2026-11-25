<?php
declare(strict_types=1);

/**
 * server/api.php — entrée de l'API quand le jeu est servi par Apache/PHP (public/api.php).
 * Sur alwaysdata avec un seul site, c'est server.php qui répond directement à /api.php/…
 * Les routes sont dans routes.php.
 */

require_once __DIR__ . '/routes.php';

$token = $_SERVER['HTTP_X_PLAYER_TOKEN'] ?? '';
[$code, $data] = apiRoute(
    $_SERVER['REQUEST_METHOD'] ?? 'GET',
    $_SERVER['PATH_INFO'] ?? '/',
    is_string($token) ? $token : '',
    (string) file_get_contents('php://input'),
);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Player-Token');
http_response_code($code);
if ($data !== null) {
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
