<?php
// =====================================================================
// bots.php : joueurs contrôlés par le serveur pour compléter les parties.
// Ils sautent de la montgolfière, fouillent les coffres, ramassent armes et
// soins, récoltent du bois, fuient la tempête, se battent et se protègent
// derrière un mur quand ils prennent des dégâts.
// =====================================================================
declare(strict_types=1);

const BOT_NAMES = ['Lucas', 'Emma', 'Hugo', 'Léa', 'Nathan', 'Chloé', 'Louis', 'Manon', 'Jules', 'Inès', 'Gabin', 'Jade',
    'Raphaël', 'Lina', 'Arthur', 'Zoé', 'Tom', 'Camille', 'Noah', 'Sarah', 'Enzo', 'Lou', 'Sacha', 'Alice'];
const BOT_SIGHT = 72.0;

/** Connexion factice : les bots ne reçoivent rien. */
final class BotConnection implements ConnectionInterface
{
    public function send($data)
    {
    }

    public function close()
    {
    }
}

/** Ajoute des bots pour atteindre $target participants. */
function fillWithBots(array &$room, int $target): void
{
    $have = count($room['players']);
    $names = BOT_NAMES;
    shuffle($names);
    $skins = array_keys(SKINS);
    for ($i = 0; $have + $i < $target; $i++) {
        $lvl = botLevelFor($room);
        $L = botLevelParams($lvl);
        $pid = $room['nextId']++;
        $profile = ['id' => null, 'token' => null, 'name' => $names[$i % count($names)], 'skin' => $skins[mt_rand(0, count($skins) - 1)]];
        $p = newPlayer($pid, new BotConnection(), $profile, $room);
        $p['bot'] = [
            'skill' => $L['skill'][0] + rndf() * ($L['skill'][1] - $L['skill'][0]),
            'sight' => $L['sight'],
            'react' => $L['react'],
            'rate'  => $L['rate'],
            'wallK' => $L['wall'],
            'miss'  => $L['miss'],
            'lvl'   => $lvl,
            // certains bots préfèrent récolter des matériaux plutôt que d'attaquer tout de suite
            'style' => rndf() < 0.4 ? 'farmer' : 'fighter',
            'jumpU' => 0.08 + rndf() * 0.7,
            'land'  => null,
            'goal'  => null,
            'mode'  => 'loot',
            'next'  => 0.0,
            'enemy' => null,
            'seenAt' => -10.0,
            'firstSeen' => -10.0,
            'hpPrev' => HP_MAX,
            'hurtAt' => -10.0,
            'lastPos' => [0.0, 0.0, 0.0],
            'stuckAt' => 0.0,
            'stuck' => 0,
            'detour' => 0.0,
            'detourA' => 0.0,
            'wallAt' => -10.0,
            'strafe' => rndf() < 0.5 ? 1.0 : -1.0,
            'phase' => rndf() * 6.0,
            'farmUntil' => 0.0,
        ];
        $room['players'][$pid] = $p;
    }
}

function isBot(array $p): bool
{
    return !empty($p['bot']);
}

function botYawTo(array $from, array $to): float
{
    return atan2(-($to[0] - $from[0]), -($to[2] - $from[2]));
}

function tickBots(array &$room): void
{
    if ($room['mode'] !== 'br' || $room['state'] === 'lobby') {
        return;
    }
    foreach (array_keys($room['players']) as $pid) {
        if (isset($room['players'][$pid]) && isBot($room['players'][$pid])) {
            botThink($room, $pid);
        }
    }
}

function botThink(array &$room, int $pid): void
{
    $p = &$room['players'][$pid];
    $b = &$p['bot'];
    $t = $room['time'];
    $in = ['seq' => 0, 'fwd' => 0.0, 'side' => 0.0, 'sprint' => false, 'crouch' => false, 'glide' => false, 'ads' => false];

    if ($p['state'] === 'bus') {
        if ($b['land'] === null) {
            $b['land'] = botLandingSpot($room);
        }
        $bal = $room['bal'];
        if ($bal !== null && $bal['u'] >= $b['jumpU']) {
            unset($b, $p);
            dropPlayer($room, $pid);
            return;
        }
        $p['in'] = $in;
        return;
    }
    if ($p['state'] === 'falling') {
        $land = $b['land'] ?? [$p['pos'][0], $p['pos'][2]];
        $dx = $land[0] - $p['pos'][0];
        $dz = $land[1] - $p['pos'][2];
        $p['yaw'] = atan2(-$dx, -$dz);
        $in['fwd'] = sqrt($dx * $dx + $dz * $dz) > 6 ? 1.0 : 0.0;
        $p['in'] = $in;
        return;
    }
    if ($p['state'] !== 'alive') {
        $p['in'] = $in;
        return;
    }
    if ($p['veh'] !== null) {
        exitVehicle($room, $pid);
    }

    botOpenDoors($room, $pid);
    $p = &$room['players'][$pid];
    $b = &$p['bot'];

    // --- perception (4 fois par seconde)
    $hpNow = $p['hp'] + $p['sh'];
    if ($hpNow < $b['hpPrev'] - 0.5) {
        $b['hurtAt'] = $t;
    }
    $b['hpPrev'] = $hpNow;
    if ($t >= $b['next']) {
        $b['next'] = $t + 0.25 + rndf() * 0.1;
        botPerceive($room, $pid);
    }
    $enemy = $b['enemy'] !== null ? ($room['players'][$b['enemy']] ?? null) : null;
    if ($enemy !== null && ($enemy['state'] !== 'alive' || $t - $b['seenAt'] > 3.0)) {
        $b['enemy'] = null;
        $enemy = null;
    }

    $goal = $b['goal'];
    $sprint = true;
    $face = null;
    $weapon = botBestWeapon($p, $enemy !== null ? botDist($p['pos'], $enemy['pos']) : 40.0);

    if ($enemy !== null && $weapon !== null) {
        // --- combat
        $d = botDist($p['pos'], $enemy['pos']);
        if ($p['sel'] !== $weapon) {
            selectSlot($room, $pid, $weapon);
        }
        $type = $p['slots'][$weapon]['type'];
        $ideal = ['pump' => 6.0, 'smg' => 14.0, 'pistol' => 18.0, 'ar' => 28.0, 'sniper' => 60.0, 'rocket' => 30.0][$type] ?? 20.0;
        // imprécision : distance, premières secondes, cible qui se déplace de côté, bot qui bouge ou qui vient d'être touché
        $tvx = $enemy['vel'][0];
        $tvz = $enemy['vel'][2];
        $lat = abs($tvx * cos($p['yaw']) - $tvz * sin($p['yaw']));
        $err = (0.034 + $d * 0.0008 + ($t - $b['firstSeen'] < 1.0 ? 0.07 : 0.0) + $lat * 0.005
            + (abs($p['vel'][0]) + abs($p['vel'][2]) > 2.0 ? 0.015 : 0.0)) / $b['skill'];
        if ($t - $b['hurtAt'] < 0.6) {
            $err *= 1.6;
        }
        $aimY = $type === 'rocket' ? 0.2 : 1.25;
        $target = [$enemy['pos'][0] + $enemy['vel'][0] * 0.12, $enemy['pos'][1] + $aimY, $enemy['pos'][2] + $enemy['vel'][2] * 0.12];
        $yaw = botYawTo($p['pos'], $target);
        $o = aimOrigin($room, $p, $yaw);
        $h = sqrt(($target[0] - $o[0]) ** 2 + ($target[2] - $o[2]) ** 2);
        $pitch = atan2($target[1] - $o[1], max(0.1, $h));
        $p['yaw'] = $yaw;
        $p['pitch'] = $pitch;
        $face = $yaw;
        $w = WEAPONS[$type];
        $ready = $t - $b['firstSeen'] > 0.45 / $b['skill'] * ($b['react'] ?? 1.0) && $t - $p['lastShot'] >= $w['rate'] * (1.1 + rndf() * 0.8) * ($b['rate'] ?? 1.0);
        if ($ready && $b['seenAt'] >= $t - 0.3 && $p['reload'] === null) {
            // de temps en temps un tir franchement raté (personne n'est parfait)
            $e = rndf() < ($b['miss'] ?? 0.2) ? $err * 2.5 + 0.05 : $err;
            fire($room, $pid, ['yaw' => $yaw + rnds() * $e, 'pitch' => $pitch + rnds() * $e * 0.7]);
            // petites pauses entre les rafales
            if (rndf() < 0.12 * (1.6 - min(1.5, $b['skill']))) {
                $p['lastShot'] = $t + 0.4 + rndf() * 0.6;
            }
        }
        // grenade de temps en temps (plus souvent en difficile), lancée en cloche
        if ($d > 9.0 && $d < 26.0 && $p['reload'] === null && rndf() < 0.005 * ($b['wallK'] ?? 1.0)) {
            foreach ($p['slots'] as $si => $it) {
                if (($it['type'] ?? '') === 'grenade') {
                    $prevSel = $p['sel'];
                    $p['sel'] = $si;
                    $p['pitch'] = $pitch + 0.18 + $d * 0.008;
                    throwGrenade($room, $pid);
                    $p['sel'] = $prevSel;
                    break;
                }
            }
        }
        $in['ads'] = $d > 25 && $type !== 'pump';
        $in['side'] = $b['strafe'] * (sin($t * 1.7 + $b['phase']) > -0.2 ? 1.0 : -1.0);
        if (rndf() < 0.01) {
            $b['strafe'] = -$b['strafe'];
        }
        $in['fwd'] = $d > $ideal + 8 ? 1.0 : ($d < $ideal - 4 ? -1.0 : 0.0);
        $sprint = false;
        $goal = null;
        // sous le feu : on esquive (pas de mur, il n'y a plus de construction)
        if ($t - $b['hurtAt'] < 0.5 && $t - $b['wallAt'] > 1.6 && rndf() < 0.45) {
            $b['wallAt'] = $t;
            $b['strafe'] = -$b['strafe'];
            if ($p['ground'] && rndf() < 0.5) {
                $p['jumpQ'] = true;
            }
        }
        if (rndf() < 0.012 && $p['ground']) {
            $p['jumpQ'] = true;
        }
    } else {
        // --- soins au calme
        if ($t - $b['seenAt'] > 2.5 && $p['use'] === null && botHeal($room, $pid)) {
            $p['in'] = $in;
            return;
        }
        botChooseGoal($room, $pid);
        $goal = $p['bot']['goal'];
    }

    // --- déplacement vers l'objectif
    if ($goal !== null) {
        $dx = $goal[0] - $p['pos'][0];
        $dz = $goal[1] - $p['pos'][2];
        $dist = sqrt($dx * $dx + $dz * $dz);
        if ($dist > 1.2) {
            $yaw = atan2(-$dx, -$dz);
            if ($t < $b['detour']) {
                $yaw += $b['detourA'];
            }
            if ($face === null) {
                $p['yaw'] = $yaw;
                $p['pitch'] = 0.0;
                $in['fwd'] = 1.0;
            } else {
                $rel = $yaw - $face;
                $in['fwd'] = cos($rel);
                $in['side'] = -sin($rel);
            }
        }
    }
    $in['sprint'] = $sprint && $in['fwd'] > 0;

    // --- coincé ? on saute puis on contourne
    if ($t - $b['stuckAt'] >= 1.0) {
        $moved = sqrt(($p['pos'][0] - $b['lastPos'][0]) ** 2 + ($p['pos'][2] - $b['lastPos'][2]) ** 2);
        $wants = abs($in['fwd']) + abs($in['side']) > 0.3;
        if ($wants && $moved < 1.2) {
            $b['stuck']++;
            $p['jumpQ'] = true;
            if ($b['stuck'] >= 2) {
                $b['detour'] = $t + 1.6;
                $b['detourA'] = (rndf() < 0.5 ? 1 : -1) * (M_PI / 2 + rndf() * 0.6);
            }
            if ($b['stuck'] >= 5) {
                $b['goal'] = null;
                $b['skip'][] = $b['target'] ?? null;
                $b['stuck'] = 0;
            }
        } else {
            $b['stuck'] = 0;
        }
        $b['lastPos'] = $p['pos'];
        $b['stuckAt'] = $t;
    }
    $p['in'] = $in;
}

function botDist(array $a, array $b): float
{
    return sqrt(($a[0] - $b[0]) ** 2 + ($a[2] - $b[2]) ** 2);
}

/** Lieu d'atterrissage : un coffre au hasard près du trajet (ou un lieu nommé). */
function botLandingSpot(array $room): array
{
    $ids = array_keys($room['chests']);
    for ($k = 0; $k < 12; $k++) {
        $c = $room['chests'][$ids[mt_rand(0, count($ids) - 1)]];
        if (($c['k'] ?? 0) === 0 && sqrt($c['x'] ** 2 + $c['z'] ** 2) < 420) {
            return [$c['x'] + rnds() * 6, $c['z'] + rnds() * 6];
        }
    }
    $sp = randomLand(300.0, $room);
    return [$sp[0], $sp[1]];
}

function botPerceive(array &$room, int $pid): void
{
    $p = &$room['players'][$pid];
    $b = &$p['bot'];
    $eye = [$p['pos'][0], $p['pos'][1] + EYE_H, $p['pos'][2]];
    $cands = [];
    foreach ($room['players'] as $oid => $o) {
        if ($oid === $pid || $o['state'] !== 'alive') {
            continue;
        }
        $d = botDist($p['pos'], $o['pos']);
        if ($d < ($p['bot']['sight'] ?? BOT_SIGHT)) {
            $cands[] = [$d, $oid];
        }
    }
    usort($cands, static fn ($a, $c) => $a[0] <=> $c[0]);
    foreach (array_slice($cands, 0, 3) as [$d, $oid]) {
        $o = $room['players'][$oid];
        $tgt = [$o['pos'][0], $o['pos'][1] + 1.2, $o['pos'][2]];
        $len = sqrt(($tgt[0] - $eye[0]) ** 2 + ($tgt[1] - $eye[1]) ** 2 + ($tgt[2] - $eye[2]) ** 2);
        if ($len < 0.5) {
            continue;
        }
        $dir = [($tgt[0] - $eye[0]) / $len, ($tgt[1] - $eye[1]) / $len, ($tgt[2] - $eye[2]) / $len];
        $hit = raycastWorld($room, $eye, $dir, $len + 0.5, $pid);
        $visible = $hit === null || ($hit['kind'] === 'player' && $hit['id'] === $oid) || $hit['t'] > $len - 0.3;
        // on remarque ceux qui nous tirent dessus même sans les voir
        $hurt = $room['time'] - $b['hurtAt'] < 0.5 && $d < 30;
        if ($b['style'] === 'farmer' && !$hurt && $d > 16 && $room['time'] - $b['hurtAt'] > 6.0
            && $room['time'] < $b['farmUntil']) {
            continue;   // le pilleur ignore les ennemis lointains tant qu'il fouille
        }
        if ($visible || $hurt) {
            if ($b['enemy'] !== $oid) {
                $b['firstSeen'] = $room['time'];
            }
            $b['enemy'] = $oid;
            $b['seenAt'] = $room['time'];
            return;
        }
    }
}

/** Meilleure arme (emplacement) pour une distance, avec des munitions. */
function botBestWeapon(array $p, float $d): ?int
{
    $pref = $d < 9 ? ['pump', 'smg', 'pistol', 'ar', 'rocket', 'sniper']
        : ($d < 35 ? ['ar', 'smg', 'pump', 'pistol', 'rocket', 'sniper']
        : ['sniper', 'ar', 'rocket', 'pistol', 'smg', 'pump']);
    foreach ($pref as $type) {
        foreach ($p['slots'] as $i => $it) {
            if (isWeapon($it) && $it['type'] === $type && ($it['mag'] > 0 || $p['ammo'][WEAPONS[$type]['ammo']] > 0)) {
                return $i;
            }
        }
    }
    return null;
}

function botHeal(array &$room, int $pid): bool
{
    $p = &$room['players'][$pid];
    // une plaque d'abord si le gilet est entamé (comme un joueur)
    if ((int) ($p['plates'] ?? 0) > 0 && $p['sh'] < SHIELD_MAX - 10.0 && $p['use'] === null) {
        unset($p);
        startPlate($room, $pid);
        return $room['players'][$pid]['use'] !== null;
    }
    foreach ($p['slots'] as $i => $it) {
        if (!isConsumable($it) || isset(CONSUMABLES[$it['type']]['pad'])) {
            continue;
        }
        $c = CONSUMABLES[$it['type']];
        if (isset($c['nade']) || isset($c['pad'])) {
            continue;
        }
        // l'emplacement tactique se déclenche sans changer d'arme (comme pour un joueur)
        if (isset($c['hp']) && $p['hp'] < min(85.0, (float) $c['cap'] - 5.0)) {
            startUse($room, $pid, $i);
            return $p['use'] !== null;
        }
    }
    return false;
}

/** Objectif hors combat : tempête, coffres, objets au sol, bois, balade. */
function botChooseGoal(array &$room, int $pid): string
{
    $p = &$room['players'][$pid];
    $b = &$p['bot'];
    $pos = $p['pos'];
    $s = $room['storm'];
    // tempête : on rejoint la prochaine zone sûre
    if ($room['state'] === 'playing' && $s['phase'] >= 0) {
        $dn = sqrt(($pos[0] - $s['nx']) ** 2 + ($pos[2] - $s['nz']) ** 2);
        $dc = sqrt(($pos[0] - $s['x']) ** 2 + ($pos[2] - $s['z']) ** 2);
        if ($dc > $s['r'] - 4 || ($dn > $s['nr'] * 0.85 && $s['shrinking']) || $dn > $s['nr'] + 60) {
            $b['mode'] = 'storm';
            $b['goal'] = [$s['nx'] + rnds() * $s['nr'] * 0.3, $s['nz'] + rnds() * $s['nr'] * 0.3];
            return 'storm';
        }
    }
    $weapons = 0;
    $heals = 0;
    foreach ($p['slots'] as $it) {
        if (isWeapon($it)) {
            $weapons++;
        } elseif (isConsumable($it)) {
            $heals++;
        }
    }
    $skip = $b['skip'] ?? [];
    // objets au sol utiles tout près
    $best = null;
    foreach ($room['drops'] as $did => $d) {
        $dist = botDist($pos, $d['p']);
        if ($dist > 28 || in_array('d' . $did, $skip, true) || abs($d['p'][1] - $pos[1]) > 6) {
            continue;
        }
        $it = $d['it'];
        $useful = $it['type'] === 'ammo' || $it['type'] === 'cash' || $it['type'] === 'plate'
            || (isWeapon($it) && $weapons < 2)
            || (isConsumable($it) && $heals < 2);
        if ($useful && ($best === null || $dist < $best[0])) {
            $best = [$dist, $did];
        }
    }
    if ($best !== null) {
        $d = $room['drops'][$best[1]];
        $b['target'] = 'd' . $best[1];
        if ($best[0] < 2.2) {
            pickUp($room, $pid, $best[1]);
            $b['skip'][] = 'd' . $best[1];
        }
        $b['mode'] = 'loot';
        $b['goal'] = [$d['p'][0], $d['p'][2]];
        return 'loot';
    }
    // coffres
    if ($weapons < 3 || $heals < 2 || array_sum($p['ammo']) < 60) {
        $best = null;
        foreach ($room['chests'] as $cid => $c) {
            if ($c['open'] || in_array('c' . $cid, $skip, true) || abs($c['y'] - $pos[1]) > 7) {
                continue;
            }
            $dist = botDist($pos, [$c['x'], 0, $c['z']]);
            if (($c['k'] ?? 0) === 1 && $weapons === 0) {
                continue;
            }
            if ($dist < 80 && ($best === null || $dist < $best[0])) {
                $best = [$dist, $cid];
            }
        }
        if ($best !== null) {
            $c = $room['chests'][$best[1]];
            $b['target'] = 'c' . $best[1];
            if ($best[0] < 2.6) {
                openChest($room, $pid, $best[1]);
            }
            $b['mode'] = 'loot';
            $b['goal'] = [$c['x'], $c['z']];
            return 'loot';
        }
    }
    // balade vers la zone sûre
    if ($b['goal'] === null || $b['mode'] !== 'wander' || botDist($pos, [$b['goal'][0], 0, $b['goal'][1]]) < 4) {
        $cx = $s['phase'] >= 0 ? $s['nx'] : $pos[0];
        $cz = $s['phase'] >= 0 ? $s['nz'] : $pos[2];
        $r = $s['phase'] >= 0 ? max(10.0, $s['nr'] * 0.7) : 120.0;
        for ($k = 0; $k < 8; $k++) {
            $a = rndf() * 2 * M_PI;
            $d = sqrt(rndf()) * $r;
            $x = $cx + cos($a) * $d;
            $z = $cz + sin($a) * $d;
            if (terrainHeight($x, $z) > WATER_Y + 1 && sqrt($x * $x + $z * $z) < 430) {
                $b['goal'] = [$x, $z];
                break;
            }
        }
        $b['mode'] = 'wander';
        $b['target'] = null;
    }
    return 'wander';
}

function botOpenDoors(array &$room, int $pid): void
{
    $p = $room['players'][$pid];
    foreach (nearbyPieces($room, $p['pos'][0], $p['pos'][2]) as $pc) {
        if (!isDoor($pc) || !empty($pc['o'])) {
            continue;
        }
        [$cx, $cz] = doorCenter($pc);
        if (sqrt(($cx - $p['pos'][0]) ** 2 + ($cz - $p['pos'][2]) ** 2) < 2.0 && abs($pc['base'] - $p['pos'][1]) < 1.5) {
            toggleDoor($room, $pid, $pc['key'], true);
        }
    }
}
