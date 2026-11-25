<?php
// Test de parité : rejoue des entrées avec engine.php et affiche les positions (comparées par parity.mjs).
declare(strict_types=1);
define('GAME_NO_BOOT', true);
require dirname(__DIR__) . '/server/engine.php';
MapData::load(dirname(__DIR__) . '/public/map/island.json');
$sc = json_decode(file_get_contents($argv[1]), true);
$room = ['buildings' => [], 'cells' => [], 'cols' => [], 'nodes' => [], 'ncells' => [], 'pads' => [], 'zips' => []];
foreach (MapData::$raw['cols'] as $ck => $v) { $room['cols'][$ck] = (float) $v; }
foreach ($sc['pieces'] as $pc) { $pc['base'] = (float) $pc['base']; if (isset($pc['e'])) { $pc['e'] = (int) $pc['e']; $pc['o'] = (int) ($pc['o'] ?? 0); } addPiece($room, $pc); }
foreach (MapData::$raw['nodes'] as $i => $n) { addNode($room, $i, $n[0], (float) $n[1], (float) $n[2], (float) $n[3], (int) $n[4], isset($n[5]) ? (float) $n[5] : null); }
foreach (MapData::$raw['pads'] as $i => [$x, $y, $z]) { $room['pads'][$i] = ['id' => $i, 'x' => (float) $x, 'y' => (float) $y, 'z' => (float) $z]; }
foreach (MapData::$raw['zips'] as $i => [$a, $b]) { $a = array_map('floatval', $a); $b = array_map('floatval', $b); $room['zips'][$i] = ['id' => $i, 'a' => $a, 'b' => $b, 'len' => sqrt(($b[0] - $a[0]) ** 2 + ($b[1] - $a[1]) ** 2 + ($b[2] - $a[2]) ** 2)]; }
foreach ($sc['craters'] ?? [] as [$x, $z, $y]) { applyCrater(MapData::$h, (float) $x, (float) $z, (float) $y); }
$out = [];
foreach ($sc['runs'] as $run) {
    $p = ['pos' => array_map('floatval', $run['pos']), 'vel' => [0.0, 0.0, 0.0], 'yaw' => 0.0, 'ground' => false, 'glide' => false,
          'slide' => 0.0, 'slideDir' => [0.0, 0.0], 'state' => $run['state'], 'jumpQ' => false, 'swim' => false,
          'zip' => isset($run['zip']) ? ['id' => (int) $run['zip']['id'], 't' => (float) $run['zip']['t'], 'dir' => (int) $run['zip']['dir']] : null,
          'veh' => $run['veh'] ?? null, 'cyaw' => (float) ($run['cyaw'] ?? 0), 'cspd' => 0.0];
    $trace = [];
    foreach ($run['inputs'] as $in) {
        $p['yaw'] = (float) $in['yaw'];
        if ($in['jump']) { $p['jumpQ'] = true; }
        $in = ['fwd' => (float) $in['fwd'], 'side' => (float) $in['side'], 'sprint' => $in['sprint'], 'tac' => $in['tac'] ?? false, 'crouch' => $in['crouch'], 'glide' => $in['glide'], 'ads' => $in['ads']];
        stepBody($room, $p, $in, DT);
        $trace[] = [$p['pos'][0], $p['pos'][1], $p['pos'][2], $p['state'], $p['glide'], $p['swim'], $p['zip'] !== null, $p['cyaw']];
    }
    $out[] = $trace;
}
echo json_encode($out, JSON_PRESERVE_ZERO_FRACTION);
