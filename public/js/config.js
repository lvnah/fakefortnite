// Configuration du client.
//
// WS_URL : adresse du serveur de jeu. Laisser null : le jeu se connecte tout seul à
//          wss://<adresse du site>/ws (site « Programme utilisateur » sur alwaysdata, sans Service).
//          À remplir seulement si le serveur de jeu est ailleurs, ex. "wss://autre-site.alwaysdata.net/ws".
// API_URL : chemin de l'API REST (même dossier que index.html).
window.GAME_CONFIG = {
    WS_URL: null,
    API_URL: 'api.php',
};
