<?php
declare(strict_types=1);

/**
 * server/server.php — serveur de jeu autoritaire (WebSocket natif, sans Composer).
 *
 *   php server/server.php        -> http://localhost:8300 (page + API + WebSocket /ws)
 *
 * Ce serveur fait TOUT : la page du jeu (dossier public/), l'API (/api.php/…) et le
 * temps réel (WebSocket sur /ws). Sur alwaysdata, un seul site suffit :
 *   type « Programme utilisateur », commande « php server.php »,
 *   répertoire de travail « fakeftn/server/ ». Pas de Service.
 * alwaysdata fournit l'adresse et le port d'écoute dans les variables IP et PORT.
 *
 * Le serveur détient la vérité : positions, tirs, dégâts, constructions, loot, tempête.
 * Le client n'envoie que des intentions. Simulation 60 Hz, instantanés 20 Hz.
 */

require_once __DIR__ . '/ws.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/http.php';
require_once __DIR__ . '/engine.php';
require_once __DIR__ . '/bots.php';
require_once __DIR__ . '/extras.php';

if (PHP_VERSION_ID < 80100) {
    fwrite(STDERR, '[ws] PHP 8.1 minimum requis (version actuelle : ' . PHP_VERSION . ")\n");
    exit(1);
}

// Adresse et port d'écoute : alwaysdata les fournit (IP / PORT, ou ALWAYSDATA_HTTPD_IP / _PORT).
define('PORT', (int) (getenv('PORT') ?: getenv('ALWAYSDATA_HTTPD_PORT') ?: 8300));
define('GAME_HOST', (string) (getenv('GAME_HOST') ?: getenv('IP') ?: getenv('ALWAYSDATA_HTTPD_IP') ?: '0.0.0.0'));

// =========================================================== RÉGLAGES DU JEU

const SNAP_INTERVAL  = 1.0 / 20.0;
const MAX_MSG_PER_S  = 220;
const MAX_ROOM       = 30;
define('BR_COUNTDOWN', (float) (getenv('BR_COUNTDOWN') ?: 40.0));   // attente dans le lobby (dès 1 joueur)
define('BOT_FILL', getenv('BR_BOTS') !== false && getenv('BR_BOTS') !== '' ? max(0, (int) getenv('BR_BOTS')) : 15);   // participants visés (bots en plus)
const BR_FULL_WAIT   = 8.0;      // attente quand la partie est pleine
const BALLOON_Y      = 135.0;
const BALLOON_SPEED  = 19.0;
const HP_MAX         = 100.0;
const SHIELD_MAX     = 150.0;   // gilet complet = 3 plaques de 50
// corps-à-corps (crosse de l'arme tenue) : de quoi finir quelqu'un, pas de quoi faire un duel
const SWING_RATE     = 0.5;
const SWING_REACH    = 3.2;
const MELEE_DMG_PLAYER = 10;
const MELEE_DMG_BUILD = 20;
const MELEE_DMG_NODE = 25;
/** Dégâts des gravats, selon le matériau de la pièce qui tombe. */
const DEBRIS_DMG     = ['wood' => 18.0, 'stone' => 28.0, 'metal' => 38.0];
const DEBRIS_RATE    = 0.3;    // un joueur ne peut être touché par des gravats que toutes les 0,3 s

// ---- économie : argent dans les coffres, points d'achat, largage de la classe du lobby
const CASH_MAX       = 99999;
const CASH_CHEST     = [120, 320];     // argent trouvé dans un coffre ordinaire
const CASH_AIRDROP   = [600, 900];     // argent d'un largage
const CASH_FLOOR     = [40, 110];      // liasse au sol
const CASH_KILL      = 250;            // argent récupéré sur un adversaire éliminé (en plus du sien)
const LOADOUT_COST   = 1000;           // prix d'un largage de classe à un point d'achat
const SHOP_REACH     = 3.6;
const SHOP_DROP_DELAY = 2.2;           // temps de chute du largage demandé
const AMMO_EMPTY     = ['light' => 0, 'medium' => 0, 'shells' => 0, 'heavy' => 0, 'rockets' => 0];
const BOOM_RADIUS    = 4.8;     // explosion de roquette
const BOOM_PLAYER    = 105.0;   // dégâts max aux joueurs
const BOOM_BUILD     = 520.0;   // dégâts max aux constructions (détruit un mur en métal au centre)
const RUNOVER_SPEED  = 7.0;
const VEH_ENTER      = 3.6;
const ZIP_REACH      = 3.4;
const DOOR_REACH     = 3.4;
const WATER_GRACE    = 8.0;     // secondes dans l'eau avant de se noyer
const WATER_DPS      = 6.0;
const LOBBY_REFILL   = 12.0;    // un coffre du lobby se referme (et se remplit) après ce délai
const MAX_AMMO       = 999;
const RESPAWN_DELAY  = 2.0;
const FALL_SAFE      = 21.0;   // ≈ 8 m de chute sans dégâts ; mortel vers 20 m

const RARITY_NAMES   = ['Commun', 'Peu commun', 'Rare', 'Épique', 'Légendaire'];
const RARITY_DMG     = [1.0, 1.05, 1.1, 1.16, 1.22];
const RARITY_RELOAD  = [1.0, 0.95, 0.9, 0.85, 0.8];

/**
 * Armes. spread / ads : dispersion (radians) au jugé / en visée ; bloom : ajout par tir.
 * fall : [distance de début, facteur minimal, distance du minimum].
 */
const WEAPONS = [
    'pistol' => ['name' => 'Pistolet', 'ammo' => 'light', 'dmg' => 24, 'rate' => 0.2, 'mag' => 16, 'reload' => 1.3,
        'spread' => 0.03, 'ads' => 0.01, 'bloom' => 0.22, 'range' => 160.0, 'pellets' => 1, 'head' => 2.0,
        'auto' => false, 'fall' => [40, 0.7, 120], 'rar' => [0, 3]],
    'smg' => ['name' => 'Mitraillette', 'ammo' => 'light', 'dmg' => 16, 'rate' => 0.075, 'mag' => 30, 'reload' => 2.0,
        'spread' => 0.05, 'ads' => 0.028, 'bloom' => 0.09, 'range' => 100.0, 'pellets' => 1, 'head' => 1.75,
        'auto' => true, 'fall' => [25, 0.6, 80], 'rar' => [0, 4]],
    'ar' => ['name' => "Fusil d'assaut", 'ammo' => 'medium', 'dmg' => 30, 'rate' => 0.17, 'mag' => 30, 'reload' => 2.2,
        'spread' => 0.035, 'ads' => 0.006, 'bloom' => 0.16, 'range' => 280.0, 'pellets' => 1, 'head' => 1.5,
        'auto' => true, 'fall' => [90, 0.75, 280], 'rar' => [0, 4]],
    'pump' => ['name' => 'Fusil à pompe', 'ammo' => 'shells', 'dmg' => 10, 'rate' => 0.85, 'mag' => 5, 'reload' => 4.0,
        'spread' => 0.075, 'ads' => 0.06, 'bloom' => 0.0, 'range' => 48.0, 'pellets' => 10, 'head' => 1.75,
        'auto' => false, 'fall' => [7, 0.3, 32], 'rar' => [0, 4]],
    'sniper' => ['name' => 'Sniper', 'ammo' => 'heavy', 'dmg' => 105, 'rate' => 1.6, 'mag' => 1, 'reload' => 2.4,
        'spread' => 0.11, 'ads' => 0.0, 'bloom' => 0.0, 'range' => 600.0, 'pellets' => 1, 'head' => 2.5,
        'auto' => false, 'speed' => 300.0, 'fall' => [600, 1.0, 600], 'rar' => [2, 4]],
    'rocket' => ['name' => 'Lance-roquettes', 'ammo' => 'rockets', 'dmg' => 0, 'rate' => 0.9, 'mag' => 1, 'reload' => 2.6,
        'spread' => 0.03, 'ads' => 0.0, 'bloom' => 0.0, 'range' => 400.0, 'pellets' => 1, 'head' => 1.0,
        'auto' => false, 'speed' => 62.0, 'grav' => 0.0, 'boom' => true, 'fall' => [400, 1.0, 400], 'rar' => [2, 4]],
];

/**
 * Objets utilisables. `kind` dit dans quel emplacement fixe ils vont :
 *   'lethal'   : touche létal (grenades)
 *   'tactical' : touche tactique (soins)
 *   'util'     : touche utilitaire (plateforme de saut)
 * Les plaques de gilet ne sont pas un emplacement : elles se comptent à part (touche G).
 */
const CONSUMABLES = [
    'bandage' => ['name' => 'Bandages', 'stack' => 6, 'time' => 2.2, 'hp' => 30, 'cap' => 100, 'r' => 0, 'kind' => 'tactical'],
    'medkit'  => ['name' => 'Trousse de soin', 'stack' => 3, 'time' => 4.0, 'hp' => 100, 'cap' => 100, 'r' => 1, 'kind' => 'tactical'],
    'pad'     => ['name' => 'Plateforme de saut', 'stack' => 2, 'time' => 0.5, 'pad' => true, 'r' => 2, 'kind' => 'util'],
    'grenade' => ['name' => 'Grenade', 'stack' => 4, 'time' => 0.0, 'nade' => true, 'r' => 1, 'kind' => 'lethal'],
    'smoke'   => ['name' => 'Fumigène', 'stack' => 3, 'time' => 0.0, 'nade' => true, 'smoke' => true, 'r' => 1, 'kind' => 'lethal'],
];

// ---- gilet porte-plaques (comme sur Warzone) : 3 plaques de 50, et des plaques en réserve
const PLATE_VALUE    = 50.0;
const PLATE_TIME     = 1.5;    // temps pour enfiler une plaque
const PLATE_CARRY    = 5;      // plaques transportées au maximum
const PLATE_PACK     = 2;      // plaques trouvées par paquet

/** Emplacements fixes : 0 arme principale, 1 arme secondaire, 2 létal, 3 tactique, 4 utilitaire. */
const SLOT_PRIMARY   = 0;
const SLOT_SECONDARY = 1;
const SLOT_LETHAL    = 2;
const SLOT_TACTICAL  = 3;
const SLOT_UTIL      = 4;
const SLOT_COUNT     = 5;
const SLOT_OF_KIND   = ['lethal' => SLOT_LETHAL, 'tactical' => SLOT_TACTICAL, 'util' => SLOT_UTIL];

/**
 * Accessoires d'arme. Ils ne font jamais de dégâts en plus : ils rendent le tir plus
 * droit, le recul plus tenu, la visée plus rapide ou le chargeur plus grand.
 *   adsSpread / hipSpread : multiplicateurs de dispersion (visée / au jugé)
 *   bloom  : multiplicateur de dispersion ajoutée par tir (tenue de l'arme)
 *   range  : multiplicateur de portée utile
 *   mag    : multiplicateur de chargeur
 *   adsK   : vitesse de mise en joue (1 = inchangée, > 1 = plus vite)
 *   moveK  : vitesse de déplacement en visée
 */
const ATTACHMENTS = [
    'holo'  => ['name' => 'Viseur holographique', 'adsSpread' => 0.70, 'adsK' => 1.15],
    'scope' => ['name' => 'Lunette 4×', 'adsSpread' => 0.50, 'range' => 1.2, 'adsK' => 0.75, 'zoom' => 0.62],
    'laser' => ['name' => 'Laser', 'hipSpread' => 0.68],
    'grip'  => ['name' => 'Poignée avant', 'bloom' => 0.72, 'adsSpread' => 0.9],
    'heavy' => ['name' => 'Canon lourd', 'range' => 1.3, 'hipSpread' => 0.85, 'moveK' => 0.92],
    'mag'   => ['name' => 'Chargeur étendu', 'mag' => 1.5],
    'stock' => ['name' => 'Crosse légère', 'moveK' => 1.12, 'adsK' => 1.1, 'bloom' => 1.1],
];
const ATTACH_MAX = 3;

/**
 * Atouts. Deux par classe.
 *   tacK    : endurance du sprint tactique
 *   moveK   : vitesse de déplacement
 *   healK   : vitesse des soins et des plaques
 *   reloadK : vitesse de rechargement
 *   ammoK   : munitions ramassées
 *   plates  : plaques transportées
 */
const PERKS = [
    'athlete'  => ['name' => 'Athlète', 'desc' => 'Sprint tactique bien plus long', 'tacK' => 1.6],
    'light'    => ['name' => 'Léger', 'desc' => 'Déplacement 8 % plus rapide', 'moveK' => 1.08],
    'medic'    => ['name' => 'Infirmier', 'desc' => 'Soins et plaques 35 % plus rapides', 'healK' => 1.35],
    'quickfix' => ['name' => 'Mains sûres', 'desc' => 'Rechargement 25 % plus rapide', 'reloadK' => 1.25],
    'scavenger'=> ['name' => 'Charognard', 'desc' => 'Munitions ramassées × 1,5', 'ammoK' => 1.5],
    'carrier'  => ['name' => 'Porteur', 'desc' => '8 plaques au lieu de 5', 'plates' => 8],
];
const PERK_SLOTS = 2;

const AMMO_NAMES = ['light' => 'Munitions légères', 'medium' => 'Munitions moyennes', 'shells' => 'Cartouches', 'heavy' => 'Munitions lourdes', 'rockets' => 'Roquettes'];
const AMMO_PACK  = ['light' => 30, 'medium' => 30, 'shells' => 8, 'heavy' => 6, 'rockets' => 3];

const LOOT_WEAPONS     = ['pistol' => 22, 'smg' => 18, 'ar' => 27, 'pump' => 23, 'sniper' => 8, 'rocket' => 6];
const LOOT_CONSUMABLES = ['bandage' => 30, 'medkit' => 16, 'pad' => 8, 'grenade' => 20, 'smoke' => 12];
const RARITY_CHEST     = [22, 34, 28, 12, 4];
const RARITY_FLOOR     = [45, 33, 16, 5, 1];

/** Phases de la tempête : attente, rétrécissement, rayon final, dégâts / s. */
const STORM_PHASES = [
    ['wait' => 70.0, 'shrink' => 45.0, 'radius' => 290.0, 'dps' => 1.0],
    ['wait' => 55.0, 'shrink' => 40.0, 'radius' => 170.0, 'dps' => 2.0],
    ['wait' => 45.0, 'shrink' => 32.0, 'radius' => 95.0, 'dps' => 4.0],
    ['wait' => 35.0, 'shrink' => 26.0, 'radius' => 45.0, 'dps' => 7.0],
    ['wait' => 25.0, 'shrink' => 22.0, 'radius' => 14.0, 'dps' => 10.0],
    ['wait' => 15.0, 'shrink' => 18.0, 'radius' => 0.0, 'dps' => 14.0],
];
const STORM_START = 560.0;

// =========================================================== OUTILS

function pickWeighted(array $weights)
{
    $total = array_sum($weights);
    $r = rndf() * $total;
    foreach ($weights as $k => $w) {
        $r -= $w;
        if ($r <= 0) {
            return $k;
        }
    }
    return array_key_first($weights);
}

function makeWeapon(string $type, int $r): array
{
    $w = WEAPONS[$type];
    $r = max($w['rar'][0], min($w['rar'][1], $r));
    return ['type' => $type, 'r' => $r, 'n' => 1, 'mag' => $w['mag'], 'att' => []];
}

function makeConsumable(string $type, int $n = 0): array
{
    $c = CONSUMABLES[$type];
    $def = ['bandage' => 3, 'medkit' => 1, 'pad' => 1, 'grenade' => 2, 'smoke' => 2][$type] ?? 1;
    return ['type' => $type, 'r' => $c['r'], 'n' => $n > 0 ? $n : $def];
}

function isWeapon(?array $it): bool
{
    return $it !== null && isset(WEAPONS[$it['type']]);
}

function isConsumable(?array $it): bool
{
    return $it !== null && isset(CONSUMABLES[$it['type']]);
}

function lootWeapon(array $rarityWeights): array
{
    return makeWeapon(pickWeighted(LOOT_WEAPONS), (int) pickWeighted($rarityWeights));
}

function ammoPack(string $type, int $mult = 1): array
{
    return ['type' => 'ammo', 'a' => $type, 'n' => AMMO_PACK[$type] * $mult, 'r' => 0];
}

function round3(array $v, int $p = 2): array
{
    return [round($v[0], $p), round($v[1], $p), round($v[2], $p)];
}

// =========================================================== PARTIES

function newRoom(string $id, string $mode): array
{
    $room = [
        'id'        => $id,
        'mode'      => $mode,                                   // 'br' | 'train' (terrain d'entraînement)
        'state'     => $mode === 'br' ? 'lobby' : 'playing',    // lobby -> bus -> playing -> ended
        'time'      => 0.0,
        'nextId'    => 1,
        'players'   => [],
        'buildings' => [],
        'cells'     => [],
        'cols'      => [],
        'nodes'     => [],
        'ncells'    => [],
        'chests'    => [],
        'pads'      => [],
        'shops'     => [],
        'nextPad'   => 1000,
        'lobbyLoot' => [],
        'lobbyT'    => 0.0,
        'zips'      => [],
        'vehicles'  => [],
        'drops'     => [],
        'nextDrop'  => 1,
        'nades'     => [],
        'intQ'      => [],
        'collapse'  => [],
        'nextNade'  => 1,
        'craters'   => [],
        'h'         => MapData::$base,
        'priv'      => null,
        'botLevel'  => BOT_LEVEL,
        'bullets'   => [],
        'events'    => [],
        'countdown' => -1.0,
        'bal'       => null,
        'startCount'=> 0,
        'storm'     => ['phase' => -1, 't' => 0.0, 'x' => 0.0, 'z' => 0.0, 'r' => STORM_START,
                        'fx' => 0.0, 'fz' => 0.0, 'fr' => STORM_START, 'nx' => 0.0, 'nz' => 0.0, 'nr' => STORM_START,
                        'shrinking' => false],
        'winner'    => null,
    ];
    loadMapInto($room);
    spawnShops($room);
    $room['events'] = [];   // l'état initial part dans le message de bienvenue
    return $room;
}

/** Bâtiments, arbres, coffres et loot de la carte. */
function loadMapInto(array &$room): void
{
    $m = MapData::$raw;
    foreach ($m['cols'] as $ck => $v) {
        $room['cols'][$ck] = (float) $v;
    }
    $L = $m['lobby'] ?? null;
    foreach ($m['pieces'] as [$type, $gx, $gy, $gz, $rot, $v, $mat, $st]) {
        $col = $room['cols'][cellKey($gx, $gz)] ?? snapColumn(($gx + 0.5) * CELL, ($gz + 0.5) * CELL);
        $max = (int) round(MATERIALS[$mat] * 1.2);
        // le lobby est incassable (roquettes et pioches pendant l'attente)
        $nb = $L !== null && abs(($gx + 0.5) * CELL - $L['x']) < $L['half'] + 4 && abs(($gz + 0.5) * CELL - $L['z']) < $L['half'] + 4;
        addPiece($room, [
            'type' => $type, 'gx' => $gx, 'gy' => $gy, 'gz' => $gz, 'rot' => $rot, 'v' => $v,
            'base' => $col + $gy * CELL, 'hp' => $max, 'max' => $max, 'mat' => $mat, 'st' => $st, 'm' => 1, 'nb' => $nb,
        ]);
    }
    foreach ($m['nodes'] as $i => $n) {
        addNode($room, $i, $n[0], (float) $n[1], (float) $n[2], (float) $n[3], (int) $n[4], isset($n[5]) ? (float) $n[5] : null);
    }
    $i = 0;
    foreach ([[$m['chests'], 0], [$m['ammo'] ?? [], 1]] as [$list, $kind]) {
        foreach ($list as [$x, $y, $z, $rot]) {
            $gy = max(terrainHeight($x, $z), supportHeight($room, $x, $y + 0.3, $z));
            $room['chests'][$i++] = ['x' => (float) $x, 'y' => $gy, 'z' => (float) $z, 'rot' => (float) $rot, 'open' => false, 'k' => $kind];
        }
    }
    foreach (($m['lobby']['chests'] ?? []) as [$x, $y, $z, $rot, $kind]) {
        $room['chests'][$i++] = ['x' => (float) $x, 'y' => (float) $y, 'z' => (float) $z, 'rot' => (float) $rot, 'open' => false,
            'k' => (int) $kind, 'lobby' => true, 'shutAt' => 0.0];
    }
    if ($room['mode'] === 'br') {
        foreach (($m['lobby']['loot'] ?? []) as [$type, $x, $y, $z]) {
            $room['lobbyLoot'][] = ['type' => $type, 'p' => [(float) $x, (float) $y, (float) $z], 'drop' => null];
        }
    }
    foreach ($m['pads'] ?? [] as $i => [$x, $y, $z]) {
        $room['pads'][$i] = ['id' => $i, 'x' => (float) $x, 'y' => (float) $y, 'z' => (float) $z];
    }
    foreach ($m['zips'] ?? [] as $i => [$a, $b]) {
        $a = array_map('floatval', $a);
        $b = array_map('floatval', $b);
        $room['zips'][$i] = ['id' => $i, 'a' => $a, 'b' => $b, 'len' => sqrt(($b[0] - $a[0]) ** 2 + ($b[1] - $a[1]) ** 2 + ($b[2] - $a[2]) ** 2)];
    }
    foreach ($m['vehicles'] ?? [] as $i => [$kind, $x, $z, $yaw]) {
        $room['vehicles'][$i] = ['id' => $i, 'kind' => $kind, 'pos' => [(float) $x, terrainHeight($x, $z), (float) $z], 'yaw' => (float) $yaw, 'driver' => null,
            'hp' => VEH_HP, 'pass' => [null, null, null]];
        parkVehicle($room, $i);
    }
    if ($room['mode'] === 'br') {
        foreach ($m['loot'] as [$x, $y, $z]) {
            if (rndf() > 0.72) {
                continue;
            }
            $gy = max(terrainHeight($x, $z), supportHeight($room, $x, $y + 0.3, $z));
            $roll = rndf();
            if ($roll < 0.55) {
                $w = lootWeapon(RARITY_FLOOR);
                spawnDrop($room, $w, [$x, $gy, $z], null);
                spawnDrop($room, ammoPack(WEAPONS[$w['type']]['ammo']), [$x + 0.7, $gy, $z + 0.3], null);
            } elseif ($roll < 0.72) {
                spawnDrop($room, makeConsumable(pickWeighted(LOOT_CONSUMABLES)), [$x, $gy, $z], null);
            } elseif ($roll < 0.86) {
                spawnDrop($room, ['type' => 'plate', 'n' => PLATE_PACK, 'r' => 1], [$x, $gy, $z], null);
            } else {
                spawnDrop($room, ammoPack(pickWeighted(['light' => 3, 'medium' => 3, 'shells' => 2, 'heavy' => 1])), [$x, $gy, $z], null);
            }
        }
    }
}

// =========================================================== OBJETS AU SOL

function spawnDrop(array &$room, array $item, array $p, ?array $from): int
{
    $id = $room['nextDrop']++;
    $room['drops'][$id] = ['id' => $id, 'it' => $item, 'p' => round3($p)];
    $ev = ['k' => 'dropAdd', 'd' => $room['drops'][$id]];
    if ($from !== null) {
        $ev['f'] = round3($from);
    }
    $room['events'][] = $ev;
    return $id;
}

function removeDrop(array &$room, int $id, ?int $by): void
{
    unset($room['drops'][$id]);
    $room['events'][] = ['k' => 'dropDel', 'id' => $id, 'by' => $by];
}

/** Sol sous un point (relief, eau ou construction). */
function floorAt(array $room, float $x, float $y, float $z): float
{
    return max(groundOrWater($x, $z), supportHeight($room, $x, $y, $z));
}

/** Objets éjectés autour d'un point (coffre, mort d'un joueur). */
function scatterDrops(array &$room, array $items, array $c, float $dir, float $dist): void
{
    $n = count($items);
    foreach (array_values($items) as $i => $item) {
        $a = $dir + ($n > 1 ? ($i / ($n - 1) - 0.5) * 1.9 : 0.0);
        $d = $dist + ($i % 2) * 0.5;
        $x = $c[0] + sin($a) * $d;
        $z = $c[2] + cos($a) * $d;
        spawnDrop($room, $item, [$x, floorAt($room, $x, $c[1] + 0.6, $z), $z], [$c[0], $c[1] + 0.6, $c[2]]);
    }
}

function openChest(array &$room, int $pid, int $cid): ?string
{
    $p = $room['players'][$pid];
    $c = $room['chests'][$cid] ?? null;
    if ($p['state'] !== 'alive' || $c === null) {
        return null;
    }
    if ($c['open']) {
        return 'coffre déjà ouvert';
    }
    if (!empty($c['lobby']) && $room['state'] !== 'lobby') {
        return null;
    }
    $ck = $c['k'] ?? 0;
    if (($ck === 3 || $ck === 4) && empty($c['land'])) {
        return 'le largage n\'est pas encore arrivé';
    }
    if ($ck === 4 && ($c['own'] ?? -1) !== $pid) {
        return 'ce largage appartient à un autre joueur';
    }
    if (!nearPoint($p, [$c['x'], $c['y'], $c['z']], INTERACT_REACH + 1.0)) {
        return 'trop loin du coffre';
    }
    if (!canSee($room, $p, [$c['x'], $c['y'] + 0.45, $c['z']], $pid)) {
        return 'le coffre est derrière un mur';
    }
    $room['chests'][$cid]['open'] = true;
    if (!empty($c['lobby'])) {
        $room['chests'][$cid]['shutAt'] = $room['time'] + LOBBY_REFILL;
    }
    $room['events'][] = ['k' => 'chest', 'c' => $cid, 'a' => $pid];
    chestLoot($room, $cid);
    return null;
}

/** Butin d'un coffre (ouvert par un joueur, ou parce que le sol sous lui a cédé). */
function chestLoot(array &$room, int $cid): void
{
    $c = $room['chests'][$cid];
    if (($c['k'] ?? 0) === 4) {
        // largage de classe : exactement la classe préparée dans le lobby
        scatterDrops($room, loadoutItems(sanitizeLoadout($c['lo'] ?? null)), [$c['x'], $c['y'], $c['z']], $c['rot'], 1.5);
        return;
    }
    if (($c['k'] ?? 0) >= 2) {
        // ravitaillement (2) ou largage (3)
        scatterDrops($room, specialLoot($c['k']), [$c['x'], $c['y'], $c['z']], $c['rot'], 1.6);
        return;
    }
    if (($c['k'] ?? 0) === 1) {
        // caisse de munitions
        $items = [ammoPack(pickWeighted(['light' => 4, 'medium' => 4, 'shells' => 3, 'heavy' => 2])),
            ammoPack(pickWeighted(['light' => 4, 'medium' => 4, 'shells' => 3, 'heavy' => 2]))];
        if (rndf() < 0.18) {
            $items[] = ammoPack('rockets');
        }
        scatterDrops($room, $items, [$c['x'], $c['y'], $c['z']], $c['rot'], 1.1);
        return;
    }
    $w = lootWeapon(RARITY_CHEST);
    $items = [$w, ammoPack(WEAPONS[$w['type']]['ammo'])];
    $items[] = makeConsumable(pickWeighted(LOOT_CONSUMABLES));
    $items[] = cashPack(CASH_CHEST);

    scatterDrops($room, $items, [$c['x'], $c['y'], $c['z']], $c['rot'], 1.4);
    return;
}

/** Segment a -> b coupé par une construction ? Les fenêtres comptent comme pleines (vitres). */
function segmentBlocked(array $room, array $a, array $b): bool
{
    $d = sqrt(($b[0] - $a[0]) ** 2 + ($b[1] - $a[1]) ** 2 + ($b[2] - $a[2]) ** 2);
    $n = max(1, (int) ceil($d / 0.2));
    for ($i = 1; $i < $n; $i++) {
        $t = $i / $n;
        $x = $a[0] + ($b[0] - $a[0]) * $t;
        $y = $a[1] + ($b[1] - $a[1]) * $t;
        $z = $a[2] + ($b[2] - $a[2]) * $t;
        foreach ([[0.0, false], [0.25, true]] as [$off, $wallsOnly]) {
            foreach (piecesInCell($room, (int) floor(($x + $off) / CELL), (int) floor(($z + $off) / CELL)) as $pc) {
                if ($wallsOnly && $pc['type'] !== 'wall') {
                    continue;
                }
                $q = $pc['type'] === 'wall' && (int) ($pc['v'] ?? 0) === 2 ? ['v' => 0] + $pc : $pc;
                foreach (pieceBoxes($q) as $bx) {
                    if ($x > $bx[0] && $x < $bx[3] && $y > $bx[1] && $y < $bx[4] && $z > $bx[2] && $z < $bx[5]) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

/** Ligne de vue du joueur vers un point (coffre) : yeux ou poitrine. */
function canSee(array $room, array $p, array $pt, int $pid): bool
{
    foreach ([1.5, 0.9] as $h) {
        if (!segmentBlocked($room, [$p['pos'][0], $p['pos'][1] + $h, $p['pos'][2]], $pt)) {
            return true;
        }
    }
    return false;
}

/** Ouvre / ferme une porte (mur avec porte). */
function toggleDoor(array &$room, int $pid, string $key, ?bool $want = null): ?string
{
    $p = $room['players'][$pid];
    $pc = $room['buildings'][$key] ?? null;
    if ($p['state'] !== 'alive' || $pc === null || !isDoor($pc)) {
        return null;
    }
    [$cx, $cz] = doorCenter($pc);
    if (sqrt(($cx - $p['pos'][0]) ** 2 + ($cz - $p['pos'][2]) ** 2) > DOOR_REACH || abs($pc['base'] - $p['pos'][1]) > 2.5) {
        return 'trop loin de la porte';
    }
    $open = $want ?? empty($pc['o']);
    if ($open === !empty($pc['o'])) {
        return null;
    }
    if (!$open && doorBlocked($room, $pc)) {
        return null;   // quelqu'un est dans l'encadrement
    }
    $room['buildings'][$key]['o'] = $open ? 1 : 0;
    // la porte s'ouvre du côté opposé à celui qui la pousse
    $side = $pc['rot'] === 0 ? ($p['pos'][2] < $pc['gz'] * CELL ? 1 : -1) : ($p['pos'][0] < $pc['gx'] * CELL ? 1 : -1);
    $room['buildings'][$key]['ds'] = $side;
    $room['events'][] = ['k' => 'door', 'key' => $key, 'o' => $open ? 1 : 0, 's' => $side, 'a' => $pid];
    return null;
}

function doorCenter(array $pc): array
{
    return $pc['rot'] === 0 ? [$pc['gx'] * CELL + 2.0, $pc['gz'] * CELL] : [$pc['gx'] * CELL, $pc['gz'] * CELL + 2.0];
}

function doorBlocked(array $room, array $pc): bool
{
    [$cx, $cz] = doorCenter($pc);
    foreach ($room['players'] as $o) {
        if (in_array($o['state'], ['alive', 'falling'], true) && abs($o['pos'][0] - $cx) < 1.2 && abs($o['pos'][2] - $cz) < 1.2
            && $o['pos'][1] > $pc['base'] - 1.0 && $o['pos'][1] < $pc['base'] + 2.6) {
            return true;
        }
    }
    return false;
}

function nearPoint(array $p, array $pt, float $reach): bool
{
    $dx = $pt[0] - $p['pos'][0];
    $dz = $pt[2] - $p['pos'][2];
    $dy = $pt[1] - $p['pos'][1];
    return $dx * $dx + $dz * $dz <= $reach * $reach && $dy > -3.0 && $dy < 2.6;
}

/** Emplacement fixe d'un objet : arme (principale / secondaire) ou utilitaire par catégorie. */
function slotFor(array $p, array $it): ?int
{
    if (isWeapon($it)) {
        // l'arme va dans l'emplacement libre, sinon elle remplace celle qu'on tient
        if ($p['slots'][SLOT_PRIMARY] === null) {
            return SLOT_PRIMARY;
        }
        if ($p['slots'][SLOT_SECONDARY] === null) {
            return SLOT_SECONDARY;
        }
        return $p['sel'] === SLOT_SECONDARY ? SLOT_SECONDARY : SLOT_PRIMARY;
    }
    if (isConsumable($it)) {
        return SLOT_OF_KIND[CONSUMABLES[$it['type']]['kind']] ?? null;
    }
    return null;
}

function pickUp(array &$room, int $pid, int $did): ?string
{
    $p = &$room['players'][$pid];
    $d = $room['drops'][$did] ?? null;
    if ($d === null || !in_array($p['state'], ['alive'], true)) {
        return null;
    }
    if (!nearPoint($p, $d['p'], INTERACT_REACH + 0.6)) {
        return 'trop loin';
    }
    $it = $d['it'];

    if ($it['type'] === 'ammo') {
        $p['ammo'][$it['a']] = min(MAX_AMMO, $p['ammo'][$it['a']] + (int) round($it['n'] * perkMult($p, 'ammoK')));
        removeDrop($room, $did, $pid);
        return null;
    }
    if ($it['type'] === 'cash') {
        addCash($room, $pid, (int) $it['n']);
        removeDrop($room, $did, $pid);
        return null;
    }
    if ($it['type'] === 'plate') {
        if ($p['plates'] >= plateCarry($p) && $p['sh'] >= SHIELD_MAX) {
            return 'gilet et plaques au maximum';
        }
        $take = min((int) $it['n'], plateCarry($p) - (int) $p['plates']);
        $p['plates'] += $take;
        $it['n'] -= $take;
        if ($it['n'] > 0) {
            $room['drops'][$did]['it'] = $it;
            $room['events'][] = ['k' => 'dropUpd', 'd' => $room['drops'][$did]];
        } else {
            removeDrop($room, $did, $pid);
        }
        return null;
    }
    if (isConsumable($it)) {
        // les objets utilisables s'empilent dans leur emplacement dédié
        $slot = SLOT_OF_KIND[CONSUMABLES[$it['type']]['kind']] ?? null;
        $max = CONSUMABLES[$it['type']]['stack'];
        $cur = $slot !== null ? $p['slots'][$slot] : null;
        if ($cur !== null && $cur['type'] === $it['type']) {
            $add = min($max - $cur['n'], $it['n']);
            if ($add <= 0) {
                return 'emplacement plein';
            }
            $p['slots'][$slot]['n'] += $add;
            $it['n'] -= $add;
            if ($it['n'] > 0) {
                $room['drops'][$did]['it'] = $it;
                $room['events'][] = ['k' => 'dropUpd', 'd' => $room['drops'][$did]];
            } else {
                removeDrop($room, $did, $pid);
            }
            return null;
        }
    }
    $slot = slotFor($p, $it);
    if ($slot === null) {
        return 'objet inconnu';
    }
    $old = $p['slots'][$slot];
    if ($old !== null) {
        cancelActions($p);
        spawnDrop($room, $old, [$d['p'][0], $d['p'][1], $d['p'][2]], round3([$p['pos'][0], $p['pos'][1] + 1.0, $p['pos'][2]]));
    }
    $p['slots'][$slot] = $it;
    removeDrop($room, $did, $pid);
    return null;
}

/**
 * Pose une plaque de gilet (touche G). Comme sur Warzone : une plaque à la fois,
 * 1,5 s, annulable, et on ne la gaspille pas si le gilet est déjà plein.
 */
function startPlate(array &$room, int $pid): ?string
{
    $p = &$room['players'][$pid];
    if ($p['state'] !== 'alive' || $p['use'] !== null) {
        return null;
    }
    if ((int) $p['plates'] <= 0) {
        return 'plus de plaques';
    }
    if ($p['sh'] >= SHIELD_MAX) {
        return 'gilet déjà complet';
    }
    $p['reload'] = null;
    $dur = PLATE_TIME / perkMult($p, 'healK');
    $p['use'] = ['slot' => -1, 'plate' => true, 'end' => $room['time'] + $dur, 'dur' => $dur];
    $room['events'][] = ['k' => 'plateStart', 'a' => $pid];
    return null;
}

function dropSelected(array &$room, int $pid): void
{
    $p = &$room['players'][$pid];
    $sel = $p['sel'];
    $it = $p['slots'][$sel] ?? null;
    if ($sel === 0 || $it === null || $p['state'] !== 'alive') {
        return;
    }
    cancelActions($p);
    $p['slots'][$sel] = null;
    $x = $p['pos'][0] - sin($p['yaw']) * 1.2;
    $z = $p['pos'][2] - cos($p['yaw']) * 1.2;
    spawnDrop($room, $it, [$x, floorAt($room, $x, $p['pos'][1] + 0.6, $z), $z], [$p['pos'][0], $p['pos'][1] + 1.0, $p['pos'][2]]);
}

/** Tout l'inventaire tombe au sol à la mort (BR). */
function dropAll(array &$room, int $pid): void
{
    $p = $room['players'][$pid];
    $items = [];
    for ($i = 0; $i < SLOT_COUNT; $i++) {
        if (($p['slots'][$i] ?? null) !== null) {
            $items[] = $p['slots'][$i];
        }
    }
    foreach ($p['ammo'] as $a => $n) {
        if ($n > 0) {
            $items[] = ['type' => 'ammo', 'a' => $a, 'n' => $n, 'r' => 0];
        }
    }
    if (($p['cash'] ?? 0) > 0) {
        $items[] = ['type' => 'cash', 'n' => (int) $p['cash'] + CASH_KILL, 'r' => 0];
    } else {
        $items[] = ['type' => 'cash', 'n' => CASH_KILL, 'r' => 0];
    }
    $c = $p['pos'];
    $n = count($items);
    foreach ($items as $i => $item) {
        $a = ($i / max(1, $n)) * 2 * M_PI;
        $d = 1.0 + ($i % 3) * 0.6;
        $x = $c[0] + sin($a) * $d;
        $z = $c[2] + cos($a) * $d;
        spawnDrop($room, $item, [$x, floorAt($room, $x, $c[1] + 0.6, $z), $z], [$c[0], $c[1] + 1.0, $c[2]]);
    }
}

// =========================================================== CONSTRUCTIONS

/**
 * Pièce cassable ? Tout est destructible (maisons de la carte comprises) ; seule la plateforme
 * d'attente reste intacte tant que la partie n'a pas commencé, pour ne pas en faire tomber
 * les joueurs avant le départ.
 */
function pieceBreakable(array $room, array $pc): bool
{
    return empty($pc['nb']) || $room['state'] !== 'lobby';
}

function damageBuilding(array &$room, string $key, float $dmg, ?int $by): void
{
    if (!isset($room['buildings'][$key]) || !pieceBreakable($room, $room['buildings'][$key])) {
        return;
    }
    $room['buildings'][$key]['hp'] -= $dmg;
    // dégâts reçus (pour les fissures) : distincts des PV qui montent pendant la construction
    $room['buildings'][$key]['lost'] = ($room['buildings'][$key]['lost'] ?? 0.0) + $dmg;
    $hp = $room['buildings'][$key]['hp'];
    if ($hp <= 0) {
        $pc = $room['buildings'][$key];
        removePiece($room, $key);
        unset($room['collapse'][$key]);
        $room['events'][] = ['k' => 'bDel', 'key' => $key, 'mat' => $pc['mat']];
        crushPlayers($room, $pc, $by);   // les gravats blessent qui se trouvait dedans / juste dessous
        pieceRemoved($room, $pc);     // ce qu'elle portait tombe ; effondrement si plus rien ne touche le sol
    } else {
        $room['events'][] = ['k' => 'bHp', 'key' => $key, 'hp' => (int) ceil($hp), 'l' => (int) round($room['buildings'][$key]['lost'])];
    }
}

function pieceWire(array $pc): array
{
    // [4] = orientation de la clé (inchangée par l'édition), [15] = orientation réelle
    return [$pc['type'], $pc['gx'], $pc['gy'], $pc['gz'], $pc['krot'] ?? $pc['rot'], $pc['v'] ?? 0, $pc['mat'], $pc['st'] ?? 0,
        (int) ceil($pc['hp']), (int) $pc['max'], round($pc['base'], 2), isset($pc['bt']) ? round($pc['bt'], 2) : 0,
        (int) ($pc['o'] ?? 0), (int) ($pc['ds'] ?? 1), isset($pc['e']) ? (int) $pc['e'] : -1, $pc['rot'],
        (empty($pc['m']) && empty($pc['nb'])) ? (int) ($pc['owner'] ?? -1) : -1, (int) round($pc['lost'] ?? 0)];
}

// =========================================================== ARGENT, BOUTIQUES, LARGAGE DE CLASSE

/** Liasse de billets à ramasser. */
function cashPack(array $range): array
{
    return ['type' => 'cash', 'n' => mt_rand($range[0], $range[1]), 'r' => 0];
}

function addCash(array &$room, int $pid, int $n): void
{
    if ($n === 0 || !isset($room['players'][$pid])) {
        return;
    }
    $p = &$room['players'][$pid];
    $p['cash'] = max(0, min(CASH_MAX, (int) ($p['cash'] ?? 0) + $n));
    $room['events'][] = ['k' => 'cash', 'a' => $pid, 'n' => $n, 'total' => $p['cash']];
    unset($p);
}

/**
 * Classe préparée dans le lobby : deux armes avec leurs accessoires, un létal, un
 * tactique et deux atouts. Tout est revalidé ici : le client ne choisit que des
 * identifiants connus, et jamais plus d'accessoires ou d'atouts que prévu.
 */
function sanitizeLoadout($raw): array
{
    $out = ['name' => 'Classe', 'primary' => 'ar', 'primaryAtt' => ['holo'], 'secondary' => 'pump',
        'secondaryAtt' => [], 'lethal' => 'grenade', 'tactical' => 'bandage', 'perks' => ['athlete', 'medic']];
    if (!is_array($raw)) {
        return $out;
    }
    if (is_string($raw['name'] ?? null)) {
        $n = trim(preg_replace('/\s+/u', ' ', mb_substr($raw['name'], 0, 20)));
        if ($n !== '') {
            $out['name'] = $n;
        }
    }
    foreach ([['primary', 'primaryAtt'], ['secondary', 'secondaryAtt']] as [$wk, $ak]) {
        $v = is_string($raw[$wk] ?? null) ? $raw[$wk] : '';
        if (isset(WEAPONS[$v])) {
            $out[$wk] = $v;
        }
        $att = [];
        foreach (is_array($raw[$ak] ?? null) ? $raw[$ak] : [] as $a) {
            if (is_string($a) && isset(ATTACHMENTS[$a]) && !in_array($a, $att, true) && count($att) < ATTACH_MAX) {
                $att[] = $a;
            }
        }
        $out[$ak] = $att;
    }
    foreach (['lethal' => 'lethal', 'tactical' => 'tactical'] as $k => $kind) {
        $v = is_string($raw[$k] ?? null) ? $raw[$k] : '';
        if (isset(CONSUMABLES[$v]) && CONSUMABLES[$v]['kind'] === $kind) {
            $out[$k] = $v;
        }
    }
    $perks = [];
    foreach (is_array($raw['perks'] ?? null) ? $raw['perks'] : [] as $pk) {
        if (is_string($pk) && isset(PERKS[$pk]) && !in_array($pk, $perks, true) && count($perks) < PERK_SLOTS) {
            $perks[] = $pk;
        }
    }
    $out['perks'] = $perks;
    return $out;
}

/** Contenu d'un largage de classe : les armes équipées de leurs accessoires. */
function loadoutItems(array $lo): array
{
    $items = [];
    foreach ([['primary', 'primaryAtt'], ['secondary', 'secondaryAtt']] as [$wk, $ak]) {
        $w = makeWeapon($lo[$wk], 3);
        $w['att'] = $lo[$ak];
        $w['mag'] = weaponStats($w)['mag'];
        $items[] = $w;
        $items[] = ammoPack(WEAPONS[$lo[$wk]]['ammo'], 2);
    }
    $items[] = makeConsumable($lo['lethal'], CONSUMABLES[$lo['lethal']]['stack']);
    $items[] = makeConsumable($lo['tactical'], CONSUMABLES[$lo['tactical']]['stack']);
    $items[] = ['type' => 'plate', 'n' => PLATE_PACK, 'r' => 1];
    return $items;
}

/** Statistiques d'une arme, accessoires compris. */
function weaponStats(array $item): array
{
    $w = WEAPONS[$item['type']];
    $k = ['adsSpread' => 1.0, 'hipSpread' => 1.0, 'bloom' => 1.0, 'range' => 1.0, 'mag' => 1.0,
        'adsK' => 1.0, 'moveK' => 1.0, 'zoom' => 1.0];
    foreach ($item['att'] ?? [] as $a) {
        foreach (ATTACHMENTS[$a] ?? [] as $key => $v) {
            if (isset($k[$key])) {
                $k[$key] *= (float) $v;
            }
        }
    }
    $w['ads'] *= $k['adsSpread'];
    $w['spread'] *= $k['hipSpread'];
    $w['bloom'] *= $k['bloom'];
    $w['range'] *= $k['range'];
    $w['mag'] = (int) round($w['mag'] * $k['mag']);
    $w['fall'] = [$w['fall'][0] * $k['range'], $w['fall'][1], $w['fall'][2] * $k['range']];
    $w['adsK'] = $k['adsK'];
    $w['moveK'] = $k['moveK'];
    $w['zoom'] = $k['zoom'];
    return $w;
}

/** Cumul des atouts de la classe du joueur. */
function perkMult(array $p, string $key, float $def = 1.0): float
{
    $v = $def;
    foreach ($p['loadout']['perks'] ?? [] as $pk) {
        if (isset(PERKS[$pk][$key])) {
            $v *= (float) PERKS[$pk][$key];
        }
    }
    return $v;
}

/** Nombre de plaques transportables (atout « Porteur »). */
function plateCarry(array $p): int
{
    $n = PLATE_CARRY;
    foreach ($p['loadout']['perks'] ?? [] as $pk) {
        if (isset(PERKS[$pk]['plates'])) {
            $n = max($n, (int) PERKS[$pk]['plates']);
        }
    }
    return $n;
}

/**
 * Points d'achat : un par lieu-dit de la carte, posé au sol en lisière du village
 * (pas dans une maison, pas dans un arbre), plus un près du centre de la carte.
 */
function spawnShops(array &$room): void
{
    $room['shops'] = [];
    $id = 0;
    $spots = [];
    foreach (MapData::$raw['pois'] ?? [] as $poi) {
        $spots[] = [(float) $poi['x'], (float) $poi['z'], (string) ($poi['name'] ?? 'Point d\'achat')];
    }
    foreach ($spots as [$x, $z, $name]) {
        $placed = false;
        $fallback = null;
        for ($try = 0; $try < 90; $try++) {
            $a = rndf() * 2 * M_PI;
            $r = 10.0 + rndf() * 26.0;
            $sx = $x + cos($a) * $r;
            $sz = $z + sin($a) * $r;
            if (terrainHeight($sx, $sz) < 1.2 || sqrt($sx * $sx + $sz * $sz) > PLAY_RADIUS - 10) {
                continue;
            }
            $gx = (int) floor($sx / CELL);
            $gz = (int) floor($sz / CELL);
            $free = !piecesInCell($room, $gx, $gz) && !nodesInRadius($room, $sx, $sz, 2.4);
            $fallback ??= [$sx, $sz];
            if (!$free) {
                continue;
            }
            addShop($room, $id++, $sx, $sz, $name);
            $placed = true;
            break;
        }
        if (!$placed && $fallback !== null) {
            addShop($room, $id++, $fallback[0], $fallback[1], $name);
        }
    }
}

function addShop(array &$room, int $id, float $x, float $z, string $name): void
{
    $room['shops'][$id] = ['id' => $id, 'x' => $x, 'y' => floorAt($room, $x, terrainHeight($x, $z) + 1.0, $z), 'z' => $z,
        'rot' => rndf() * 6.28, 'name' => $name];
}

function shopsWire(array $room): array
{
    $out = [];
    foreach ($room['shops'] ?? [] as $s) {
        $out[] = [$s['id'], round($s['x'], 2), round($s['y'], 2), round($s['z'], 2), round($s['rot'], 3), $s['name']];
    }
    return $out;
}

/** Achat d'un largage de classe à un point d'achat. */
function buyLoadout(array &$room, int $pid): ?string
{
    $p = &$room['players'][$pid];
    if ($p['state'] !== 'alive') {
        return null;
    }
    $best = null;
    foreach ($room['shops'] ?? [] as $s) {
        if (nearPoint($p, [$s['x'], $s['y'], $s['z']], SHOP_REACH)) {
            $best = $s;
            break;
        }
    }
    if ($best === null) {
        return 'aucun point d\'achat à portée';
    }
    if ((int) ($p['cash'] ?? 0) < LOADOUT_COST) {
        return 'il faut ' . LOADOUT_COST . ' $ pour un largage';
    }
    $p['cash'] -= LOADOUT_COST;
    $cash = (int) $p['cash'];
    $lo = $p['loadout'];
    $x = $p['pos'][0];
    $z = $p['pos'][2];
    unset($p);
    $room['events'][] = ['k' => 'cash', 'a' => $pid, 'n' => -LOADOUT_COST, 'total' => $cash];
    // le largage tombe à côté du point d'achat, marqué au nom du joueur
    $gy = floorAt($room, $x, terrainHeight($x, $z) + 1.0, $z);
    $cid = addSpecialChest($room, 4, $x, $gy + SHOP_DROP_DELAY * AIRDROP_FALL + 18.0, $z, rndf() * 6.28,
        ['gy' => $gy, 'land' => false, 'own' => $pid, 'lo' => $lo]);
    $room['events'][] = ['k' => 'loadoutDrop', 'a' => $pid, 'c' => $cid, 'p' => [round($x, 1), round($z, 1)]];
    return null;
}

// =========================================================== TIR

/** Point de départ des tirs : sur l'axe de la caméra (épaule droite), comme le viseur. */
function aimOrigin(array $room, array $p, float $yaw): array
{
    $head = [$p['pos'][0], $p['pos'][1] + EYE_H - (!empty($p['in']['crouch']) && $p['ground'] ? 0.35 : 0.0), $p['pos'][2]];
    $right = [cos($yaw), 0.0, -sin($yaw)];
    $hit = raycastWorld($room, $head, $right, SHOULDER, null, false);
    $s = $hit === null ? SHOULDER : max(0.0, $hit['t'] - 0.1);
    return [$head[0] + $right[0] * $s, $head[1], $head[2] + $right[2] * $s];
}

function spreadDir(float $yaw, float $pitch, float $spread): array
{
    $f = dirFromAngles($yaw, $pitch);
    if ($spread <= 0.0) {
        return $f;
    }
    $a = rndf() * 2 * M_PI;
    $r = sqrt(rndf()) * $spread;
    $right = [cos($yaw), 0.0, -sin($yaw)];
    $up = [
        $right[1] * $f[2] - $right[2] * $f[1],
        $right[2] * $f[0] - $right[0] * $f[2],
        $right[0] * $f[1] - $right[1] * $f[0],
    ];
    $d = [
        $f[0] + ($right[0] * cos($a) + $up[0] * sin($a)) * $r,
        $f[1] + ($right[1] * cos($a) + $up[1] * sin($a)) * $r,
        $f[2] + ($right[2] * cos($a) + $up[2] * sin($a)) * $r,
    ];
    $l = sqrt($d[0] ** 2 + $d[1] ** 2 + $d[2] ** 2);
    return [$d[0] / $l, $d[1] / $l, $d[2] / $l];
}

function currentSpread(array $p, array $w): float
{
    $ads = !empty($p['in']['ads']);
    $s = $ads ? $w['ads'] : $w['spread'];
    $moving = abs($p['vel'][0]) + abs($p['vel'][2]) > 1.0;
    if (!$p['ground']) {
        $s *= 2.0;
    } elseif ($moving) {
        $s *= $ads ? 1.3 : 1.5;
    }
    if (!empty($p['in']['crouch']) && $p['ground']) {
        $s *= 0.75;
    }
    return $s + $p['bloom'] * ($ads ? 0.03 : 0.06);
}

function falloff(array $w, float $dist): float
{
    [$start, $min, $end] = $w['fall'];
    if ($dist <= $start) {
        return 1.0;
    }
    if ($dist >= $end) {
        return $min;
    }
    return 1.0 - (1.0 - $min) * ($dist - $start) / ($end - $start);
}

function fire(array &$room, int $pid, array $m): void
{
    $p = &$room['players'][$pid];
    $slot = $p['sel'];
    $item = $p['slots'][$slot] ?? null;
    if ($p['state'] !== 'alive' || !isWeapon($item) || $p['reload'] !== null) {
        return;
    }
    $w = weaponStats($item);
    if ($room['time'] - $p['lastShot'] < $w['rate'] * 0.92) {
        return;
    }
    if ($item['mag'] <= 0) {
        startReload($room, $pid);
        return;
    }
    $p['use'] = null;
    $p['slots'][$slot]['mag']--;
    $p['lastShot'] = $room['time'];

    $yaw = (float) ($m['yaw'] ?? $p['yaw']);
    $pitch = max(-1.45, min(1.45, (float) ($m['pitch'] ?? $p['pitch'])));
    if (!is_finite($yaw) || !is_finite($pitch)) {
        return;
    }
    $o = aimOrigin($room, $p, $yaw);
    $spread = currentSpread($p, $w);
    $dmgMult = RARITY_DMG[$item['r']];
    $p['bloom'] = min(1.0, $p['bloom'] + $w['bloom']);
    $hits = [];
    $ends = [];

    for ($i = 0; $i < $w['pellets']; $i++) {
        $d = spreadDir($yaw, $pitch, $spread);
        if (isset($w['speed'])) {
            $bid = $room['nextId']++;
            $room['bullets'][$bid] = [
                'id' => $bid, 'o' => $pid, 'p' => $o, 'w' => $item['type'], 'start' => $o,
                'v' => [$d[0] * $w['speed'], $d[1] * $w['speed'], $d[2] * $w['speed']],
                'dmg' => $w['dmg'] * $dmgMult, 'head' => $w['head'], 'ttl' => isset($w['boom']) ? 6.0 : 3.0,
                'grav' => $w['grav'] ?? 9.8, 'boom' => isset($w['boom']) ? $dmgMult : 0.0,
            ];
            $ends[] = null;
            continue;
        }
        $hit = raycastWorld($room, $o, $d, $w['range'], $pid);
        $len = $hit['t'] ?? $w['range'];
        $end = [$o[0] + $d[0] * $len, $o[1] + $d[1] * $len, $o[2] + $d[2] * $len];
        $ends[] = [round3($end), $hit['kind'] ?? null];
        if ($hit !== null) {
            $dmg = $w['dmg'] * $dmgMult * falloff($w, $len);
            collectHit($room, $hits, $pid, $hit, $dmg, $w['head'], $end);
        }
    }
    $room['events'][] = ['k' => 'fire', 'a' => $pid, 'w' => $item['type'], 'r' => $item['r'], 'o' => round3($o), 'e' => $ends];
    flushHits($room, $hits, $pid);
    if ($p['slots'][$slot]['mag'] <= 0) {
        startReload($room, $pid);
    }
}

/** Regroupe les plombs d'un même tir (un seul chiffre de dégâts par cible). */
function collectHit(array &$room, array &$hits, int $pid, array $hit, float $dmg, float $headMult, array $at): void
{
    if ($hit['kind'] === 'build') {
        damageBuilding($room, $hit['key'], $dmg, $pid);
        return;
    }
    // véhicules : environ 25 balles pour les mettre hors service (les plombs du fusil à pompe comptent moins)
    if ($hit['kind'] === 'veh') {
        damageVehicle($room, $hit['id'], min(VEH_BULLET, $dmg), $pid);
        return;
    }
    if ($hit['kind'] === 'node' && ($room['nodes'][$hit['id']]['k'] ?? '') === 'veh') {
        damageVehicle($room, $room['nodes'][$hit['id']]['var'], min(VEH_BULLET, $dmg), $pid);
        return;
    }
    if ($hit['kind'] !== 'player') {
        return;
    }
    $id = $hit['id'];
    $mult = $hit['head'] ? $headMult : 1.0;
    $hits[$id] ??= ['d' => 0.0, 'h' => false, 'p' => $at];
    $hits[$id]['d'] += $dmg * $mult;
    $hits[$id]['h'] = $hits[$id]['h'] || $hit['head'];
}

function flushHits(array &$room, array $hits, int $pid): void
{
    foreach ($hits as $vid => $h) {
        damagePlayer($room, $vid, $h['d'], $pid, $h['h'], $h['p']);
    }
}

function tickBullets(array &$room, float $dt): void
{
    foreach (array_keys($room['bullets']) as $bid) {
        $b = $room['bullets'][$bid];
        $b['ttl'] -= $dt;
        $b['v'][1] -= $b['grav'] * $dt;
        $from = $b['p'];
        $to = [$from[0] + $b['v'][0] * $dt, $from[1] + $b['v'][1] * $dt, $from[2] + $b['v'][2] * $dt];
        $len = sqrt(($to[0] - $from[0]) ** 2 + ($to[1] - $from[1]) ** 2 + ($to[2] - $from[2]) ** 2);
        $hit = null;
        if ($len > 1e-4) {
            $d = [($to[0] - $from[0]) / $len, ($to[1] - $from[1]) / $len, ($to[2] - $from[2]) / $len];
            $hit = raycastWorld($room, $from, $d, $len, $b['o']);
        }
        if ($hit !== null && $b['boom'] > 0.0) {
            $t = max(0.0, $hit['t'] - 0.25);
            unset($room['bullets'][$bid]);
            rocketBlast($room, [$from[0] + $d[0] * $t, $from[1] + $d[1] * $t, $from[2] + $d[2] * $t], $b['o'], $b['boom']);
            continue;
        }
        if ($hit !== null) {
            $t = $hit['t'];
            $at = [$from[0] + $d[0] * $t, $from[1] + $d[1] * $t, $from[2] + $d[2] * $t];
            $room['events'][] = ['k' => 'impact', 'p' => round3($at), 'kind' => $hit['kind']];
            $hits = [];
            collectHit($room, $hits, $b['o'], $hit, $b['dmg'], $b['head'], $at);
            flushHits($room, $hits, $b['o']);
            unset($room['bullets'][$bid]);
            continue;
        }
        if ($b['ttl'] <= 0.0) {
            unset($room['bullets'][$bid]);
            if ($b['boom'] > 0.0) {
                rocketBlast($room, $b['p'], $b['o'], $b['boom']);
            }
            continue;
        }
        $b['p'] = $to;
        $room['bullets'][$bid] = $b;
    }
}

/** Explosion de roquette : détruit les constructions proches, blesse les joueurs à découvert. */
function rocketBlast(array &$room, array $c, int $owner, float $mult): void
{
    blast($room, $c, $owner, $mult, BOOM_RADIUS, BOOM_PLAYER, BOOM_BUILD, 'r');
}

// =========================================================== VÉHICULES, TYROLIENNES, ÉDITION

/** Véhicule garé : deux cylindres d'obstacle (avant et arrière). */
function parkVehicle(array &$room, int $vid): void
{
    $v = $room['vehicles'][$vid];
    $fx = -sin($v['yaw']);
    $fz = -cos($v['yaw']);
    foreach ([0, 1] as $k) {
        $o = $k === 0 ? 1.15 : -1.15;
        addNode($room, 100000 + $vid * 2 + $k, 'veh', $v['pos'][0] + $fx * $o, $v['pos'][2] + $fz * $o, 0.0, $vid, $v['pos'][1]);
    }
}

function unparkVehicle(array &$room, int $vid): void
{
    removeNode($room, 100000 + $vid * 2);
    removeNode($room, 100000 + $vid * 2 + 1);
}

function vehicleWire(array $v): array
{
    return [$v['id'], $v['kind'], round($v['pos'][0], 2), round($v['pos'][1], 2), round($v['pos'][2], 2), round($v['yaw'], 3), $v['driver'],
        (int) ceil($v['hp'] ?? VEH_HP), empty($v['wreck']) ? 0 : 1, $v['pass'] ?? [null, null, null]];
}

function enterVehicle(array &$room, int $pid): ?string
{
    $p = &$room['players'][$pid];
    if ($p['state'] !== 'alive' || $p['veh'] !== null || $p['zip'] !== null || !empty($p['seat'])) {
        return null;
    }
    $best = null;
    foreach ($room['vehicles'] as $vid => $v) {
        if (!empty($v['wreck'])) {
            continue;
        }
        $d = sqrt(($v['pos'][0] - $p['pos'][0]) ** 2 + ($v['pos'][2] - $p['pos'][2]) ** 2);
        if ($d < VEH_ENTER && abs($v['pos'][1] - $p['pos'][1]) < 2.5 && ($best === null || $d < $best[0])) {
            $best = [$d, $vid];
        }
    }
    if ($best === null) {
        return 'aucun véhicule à portée';
    }
    $vid = $best[1];
    if ($room['vehicles'][$vid]['driver'] !== null) {
        unset($p);
        return enterSeat($room, $pid, $vid);   // place passager
    }
    unparkVehicle($room, $vid);
    $room['vehicles'][$vid]['driver'] = $pid;
    cancelActions($p);
    $p['veh'] = $vid;
    $p['cyaw'] = $room['vehicles'][$vid]['yaw'];
    $p['cspd'] = 0.0;
    $p['pos'] = $room['vehicles'][$vid]['pos'];
    $p['vel'] = [0.0, 0.0, 0.0];
    $p['ground'] = true;
    $p['slide'] = 0.0;
    $room['events'][] = ['k' => 'vEnter', 'v' => $vid, 'a' => $pid];
    return null;
}

function exitVehicle(array &$room, int $pid): void
{
    $p = &$room['players'][$pid];
    $vid = $p['veh'];
    if ($vid === null) {
        return;
    }
    $v = &$room['vehicles'][$vid];
    $v['pos'] = $p['pos'];
    $v['yaw'] = $p['cyaw'];
    $v['driver'] = null;
    $p['veh'] = null;
    $p['cspd'] = 0.0;
    // on descend du côté gauche (ou droit si bloqué)
    $rx = cos($v['yaw']);
    $rz = -sin($v['yaw']);
    foreach ([-2.0, 2.0, -3.0, 3.0] as $side) {
        $x = $v['pos'][0] + $rx * $side;
        $z = $v['pos'][2] + $rz * $side;
        $y = floorAt($room, $x, $v['pos'][1] + 1.0, $z);
        if (!insideSolidAt($room, $x, $y + 0.9, $z)) {
            $p['pos'] = [$x, $y, $z];
            break;
        }
    }
    $p['vel'] = [0.0, 0.0, 0.0];
    $p['ground'] = false;
    unset($v);
    parkVehicle($room, $vid);
    $room['events'][] = ['k' => 'vExit', 'v' => vehicleWire($room['vehicles'][$vid]), 'a' => $pid];
}

/** Point à l'intérieur d'une construction ou d'un obstacle ? */
function insideSolidAt(array $room, float $x, float $y, float $z): bool
{
    foreach (nearbyPieces($room, $x, $z) as $pc) {
        foreach (pieceBoxes($pc) as $b) {
            if ($x > $b[0] - 0.3 && $x < $b[3] + 0.3 && $y > $b[1] && $y < $b[4] && $z > $b[2] - 0.3 && $z < $b[5] + 0.3) {
                return true;
            }
        }
    }
    foreach (nodesNear($room, $x, $z) as $n) {
        if ($y > $n['y'] && $y < $n['y'] + $n['h'] && sqrt(($x - $n['x']) ** 2 + ($z - $n['z']) ** 2) < $n['r'] + 0.35) {
            return true;
        }
    }
    return false;
}

function attachZip(array &$room, int $pid): ?string
{
    $p = &$room['players'][$pid];
    if (!in_array($p['state'], ['alive', 'falling'], true) || $p['veh'] !== null || $p['zip'] !== null) {
        return null;
    }
    $best = null;
    foreach ($room['zips'] as $zid => $z) {
        $dx = $z['b'][0] - $z['a'][0];
        $dz = $z['b'][2] - $z['a'][2];
        $t = max(0.0, min(1.0, (($p['pos'][0] - $z['a'][0]) * $dx + ($p['pos'][2] - $z['a'][2]) * $dz) / ($dx * $dx + $dz * $dz)));
        $h = sqrt(($z['a'][0] + $dx * $t - $p['pos'][0]) ** 2 + ($z['a'][2] + $dz * $t - $p['pos'][2]) ** 2);
        $up = $z['a'][1] + ($z['b'][1] - $z['a'][1]) * $t - $p['pos'][1];
        if ($h < 2.6 && $up > 0.4 && $up < 6.8 && ($best === null || $h < $best[0])) {
            $best = [$h, $zid, $t];
        }
    }
    if ($best === null) {
        return 'aucune tyrolienne à portée';
    }
    [, $zid, $t] = $best;
    $z = $room['zips'][$zid];
    $dot = -sin($p['yaw']) * ($z['b'][0] - $z['a'][0]) - cos($p['yaw']) * ($z['b'][2] - $z['a'][2]);
    $dir = $t < 0.1 ? 1 : ($t > 0.9 ? -1 : ($dot >= 0 ? 1 : -1));   // depuis un bout : vers l'autre
    $p['zip'] = ['id' => $zid, 't' => max(0.01, min(0.99, $t)), 'dir' => $dir];
    $p['state'] = 'alive';
    $p['glide'] = false;
    cancelActions($p);
    $room['events'][] = ['k' => 'zip', 'a' => $pid];
    return null;
}

/** Édition d'un mur : plein -> porte -> fenêtre -> plein. */
/**
 * Édition à la Fortnite d'une construction du joueur.
 * Mur : masque 3x3 'e' (cases retirées) · sol : masque 2x2 · rampe : nouvelle direction 'r' · toit : 'v' (0 cône, 1 pente) + 'r'.
 */
function startReload(array &$room, int $pid): void
{
    $p = &$room['players'][$pid];
    $item = $p['slots'][$p['sel']] ?? null;
    if (!isWeapon($item) || $p['reload'] !== null || $p['state'] !== 'alive') {
        return;
    }
    $w = weaponStats($item);
    if ($item['mag'] >= $w['mag']) {
        return;
    }
    if ($room['mode'] === 'br' && $p['ammo'][$w['ammo']] <= 0) {
        if ($room['time'] - ($p['noAmmoAt'] ?? -10.0) > 1.5) {
            $p['noAmmoAt'] = $room['time'];
            $room['events'][] = ['k' => 'noAmmo', 'a' => $pid];
        }
        return;
    }
    $p['use'] = null;
    $dur = $w['reload'] * RARITY_RELOAD[$item['r']] / perkMult($p, 'reloadK');
    $p['reload'] = ['slot' => $p['sel'], 'end' => $room['time'] + $dur, 'dur' => $dur];
    $room['events'][] = ['k' => 'reload', 'a' => $pid, 'w' => $item['type']];
}

function cancelActions(array &$p): void
{
    $p['reload'] = null;
    $p['use'] = null;
}

/**
 * Utilise l'objet d'un emplacement dédié (létal, tactique, utilitaire) : l'arme tenue
 * ne change pas, exactement comme sur Call of Duty.
 */
function startUse(array &$room, int $pid, int $slot): void
{
    $p = &$room['players'][$pid];
    $item = $p['slots'][$slot] ?? null;
    if (!isConsumable($item) || $p['state'] !== 'alive' || $p['use'] !== null) {
        return;
    }
    $c = CONSUMABLES[$item['type']];
    if (isset($c['nade'])) {
        unset($p);
        throwGrenade($room, $pid, $slot);
        return;
    }
    if (isset($c['pad']) && (!$p['ground'] || $p['swim'] || !empty($p['seat']))) {
        $room['events'][] = ['k' => 'toast', 'a' => $pid, 'msg' => 'Posez la plateforme sur le sol'];
        return;
    }
    if (!isset($c['pad'])) {
        $wantHp = isset($c['hp']) || isset($c['pool']);
        $wantSh = isset($c['sh']) || isset($c['pool']);
        $hpFull = !$wantHp || $p['hp'] >= $c['cap'];
        $shFull = !$wantSh || $p['sh'] >= (isset($c['pool']) ? SHIELD_MAX : $c['cap']);
        if ($hpFull && $shFull) {
            $msg = !$wantHp ? 'Bouclier déjà au maximum pour cet objet' : (!$wantSh ? 'Vie déjà au maximum pour cet objet' : 'Vie et bouclier déjà au maximum');
            $room['events'][] = ['k' => 'toast', 'a' => $pid, 'msg' => $msg];
            return;
        }
    }
    $p['reload'] = null;
    $dur = $c['time'] / (isset($c['nade']) || isset($c['pad']) ? 1.0 : perkMult($p, 'healK'));
    $p['use'] = ['slot' => $slot, 'end' => $room['time'] + $dur, 'dur' => $dur];
}

function tickActions(array &$room, int $pid): void
{
    $p = &$room['players'][$pid];
    $t = $room['time'];
    if ($p['reload'] !== null && $t >= $p['reload']['end']) {
        $slot = $p['reload']['slot'];
        $p['reload'] = null;
        $item = $p['slots'][$slot] ?? null;
        if (isWeapon($item)) {
            $w = weaponStats($item);
            $need = $w['mag'] - $item['mag'];
            $have = $room['mode'] === 'br' && $room['state'] !== 'lobby' ? $p['ammo'][$w['ammo']] : 9999;
            $take = min($need, $have);
            $p['slots'][$slot]['mag'] += $take;
            if ($room['mode'] === 'br' && $room['state'] !== 'lobby') {
                $p['ammo'][$w['ammo']] -= $take;
            }
        }
    }
    if ($p['use'] !== null && $t >= $p['use']['end']) {
        $plate = !empty($p['use']['plate']);
        $slot = $p['use']['slot'];
        $p['use'] = null;
        if ($plate) {
            // une plaque enfilée : +50 d'armure, une plaque en moins
            if ((int) $p['plates'] > 0 && $p['sh'] < SHIELD_MAX) {
                $p['plates']--;
                $p['sh'] = min(SHIELD_MAX, $p['sh'] + PLATE_VALUE);
                $room['events'][] = ['k' => 'plate', 'a' => $pid, 'sh' => (int) ceil($p['sh']), 'n' => (int) $p['plates']];
            }
            $p['bloom'] = max(0.0, $p['bloom'] - DT * 2.2);
            return;
        }
        $item = $p['slots'][$slot] ?? null;
        if (isConsumable($item) && isset(CONSUMABLES[$item['type']]['pad'])) {
            if ($p['ground'] && !$p['swim'] && $p['veh'] === null) {
                $id = $room['nextPad']++;
                $fx = -sin($p['yaw']);
                $fz = -cos($p['yaw']);
                $x = $p['pos'][0] + $fx * 1.6;
                $z = $p['pos'][2] + $fz * 1.6;
                $y = floorAt($room, $x, $p['pos'][1] + 0.5, $z);
                if (abs($y - $p['pos'][1]) > 0.8) {
                    [$x, $y, $z] = $p['pos'];
                }
                $room['pads'][$id] = ['id' => $id, 'x' => $x, 'y' => $y + 0.05, 'z' => $z];
                $room['events'][] = ['k' => 'padAdd', 'id' => $id, 'p' => round3([$x, $y + 0.05, $z]), 'a' => $pid];
                $p['slots'][$slot]['n']--;
                if ($p['slots'][$slot]['n'] <= 0) {
                    $p['slots'][$slot] = null;
                }
            }
        } elseif (isConsumable($item)) {
            $c = CONSUMABLES[$item['type']];
            if (isset($c['hp'])) {
                $p['hp'] = max($p['hp'], min((float) $c['cap'], $p['hp'] + $c['hp']));
            }
            $p['slots'][$slot]['n']--;
            if ($p['slots'][$slot]['n'] <= 0) {
                $p['slots'][$slot] = null;
            }
            $room['events'][] = ['k' => 'healed', 'a' => $pid, 'it' => $item['type']];
        }
    }
    $p['bloom'] = max(0.0, $p['bloom'] - DT * 2.2);
}

// =========================================================== PIOCHE

function swing(array &$room, int $pid, array $m): void
{
    $p = &$room['players'][$pid];
    if ($p['state'] !== 'alive' || $room['time'] - $p['lastSwing'] < SWING_RATE * 0.9) {
        return;
    }
    $p['lastSwing'] = $room['time'];
    $p['use'] = null;
    $yaw = (float) ($m['yaw'] ?? $p['yaw']);
    $pitch = max(-1.45, min(1.45, (float) ($m['pitch'] ?? $p['pitch'])));
    $o = aimOrigin($room, $p, $yaw);
    $d = dirFromAngles($yaw, $pitch);
    $hit = raycastWorld($room, $o, $d, SWING_REACH + SHOULDER, $pid);
    if ($hit === null || $hit['kind'] === 'ground') {
        // depuis la tête, un peu vers le bas
        $head = [$p['pos'][0], $p['pos'][1] + 1.3, $p['pos'][2]];
        $d2 = dirFromAngles($yaw, max(-0.6, min(0.3, $pitch)));
        $hit2 = raycastWorld($room, $head, $d2, SWING_REACH, $pid);
        if ($hit2 !== null && $hit2['kind'] !== 'ground') {
            $hit = $hit2;
            $o = $head;
            $d = $d2;
        }
    }
    if ($hit === null || $hit['kind'] === 'ground') {
        // arbre / rocher / voiture juste devant (angle < 60°)
        $fx = -sin($yaw);
        $fz = -cos($yaw);
        $best = null;
        foreach (nodesNear($room, $p['pos'][0], $p['pos'][2]) as $n) {
            $dx = $n['x'] - $p['pos'][0];
            $dz = $n['z'] - $p['pos'][2];
            $dist = sqrt($dx * $dx + $dz * $dz) - $n['r'];
            if ($dist > 2.2 || ($dx * $fx + $dz * $fz) < 0.5 * sqrt($dx * $dx + $dz * $dz)) {
                continue;
            }
            if ($best === null || $dist < $best[0]) {
                $best = [$dist, $n];
            }
        }
        if ($best !== null) {
            $n = $best[1];
            $o = [$n['x'] - $fx * $n['r'], $p['pos'][1] + 1.2, $n['z'] - $fz * $n['r']];
            $d = [0.0, 0.0, 0.0];
            $hit = ['kind' => 'node', 'id' => $n['id'], 't' => 0.0];
        }
    }
    $room['events'][] = ['k' => 'swing', 'a' => $pid];
    if ($hit === null || $hit['kind'] === 'ground') {
        return;
    }
    $at = round3([$o[0] + $d[0] * $hit['t'], $o[1] + $d[1] * $hit['t'], $o[2] + $d[2] * $hit['t']]);
    if ($hit['kind'] === 'node') {
        $nid = $hit['id'];
        $room['nodes'][$nid]['hp'] -= MELEE_DMG_NODE;
        if ($room['nodes'][$nid]['hp'] <= 0) {
            removeNode($room, $nid);
            $room['events'][] = ['k' => 'gone', 'n' => $nid];
        } else {
            $nn = $room['nodes'][$nid];
            $room['events'][] = ['k' => 'chip', 'n' => $nid, 'p' => $at, 'd' => round(1.0 - $nn['hp'] / max(1.0, $nn['max'] ?? $nn['hp']), 2)];
        }
    } elseif ($hit['kind'] === 'build') {
        $room['events'][] = ['k' => 'chipB', 'key' => $hit['key'], 'p' => $at];
        damageBuilding($room, $hit['key'], MELEE_DMG_BUILD, $pid);
    } elseif ($hit['kind'] === 'player') {
        damagePlayer($room, $hit['id'], MELEE_DMG_PLAYER, $pid, false, $at);
    }
}

// =========================================================== VIE & MORT

function damagePlayer(array &$room, int $victim, float $dmg, ?int $attacker, bool $head = false, ?array $at = null, bool $healthOnly = false): void
{
    if (!isset($room['players'][$victim])) {
        return;
    }
    $v = &$room['players'][$victim];
    if ($v['state'] !== 'alive' || $dmg <= 0.0) {
        return;
    }
    if ($room['mode'] === 'br' && $room['state'] === 'lobby') {
        return;   // pas de dégâts dans le lobby
    }
    $shieldHit = $v['sh'] > 0.0 && !$healthOnly;
    $rest = $dmg;
    if ($v['sh'] > 0.0 && !$healthOnly) {
        $absorbed = min($v['sh'], $rest);
        $v['sh'] -= $absorbed;
        $rest -= $absorbed;
    }
    $v['hp'] = max(0.0, $v['hp'] - $rest);
    $v['use'] = null;
    if ($attacker !== null) {
        $ev = ['k' => 'hit', 'v' => $victim, 'a' => $attacker, 'd' => (int) round($dmg), 'h' => $head, 's' => $shieldHit];
        if ($at !== null) {
            $ev['p'] = round3($at);
        }
        $room['events'][] = $ev;
    }
    if ($v['hp'] <= 0.0) {
        killPlayer($room, $victim, $attacker);
    }
}

function killPlayer(array &$room, int $victim, ?int $attacker): void
{
    if ($room['players'][$victim]['veh'] !== null) {
        exitVehicle($room, $victim);
    }
    if (!empty($room['players'][$victim]['seat'])) {
        exitSeat($room, $victim);
    }
    $room['players'][$victim]['swimT'] = 0.0;
    $v = &$room['players'][$victim];
    $v['zip'] = null;
    if ($room['mode'] === 'br') {
        dropAll($room, $victim);
        $v['slots'] = starterLoadout();
        $v['ammo'] = AMMO_EMPTY;
        $v['cash'] = 0;
        $v['plates'] = 0;
    }
    $v['state'] = 'dead';
    $v['hp'] = 0.0;
    $v['sh'] = 0.0;
    $v['reload'] = null;
    $v['use'] = null;
    $v['respawnAt'] = $room['time'] + RESPAWN_DELAY;
    $v['killer'] = $attacker;
    $v['deathCause'] = $attacker === null ? ($v['cause'] ?? 'storm') : null;
    $v['place'] = count(inMatchIds($room)) + 1;

    if ($attacker !== null && $attacker !== $victim && isset($room['players'][$attacker])) {
        $room['players'][$attacker]['kills']++;
    }
    $room['events'][] = ['k' => 'kill', 'v' => $victim, 'a' => $attacker, 'pl' => $v['place'], 'c' => $attacker === null ? ($v['cause'] ?? null) : null];
    $v['cause'] = null;

    if ($room['mode'] === 'br' && in_array($room['state'], ['bus', 'playing'], true)) {
        checkEnd($room);
    }
}

function checkEnd(array &$room): void
{
    $left = inMatchIds($room);
    if ($room['startCount'] >= 2 ? count($left) <= 1 : count($left) === 0) {
        endMatch($room, $left[0] ?? null);
        return;
    }
    // plus aucun humain en jeu : la partie s'arrête (le bot avec le plus d'éliminations gagne)
    $humans = array_filter($left, static fn ($id) => !isBot($room['players'][$id]));
    if ($humans === [] && $left !== []) {
        usort($left, static fn ($a, $b) => $room['players'][$b]['kills'] <=> $room['players'][$a]['kills']);
        endMatch($room, $left[0]);
    }
}

/** Joueurs encore en partie (montgolfière, chute ou debout). */
function inMatchIds(array $room): array
{
    return array_keys(array_filter(
        $room['players'],
        static fn (array $p): bool => in_array($p['state'], ['bus', 'falling', 'alive'], true)
    ));
}

function endMatch(array &$room, ?int $winner): void
{
    if ($room['state'] === 'ended') {
        return;
    }
    $room['state'] = 'ended';
    $room['winner'] = $winner;
    foreach ($room['players'] as $pid => $p) {
        if (!empty($p['token'])) {
            recordMatch($p['token'], $pid === $winner, (int) $p['kills']);
        }
    }
    $room['events'][] = ['k' => 'end', 'w' => $winner];
}

function respawnPlayer(array &$room, int $pid): void
{
    $sp = randomLand(300.0, $room);
    $p = &$room['players'][$pid];
    $p['pos'] = [$sp[0], terrainHeight($sp[0], $sp[1]) + 60.0, $sp[1]];
    $p['vel'] = [0.0, -5.0, 0.0];
    $p['hp'] = HP_MAX;
    $p['sh'] = $room['mode'] === 'train' ? SHIELD_MAX : 0.0;
    $p['state'] = 'falling';
    $p['glide'] = false;
    $p['ground'] = false;
    $p['slots'] = loadoutTraining();
    $p['sel'] = 0;
}

function tickRespawn(array &$room): void
{
    foreach (array_keys($room['players']) as $pid) {
        $p = $room['players'][$pid];
        if ($p['state'] === 'dead' && $room['time'] >= $p['respawnAt']) {
            respawnPlayer($room, $pid);
        }
    }
}

function stormDamage(array &$room, int $pid, float $dt): void
{
    $p = $room['players'][$pid];
    $s = $room['storm'];
    $dist = sqrt(($p['pos'][0] - $s['x']) ** 2 + ($p['pos'][2] - $s['z']) ** 2);
    if ($dist <= $s['r']) {
        return;
    }
    $idx = max(0, min($s['phase'], count(STORM_PHASES) - 1));
    $room['players'][$pid]['stormAcc'] = ($room['players'][$pid]['stormAcc'] ?? 0.0) + STORM_PHASES[$idx]['dps'] * $dt;
    if ($room['players'][$pid]['stormAcc'] >= 1.0) {
        $d = floor($room['players'][$pid]['stormAcc']);
        $room['players'][$pid]['stormAcc'] -= $d;
        $room['players'][$pid]['cause'] = 'storm';
        damagePlayer($room, $pid, $d, null, false, null, true);   // la tempête ignore le bouclier
    }
}

/** On se noie si on reste trop longtemps dans l'eau (la vie, pas le bouclier). */
function waterDamage(array &$room, int $pid, float $dt): void
{
    $p = &$room['players'][$pid];
    if (!$p['swim']) {
        $p['swimT'] = max(0.0, ($p['swimT'] ?? 0.0) - $dt * 2.0);
        $p['waterAcc'] = 0.0;
        return;
    }
    $p['swimT'] = ($p['swimT'] ?? 0.0) + $dt;
    if ($p['swimT'] < WATER_GRACE) {
        return;
    }
    $p['waterAcc'] = ($p['waterAcc'] ?? 0.0) + WATER_DPS * $dt;
    if ($p['waterAcc'] >= 1.0) {
        $d = floor($p['waterAcc']);
        $p['waterAcc'] -= $d;
        $p['cause'] = 'water';
        unset($p);
        damagePlayer($room, $pid, $d, null, false, null, true);
        if (isset($room['players'][$pid]) && $room['players'][$pid]['state'] === 'dead') {
            $room['events'][] = ['k' => 'drown', 'v' => $pid];
        }
    }
}

// =========================================================== MONTGOLFIÈRE, TEMPÊTE

// =========================================================== LOBBY DE DÉPART

/** Point libre sur le pont du lobby. */
function lobbySpot(): array
{
    $L = MapData::$raw['lobby'];
    for ($k = 0; $k < 20; $k++) {
        $x = $L['x'] + rnds() * ($L['half'] - 1.0);
        $z = $L['z'] + rnds() * ($L['half'] - 1.0);
        if (abs($x - $L['x']) > 7 || abs($z - $L['z']) > 7) {
            return [$x, $z];
        }
    }
    return [$L['x'] + 12.0, $L['z']];
}

/** Pendant l'attente : retour sur le pont si on tombe, coffres qui se remplissent, armes qui réapparaissent. */
function tickLobby(array &$room, float $dt): void
{
    $L = MapData::$raw['lobby'] ?? null;
    if ($L === null) {
        return;
    }
    foreach (array_keys($room['players']) as $pid) {
        $p = &$room['players'][$pid];
        if ($p['state'] === 'alive' && ($p['pos'][1] < $L['y'] - 8.0 || $p['swim'])) {
            [$x, $z] = lobbySpot();
            $p['pos'] = [$x, $L['y'] + 0.3, $z];
            $p['vel'] = [0.0, 0.0, 0.0];
            $p['zip'] = null;
            $p['inq'] = [];
            $room['events'][] = ['k' => 'toast', 'a' => $pid, 'msg' => 'Retour sur la plateforme !'];
        }
        unset($p);
    }
    foreach ($room['chests'] as $cid => $c) {
        if (!empty($c['lobby']) && $c['open'] && $room['time'] >= $c['shutAt']) {
            $room['chests'][$cid]['open'] = false;
            $room['events'][] = ['k' => 'chestShut', 'c' => $cid];
        }
    }
    $room['lobbyT'] -= $dt;
    if ($room['lobbyT'] > 0.0) {
        return;
    }
    $room['lobbyT'] = 6.0;
    foreach ($room['lobbyLoot'] as $i => $l) {
        if ($l['drop'] !== null && isset($room['drops'][$l['drop']])) {
            continue;
        }
        $item = isset(WEAPONS[$l['type']]) ? makeWeapon($l['type'], 3) : makeConsumable($l['type'], 2);
        $room['lobbyLoot'][$i]['drop'] = spawnDrop($room, $item, $l['p'], null);
    }
}

/** Au départ : on range le lobby (constructions, objets au sol, coffres, plateformes posées). */
function clearLobby(array &$room): void
{
    foreach ($room['buildings'] as $key => $pc) {
        if (empty($pc['m'])) {
            removePiece($room, $key);
            $room['events'][] = ['k' => 'bDel', 'key' => $key, 'mat' => $pc['mat'], 'q' => 1];
        }
    }
    $L = MapData::$raw['lobby'] ?? null;
    if ($L !== null) {
        foreach ($room['drops'] as $did => $d) {
            if (abs($d['p'][0] - $L['x']) < $L['half'] + 30 && abs($d['p'][2] - $L['z']) < $L['half'] + 30) {
                removeDrop($room, $did, null);
            }
        }
    }
    foreach ($room['chests'] as $cid => $c) {
        if (!empty($c['lobby']) && $c['open']) {
            $room['chests'][$cid]['open'] = false;
            $room['events'][] = ['k' => 'chestShut', 'c' => $cid];
        }
    }
    foreach ($room['pads'] as $id => $pd) {
        if ($id >= 1000) {
            unset($room['pads'][$id]);
            $room['events'][] = ['k' => 'padDel', 'id' => $id];
        }
    }
    $room['lobbyLoot'] = [];
}

function startBalloon(array &$room): void
{
    clearLobby($room);
    $a = rndf() * 2.0 * M_PI;
    $off = rnds() * 140.0;
    $dir = [cos($a), sin($a)];
    $perp = [-$dir[1], $dir[0]];
    $start = [-$dir[0] * 470 + $perp[0] * $off, -$dir[1] * 470 + $perp[1] * $off];
    $end = [$dir[0] * 470 + $perp[0] * $off, $dir[1] * 470 + $perp[1] * $off];
    $len = sqrt(($end[0] - $start[0]) ** 2 + ($end[1] - $start[1]) ** 2);
    $room['bal'] = ['a' => $start, 'b' => $end, 'u' => 0.0, 'dur' => $len / BALLOON_SPEED,
        'pos' => [$start[0], BALLOON_Y, $start[1]], 't0' => $room['time']];
    $pv = $room['priv'];
    fillWithBots($room, $pv !== null ? count($room['players']) + $pv['bots'] : max(BOT_FILL, count($room['players'])));
    $room['state'] = 'bus';
    spawnLlamas($room);
    $room['startCount'] = count($room['players']);
    foreach (array_keys($room['players']) as $pid) {
        if ($room['players'][$pid]['veh'] !== null) {
            exitVehicle($room, $pid);
        }
        if (!empty($room['players'][$pid]['seat'])) {
            exitSeat($room, $pid);
        }
        $p = &$room['players'][$pid];
        $p['zip'] = null;
        $p['state'] = 'bus';
        $p['pos'] = $room['bal']['pos'];
        $p['vel'] = [0.0, 0.0, 0.0];
        $p['slots'] = starterLoadout();
        $p['sel'] = 0;
        $p['hp'] = HP_MAX;
        $p['sh'] = 0.0;
        $p['cash'] = 0;
        $p['plates'] = 0;
        $p['ammo'] = AMMO_EMPTY;
        unset($p);
    }
    $room['events'][] = ['k' => 'balloon'];
}

function tickBalloon(array &$room, float $dt): void
{
    $b = &$room['bal'];
    $b['u'] = min(1.0, $b['u'] + $dt / $b['dur']);
    $u = $b['u'];
    $b['pos'] = [$b['a'][0] + ($b['b'][0] - $b['a'][0]) * $u, BALLOON_Y, $b['a'][1] + ($b['b'][1] - $b['a'][1]) * $u];
    foreach (array_keys($room['players']) as $pid) {
        if ($room['players'][$pid]['state'] !== 'bus') {
            continue;
        }
        if ($u >= 1.0) {
            dropPlayer($room, $pid, true);
        } else {
            $room['players'][$pid]['pos'] = [$b['pos'][0], $b['pos'][1] - 2.0, $b['pos'][2]];
        }
    }
    if ($u >= 1.0 && $room['state'] === 'bus') {
        $room['state'] = 'playing';
        startStormPhase($room, 0);
    }
    unset($b);
}

function dropPlayer(array &$room, int $pid, bool $force = false): void
{
    $p = &$room['players'][$pid];
    if ($p['state'] !== 'bus' || (!$force && $room['time'] - $room['bal']['t0'] < 2.0)) {
        return;
    }
    $b = $room['bal'];
    $dir = [$b['b'][0] - $b['a'][0], $b['b'][1] - $b['a'][1]];
    $l = sqrt($dir[0] ** 2 + $dir[1] ** 2) ?: 1.0;
    $p['state'] = 'falling';
    $p['pos'] = [$b['pos'][0], $b['pos'][1] - 3.0, $b['pos'][2]];
    $p['vel'] = [$dir[0] / $l * 8.0, -4.0, $dir[1] / $l * 8.0];
    $p['glide'] = false;
    $p['ground'] = false;
    $room['events'][] = ['k' => 'jump', 'a' => $pid];
}

function startStormPhase(array &$room, int $i): void
{
    $s = &$room['storm'];
    $s['phase'] = $i;
    $s['t'] = 0.0;
    $s['shrinking'] = false;
    $s['fx'] = $s['x'];
    $s['fz'] = $s['z'];
    $s['fr'] = $s['r'];
    if ($i >= count(STORM_PHASES)) {
        return;
    }
    $nr = STORM_PHASES[$i]['radius'];
    $maxOff = max(0.0, ($s['r'] - $nr) * 0.85);
    if ($i === 0) {
        $maxOff = min($maxOff, 120.0);
    }
    $best = [$s['x'], $s['z']];
    for ($k = 0; $k < 40; $k++) {
        $a = rndf() * 2 * M_PI;
        $d = sqrt(rndf()) * $maxOff;
        $x = $s['x'] + cos($a) * $d;
        $z = $s['z'] + sin($a) * $d;
        if (sqrt($x * $x + $z * $z) + $nr < 470 && terrainHeight($x, $z) > 1.0) {
            $best = [$x, $z];
            break;
        }
    }
    $s['nx'] = $best[0];
    $s['nz'] = $best[1];
    $s['nr'] = $nr;
    unset($s);
    if ($i >= 1 && $i <= 4 && $room['state'] === 'playing') {
        spawnAirdrop($room);
    }
}

function tickStorm(array &$room, float $dt): void
{
    $s = &$room['storm'];
    $i = $s['phase'];
    if ($i < 0 || $i >= count(STORM_PHASES)) {
        unset($s);
        return;
    }
    $ph = STORM_PHASES[$i];
    $s['t'] += $dt * (getenv('GAME_DEBUG') === '1' ? 8.0 : 1.0);   // tests : tempête accélérée
    if ($s['t'] >= $ph['wait']) {
        $s['shrinking'] = true;
        $k = min(1.0, ($s['t'] - $ph['wait']) / $ph['shrink']);
        $s['x'] = $s['fx'] + ($s['nx'] - $s['fx']) * $k;
        $s['z'] = $s['fz'] + ($s['nz'] - $s['fz']) * $k;
        $s['r'] = $s['fr'] + ($s['nr'] - $s['fr']) * $k;
        if ($k >= 1.0) {
            unset($s);
            startStormPhase($room, $i + 1);
            return;
        }
    }
    unset($s);
}

function stormView(array $room): array
{
    $s = $room['storm'];
    $i = $s['phase'];
    $left = 0.0;
    if ($i >= 0 && $i < count(STORM_PHASES)) {
        $ph = STORM_PHASES[$i];
        $left = $s['shrinking'] ? $ph['wait'] + $ph['shrink'] - $s['t'] : $ph['wait'] - $s['t'];
    }
    return [
        'x' => round($s['x'], 1), 'z' => round($s['z'], 1), 'r' => round($s['r'], 1),
        'nx' => round($s['nx'], 1), 'nz' => round($s['nz'], 1), 'nr' => round($s['nr'], 1),
        'ph' => $i, 'sh' => $s['shrinking'], 't' => (int) ceil(max(0.0, $left)),
    ];
}

// =========================================================== JOUEURS

/** Arme de départ : un pistolet, un chargeur, pas de réserve. La crosse fait 10 PV. */
function starterLoadout(): array
{
    return [makeWeapon('pistol', 0), null, null, null, null];
}

/** Terrain d'entraînement : tout l'arsenal, sans tempête. */
function loadoutTraining(): array
{
    return [
        makeWeapon('ar', 4),
        makeWeapon('pump', 4),
        makeConsumable('grenade', 4),
        makeConsumable('medkit', 3),
        makeConsumable('pad', 2),
    ];
}

function newPlayer(int $pid, ConnectionInterface $conn, array $profile, array $room): array
{
    $build = $room['mode'] === 'train';
    $lobby = $room['mode'] === 'br' && $room['state'] !== 'lobby';
    $sp = randomLand(260.0, $room);
    $onDeck = $room['mode'] === 'br' && !$lobby;
    if ($onDeck) {
        $sp = lobbySpot();
    }
    return [
        'id'        => $pid,
        'conn'      => $conn,
        'token'     => $profile['token'],
        'dbid'      => $profile['id'],
        'name'      => $profile['name'],
        'skin'      => $profile['skin'],
        'pos'       => [$sp[0], $onDeck ? MapData::$raw['lobby']['y'] + 0.3 : terrainHeight($sp[0], $sp[1]) + ($build ? 60.0 : 0.5), $sp[1]],
        'vel'       => [0.0, 0.0, 0.0],
        'yaw'       => 0.0,
        'pitch'     => 0.0,
        'in'        => ['seq' => 0, 'fwd' => 0.0, 'side' => 0.0, 'sprint' => false, 'tac' => false, 'crouch' => false, 'glide' => false, 'ads' => false],
        'jumpQ'     => false,
        'jumpBuf'   => 0.0,
        'coyote'    => 0.0,
        'tac'       => TAC_TIME,
        'spdK'      => 1.0,
        'tacMax'    => TAC_TIME,
        'slideCd'   => 0.0,
        'land'      => 0.0,
        'ground'    => !$build,
        'glide'     => false,
        'swim'      => false,
        'slide'     => 0.0,
        'slideDir'  => [0.0, 0.0],
        'zip'       => null,
        'veh'       => null,
        'seat'      => null,
        'cyaw'      => 0.0,
        'cspd'      => 0.0,
        'inq'       => [],
        'lastIn'    => 0.0,
        'runHit'    => [],
        'state'     => $build ? 'falling' : ($lobby ? 'dead' : 'alive'),
        'swimT'     => 0.0,
        'hp'        => HP_MAX,
        'sh'        => $build ? SHIELD_MAX : 0.0,
        'sel'       => 0,
        'slots'     => $build ? loadoutTraining() : starterLoadout(),
        'ammo'      => AMMO_EMPTY,
        'cash'      => 0,
        'plates'    => 0,
        'crushT'    => -9.0,
        'loadout'   => sanitizeLoadout($profile['loadout'] ?? null),
        'kills'     => 0,
        'lastShot'  => -10.0,
        'lastSwing' => -10.0,
        'bloom'     => 0.0,
        'reload'    => null,
        'use'       => null,
        'respawnAt' => 0.0,
        'killer'    => null,
        'place'     => 0,
        'ack'       => 0,
        'spectator' => $lobby,
    ];
}

function selectSlot(array &$room, int $pid, int $slot): void
{
    if ($slot < 0 || $slot > 5) {
        return;
    }
    $p = &$room['players'][$pid];
    $slot = $slot === SLOT_SECONDARY ? SLOT_SECONDARY : SLOT_PRIMARY;
    if ($p['sel'] !== $slot) {
        cancelActions($p);
        $p['sel'] = $slot;
        $p['lastShot'] = max($p['lastShot'], $room['time'] - 0.6);   // petit délai de sortie d'arme
    }
}

/**
 * Entrée du client : mise en file, une entrée = un pas de simulation (comme la prédiction du
 * client). Sans cela, deux entrées arrivées dans le même tick feraient « glisser » le joueur.
 */
function applyInput(array &$room, int $pid, array $d): void
{
    $p = &$room['players'][$pid];
    $yaw = (float) ($d['yaw'] ?? $p['yaw']);
    $pitch = (float) ($d['pitch'] ?? 0.0);
    $p['inq'][] = [
        'in' => [
            'seq'    => (int) ($d['seq'] ?? 0),
            'fwd'    => max(-1.0, min(1.0, (float) ($d['fwd'] ?? 0))),
            'side'   => max(-1.0, min(1.0, (float) ($d['side'] ?? 0))),
            'sprint' => !empty($d['sprint']),
            'tac'    => !empty($d['tac']),
            'crouch' => !empty($d['crouch']),
            'glide'  => !empty($d['glide']),
            'ads'    => !empty($d['ads']),
        ],
        'yaw'   => is_finite($yaw) ? fmod($yaw, 2.0 * M_PI) : $p['yaw'],
        'pitch' => is_finite($pitch) ? max(-1.45, min(1.45, $pitch)) : 0.0,
        'jump'  => !empty($d['jump']),
    ];
    if (count($p['inq']) > 90) {
        array_shift($p['inq']);
    }
}

/** Nombre de pas à simuler ce tick pour un joueur humain (rattrapage si la file s'allonge). */
function takeInputs(array &$room, int $pid): int
{
    $p = &$room['players'][$pid];
    $n = count($p['inq']);
    if ($n === 0) {
        if ($room['time'] - $p['lastIn'] > 0.3) {
            $p['in']['fwd'] = 0.0;
            $p['in']['side'] = 0.0;
            $p['in']['sprint'] = false;
            $p['in']['tac'] = false;
            return 1;   // client muet : on le laisse retomber
        }
        return 0;
    }
    return $n > 20 ? 3 : ($n > 5 ? 2 : 1);
}

function popInput(array &$room, int $pid): void
{
    $p = &$room['players'][$pid];
    if ($p['inq'] === []) {
        return;
    }
    $e = array_shift($p['inq']);
    $p['in'] = $e['in'];
    $p['yaw'] = $e['yaw'];
    $p['pitch'] = $e['pitch'];
    if ($e['jump']) {
        $p['jumpQ'] = true;
    }
    $p['lastIn'] = $room['time'];
}

function stepPlayer(array &$room, int $pid, float $dt): void
{
    $p = &$room['players'][$pid];
    $wasGround = $p['ground'];
    $vy = $p['vel'][1];
    $state = $p['state'];
    // vitesse propre au joueur : atouts (« Léger ») et accessoires de l'arme tenue
    $held = $p['slots'][$p['sel']] ?? null;
    $p['spdK'] = round(perkMult($p, 'moveK') * (isWeapon($held) ? weaponStats($held)['moveK'] : 1.0), 4);
    $p['tacMax'] = round(TAC_TIME * perkMult($p, 'tacK'), 4);
    stepBody($room, $p, $p['in'], $dt);
    $p['ack'] = $p['in']['seq'];
    // dégâts de chute (pas en chute libre / planeur) : sur la vie seulement, comme dans Fortnite
    if ($state === 'alive' && !$wasGround && $p['ground'] && !$p['swim'] && $p['veh'] === null && $vy < -FALL_SAFE
        && $room['mode'] === 'br' && $room['state'] !== 'lobby') {
        $dmg = (abs($vy) - FALL_SAFE) * 8.0;
        $p['cause'] = 'fall';
        unset($p);
        $room['events'][] = ['k' => 'fallDmg', 'a' => $pid, 'd' => (int) round($dmg)];
        damagePlayer($room, $pid, $dmg, null, false, null, true);
        if (isset($room['players'][$pid])) {
            $room['players'][$pid]['cause'] = null;
        }
        return;
    }
    if ($state === 'falling' && $p['state'] === 'alive') {
        $room['events'][] = ['k' => 'land', 'a' => $pid];
    }
}

// =========================================================== BOUCLE DE PARTIE

function tickRoom(array &$room, float $dt): void
{
    $room['time'] += $dt;

    if ($room['mode'] === 'br') {
        if ($room['state'] === 'lobby') {
            tickLobby($room, $dt);
            $n = count($room['players']);
            if ($room['priv'] !== null && !$room['priv']['go']) {
                $room['countdown'] = -1.0;    // partie privée : on attend que l'hôte lance
            } elseif ($n >= 1) {
                if ($room['countdown'] < 0.0) {
                    $room['countdown'] = $room['priv'] !== null ? 10.0 : BR_COUNTDOWN;
                }
                if ($n >= MAX_ROOM) {
                    $room['countdown'] = min($room['countdown'], BR_FULL_WAIT);
                }
                $room['countdown'] -= $dt;
                if ($room['countdown'] <= 0.0) {
                    startBalloon($room);
                }
            } else {
                $room['countdown'] = -1.0;
            }
        } elseif ($room['state'] === 'bus' || ($room['state'] === 'ended' && $room['bal'] !== null && $room['bal']['u'] < 1.0)) {
            tickBalloon($room, $dt);
            tickAirdrops($room, $dt);
        } elseif ($room['state'] === 'playing') {
            tickStorm($room, $dt);
            tickAirdrops($room, $dt);
        }
    } else {
        tickRespawn($room);
    }

    tickBots($room);

    foreach (array_keys($room['players']) as $pid) {
        $state = $room['players'][$pid]['state'];
        if ($state === 'bus' || $state === 'dead') {
            $room['players'][$pid]['inq'] = [];
            continue;
        }
        $bot = isBot($room['players'][$pid]);
        $steps = $bot ? 1 : takeInputs($room, $pid);
        $passenger = !empty($room['players'][$pid]['seat']);
        for ($k = 0; $k < $steps && isset($room['players'][$pid]); $k++) {
            if (!$bot) {
                popInput($room, $pid);
            }
            if ($passenger) {
                $room['players'][$pid]['ack'] = $room['players'][$pid]['in']['seq'];   // pas de physique : on suit le véhicule
                continue;
            }
            stepPlayer($room, $pid, $dt);
        }
        if (!isset($room['players'][$pid])) {
            continue;
        }
        if ($room['players'][$pid]['veh'] !== null) {
            tickVehicle($room, $pid);
        }
        tickActions($room, $pid);
        if ($room['mode'] === 'br' && $room['state'] === 'playing' && $room['players'][$pid]['state'] === 'alive') {
            stormDamage($room, $pid, $dt);
        }
        if (isset($room['players'][$pid]) && $room['players'][$pid]['state'] === 'alive' && $room['state'] !== 'lobby') {
            waterDamage($room, $pid, $dt);
        }
    }

    // les passagers suivent leur véhicule (après le déplacement des conducteurs)
    foreach (array_keys($room['players']) as $pid) {
        if (!empty($room['players'][$pid]['seat'])) {
            seatPlayer($room, $pid);
        }
    }
    tickBullets($room, $dt);
    tickNades($room, $dt);
    tickCollapse($room);
    processIntegrity($room);
}

/** Le véhicule suit son conducteur ; à pleine vitesse il renverse les autres joueurs. */
function tickVehicle(array &$room, int $pid): void
{
    $p = &$room['players'][$pid];
    $vid = $p['veh'];
    $room['vehicles'][$vid]['pos'] = $p['pos'];
    $room['vehicles'][$vid]['yaw'] = $p['cyaw'];
    $spd = abs($p['cspd']);
    if ($spd < RUNOVER_SPEED || $p['state'] !== 'alive') {
        return;
    }
    $fx = -sin($p['cyaw']);
    $fz = -cos($p['cyaw']);
    foreach (array_keys($room['players']) as $oid) {
        $o = $room['players'][$oid];
        if ($oid === $pid || $o['state'] !== 'alive' || $o['veh'] !== null) {
            continue;
        }
        $dx = $o['pos'][0] - $p['pos'][0];
        $dz = $o['pos'][2] - $p['pos'][2];
        $along = max(-2.2, min(2.2, $dx * $fx + $dz * $fz));
        $lat = sqrt(($dx - $fx * $along) ** 2 + ($dz - $fz * $along) ** 2);
        if ($lat > 1.35 || abs($o['pos'][1] - $p['pos'][1]) > 1.8 || $room['time'] - ($p['runHit'][$oid] ?? -9) < 0.8) {
            continue;
        }
        $p['runHit'][$oid] = $room['time'];
        $room['players'][$oid]['vel'] = [$fx * $spd * 0.8, 7.0, $fz * $spd * 0.8];
        $room['players'][$oid]['ground'] = false;
        damagePlayer($room, $oid, 22.0 + $spd * 2.2, $pid, false, [$o['pos'][0], $o['pos'][1] + 1.0, $o['pos'][2]]);
        $p = &$room['players'][$pid];
    }
}

function snapshot(array $room): array
{
    $players = [];
    foreach ($room['players'] as $pid => $p) {
        if (!empty($p['spectator'])) {
            continue;
        }
        $item = $p['slots'][$p['sel']] ?? null;
        $players[] = [
            'id'   => $pid,
            'n'    => $p['name'],
            's'    => $p['skin'],
            'p'    => round3($p['pos']),
            'y'    => round($p['yaw'], 3),
            'pt'   => round($p['pitch'], 3),
            'st'   => $p['state'],
            'w'    => $item['type'] ?? null,
            'wr'   => $item['r'] ?? 0,
            'g'    => $p['glide'],
            'sd'   => $p['slide'] > 0.0,
            'c'    => $p['in']['crouch'],
            'ad'   => $p['in']['ads'],
            'sw'   => $p['swim'],
            'ack'  => $p['ack'],
            'v'    => round3($p['vel'], 3),
            'gr'   => $p['ground'],
            'sl'   => round($p['slide'], 3),
            'sdir' => [round($p['slideDir'][0], 3), round($p['slideDir'][1], 3)],
            'cy'   => round($p['coyote'] ?? 0.0, 4),
            'jb'   => round($p['jumpBuf'] ?? 0.0, 4),
            'tc'   => round($p['tac'] ?? TAC_TIME, 4),
            'sk'   => round($p['spdK'] ?? 1.0, 4),
            'tmax' => round(TAC_TIME * perkMult($p, 'tacK'), 3),
            'scd'  => round($p['slideCd'] ?? 0.0, 4),
            'ld'   => round($p['land'] ?? 0.0, 4),
            'k'    => $p['kills'],
            // inventaire visible en spectateur : type, rareté et chargeur de chaque emplacement
            'inv'  => array_map(static fn ($it) => $it === null ? null
                : [$it['type'], (int) ($it['r'] ?? 0), isset($it['mag']) ? (int) $it['mag'] : (isset($it['n']) ? (int) $it['n'] : 0)], $p['slots']),
            'sel'  => $p['sel'],
            'hp'   => (int) ceil($p['hp']),
            'sh'   => (int) ceil($p['sh']),
            'cash' => (int) ($p['cash'] ?? 0),
            'pl'   => (int) ($p['plates'] ?? 0),
            'u'    => $p['use'] !== null,
            'rl'   => $p['reload'] !== null,
            'zp'   => $p['zip'] !== null ? [$p['zip']['id'], round($p['zip']['t'], 5), $p['zip']['dir']] : null,
            'vh'   => $p['veh'] !== null ? [$p['veh'], round($p['cyaw'], 4), round($p['cspd'], 3)] : null,
            'ps'   => $p['seat'] ?? null,
        ];
    }
    $bullets = [];
    foreach ($room['bullets'] as $id => $b) {
        $bullets[] = ['id' => $id, 'p' => round3($b['p']), 'w' => $b['w'], 'v' => round3($b['v'], 1)];
    }
    $bal = null;
    if ($room['bal'] !== null && $room['state'] === 'bus') {
        $bal = ['p' => round3($room['bal']['pos']), 'a' => $room['bal']['a'], 'b' => $room['bal']['b']];
    }
    return [
        't'       => 'snap',
        'time'    => round($room['time'], 3),
        'state'   => $room['state'],
        'cd'      => round(max(0.0, $room['countdown']), 1),
        'alive'   => count(inMatchIds($room)),
        'storm'   => stormView($room),
        'bal'     => $bal,
        'players' => $players,
        'bullets' => $bullets,
        'nd'      => nadesView($room),
        'ad'      => airdropView($room),
        'pv'      => privView($room),
        'ev'      => $room['events'],
    ];
}

/** Vue privée d'un joueur : inventaire, munitions, argent. */
function selfView(array $room, array $p): array
{
    $t = $room['time'];
    $prog = static fn (?array $a): ?array => $a === null ? null
        : ['s' => $a['slot'], 'p' => round(1 - ($a['end'] - $t) / $a['dur'], 3), 'd' => round($a['dur'], 2)];
    return [
        'hp'    => (int) ceil($p['hp']),
        'sh'    => (int) ceil($p['sh']),
        'cash'  => (int) ($p['cash'] ?? 0),
        'pl'    => (int) ($p['plates'] ?? 0),
        'plMax' => plateCarry($p),
        'ammo'  => $p['ammo'],
        'slots' => $p['slots'],
        'sel'   => $p['sel'],
        'kills' => $p['kills'],
        'state' => $p['state'],
        'rl'    => $prog($p['reload']),
        'us'    => $prog($p['use']),
        'bl'    => round($p['bloom'], 2),
        'killer'=> $p['killer'],
        'dc'    => $p['deathCause'] ?? null,
        'place' => $p['place'],
        'tot'   => (int) $room['startCount'],
        'spec'  => !empty($p['spectator']),
        'wt'    => $p['swim'] ? round(WATER_GRACE - ($p['swimT'] ?? 0.0), 1) : null,
    ];
}

function welcomePayload(array $room, int $pid): array
{
    $nodes = [];
    foreach ($room['nodes'] as $id => $n) {
        $nodes[] = [$id, $n['k'], $n['x'], $n['z'], $n['s'], $n['var'], round($n['y'], 3)];
    }
    $chests = [];
    foreach ($room['chests'] as $id => $c) {
        $chests[] = [$id, round($c['x'], 2), round($c['y'], 2), round($c['z'], 2), $c['rot'], $c['open'], $c['k'] ?? 0, empty($c['lobby']) ? 0 : 1,
            isset($c['gy']) ? round($c['gy'], 2) : null];
    }
    $pads = [];
    foreach ($room['pads'] as $pd) {
        $pads[] = [$pd['id'], round($pd['x'], 3), round($pd['y'], 3), round($pd['z'], 3)];
    }
    $zips = [];
    foreach ($room['zips'] as $z) {
        $zips[] = [$z['id'], $z['a'], $z['b']];
    }
    $vehicles = [];
    foreach ($room['vehicles'] as $v) {
        $vehicles[] = vehicleWire($v);
    }
    $buildings = [];
    foreach ($room['buildings'] as $pc) {
        $buildings[] = pieceWire($pc);
    }
    $cols = [];
    foreach ($room['cols'] as $ck => $v) {
        $cols[$ck] = $v;
    }
    return [
        't'      => 'welcome',
        'id'     => $pid,
        'mode'   => $room['mode'],
        'state'  => $room['state'],
        'config' => [
            'tickRate'    => TICK_RATE,
            'weapons'     => WEAPONS,
            'consumables' => CONSUMABLES,
            'rarity'      => RARITY_NAMES,
            'rarityDmg'   => RARITY_DMG,
            'ammoNames'   => AMMO_NAMES,
            'loadoutCost' => LOADOUT_COST,
            'skins'       => SKINS,
            'storm'       => STORM_PHASES,
        ],
        'world' => [
            'nodes'     => $nodes,
            'chests'    => $chests,
            'buildings' => $buildings,
            'cols'      => $cols,
            'drops'     => array_values($room['drops']),
            'pads'      => $pads,
            'shops'     => shopsWire($room),
            'zips'      => $zips,
            'vehicles'  => $vehicles,
            'craters'   => $room['craters'],
        ],
        'room' => privView($room),
    ];
}

// =========================================================== SERVEUR WEBSOCKET

final class GameServer implements MessageComponentInterface
{
    /** @var array<string, array<string, mixed>> */
    private array $rooms = [];
    /** @var array<int, array{room: string, pid: int}> */
    private array $sessions = [];
    /** @var array<int, int> */
    private array $msgRate = [];
    private int $roomSeq = 0;
    private float $snapAcc = 0.0;
    private float $rateAcc = 0.0;

    public function onOpen(ConnectionInterface $conn): void
    {
    }

    public function onMessage(ConnectionInterface $from, $msg): void
    {
        $cid = spl_object_id($from);
        $this->msgRate[$cid] = ($this->msgRate[$cid] ?? 0) + 1;
        if ($this->msgRate[$cid] > MAX_MSG_PER_S) {
            return;
        }
        $data = json_decode((string) $msg, true);
        if (!is_array($data) || !isset($data['t']) || !is_string($data['t'])) {
            return;
        }
        if (!isset($this->sessions[$cid])) {
            if ($data['t'] === 'join') {
                $this->join($from, $data);
            }
            return;
        }
        ['room' => $rid, 'pid' => $pid] = $this->sessions[$cid];
        if (!isset($this->rooms[$rid]['players'][$pid])) {
            return;
        }
        $room = &$this->rooms[$rid];
        MapData::$h = $room['h'];      // relief de cette partie (cratères)
        $this->dispatch($room, $from, $pid, $data);
        unset($room);
    }

    public function onClose(ConnectionInterface $conn): void
    {
        $cid = spl_object_id($conn);
        $s = $this->sessions[$cid] ?? null;
        unset($this->sessions[$cid], $this->msgRate[$cid]);
        if ($s === null || !isset($this->rooms[$s['room']]['players'][$s['pid']])) {
            return;
        }
        $room = &$this->rooms[$s['room']];
        MapData::$h = $room['h'];
        if ($room['players'][$s['pid']]['veh'] !== null) {
            exitVehicle($room, $s['pid']);
        }
        if (!empty($room['players'][$s['pid']]['seat'])) {
            exitSeat($room, $s['pid']);
        }
        $p = $room['players'][$s['pid']];
        if ($room['mode'] === 'br' && in_array($p['state'], ['alive', 'falling'], true) && $room['state'] === 'playing') {
            dropAll($room, $s['pid']);
        }
        unset($room['players'][$s['pid']]);
        $room['events'][] = ['k' => 'left', 'id' => $s['pid']];
        // partie privée : l'hôte part, un autre joueur prend la main
        if ($room['priv'] !== null && $room['priv']['host'] === $s['pid']) {
            $room['priv']['host'] = null;
            foreach ($room['players'] as $oid => $o) {
                if (!isBot($o)) {
                    $room['priv']['host'] = $oid;
                    $room['events'][] = ['k' => 'toast', 'a' => $oid, 'msg' => 'Vous êtes maintenant l\'hôte de la partie privée'];
                    break;
                }
            }
        }
        if ($room['mode'] === 'br' && in_array($room['state'], ['bus', 'playing'], true)) {
            checkEnd($room);
        }
        unset($room);
    }

    public function onError(ConnectionInterface $conn, \Exception $e): void
    {
        error_log('[ws] ' . $e->getMessage());
        $conn->close();
    }

    /**
     * Requête HTTP ordinaire : page du jeu, API ou état (voir http.php).
     * @param array<string,string> $headers
     * @return array{0:int, 1:array<string,string>, 2:string}
     */
    public function onHttp(string $method, string $target, array $headers, string $body): array
    {
        return httpHandle($method, $target, $headers, $body, fn (): array => $this->status());
    }

    /** État affiché quand on ouvre …/ws ou …/status dans un navigateur. */
    public function status(): array
    {
        $players = 0;
        $bots = 0;
        foreach ($this->rooms as $r) {
            foreach ($r['players'] as $p) {
                isBot($p) ? $bots++ : $players++;
            }
        }
        return ['ok' => true, 'rooms' => count($this->rooms), 'players' => $players, 'bots' => $bots];
    }

    /** Appelée à chaque tick (60 Hz) par la boucle WsServerLoop. */
    public function tick(float $dt): void
    {
        foreach ($this->rooms as &$room) {
            MapData::$h = $room['h'];   // chaque partie a son relief (cratères des grenades)
            tickRoom($room, $dt);
            $room['h'] = MapData::$h;
        }
        unset($room);

        $this->rateAcc += $dt;
        if ($this->rateAcc >= 1.0) {
            $this->msgRate = [];
            $this->rateAcc = 0.0;
        }

        $this->snapAcc += $dt;
        if ($this->snapAcc >= SNAP_INTERVAL - 1e-6) {
            $this->snapAcc -= SNAP_INTERVAL;
            foreach ($this->rooms as $rid => $room) {
                $snap = snapshot($room);
                foreach ($room['players'] as $p) {
                    if (!isBot($p)) {
                        $this->send($p['conn'], $snap + ['me' => selfView($room, $p)]);
                    }
                }
                $this->rooms[$rid]['events'] = [];
            }
        }

        foreach ($this->rooms as $rid => $room) {
            $humans = 0;
            foreach ($room['players'] as $p) {
                $humans += isBot($p) ? 0 : 1;
            }
            if ($humans === 0) {
                unset($this->rooms[$rid]);
            }
        }
    }

    private function join(ConnectionInterface $conn, array $d): void
    {
        $mode = ($d['mode'] ?? '') === 'train' ? 'train' : 'br';
        $profile = null;
        $token = $d['token'] ?? '';
        if (is_string($token) && $token !== '') {
            $profile = findPlayerByToken($token);
        }
        $profile ??= [
            'id'    => null,
            'token' => null,
            'name'  => sanitizeName(is_string($d['name'] ?? null) ? $d['name'] : ''),
            'skin'  => validSkin(is_string($d['skin'] ?? null) ? $d['skin'] : 'knight'),
        ];
        // le pseudo et le skin choisis dans le menu priment
        if (is_string($d['skin'] ?? null)) {
            $profile['skin'] = validSkin($d['skin']);
        }
        $profile['loadout'] = sanitizeLoadout($d['lo'] ?? null);
        $priv = is_array($d['room'] ?? null) ? $d['room'] : null;
        if ($priv !== null && $mode === 'br') {
            $rid = $this->privateRoom($priv);
            if ($rid === null) {
                $this->send($conn, ['t' => 'err', 'msg' => 'Aucune partie privée en attente avec ce code', 'fatal' => true]);
                return;
            }
        } else {
            $rid = $this->pickRoom($mode);
        }
        $room = &$this->rooms[$rid];
        MapData::$h = $room['h'];
        $pid = $room['nextId']++;
        $room['players'][$pid] = newPlayer($pid, $conn, $profile, $room);
        if ($room['priv'] !== null && $room['priv']['host'] === null) {
            $room['priv']['host'] = $pid;
        }
        $this->sessions[spl_object_id($conn)] = ['room' => $rid, 'pid' => $pid];
        $this->send($conn, welcomePayload($room, $pid));
        unset($room);
    }

    /**
     * Partie privée : rejoindre par code, ou créer (create) — en « Rejouer », le même code
     * est réutilisé : on rejoint la partie s'il y en a déjà une en attente, sinon on la recrée.
     */
    private function privateRoom(array $d): ?string
    {
        $code = cleanCode($d['code'] ?? '');
        if ($code !== '') {
            foreach ($this->rooms as $id => $r) {
                if (($r['priv']['code'] ?? '') === $code && $r['state'] === 'lobby' && count($r['players']) < MAX_ROOM) {
                    return (string) $id;
                }
            }
            if (empty($d['create'])) {
                return null;
            }
            foreach ($this->rooms as $r) {
                if (($r['priv']['code'] ?? '') === $code) {
                    $code = '';      // code encore pris par une partie en cours
                    break;
                }
            }
        } elseif (empty($d['create'])) {
            return null;
        }
        $id = 'r' . (++$this->roomSeq);
        $room = newRoom($id, 'br');
        $room['priv'] = [
            'code' => $code !== '' ? $code : newPrivateCode($this->rooms),
            'host' => null,
            'bots' => max(0, min(MAX_ROOM - 1, (int) ($d['bots'] ?? 10))),
            'lvl'  => normLevel(is_string($d['lvl'] ?? null) ? $d['lvl'] : 'normal'),
            'go'   => false,
        ];
        $room['botLevel'] = $room['priv']['lvl'];
        $this->rooms[$id] = $room;
        return $id;
    }

    private function pickRoom(string $mode): string
    {
        foreach ($this->rooms as $id => $r) {
            if ($r['mode'] !== $mode || count($r['players']) >= MAX_ROOM || $r['priv'] !== null) {
                continue;
            }
            if ($mode === 'br' && $r['state'] !== 'lobby') {
                continue;
            }
            return (string) $id;
        }
        $id = 'r' . (++$this->roomSeq);
        $this->rooms[$id] = newRoom($id, $mode);
        return $id;
    }

    private function dispatch(array &$room, ConnectionInterface $conn, int $pid, array $d): void
    {
        $err = null;
        switch ($d['t']) {
            case 'input':
                applyInput($room, $pid, $d);
                break;
            case 'fire':
                fire($room, $pid, $d);
                break;
            case 'swing':
                swing($room, $pid, $d);
                break;
            case 'slot':
                selectSlot($room, $pid, (int) ($d['slot'] ?? 0));
                break;
            case 'reload':
                startReload($room, $pid);
                break;
            case 'use':
                startUse($room, $pid, SLOT_TACTICAL);
                break;
            case 'lethal':
                startUse($room, $pid, SLOT_LETHAL);
                break;
            case 'tactical':
                startUse($room, $pid, SLOT_TACTICAL);
                break;
            case 'util':
                startUse($room, $pid, SLOT_UTIL);
                break;
            case 'plate':
                $err = startPlate($room, $pid);
                break;
            case 'cancel':
                cancelActions($room['players'][$pid]);
                break;
            case 'open':
                $err = openChest($room, $pid, (int) ($d['id'] ?? -1));
                break;
            case 'pick':
                $err = pickUp($room, $pid, (int) ($d['id'] ?? -1));
                break;
            case 'dropItem':
                dropSelected($room, $pid);
                break;
            case 'buy':
                $err = buyLoadout($room, $pid);
                break;
            case 'loadout':
                $room['players'][$pid]['loadout'] = sanitizeLoadout($d['lo'] ?? null);
                break;
            case 'zip':
                $err = attachZip($room, $pid);
                break;
            case 'door':
                $err = toggleDoor($room, $pid, (string) ($d['key'] ?? ''));
                break;
            case 'start':   // partie privée : l'hôte lance le départ
                $pv = $room['priv'];
                if ($pv !== null && $pv['host'] === $pid && $room['state'] === 'lobby' && !$pv['go']) {
                    $room['priv']['go'] = true;
                    $room['countdown'] = 10.0;
                    $room['events'][] = ['k' => 'privGo'];
                }
                break;
            case 'privCfg':   // l'hôte change le nombre de bots ou leur niveau avant le départ
                if ($room['priv'] !== null && $room['priv']['host'] === $pid && $room['state'] === 'lobby') {
                    if (isset($d['bots'])) {
                        $room['priv']['bots'] = max(0, min(MAX_ROOM - 1, (int) $d['bots']));
                    }
                    if (isset($d['lvl']) && is_string($d['lvl'])) {
                        $room['priv']['lvl'] = normLevel($d['lvl']);
                        $room['botLevel'] = $room['priv']['lvl'];
                    }
                }
                break;
            case 'veh':
                if (!empty($room['players'][$pid]['seat'])) {
                    exitSeat($room, $pid);
                } elseif ($room['players'][$pid]['veh'] !== null) {
                    exitVehicle($room, $pid);
                } else {
                    $err = enterVehicle($room, $pid);
                }
                break;
            case 'emote':
                if ($room['players'][$pid]['state'] === 'alive') {
                    $room['events'][] = ['k' => 'emote', 'a' => $pid, 'e' => max(0, (int) ($d['e'] ?? 0)) % 8];
                }
                break;
            case 'drop':
                dropPlayer($room, $pid);
                break;
            case 'ping':
                $this->send($conn, ['t' => 'pong', 'ts' => $d['ts'] ?? 0]);
                break;
            case 'give':   // tests automatiques seulement (GAME_DEBUG=1)
                if (getenv('GAME_DEBUG') === '1') {
                    $type = (string) ($d['it'] ?? 'ar');
                    if (isset(WEAPONS[$type])) {
                        $slot = isset($d['slot']) ? ((int) $d['slot'] === 1 ? SLOT_SECONDARY : SLOT_PRIMARY) : SLOT_SECONDARY;
                        $room['players'][$pid]['slots'][$slot] = makeWeapon($type, 3);
                        $room['players'][$pid]['ammo'][WEAPONS[$type]['ammo']] = 99;
                    } elseif (isset(CONSUMABLES[$type])) {
                        $slot = SLOT_OF_KIND[CONSUMABLES[$type]['kind']];
                        $room['players'][$pid]['slots'][$slot] = makeConsumable($type, CONSUMABLES[$type]['stack']);
                    }
                    $room['players'][$pid]['cash'] = 5000;
                    $room['players'][$pid]['plates'] = PLATE_CARRY;
                }
                break;
            case 'hurt':   // tests automatiques seulement
                if (getenv('GAME_DEBUG') === '1') {
                    damagePlayer($room, $pid, (float) ($d['n'] ?? 10), null);
                }
                break;
            case 'vhurt':   // tests : abîmer un véhicule (GAME_DEBUG=1)
                if (getenv('GAME_DEBUG') === '1' && isset($room['vehicles'][(int) ($d['v'] ?? -1)])) {
                    damageVehicle($room, (int) $d['v'], (float) ($d['n'] ?? 100), $pid);
                }
                break;
            case 'airdrop':   // tests : faire tomber un largage (GAME_DEBUG=1)
                if (getenv('GAME_DEBUG') === '1' && $room['storm'] !== null) {
                    spawnAirdrop($room);
                }
                break;
            case 'bhit':   // tests : abîmer une construction (GAME_DEBUG=1)
                if (getenv('GAME_DEBUG') === '1' && isset($room['buildings'][(string) ($d['key'] ?? '')])) {
                    damageBuilding($room, (string) $d['key'], (float) ($d['dmg'] ?? 50), $pid);
                }
                break;
            case 'tp':   // téléportation : tests automatiques seulement (GAME_DEBUG=1)
                if (getenv('GAME_DEBUG') === '1') {
                    $x = (float) ($d['x'] ?? 0);
                    $z = (float) ($d['z'] ?? 0);
                    $y = isset($d['y']) ? (float) $d['y'] : terrainHeight($x, $z) + 0.5;
                    $room['players'][$pid]['pos'] = [$x, $y, $z];
                    $room['players'][$pid]['vel'] = [0.0, 0.0, 0.0];
                    $room['players'][$pid]['zip'] = null;
                }
                break;
        }
        if ($err !== null) {
            $this->send($conn, ['t' => 'err', 'msg' => $err]);
        }
    }

    private function send(ConnectionInterface $conn, array $msg): void
    {
        $conn->send(json_encode($msg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION));
    }
}

// =========================================================== DÉMARRAGE

MapData::load(dirname(__DIR__) . '/public/map/island.json');

if (!defined('GAME_NO_BOOT')) {
    $game = new GameServer();
    $loop = new WsServerLoop($game, GAME_HOST, PORT, static fn () => $game->tick(DT), DT);
    echo '[ws] serveur prêt sur ' . WsServerLoop::address(GAME_HOST, PORT) . ' (simulation ' . TICK_RATE . " Hz)\n";
    $loop->run();
}
