<?php
declare(strict_types=1);

/**
 * server/extras.php — grenades et cratères, largages aériens, lamas à butin,
 * véhicules (points de vie, passagers, explosion), parties privées, niveau des bots.
 */

const GRENADE_FUSE  = 2.2;      // secondes avant l'explosion
const GRENADE_SPEED = 24.0;
const GRENADE_GRAV  = 22.0;
const NADE_RADIUS   = 6.8;
const NADE_PLAYER   = 95.0;
const NADE_BUILD    = 780.0;    // casse les murs et les maisons autour
const VEH_HP        = 750.0;
const VEH_BULLET    = 30.0;     // dégâts d'une balle à un véhicule : 25 balles = hors service
const VEH_BOOM      = ['r' => 6.0, 'player' => 80.0, 'build' => 320.0];
/** Places passagers : [décalage vers la droite, vers l'avant] (le conducteur est au centre du véhicule). */
const VEH_SEATS     = [[0.42, 0.05], [-0.42, -0.85], [0.42, -0.85]];
const AIRDROP_Y     = 150.0;
const AIRDROP_FALL  = 7.5;      // m/s sous son ballon
const LLAMA_COUNT   = 3;
const BOT_LEVELS    = ['facile', 'normal', 'difficile'];

function normLevel(?string $l): string
{
    $l = strtolower((string) $l);
    $l = ['easy' => 'facile', 'hard' => 'difficile', 'medium' => 'normal'][$l] ?? $l;
    return in_array($l, BOT_LEVELS, true) ? $l : 'normal';
}
define('BOT_LEVEL', normLevel(getenv('BR_BOT_LEVEL') ?: 'normal'));

/**
 * Niveau d'un bot. En partie publique « normal », les bots sont mélangés (pas tous forts) :
 * 40 % faciles, 45 % normaux, 15 % difficiles. Sinon tous au niveau choisi.
 */
function botLevelFor(array $room): string
{
    $lvl = $room['botLevel'] ?? BOT_LEVEL;
    if ($room['priv'] !== null || $lvl !== 'normal') {
        return $lvl;
    }
    $r = rndf();
    return $r < 0.4 ? 'facile' : ($r < 0.85 ? 'normal' : 'difficile');
}

/** Réglages des bots selon le niveau : précision (skill), vue, réaction, cadence, constructions. */
function botLevelParams(string $lvl): array
{
    return [
        'facile'    => ['skill' => [0.2, 0.4], 'sight' => 45.0, 'react' => 1.8, 'rate' => 1.8, 'wall' => 0.3, 'miss' => 0.35],
        'normal'    => ['skill' => [0.45, 0.9], 'sight' => 65.0, 'react' => 1.2, 'rate' => 1.25, 'wall' => 0.8, 'miss' => 0.18],
        'difficile' => ['skill' => [0.9, 1.35], 'sight' => 90.0, 'react' => 0.7, 'rate' => 0.9, 'wall' => 1.5, 'miss' => 0.1],
    ][$lvl] ?? botLevelParams('normal');
}

// =========================================================== GRENADES

function throwGrenade(array &$room, int $pid): void
{
    $p = &$room['players'][$pid];
    $slot = $p['sel'];
    $item = $p['slots'][$slot] ?? null;
    if ($item === null || $item['type'] !== 'grenade' || $p['state'] !== 'alive' || $p['veh'] !== null
        || $room['time'] - ($p['lastThrow'] ?? -9.0) < 0.75) {
        return;
    }
    $p['lastThrow'] = $room['time'];
    $p['reload'] = null;
    $yaw = $p['yaw'];
    $pitch = min(1.2, $p['pitch'] + 0.12);
    $dir = [-sin($yaw) * cos($pitch), sin($pitch), -cos($yaw) * cos($pitch)];
    $start = [$p['pos'][0] + $dir[0] * 0.4, $p['pos'][1] + 1.55, $p['pos'][2] + $dir[2] * 0.4];
    if (insideSolidAt($room, $start[0], $start[1], $start[2])) {
        $start = [$p['pos'][0], $p['pos'][1] + 1.55, $p['pos'][2]];
    }
    $id = $room['nextNade']++;
    $room['nades'][$id] = [
        'id' => $id, 'o' => $pid, 'fuse' => GRENADE_FUSE, 'bt' => -1.0, 'p' => $start,
        'v' => [$dir[0] * GRENADE_SPEED + $p['vel'][0] * 0.4, $dir[1] * GRENADE_SPEED + 4.0, $dir[2] * GRENADE_SPEED + $p['vel'][2] * 0.4],
    ];
    if (!($room['mode'] === 'build' || $room['state'] === 'lobby')) {
        $p['slots'][$slot]['n']--;
        if ($p['slots'][$slot]['n'] <= 0) {
            $p['slots'][$slot] = null;
        }
    }
    $room['events'][] = ['k' => 'throw', 'a' => $pid];
}

/** Grenades : gravité, rebonds sur le relief, les constructions et les obstacles, puis explosion. */
function tickNades(array &$room, float $dt): void
{
    foreach (array_keys($room['nades']) as $id) {
        $n = $room['nades'][$id];
        $n['fuse'] -= $dt;
        if ($n['fuse'] <= 0.0) {
            unset($room['nades'][$id]);
            grenadeBlast($room, $n['p'], $n['o']);
            continue;
        }
        $n['v'][1] -= GRENADE_GRAV * $dt;
        if ($n['p'][1] < WATER_Y) {
            $n['v'] = [$n['v'][0] * 0.9, max($n['v'][1], -2.5), $n['v'][2] * 0.9];
        }
        $p = $n['p'];
        foreach ([0, 2, 1] as $ax) {
            $try = $p;
            $try[$ax] += $n['v'][$ax] * $dt;
            $hit = insideSolidAt($room, $try[0], $try[1], $try[2]) || $try[1] < terrainHeight($try[0], $try[2]) + 0.1;
            if (!$hit) {
                $p = $try;
                continue;
            }
            $speed = abs($n['v'][$ax]);
            $n['v'][$ax] = -$n['v'][$ax] * ($ax === 1 ? 0.32 : 0.45);
            if ($ax === 1) {
                $n['v'][0] *= 0.72;
                $n['v'][2] *= 0.72;
                if (abs($n['v'][1]) < 1.2) {
                    $n['v'][1] = 0.0;
                }
            }
            if ($speed > 3.0 && $room['time'] - $n['bt'] > 0.12) {
                $n['bt'] = $room['time'];
                $room['events'][] = ['k' => 'nBounce', 'p' => round3($p)];
            }
        }
        $n['p'] = $p;
        $room['nades'][$id] = $n;
    }
}

function nadesView(array $room): array
{
    $out = [];
    foreach ($room['nades'] as $n) {
        $out[] = [$n['id'], round($n['p'][0], 2), round($n['p'][1], 2), round($n['p'][2], 2),
            round($n['v'][0], 2), round($n['v'][1], 2), round($n['v'][2], 2), round($n['fuse'], 2)];
    }
    return $out;
}

/** Explosion de grenade : gros souffle, maisons cassées autour, cratère dans le sol. */
function grenadeBlast(array &$room, array $c, int $owner): void
{
    blast($room, $c, $owner, 1.0, NADE_RADIUS, NADE_PLAYER, NADE_BUILD, 'g');
    $ground = terrainHeight($c[0], $c[2]);
    if ($c[1] - $ground < 2.4 && $ground > WATER_Y - 0.5) {
        makeCrater($room, $c[0], $c[2], min($c[1], $ground + 0.4));
    }
}

/**
 * Souffle d'une explosion : constructions (cartes comprises, sauf le lobby), arbres et rochers,
 * véhicules et joueurs (sauf abrités derrière une construction).
 */
function blast(array &$room, array $c, int $owner, float $mult, float $R, float $playerDmg, float $buildDmg, string $kind): void
{
    $room['events'][] = ['k' => 'boom', 'p' => round3($c), 'a' => $owner, 'g' => $kind];
    $gx = (int) floor($c[0] / CELL);
    $gz = (int) floor($c[2] / CELL);
    $span = (int) ceil($R / CELL) + 1;
    for ($dx = -$span; $dx <= $span; $dx++) {
        for ($dz = -$span; $dz <= $span; $dz++) {
            foreach (piecesInCell($room, $gx + $dx, $gz + $dz) as $pc) {
                $best = INF;
                foreach (pieceBoxes($pc) as $b) {
                    $qx = max($b[0], min($c[0], $b[3]));
                    $qy = max($b[1], min($c[1], $b[4]));
                    $qz = max($b[2], min($c[2], $b[5]));
                    $best = min($best, sqrt(($qx - $c[0]) ** 2 + ($qy - $c[1]) ** 2 + ($qz - $c[2]) ** 2));
                }
                if ($best < $R) {
                    damageBuilding($room, $pc['key'], $buildDmg * $mult * (1.0 - 0.55 * $best / $R), $owner);
                }
            }
        }
    }
    foreach (nodesInRadius($room, $c[0], $c[2], $R + 2.0) as $n) {
        if ($n['k'] === 'veh') {
            continue;
        }
        $d = sqrt(($n['x'] - $c[0]) ** 2 + ($n['z'] - $c[2]) ** 2) - $n['r'];
        // les meubles autour de l'explosion volent en éclats
        if ($n['k'] === 'prop' && $d < $R && abs($n['y'] - $c[1]) < $R) {
            removeNode($room, $n['id']);
            $room['events'][] = ['k' => 'gone', 'n' => $n['id']];
            continue;
        }
        if ($d < $R * 0.6 && $c[1] > $n['y'] - 1.0 && $c[1] < $n['y'] + $n['h'] + 1.0) {
            $room['nodes'][$n['id']]['hp'] -= 120 * ($kind === 'g' ? 2.0 : 1.0);
            if ($room['nodes'][$n['id']]['hp'] <= 0) {
                removeNode($room, $n['id']);
                $room['events'][] = ['k' => 'gone', 'n' => $n['id']];
            } else {
                $nn = $room['nodes'][$n['id']];
                $room['events'][] = ['k' => 'chip', 'n' => $n['id'], 'd' => round(1.0 - $nn['hp'] / max(1.0, $nn['max'] ?? $nn['hp']), 2)];
            }
        }
    }
    foreach (array_keys($room['vehicles']) as $vid) {
        $v = $room['vehicles'][$vid] ?? null;
        if ($v === null || !empty($v['wreck'])) {
            continue;
        }
        $vp = $v['pos'];
        if ($v['driver'] !== null && isset($room['players'][$v['driver']])) {
            $vp = $room['players'][$v['driver']]['pos'];
        }
        $d = sqrt(($vp[0] - $c[0]) ** 2 + ($vp[1] + 0.8 - $c[1]) ** 2 + ($vp[2] - $c[2]) ** 2);
        if ($d < $R + 1.5) {
            // roquette ou grenade dedans : le véhicule est détruit ; plus loin, il est abîmé
            $k = $kind === 'v' ? 0.45 : 1.4;
            damageVehicle($room, $vid, VEH_HP * $k * $mult * (1.0 - 0.75 * min(1.0, $d / ($R + 1.5))), $owner >= 0 ? $owner : null);
        }
    }
    foreach (array_keys($room['players']) as $vid) {
        $v = $room['players'][$vid] ?? null;
        if ($v === null || $v['state'] !== 'alive') {
            continue;
        }
        $chest = [$v['pos'][0], $v['pos'][1] + 1.0, $v['pos'][2]];
        $kd = sqrt(($chest[0] - $c[0]) ** 2 + ($chest[1] - $c[1]) ** 2 + ($chest[2] - $c[2]) ** 2);
        if ($kd < $R * 1.1 && $v['veh'] === null && empty($v['seat'])) {
            // souffle : projette les joueurs (saut à la roquette)
            $k = (1.0 - $kd / ($R * 1.1)) * 15.0;
            $hx = $kd > 0.3 ? ($chest[0] - $c[0]) / $kd : 0.0;
            $hz = $kd > 0.3 ? ($chest[2] - $c[2]) / $kd : 0.0;
            $room['players'][$vid]['vel'][0] += $hx * $k;
            $room['players'][$vid]['vel'][1] = max($room['players'][$vid]['vel'][1], 4.0 + $k * 0.8);
            $room['players'][$vid]['vel'][2] += $hz * $k;
            $room['players'][$vid]['ground'] = false;
            $room['players'][$vid]['zip'] = null;
        }
        if ($kd >= $R) {
            continue;
        }
        if ($kd > 0.6) {
            $dir = [($chest[0] - $c[0]) / $kd, ($chest[1] - $c[1]) / $kd, ($chest[2] - $c[2]) / $kd];
            $hit = raycastWorld($room, $c, $dir, $kd - 0.4, null, false);
            if ($hit !== null && $hit['kind'] === 'build') {
                continue;   // à l'abri derrière une construction
            }
        }
        $dmg = $playerDmg * $mult * (1.0 - 0.7 * $kd / $R);
        if ($vid === $owner) {
            $dmg *= 0.35;
        }
        damagePlayer($room, $vid, $dmg, $owner >= 0 ? $owner : null, false, $chest);
    }
}

/** Obstacles (arbres, rochers…) dans un rayon plus grand qu'une case. */
function nodesInRadius(array $room, float $x, float $z, float $R): array
{
    $out = [];
    $g0 = (int) floor(($x - $R) / CELL);
    $g1 = (int) floor(($x + $R) / CELL);
    $h0 = (int) floor(($z - $R) / CELL);
    $h1 = (int) floor(($z + $R) / CELL);
    for ($gx = $g0; $gx <= $g1; $gx++) {
        for ($gz = $h0; $gz <= $h1; $gz++) {
            foreach ($room['ncells'][cellKey($gx, $gz)] ?? [] as $id) {
                if (!isset($out[$id]) && isset($room['nodes'][$id])) {
                    $out[$id] = $room['nodes'][$id];
                }
            }
        }
    }
    return $out;
}

/** Creuse un cratère dans le relief de la partie (même calcul côté client, voir applyCrater). */
function makeCrater(array &$room, float $x, float $z, float $y): void
{
    $x = round($x, 2);
    $z = round($z, 2);
    $y = round($y, 2);
    MapData::$h = [];                 // libère la référence : modification sur place
    applyCrater($room['h'], $x, $z, $y);
    MapData::$h = $room['h'];
    $room['craters'][] = [$x, $z, $y];
    $room['events'][] = ['k' => 'crater', 'c' => [$x, $z, $y]];
    // constructions au-dessus du trou : elles tombent si plus rien ne les tient
    $g0 = (int) floor(($x - CRATER_R) / CELL);
    $g1 = (int) floor(($x + CRATER_R) / CELL);
    $h0 = (int) floor(($z - CRATER_R) / CELL);
    $h1 = (int) floor(($z + CRATER_R) / CELL);
    for ($gx = $g0; $gx <= $g1; $gx++) {
        for ($gz = $h0; $gz <= $h1; $gz++) {
            foreach (piecesInCell($room, $gx, $gz) as $pc) {
                $room['intQ'][] = ['seed' => true, 'key' => $pc['key']];
            }
        }
    }
    // arbres et rochers déracinés
    foreach (nodesInRadius($room, $x, $z, CRATER_R) as $n) {
        if ($n['k'] === 'veh' || sqrt(($n['x'] - $x) ** 2 + ($n['z'] - $z) ** 2) > CRATER_R * 0.8) {
            continue;
        }
        removeNode($room, $n['id']);
        $room['events'][] = ['k' => 'gone', 'n' => $n['id']];
    }
    // objets, coffres et véhicules posés au sol : ils descendent au fond du trou
    foreach ($room['drops'] as $id => $d) {
        if (sqrt(($d['p'][0] - $x) ** 2 + ($d['p'][2] - $z) ** 2) < CRATER_R) {
            $gy = floorAt($room, $d['p'][0], $d['p'][1] + 0.3, $d['p'][2]);
            if ($gy < $d['p'][1] - 0.05) {
                $room['drops'][$id]['p'][1] = round($gy, 2);
                $room['events'][] = ['k' => 'dropPos', 'id' => $id, 'p' => $room['drops'][$id]['p']];
            }
        }
    }
    foreach ($room['chests'] as $cid => $c) {
        if (!empty($c['lobby']) || sqrt(($c['x'] - $x) ** 2 + ($c['z'] - $z) ** 2) > CRATER_R) {
            continue;
        }
        $gy = max(terrainHeight($c['x'], $c['z']), supportHeight($room, $c['x'], $c['y'] + 0.3, $c['z']));
        if ($gy < $c['y'] - 0.05 && !empty($c['land'] ?? true)) {
            $room['chests'][$cid]['y'] = $gy;
            $room['events'][] = ['k' => 'chestY', 'c' => $cid, 'y' => round($gy, 2)];
        }
    }
    foreach ($room['vehicles'] as $vid => $v) {
        if ($v['driver'] !== null || sqrt(($v['pos'][0] - $x) ** 2 + ($v['pos'][2] - $z) ** 2) > CRATER_R + 1.5) {
            continue;
        }
        $gy = max(terrainHeight($v['pos'][0], $v['pos'][2]), supportHeight($room, $v['pos'][0], $v['pos'][1] + 0.5, $v['pos'][2]));
        if ($gy < $v['pos'][1] - 0.05) {
            unparkVehicle($room, $vid);
            $room['vehicles'][$vid]['pos'][1] = $gy;
            parkVehicle($room, $vid);
            foreach ($room['players'] as $pid => $pp) {
                if (($pp['seat'][0] ?? -1) === $vid) {
                    seatPlayer($room, $pid);
                }
            }
            $room['events'][] = ['k' => 'vUpd', 'v' => vehicleWire($room['vehicles'][$vid])];
        }
    }
}

// =========================================================== VÉHICULES : PV, PASSAGERS, EXPLOSION

function damageVehicle(array &$room, int $vid, float $dmg, ?int $by): void
{
    $v = $room['vehicles'][$vid] ?? null;
    if ($v === null || !empty($v['wreck']) || $dmg <= 0.0) {
        return;
    }
    $hp = max(0.0, $v['hp'] - $dmg);
    $room['vehicles'][$vid]['hp'] = $hp;
    $room['events'][] = ['k' => 'vHp', 'v' => $vid, 'hp' => (int) ceil($hp), 'a' => $by];
    if ($hp <= 0.0) {
        explodeVehicle($room, $vid, $by);
    }
}

/** Le véhicule explose : tout le monde est éjecté, il reste une carcasse (obstacle). */
function explodeVehicle(array &$room, int $vid, ?int $by): void
{
    $room['vehicles'][$vid]['wreck'] = true;
    $room['vehicles'][$vid]['hp'] = 0.0;
    $driver = $room['vehicles'][$vid]['driver'];
    if ($driver !== null && isset($room['players'][$driver])) {
        exitVehicle($room, $driver);
    }
    foreach (array_keys($room['players']) as $pid) {
        if (($room['players'][$pid]['seat'][0] ?? -1) === $vid) {
            exitSeat($room, $pid);
        }
    }
    $v = $room['vehicles'][$vid];
    $room['events'][] = ['k' => 'vBoom', 'v' => vehicleWire($v), 'a' => $by];
    blast($room, [$v['pos'][0], $v['pos'][1] + 0.8, $v['pos'][2]], $by ?? -1, 1.0, VEH_BOOM['r'], VEH_BOOM['player'], VEH_BOOM['build'], 'v');
}

/** Position d'une place passager selon le véhicule (conduit ou garé). */
function seatPos(array $room, int $vid, int $s): array
{
    $v = $room['vehicles'][$vid];
    $pos = $v['pos'];
    $yaw = $v['yaw'];
    if ($v['driver'] !== null && isset($room['players'][$v['driver']])) {
        $d = $room['players'][$v['driver']];
        $pos = $d['pos'];
        $yaw = $d['cyaw'];
    }
    [$side, $fwd] = VEH_SEATS[$s];
    return [$pos[0] + cos($yaw) * $side - sin($yaw) * $fwd, $pos[1], $pos[2] - sin($yaw) * $side - cos($yaw) * $fwd];
}

function seatPlayer(array &$room, int $pid): void
{
    $p = &$room['players'][$pid];
    [$vid, $s] = $p['seat'];
    if (!isset($room['vehicles'][$vid])) {
        $p['seat'] = null;
        return;
    }
    $p['pos'] = seatPos($room, $vid, $s);
    $drv = $room['vehicles'][$vid]['driver'];
    $p['vel'] = $drv !== null && isset($room['players'][$drv]) ? $room['players'][$drv]['vel'] : [0.0, 0.0, 0.0];
    $p['ground'] = true;
    $p['swim'] = false;
    $p['slide'] = 0.0;
}

function exitSeat(array &$room, int $pid): void
{
    $p = &$room['players'][$pid];
    if (empty($p['seat'])) {
        return;
    }
    [$vid, $s] = $p['seat'];
    $p['seat'] = null;
    $room['vehicles'][$vid]['pass'][$s] = null;
    $v = $room['vehicles'][$vid];
    $yaw = $v['driver'] !== null && isset($room['players'][$v['driver']]) ? $room['players'][$v['driver']]['cyaw'] : $v['yaw'];
    $c = seatPos($room, $vid, $s);
    $side = VEH_SEATS[$s][0] > 0 ? 1.0 : -1.0;
    foreach ([2.0 * $side, 3.0 * $side, -2.0 * $side] as $o) {
        $x = $c[0] + cos($yaw) * $o;
        $z = $c[2] - sin($yaw) * $o;
        $y = floorAt($room, $x, $c[1] + 1.0, $z);
        if (!insideSolidAt($room, $x, $y + 0.9, $z)) {
            $p['pos'] = [$x, $y, $z];
            break;
        }
    }
    $p['vel'] = [0.0, 0.0, 0.0];
    $p['ground'] = false;
    $room['events'][] = ['k' => 'vSeat', 'v' => $vid, 's' => $s, 'a' => $pid, 'in' => 0];
}

function enterSeat(array &$room, int $pid, int $vid): ?string
{
    foreach (array_keys(VEH_SEATS) as $s) {
        if (($room['vehicles'][$vid]['pass'][$s] ?? null) === null) {
            $p = &$room['players'][$pid];
            cancelActions($p);
            $p['seat'] = [$vid, $s];
            $p['zip'] = null;
            $room['vehicles'][$vid]['pass'][$s] = $pid;
            unset($p);
            seatPlayer($room, $pid);
            $room['events'][] = ['k' => 'vSeat', 'v' => $vid, 's' => $s, 'a' => $pid, 'in' => 1];
            return null;
        }
    }
    return 'véhicule plein';
}

// =========================================================== LAMAS ET LARGAGES (des coffres spéciaux)

/** k = 2 : lama à butin · k = 3 : largage aérien. */
function addSpecialChest(array &$room, int $k, float $x, float $y, float $z, float $rot, array $extra = []): int
{
    $cid = $room['chests'] ? max(array_keys($room['chests'])) + 1 : 0;
    $room['chests'][$cid] = ['x' => $x, 'y' => $y, 'z' => $z, 'rot' => $rot, 'open' => false, 'k' => $k] + $extra;
    $room['events'][] = ['k' => 'chestAdd', 'c' => [$cid, round($x, 2), round($y, 2), round($z, 2), round($rot, 3), false, $k, 0,
        isset($extra['gy']) ? round($extra['gy'], 2) : null]];
    return $cid;
}

function spawnLlamas(array &$room): void
{
    for ($i = 0; $i < LLAMA_COUNT; $i++) {
        for ($try = 0; $try < 30; $try++) {
            [$x, $z] = randomLand(380.0, $room);
            $y = terrainHeight($x, $z);
            if ($y < 2.0 || nodesInRadius($room, $x, $z, 2.5) || nearbyPieces($room, $x, $z)) {
                continue;
            }
            addSpecialChest($room, 2, $x, $y, $z, rndf() * 6.28);
            break;
        }
    }
}

/** Largage : un point au hasard dans la prochaine zone, sur la terre ferme. */
function spawnAirdrop(array &$room): void
{
    $s = $room['storm'];
    for ($try = 0; $try < 40; $try++) {
        $a = rndf() * 2 * M_PI;
        $r = sqrt(rndf()) * max(8.0, $s['nr'] * 0.8);
        $x = $s['nx'] + cos($a) * $r;
        $z = $s['nz'] + sin($a) * $r;
        if (terrainHeight($x, $z) < 1.5 || nearbyPieces($room, $x, $z) || nodesInRadius($room, $x, $z, 2.0)) {
            continue;
        }
        $gy = floorAt($room, $x, 300.0, $z);
        addSpecialChest($room, 3, $x, AIRDROP_Y, $z, rndf() * 6.28, ['gy' => $gy, 'land' => false]);
        $room['events'][] = ['k' => 'airdrop', 'p' => [round($x, 1), round($z, 1)]];
        return;
    }
}

function tickAirdrops(array &$room, float $dt): void
{
    foreach ($room['chests'] as $cid => $c) {
        if (($c['k'] ?? 0) !== 3 || !empty($c['land'])) {
            continue;
        }
        $y = max($c['gy'], $c['y'] - AIRDROP_FALL * $dt);
        $room['chests'][$cid]['y'] = $y;
        if ($y <= $c['gy']) {
            $room['chests'][$cid]['land'] = true;
            $room['events'][] = ['k' => 'adLand', 'c' => $cid, 'y' => round($y, 2)];
        }
    }
}

/** Positions des largages en train de descendre (instantanés). */
function airdropView(array $room): array
{
    $out = [];
    foreach ($room['chests'] as $cid => $c) {
        if (($c['k'] ?? 0) === 3 && empty($c['land'])) {
            $out[] = [$cid, round($c['y'], 2)];
        }
    }
    return $out;
}

/** Butin d'un lama ou d'un largage. */
function specialLoot(int $k): array
{
    $items = [];
    if ($k === 3) {
        $w = makeWeapon(pickWeighted(['ar' => 30, 'pump' => 25, 'sniper' => 15, 'rocket' => 15, 'smg' => 15]), mt_rand(3, 4));
        $items[] = $w;
        $items[] = ammoPack(WEAPONS[$w['type']]['ammo'], 2);
        $items[] = makeConsumable(pickWeighted(['chug' => 3, 'slurp' => 4, 'shield' => 3]));
        $items[] = makeConsumable('grenade', 3);
        foreach (['wood', 'stone', 'metal'] as $m) {
            $items[] = ['type' => 'mat', 'm' => $m, 'n' => 100, 'r' => 0];
        }
        return $items;
    }
    // lama : beaucoup de matériaux, des munitions et de quoi se soigner
    foreach (['wood', 'stone', 'metal'] as $m) {
        $items[] = ['type' => 'mat', 'm' => $m, 'n' => 200, 'r' => 0];
    }
    foreach (['light', 'medium', 'shells', 'heavy'] as $a) {
        $items[] = ammoPack($a, 2);
    }
    for ($i = 0; $i < 3; $i++) {
        $items[] = makeConsumable(pickWeighted(['shield' => 4, 'mini' => 4, 'slurp' => 3, 'medkit' => 2, 'grenade' => 4, 'pad' => 2]));
    }
    return $items;
}

// =========================================================== PARTIES PRIVÉES

function newPrivateCode(array $rooms): string
{
    $abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
        $code = '';
        for ($i = 0; $i < 5; $i++) {
            $code .= $abc[mt_rand(0, strlen($abc) - 1)];
        }
        $used = false;
        foreach ($rooms as $r) {
            $used = $used || (($r['priv']['code'] ?? '') === $code);
        }
    } while ($used);
    return $code;
}

function cleanCode(mixed $c): string
{
    return substr((string) preg_replace('/[^A-Z0-9]/', '', strtoupper(is_string($c) ? $c : '')), 0, 8);
}

function privView(array $room): ?array
{
    $pv = $room['priv'] ?? null;
    if ($pv === null) {
        return null;
    }
    return ['code' => $pv['code'], 'host' => $pv['host'], 'bots' => $pv['bots'], 'lvl' => $pv['lvl'], 'go' => $pv['go']];
}

// =========================================================== EFFONDREMENT DES CONSTRUCTIONS

const COLLAPSE_STEP = 0.16;    // secondes entre deux étages qui s'effondrent (du bas vers le haut)
const INTEGRITY_CAP = 2500;    // au-delà, on considère la structure comme tenue (sécurité)

/** Boîte englobante d'une pièce entière (les cases éditées ne comptent pas : la pièce tient toujours). */
function pieceAabb(array $pc): array
{
    $C = CELL;
    $x0 = $pc['gx'] * $C;
    $z0 = $pc['gz'] * $C;
    $y0 = $pc['base'];
    $t = WALL_THICK / 2;
    switch ($pc['type']) {
        case 'floor':
            return [$x0, $y0, $z0, $x0 + $C, $y0 + FLOOR_THICK, $z0 + $C];
        case 'wall':
            return ($pc['rot'] ?? 0) === 0 ? [$x0, $y0, $z0 - $t, $x0 + $C, $y0 + $C, $z0 + $t] : [$x0 - $t, $y0, $z0, $x0 + $t, $y0 + $C, $z0 + $C];
        case 'roof':
            return [$x0, $y0, $z0, $x0 + $C, $y0 + ROOF_H, $z0 + $C];
        default:
            return [$x0, $y0, $z0, $x0 + $C, $y0 + $C, $z0 + $C];
    }
}

/**
 * Longueur de contact entre deux boîtes (0 si elles ne se touchent pas) : la plus grande
 * dimension de leur zone commune (une arête partagée = 4 m, un simple coin = presque rien).
 */
function boxContact(array $a, array $b, float $pad = 0.12): float
{
    $ox = min($a[3], $b[3]) - max($a[0], $b[0]) + $pad;
    $oy = min($a[4], $b[4]) - max($a[1], $b[1]) + $pad;
    $oz = min($a[5], $b[5]) - max($a[2], $b[2]) + $pad;
    return ($ox >= 0.0 && $oy >= 0.0 && $oz >= 0.0) ? max($ox, $oy, $oz) : 0.0;
}

/**
 * Volume d'une pièce pour la solidité : une boîte (mur, sol), ou 4 marches pour une rampe / un toit
 * en pente (seuls ses bords bas et haut s'appuient vraiment), une dalle + une pointe pour un cône.
 */
function pieceParts(array $pc): array
{
    $type = $pc['type'];
    if ($type !== 'stairs' && $type !== 'roof') {
        return [pieceAabb($pc)];
    }
    $C = CELL;
    $x0 = $pc['gx'] * $C;
    $z0 = $pc['gz'] * $C;
    $y0 = $pc['base'];
    if ($type === 'roof' && (int) ($pc['v'] ?? 0) === 0) {
        return [[$x0, $y0, $z0, $x0 + $C, $y0 + 0.5, $z0 + $C], [$x0 + 1.6, $y0, $z0 + 1.6, $x0 + 2.4, $y0 + ROOF_H, $z0 + 2.4]];
    }
    $H = $type === 'roof' ? ROOF_H : $C;
    $out = [];
    $n = 4;
    for ($i = 0; $i < $n; $i++) {
        $a0 = $C * $i / $n;
        $a1 = $C * ($i + 1) / $n;
        $b0 = $y0 + $H * $i / $n;
        $b1 = $y0 + $H * ($i + 1) / $n;
        // sens de la montée : 0 vers +x, 1 vers +z, 2 vers -x, 3 vers -z
        $out[] = match ((int) $pc['rot']) {
            0 => [$x0 + $a0, $b0, $z0, $x0 + $a1, $b1, $z0 + $C],
            1 => [$x0, $b0, $z0 + $a0, $x0 + $C, $b1, $z0 + $a1],
            2 => [$x0 + $C - $a1, $b0, $z0, $x0 + $C - $a0, $b1, $z0 + $C],
            default => [$x0, $b0, $z0 + $C - $a1, $x0 + $C, $b1, $z0 + $C - $a0],
        };
    }
    return $out;
}

/**
 * Deux pièces se tiennent si elles partagent un bord ou une face (au moins 1,5 m de contact cumulé) :
 * un simple coin qui se touche (pièces en diagonale, bas d'une rampe sur le bout d'un mur) ne suffit pas.
 */
function partsTouch(array $pa, array $pb): bool
{
    $sum = 0.0;
    foreach ($pa as $a) {
        foreach ($pb as $b) {
            $sum += boxContact($a, $b);
            if ($sum >= 1.5) {
                return true;
            }
        }
    }
    return false;
}

/** Pièce posée sur le sol : son pied touche (ou s'enfonce dans) le relief, ou fondation d'une maison / du lobby. */
function pieceGrounded(array $pc): bool
{
    if (!empty($pc['nb']) || (!empty($pc['m']) && (int) $pc['gy'] === 0)) {
        return true;
    }
    // premier niveau posé sur le relief de sa propre case (pente comprise) ; un premier niveau
    // « accroché » à la fondation d'une case voisine au bord d'une falaise, lui, ne compte pas
    if ((int) $pc['gy'] === 0 && $pc['base'] <= snapColumn(($pc['gx'] + 0.5) * CELL, ($pc['gz'] + 0.5) * CELL) + 1.01) {
        return true;
    }
    [$x0, $y0, $z0, $x1, , $z1] = pieceAabb($pc);
    foreach ([0.0, 0.5, 1.0] as $u) {
        foreach ([0.0, 0.5, 1.0] as $v) {
            if (terrainHeight($x0 + ($x1 - $x0) * $u, $z0 + ($z1 - $z0) * $v) >= $y0 - 0.6) {
                return true;
            }
        }
    }
    return false;
}

/** Pièces qui tiennent à une pièce (cases voisines, contact par un bord ou une face). */
function piecesTouching(array $room, array $pc, array &$lv = []): array
{
    static $partsCache = [];
    if (count($partsCache) > 4000) {
        $partsCache = [];
    }
    $out = [];
    $gy = (int) $pc['gy'];
    $box = pieceAabb($pc);
    $mine = null;
    for ($dx = -1; $dx <= 1; $dx++) {
        for ($dz = -1; $dz <= 1; $dz++) {
            $cx = $pc['gx'] + $dx;
            $cz = $pc['gz'] + $dz;
            $ck = $cx . ':' . $cz;
            if (!isset($lv[$ck])) {
                // pièces de la case rangées par étage (une fois par vérification)
                $lv[$ck] = [];
                foreach (piecesInCell($room, $cx, $cz) as $q) {
                    $lv[$ck][(int) $q['gy']][] = $q;
                }
            }
            $cand = array_merge($lv[$ck][$gy - 1] ?? [], $lv[$ck][$gy] ?? [], $lv[$ck][$gy + 1] ?? []);
            foreach ($cand as $q) {
                $k = $q['key'];
                if ($k === $pc['key'] || isset($out[$k]) || isset($room['collapse'][$k]) || !isset($room['buildings'][$k])) {
                    continue;
                }
                $qb = pieceAabb($q);
                if (boxContact($box, $qb) <= 0.0) {
                    continue;   // trop loin, inutile de regarder le détail
                }
                $mine ??= ($partsCache[$pc['key'] . '|' . $pc['base']] ??= pieceParts($pc));
                $theirs = $partsCache[$k . '|' . $q['base']] ??= pieceParts($q);
                if (partsTouch($mine, $theirs)) {
                    $out[$k] = $q;
                }
            }
        }
    }
    return $out;
}

/**
 * Gravats : une pièce qui vient d'être détruite blesse les joueurs qui étaient dedans et ceux
 * qui se trouvent juste dessous (un étage qui s'effondre fait vraiment mal). Un joueur ne peut
 * être touché que toutes les DEBRIS_RATE secondes, sinon une tour qui tombe tuerait d'un coup.
 */
function crushPlayers(array &$room, array $pc, ?int $by = null): void
{
    $dmg = DEBRIS_DMG[$pc['mat']] ?? 20.0;
    [$x0, $y0, $z0, $x1, $y1, $z1] = pieceAabb($pc);
    foreach ($room['players'] as $pid => $p) {
        if ($p['state'] !== 'alive' || !empty($p['spectator']) || $p['veh'] !== null) {
            continue;
        }
        if ($room['time'] - ($p['crushT'] ?? -9.0) < DEBRIS_RATE) {
            continue;
        }
        // le joueur (pieds en pos[1], PLAYER_H de haut) touche la pièce, ou passe dessous (3 m)
        $inXZ = $p['pos'][0] > $x0 - PLAYER_R && $p['pos'][0] < $x1 + PLAYER_R
            && $p['pos'][2] > $z0 - PLAYER_R && $p['pos'][2] < $z1 + PLAYER_R;
        if (!$inXZ) {
            continue;
        }
        $top = $p['pos'][1] + PLAYER_H;
        $under = $p['pos'][1] < $y0 && $y0 - $top < 3.0;
        if (!($under || ($top > $y0 - 0.2 && $p['pos'][1] < $y1 + 0.2))) {
            continue;
        }
        $room['players'][$pid]['crushT'] = $room['time'];
        // secoué par l'impact : on perd l'appui et on est poussé vers le bas
        $room['players'][$pid]['ground'] = false;
        $room['players'][$pid]['vel'][1] = min($room['players'][$pid]['vel'][1], -2.0);
        $room['events'][] = ['k' => 'crush', 'v' => $pid, 'mat' => $pc['mat'],
            'p' => round3([($x0 + $x1) / 2, $y0, ($z0 + $z1) / 2])];
        damagePlayer($room, $pid, $dmg, $by, false, [$p['pos'][0], $p['pos'][1] + 1.0, $p['pos'][2]]);
    }
}

/** Une pièce vient de disparaître : on vérifiera après ce tour si ce qu'elle portait tient encore. */
function pieceRemoved(array &$room, array $pc): void
{
    $room['intQ'][] = $pc;
    settleAround($room, $pc);
}

/**
 * Ce qui ne touche plus le sol (directement ou par d'autres pièces) s'effondre :
 * étage par étage, en commençant par le plus bas.
 */
/** Pièces des cases voisines, un niveau au-dessous à un niveau au-dessus (contact ou non). */
function piecesNear(array $room, array $pc): array
{
    $out = [];
    for ($dx = -1; $dx <= 1; $dx++) {
        for ($dz = -1; $dz <= 1; $dz++) {
            foreach (piecesInCell($room, $pc['gx'] + $dx, $pc['gz'] + $dz) as $q) {
                if (abs((int) $q['gy'] - (int) $pc['gy']) <= 1 && $q['key'] !== $pc['key'] && !isset($room['collapse'][$q['key']])) {
                    $out[$q['key']] = $q;
                }
            }
        }
    }
    return $out;
}

function processIntegrity(array &$room): void
{
    if (empty($room['intQ'])) {
        return;
    }
    $removed = $room['intQ'];
    $room['intQ'] = [];
    $checked = [];
    $lv = [];
    foreach ($removed as $pc) {
        // une pièce disparue : on vérifie ce qui la touchait ; une pièce « à revérifier » (cratère) : elle-même
        // (tout ce qui est autour est revérifié, même un simple coin : rien ne doit rester suspendu dans le vide)
        $starts = !empty($pc['seed']) ? (isset($room['buildings'][$pc['key']]) ? [$pc['key'] => $room['buildings'][$pc['key']]] : [])
            : piecesTouching($room, $pc, $lv) + piecesNear($room, $pc);
        foreach ($starts as $k => $q) {
            if (isset($checked[$k])) {
                continue;
            }
            // parcours en profondeur, en explorant d'abord vers le bas (on trouve vite le sol)
            $seen = [$k => true];
            $stack = [$k];
            $grounded = false;
            while ($stack) {
                $cur = array_pop($stack);
                $p = $room['buildings'][$cur] ?? null;
                if ($p === null) {
                    continue;
                }
                if (pieceGrounded($p) || count($seen) > INTEGRITY_CAP) {
                    $grounded = true;
                    break;
                }
                $next = piecesTouching($room, $p, $lv);
                uasort($next, static fn ($a, $b) => $b['base'] <=> $a['base']);
                foreach ($next as $nk => $_) {
                    if (!isset($seen[$nk])) {
                        $seen[$nk] = true;
                        $stack[] = $nk;
                    }
                }
            }
            $checked += $seen;
            if (!$grounded) {
                scheduleCollapse($room, array_keys($seen));
            }
        }
    }
}

function scheduleCollapse(array &$room, array $keys): void
{
    $list = [];
    foreach ($keys as $k) {
        if (isset($room['buildings'][$k]) && empty($room['buildings'][$k]['nb'])) {
            $list[] = $room['buildings'][$k];
        }
    }
    if (!$list) {
        return;
    }
    $low = min(array_map(static fn ($p) => $p['base'], $list));
    foreach ($list as $p) {
        $lv = (int) round(($p['base'] - $low) / CELL);
        $room['collapse'][$p['key']] = $room['time'] + 0.15 + $lv * COLLAPSE_STEP + rndf() * 0.06;
    }
}

function tickCollapse(array &$room): void
{
    if (empty($room['collapse'])) {
        return;
    }
    foreach ($room['collapse'] as $k => $t) {
        if ($t > $room['time']) {
            continue;
        }
        unset($room['collapse'][$k]);
        $pc = $room['buildings'][$k] ?? null;
        if ($pc === null) {
            continue;
        }
        removePiece($room, $k);
        unset($room['growing'][$k]);
        $room['events'][] = ['k' => 'bDel', 'key' => $k, 'mat' => $pc['mat'], 'c' => 1];
        crushPlayers($room, $pc, null);
        pieceRemoved($room, $pc);
    }
}

/**
 * Après la disparition d'une pièce : les coffres qu'elle portait s'ouvrent et leur butin tombe,
 * les objets au sol et les meubles tombent aussi (les meubles se cassent).
 */
function settleAround(array &$room, array $pc): void
{
    [$x0, $y0, $z0, $x1, $y1, $z1] = pieceAabb($pc);
    $pad = 0.7;
    $in = static fn (float $x, float $y, float $z) => $x > $x0 - $pad && $x < $x1 + $pad && $z > $z0 - $pad && $z < $z1 + $pad
        && $y > $y0 - 0.6 && $y < $y1 + 1.2;
    foreach ($room['chests'] as $cid => $c) {
        if (!empty($c['lobby']) || (($c['k'] ?? 0) === 3 && empty($c['land'])) || !$in($c['x'], $c['y'], $c['z'])) {
            continue;
        }
        $gy = floorAt($room, $c['x'], $c['y'] + 0.2, $c['z']);
        if ($gy < $c['y'] - 0.35) {
            if (!$c['open']) {
                $room['chests'][$cid]['open'] = true;
                $room['events'][] = ['k' => 'chest', 'c' => $cid, 'a' => -1];
                chestLoot($room, $cid);      // le coffre s'ouvre en tombant, son butin tombe en bas
            }
            $room['chests'][$cid]['y'] = $gy;
            $room['events'][] = ['k' => 'chestY', 'c' => $cid, 'y' => round($gy, 2)];
        }
    }
    foreach ($room['drops'] as $id => $d) {
        if (!$in($d['p'][0], $d['p'][1], $d['p'][2])) {
            continue;
        }
        $gy = floorAt($room, $d['p'][0], $d['p'][1] + 0.2, $d['p'][2]);
        if ($gy < $d['p'][1] - 0.05) {
            $room['drops'][$id]['p'][1] = round($gy, 2);
            $room['events'][] = ['k' => 'dropPos', 'id' => $id, 'p' => $room['drops'][$id]['p']];
        }
    }
    foreach (nodesInRadius($room, ($x0 + $x1) / 2, ($z0 + $z1) / 2, CELL) as $n) {
        if ($n['k'] !== 'prop' || !$in($n['x'], $n['y'], $n['z'])) {
            continue;
        }
        if (floorAt($room, $n['x'], $n['y'] + 0.2, $n['z']) < $n['y'] - 0.35) {
            removeNode($room, $n['id']);
            $room['events'][] = ['k' => 'gone', 'n' => $n['id']];
        }
    }
}
