<?php
// Point d'entrée web de l'API (pseudo, skin, classement).
// Le dossier server/ doit se trouver à côté du dossier du jeu : fakeftn/public + fakeftn/server.
$api = dirname(__DIR__) . '/server/api.php';
if (!is_file($api)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"error":"dossier server introuvable à côté du dossier du jeu"}';
    exit;
}
require $api;
