<?php
declare(strict_types=1);

/**
 * server/engine.php — relief, pièces, collisions, physique, lancer de rayons.
 *
 * MIROIR EXACT de public/js/shared.js pour tout ce qui touche au déplacement
 * (le client prédit ses mouvements avec le même code). Vérifié par tools/parity.mjs.
 */

const TICK_RATE      = 60;
const DT             = 1.0 / TICK_RATE;
const MAP_RADIUS     = 500.0;
const PLAY_RADIUS    = 480.0;
const WATER_Y        = -1.5;
const CELL           = 4.0;
const FLOOR_THICK    = 0.4;
const WALL_THICK     = 0.4;
const ROOF_H         = 2.0;
const VEH_BODY_H     = 0.95;   // hauteur de carrosserie touchée par les balles (au-dessus : les vitres)
const GRAVITY        = 28.0;
const WALK_SPEED     = 6.2;
const SPRINT_SPEED   = 9.0;
const CROUCH_SPEED   = 3.0;
const ADS_FACTOR     = 0.62;
const SWIM_SPEED     = 4.0;
const SLIDE_SPEED    = 13.0;
const SLIDE_TIME     = 0.9;
const JUMP_VELOCITY  = 9.5;
const SKY_FALL       = 30.0;
const SKY_DIVE       = 44.0;
const SKY_SPEED      = 16.0;
const SKY_DIVE_SPEED = 22.0;
const GLIDER_FALL    = 4.5;
const GLIDER_SPEED   = 17.0;
const AUTO_GLIDER    = 50.0;
const SWIM_Y         = WATER_Y - 1.25;
const PLAYER_R       = 0.35;
const PLAYER_H       = 1.8;
const STEP_UP        = 0.6;
const INTERACT_REACH = 3.2;
const EYE_H          = 1.62;
const SHOULDER       = 0.75;
const ACCEL_GROUND   = 42.0;
const DECEL_GROUND   = 52.0;
const ACCEL_AIR      = 16.0;
const ACCEL_SKY      = 3.2;
const COYOTE_TIME    = 0.12;
const JUMP_BUFFER    = 0.15;
const SLIDE_TURN     = 3.4;
const SLIDE_MIN      = 0.3;
const SNAP_DOWN      = 0.75;
const PAD_R          = 1.3;
const PAD_VY         = 36.0;
const ZIP_SPEED      = 18.0;
const ZIP_HANG       = 2.15;
const CAR_SPEED      = 24.0;
const CAR_REVERSE    = 9.0;
const CAR_ACCEL      = 11.0;
const CAR_BRAKE      = 26.0;
const CAR_DRAG       = 4.0;
const CAR_TURN       = 1.8;
const CAR_R          = 1.0;
const CAR_AXLE       = 1.25;
const CAR_H          = 1.6;

/** Meubles et objets du décor qui bloquent : [clé, rayon, hauteur] (index = var du nœud). */
const PROPS = [
    ['couch', 0.7, 0.9], ['armchair', 0.6, 0.9], ['bed2', 1.0, 0.75], ['bed1', 0.7, 0.75],
    ['cabinet', 0.6, 1.4], ['chair', 0.3, 0.95], ['lamp', 0.25, 1.9], ['table', 0.8, 0.75],
    ['tablelow', 0.6, 0.4], ['cactus', 0.3, 0.6], ['fridge', 0.7, 1.9], ['counter', 0.7, 1.0],
    ['sink', 0.7, 1.0], ['rtable', 0.9, 0.8], ['kchair', 0.3, 0.9], ['crates', 0.65, 0.7],
    ['dumpster', 1.0, 1.5], ['streetlight', 0.15, 4.4], ['hydrant', 0.25, 1.0], ['watertower', 2.6, 10.5],
    ['boxes', 0.45, 0.8], ['bench', 0.5, 0.5], ['shelf', 0.6, 1.4],
];

const MATERIALS = ['wood' => 150, 'stone' => 300, 'metal' => 500];
const NODE_SHAPES = [
    'tree' => ['r' => 0.55, 'h' => 9.0],
    'rock' => ['r' => 1.25, 'h' => 1.7],
    'car'  => ['r' => 1.7, 'h' => 1.6],
    'veh'  => ['r' => 1.05, 'h' => 1.7],
];

/** @return array{r: float, h: float} */
function nodeShape(string $k, float $s, int $v): array
{
    if ($k === 'prop') {
        $pr = PROPS[$v] ?? PROPS[0];
        return ['r' => $pr[1], 'h' => $pr[2]];
    }
    $sh = NODE_SHAPES[$k] ?? NODE_SHAPES['rock'];
    $sc = $k === 'rock' ? $s : 1.0;
    return ['r' => $sh['r'] * $sc, 'h' => $sh['h'] * $sc];
}

// =========================================================== CARTE

final class MapData
{
    public static int $n = 0;
    public static float $step = 4.0;
    public static float $half = 500.0;
    /** @var array<int, float> */
    public static array $h = [];
    /** @var array<string, mixed> */
    public static array $raw = [];
    /** @var array<int, float> relief d'origine (chaque partie a sa copie, creusée par les grenades) */
    public static array $base = [];

    public static function load(string $file): void
    {
        $json = json_decode((string) file_get_contents($file), true);
        if (!is_array($json)) {
            throw new RuntimeException("carte illisible : $file");
        }
        $bin = base64_decode((string) $json['h'], true);
        $vals = array_values(unpack('v*', (string) $bin));
        $h = [];
        foreach ($vals as $v) {
            $h[] = ($v >= 32768 ? $v - 65536 : $v) / 10.0;
        }
        self::$n = (int) $json['n'];
        self::$step = (float) $json['step'];
        self::$half = $json['size'] / 2.0;
        self::$h = $h;
        self::$base = $h;
        unset($json['h'], $json['splat']);
        self::$raw = $json;
    }
}

const CRATER_R = 9.0;
const CRATER_D = 4.0;

/**
 * Cratère : les points du relief dans le rayon descendent sous l'explosion (bol arrondi).
 * Le bol suit la hauteur de l'explosion : sur une pente il entaille le côté haut.
 * Calcul identique à applyCrater() de shared.js (mêmes opérations, même ordre).
 */
function applyCrater(array &$h, float $x, float $z, float $y): void
{
    $n = MapData::$n;
    $step = MapData::$step;
    $half = MapData::$half;
    $R = CRATER_R;
    $i0 = max(0, (int) floor(($x - $R + $half) / $step));
    $i1 = min($n - 1, (int) ceil(($x + $R + $half) / $step));
    $j0 = max(0, (int) floor(($z - $R + $half) / $step));
    $j1 = min($n - 1, (int) ceil(($z + $R + $half) / $step));
    for ($j = $j0; $j <= $j1; $j++) {
        for ($i = $i0; $i <= $i1; $i++) {
            $dx = $i * $step - $half - $x;
            $dz = $j * $step - $half - $z;
            $d2 = $dx * $dx + $dz * $dz;
            if ($d2 >= $R * $R) {
                continue;
            }
            $k = 1.0 - $d2 / ($R * $R);
            $target = max(-6.0, $y - CRATER_D * $k);
            $idx = $j * $n + $i;
            if ($h[$idx] > $target) {
                $h[$idx] = $target;
            }
        }
    }
}

function terrainHeight(float $x, float $z): float
{
    $n = MapData::$n;
    if ($n === 0) {
        return 0.0;
    }
    $fx = ($x + MapData::$half) / MapData::$step;
    $fz = ($z + MapData::$half) / MapData::$step;
    if ($fx < 0 || $fz < 0 || $fx > $n - 1 || $fz > $n - 1) {
        return -12.0;
    }
    $i = (int) floor($fx);
    $j = (int) floor($fz);
    if ($i > $n - 2) {
        $i = $n - 2;
    }
    if ($j > $n - 2) {
        $j = $n - 2;
    }
    $u = $fx - $i;
    $v = $fz - $j;
    $h = MapData::$h;
    $a = $h[$j * $n + $i];
    $b = $h[$j * $n + $i + 1];
    $c = $h[($j + 1) * $n + $i];
    $d = $h[($j + 1) * $n + $i + 1];
    return ($a + ($b - $a) * $u) + (($c + ($d - $c) * $u) - ($a + ($b - $a) * $u)) * $v;
}

function groundOrWater(float $x, float $z): float
{
    $t = terrainHeight($x, $z);
    return $t < SWIM_Y ? SWIM_Y : $t;
}

function snapColumn(float $x, float $z): float
{
    return max(round(terrainHeight($x, $z) * 2) / 2, -1.0);
}

/** Fondation d'une case : la sienne, sinon celle d'une voisine construite, sinon le relief. */
function columnOf(array $room, int $gx, int $gz): float
{
    $own = $room['cols'][$gx . ':' . $gz] ?? null;
    if ($own !== null) {
        return (float) $own;
    }
    foreach ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [$dx, $dz]) {
        $v = $room['cols'][($gx + $dx) . ':' . ($gz + $dz)] ?? null;
        if ($v !== null) {
            return (float) $v;
        }
    }
    return snapColumn(($gx + 0.5) * CELL, ($gz + 0.5) * CELL);
}

function rndf(): float
{
    return mt_rand() / mt_getrandmax();
}

function rnds(): float
{
    return rndf() * 2.0 - 1.0;
}

/** Point aléatoire sur la terre ferme (hors bâtiments). */
function randomLand(float $radius, array $room = []): array
{
    for ($i = 0; $i < 200; $i++) {
        $a = rndf() * 2.0 * M_PI;
        $r = sqrt(rndf()) * $radius;
        $x = cos($a) * $r;
        $z = sin($a) * $r;
        $gx = (int) floor($x / CELL);
        $gz = (int) floor($z / CELL);
        if (terrainHeight($x, $z) > 1.5 && empty($room['cells'][cellKey($gx, $gz)])) {
            return [round($x, 2), round($z, 2)];
        }
    }
    return [0.0, 0.0];
}

// =========================================================== PIÈCES

function cellKey(int $gx, int $gz): string
{
    return $gx . ':' . $gz;
}

function pieceKey(string $type, int $gx, int $gy, int $gz, int $rot): string
{
    return "$type:$gx:$gy:$gz:$rot";
}

/** @return array<int, array<string, mixed>> */
function piecesInCell(array $room, int $gx, int $gz): array
{
    $out = [];
    foreach ($room['cells'][cellKey($gx, $gz)] ?? [] as $key) {
        if (isset($room['buildings'][$key])) {
            $out[] = $room['buildings'][$key];
        }
    }
    return $out;
}

function hasPiece(array $room, int $gx, int $gy, int $gz, array $types): bool
{
    foreach (piecesInCell($room, $gx, $gz) as $pc) {
        if ($pc['gy'] === $gy && in_array($pc['type'], $types, true)) {
            return true;
        }
    }
    return false;
}

function hasKey(array $room, string $key): bool
{
    return isset($room['buildings'][$key]);
}

function addPiece(array &$room, array $pc): void
{
    $key = pieceKey($pc['type'], $pc['gx'], $pc['gy'], $pc['gz'], $pc['rot']);
    $pc['key'] = $key;
    if (isset($room['buildings'][$key])) {
        removePiece($room, $key);
    }
    $room['buildings'][$key] = $pc;
    $room['cells'][cellKey($pc['gx'], $pc['gz'])][] = $key;
}

function removePiece(array &$room, string $key): void
{
    $pc = $room['buildings'][$key] ?? null;
    if ($pc === null) {
        return;
    }
    unset($room['buildings'][$key]);
    $ck = cellKey($pc['gx'], $pc['gz']);
    $rest = array_values(array_filter($room['cells'][$ck] ?? [], static fn ($k) => $k !== $key));
    if ($rest) {
        $room['cells'][$ck] = $rest;
    } else {
        unset($room['cells'][$ck]);
    }
}

/** @return array<int, array<int, float>> boîtes [minX, minY, minZ, maxX, maxY, maxZ] */
// ------------------------------------------------------------ édition (cases à la Fortnite)
const WALL_X    = [0.0, 1.2, 2.8, 4.0];
const WALL_Y    = [0.0, 1.0, 2.6, 4.0];
const DOOR_MASK = 18;

function isDoor(array $pc): bool
{
    return $pc['type'] === 'wall' && (isset($pc['e']) ? $pc['e'] === DOOR_MASK : (int) ($pc['v'] ?? 0) === 1);
}

/** Segments [a0, a1, y0, y1] d'un mur (porte fermée comprise) — identique à wallSegs() de shared.js. */
function wallSegs(array $pc): array
{
    $C = CELL;
    if (!isset($pc['e'])) {
        $v = $pc['v'] ?? 0;
        if ($v === 1) {
            $segs = [[0.0, 1.2, 0.0, $C], [2.8, $C, 0.0, $C], [1.2, 2.8, 2.6, $C]];
            if (empty($pc['o'])) {
                $segs[] = [1.2, 2.8, 0.0, 2.6];   // porte fermée
            }
            return $segs;
        }
        if ($v === 2) {
            return [[0.0, $C, 0.0, 1.1], [0.0, $C, 2.9, $C], [0.0, 1.0, 1.1, 2.9], [3.0, $C, 1.1, 2.9]];
        }
        return [[0.0, $C, 0.0, $C]];
    }
    $e = (int) $pc['e'];
    $door = $e === DOOR_MASK && empty($pc['o']);
    $segs = [];
    for ($c = 0; $c < 3; $c++) {
        $solid = static fn (int $rr): bool => !(($e >> ($rr * 3 + $c)) & 1) || ($door && $c === 1 && $rr < 2);
        $r = 0;
        while ($r < 3) {
            if (!$solid($r)) {
                $r++;
                continue;
            }
            $r1 = $r;
            while ($r1 + 1 < 3 && $solid($r1 + 1)) {
                $r1++;
            }
            $segs[] = [WALL_X[$c], WALL_X[$c + 1], WALL_Y[$r], WALL_Y[$r1 + 1]];
            $r = $r1 + 1;
        }
    }
    return $segs;
}

function floorHole(array $pc, float $x, float $z): bool
{
    if (empty($pc['e'])) {
        return false;
    }
    $i = $x - $pc['gx'] * CELL < CELL / 2 ? 0 : 1;
    $j = $z - $pc['gz'] * CELL < CELL / 2 ? 0 : 1;
    return (($pc['e'] >> ($j * 2 + $i)) & 1) === 1;
}

function pieceBoxes(array $pc): array
{
    $C = CELL;
    $x0 = $pc['gx'] * $C;
    $z0 = $pc['gz'] * $C;
    $y0 = $pc['base'];
    switch ($pc['type']) {
        case 'floor':
            if (empty($pc['e'])) {
                return [[$x0, $y0, $z0, $x0 + $C, $y0 + FLOOR_THICK, $z0 + $C]];
            }
            $out = [];
            $H = $C / 2;
            for ($j = 0; $j < 2; $j++) {
                for ($i = 0; $i < 2; $i++) {
                    if (!(($pc['e'] >> ($j * 2 + $i)) & 1)) {
                        $out[] = [$x0 + $i * $H, $y0, $z0 + $j * $H, $x0 + ($i + 1) * $H, $y0 + FLOOR_THICK, $z0 + ($j + 1) * $H];
                    }
                }
            }
            return $out;
        case 'wall':
            $segs = wallSegs($pc);
            $h = WALL_THICK / 2;
            $out = [];
            foreach ($segs as [$a0, $a1, $b0, $b1]) {
                $out[] = $pc['rot'] === 0
                    ? [$x0 + $a0, $y0 + $b0, $z0 - $h, $x0 + $a1, $y0 + $b1, $z0 + $h]
                    : [$x0 - $h, $y0 + $b0, $z0 + $a0, $x0 + $h, $y0 + $b1, $z0 + $a1];
            }
            return $out;
        case 'stairs':
            return stepBoxes($pc, 4, $C);
        case 'roof':
            if (($pc['v'] ?? 0) === 1) {
                return stepBoxes($pc, 2, ROOF_H);
            }
            return [
                [$x0, $y0, $z0, $x0 + $C, $y0 + ROOF_H / 2, $z0 + $C],
                [$x0 + 1, $y0 + ROOF_H / 2, $z0 + 1, $x0 + 3, $y0 + ROOF_H, $z0 + 3],
            ];
    }
    return [[$x0, $y0, $z0, $x0 + $C, $y0 + $C, $z0 + $C]];
}

function stepBoxes(array $pc, int $k, float $height): array
{
    $C = CELL;
    $x0 = $pc['gx'] * $C;
    $z0 = $pc['gz'] * $C;
    $y0 = $pc['base'];
    $out = [];
    for ($s = 0; $s < $k; $s++) {
        $a0 = ($s * $C) / $k;
        $a1 = (($s + 1) * $C) / $k;
        $top = $y0 + ($height * ($s + 1)) / $k;
        switch ($pc['rot']) {
            case 0: $out[] = [$x0 + $a0, $y0, $z0, $x0 + $a1, $top, $z0 + $C]; break;
            case 1: $out[] = [$x0, $y0, $z0 + $a0, $x0 + $C, $top, $z0 + $a1]; break;
            case 2: $out[] = [$x0 + $C - $a1, $y0, $z0, $x0 + $C - $a0, $top, $z0 + $C]; break;
            default: $out[] = [$x0, $y0, $z0 + $C - $a1, $x0 + $C, $top, $z0 + $C - $a0];
        }
    }
    return $out;
}

function slopeLocal(array $pc, float $x, float $z): float
{
    $x0 = $pc['gx'] * CELL;
    $z0 = $pc['gz'] * CELL;
    switch ($pc['rot']) {
        case 0: return $x - $x0;
        case 1: return $z - $z0;
        case 2: return $x0 + CELL - $x;
    }
    return $z0 + CELL - $z;
}

function pieceTop(array $pc, float $x, float $z): ?float
{
    $y0 = $pc['base'];
    if ($pc['type'] === 'floor') {
        return floorHole($pc, $x, $z) ? null : $y0 + FLOOR_THICK;
    }
    if ($pc['type'] === 'stairs') {
        return $y0 + max(0.0, min(CELL, slopeLocal($pc, $x, $z)));
    }
    if ($pc['type'] === 'roof') {
        if (($pc['v'] ?? 0) === 1) {
            return $y0 + (ROOF_H * max(0.0, min(CELL, slopeLocal($pc, $x, $z)))) / CELL;
        }
        $u = abs($x - ($pc['gx'] * CELL + CELL / 2)) / CELL;
        $w = abs($z - ($pc['gz'] * CELL + CELL / 2)) / CELL;
        return $y0 + ROOF_H * max(0.0, 1 - 2 * max($u, $w));
    }
    return null;
}

function supportHeight(array $room, float $x, float $y, float $z): float
{
    $best = -INF;
    foreach (piecesInCell($room, (int) floor($x / CELL), (int) floor($z / CELL)) as $pc) {
        $top = pieceTop($pc, $x, $z);
        if ($top !== null && $top <= $y + STEP_UP && $top > $best) {
            $best = $top;
        }
    }
    return $best;
}

/** @return array<int, array<string, mixed>> */
function nearbyPieces(array $room, float $x, float $z): array
{
    $gx = (int) floor($x / CELL);
    $gz = (int) floor($z / CELL);
    $out = [];
    for ($dx = -1; $dx <= 1; $dx++) {
        for ($dz = -1; $dz <= 1; $dz++) {
            foreach (piecesInCell($room, $gx + $dx, $gz + $dz) as $pc) {
                $out[] = $pc;
            }
        }
    }
    return $out;
}

function pushOutOfWalls(array $room, array &$pos, float $R = PLAYER_R, float $H = PLAYER_H): void
{
    foreach (nearbyPieces($room, $pos[0], $pos[2]) as $pc) {
        if ($pc['type'] !== 'wall') {
            continue;
        }
        foreach (pieceBoxes($pc) as [$minX, $minY, $minZ, $maxX, $maxY, $maxZ]) {
            if ($pos[1] + $H <= $minY + 0.05 || $pos[1] >= $maxY - 0.05) {
                continue;
            }
            if ($pos[0] + $R <= $minX || $pos[0] - $R >= $maxX) {
                continue;
            }
            if ($pos[2] + $R <= $minZ || $pos[2] - $R >= $maxZ) {
                continue;
            }
            $options = [
                [0, $maxX + $R], [0, $minX - $R],
                [2, $maxZ + $R], [2, $minZ - $R],
            ];
            $best = null;
            foreach ($options as [$axis, $target]) {
                $d = abs($target - $pos[$axis]);
                if ($best === null || $d < $best[2]) {
                    $best = [$axis, $target, $d];
                }
            }
            $pos[$best[0]] = $best[1];
        }
    }
}

// =========================================================== ARBRES, ROCHERS, VOITURES

function addNode(array &$room, int $id, string $k, float $x, float $z, float $s, int $var, ?float $y = null): void
{
    $sh = nodeShape($k, $s, $var);
    $node = [
        'id' => $id, 'k' => $k, 'x' => $x, 'z' => $z, 'y' => $y ?? terrainHeight($x, $z),
        'r' => $sh['r'], 'h' => $sh['h'], 's' => $s, 'var' => $var,
        'hp' => ['tree' => 150, 'rock' => 240, 'car' => 300, 'prop' => 70, 'veh' => 1e9][$k] ?? 100,
    ];
    $node['max'] = $node['hp'];
    $room['nodes'][$id] = $node;
    $g0 = (int) floor(($x - $node['r']) / CELL);
    $g1 = (int) floor(($x + $node['r']) / CELL);
    $h0 = (int) floor(($z - $node['r']) / CELL);
    $h1 = (int) floor(($z + $node['r']) / CELL);
    for ($gx = $g0; $gx <= $g1; $gx++) {
        for ($gz = $h0; $gz <= $h1; $gz++) {
            $room['ncells'][cellKey($gx, $gz)][] = $id;
        }
    }
}

function removeNode(array &$room, int $id): void
{
    $n = $room['nodes'][$id] ?? null;
    if ($n === null) {
        return;
    }
    unset($room['nodes'][$id]);
    $g0 = (int) floor(($n['x'] - $n['r']) / CELL);
    $g1 = (int) floor(($n['x'] + $n['r']) / CELL);
    $h0 = (int) floor(($n['z'] - $n['r']) / CELL);
    $h1 = (int) floor(($n['z'] + $n['r']) / CELL);
    for ($gx = $g0; $gx <= $g1; $gx++) {
        for ($gz = $h0; $gz <= $h1; $gz++) {
            $ck = cellKey($gx, $gz);
            $rest = array_values(array_filter($room['ncells'][$ck] ?? [], static fn ($i) => $i !== $id));
            if ($rest) {
                $room['ncells'][$ck] = $rest;
            } else {
                unset($room['ncells'][$ck]);
            }
        }
    }
}

/** @return array<int, array<string, mixed>> */
function nodesNear(array $room, float $x, float $z): array
{
    $gx = (int) floor($x / CELL);
    $gz = (int) floor($z / CELL);
    $out = [];
    for ($dx = -1; $dx <= 1; $dx++) {
        for ($dz = -1; $dz <= 1; $dz++) {
            foreach ($room['ncells'][cellKey($gx + $dx, $gz + $dz)] ?? [] as $id) {
                if (!isset($out[$id]) && isset($room['nodes'][$id])) {
                    $out[$id] = $room['nodes'][$id];
                }
            }
        }
    }
    return $out;
}

function pushOutOfNodes(array $room, array &$pos, float $R = PLAYER_R, float $H = PLAYER_H): void
{
    foreach (nodesNear($room, $pos[0], $pos[2]) as $n) {
        if ($pos[1] >= $n['y'] + $n['h'] || $pos[1] + $H <= $n['y']) {
            continue;
        }
        $dx = $pos[0] - $n['x'];
        $dz = $pos[2] - $n['z'];
        $d = sqrt($dx * $dx + $dz * $dz);
        $min = $n['r'] + $R;
        if ($d >= $min) {
            continue;
        }
        if ($d < 1e-6) {
            $pos[0] = $n['x'] + $min;
            continue;
        }
        $pos[0] = $n['x'] + ($dx / $d) * $min;
        $pos[2] = $n['z'] + ($dz / $d) * $min;
    }
}

function ceilingHit(array $room, array &$pos, float $oldY): bool
{
    $hit = false;
    foreach (piecesInCell($room, (int) floor($pos[0] / CELL), (int) floor($pos[2] / CELL)) as $pc) {
        if ($pc['type'] !== 'floor' || floorHole($pc, $pos[0], $pos[2])) {
            continue;
        }
        $bottom = $pc['base'];
        if ($oldY + PLAYER_H <= $bottom + 0.01 && $pos[1] + PLAYER_H > $bottom) {
            $pos[1] = $bottom - PLAYER_H;
            $hit = true;
        }
    }
    return $hit;
}

// =========================================================== PLACEMENT

function padUnder(array $room, array $pos): ?array
{
    foreach ($room['pads'] as $pad) {
        $dx = $pos[0] - $pad['x'];
        $dz = $pos[2] - $pad['z'];
        if ($dx * $dx + $dz * $dz < PAD_R * PAD_R && abs($pos[1] - $pad['y']) < 0.8) {
            return $pad;
        }
    }
    return null;
}

/** Point de la tyrolienne le plus proche : [t, distance]. */
function zipClosest(array $z, array $q): array
{
    $ab = [$z['b'][0] - $z['a'][0], $z['b'][1] - $z['a'][1], $z['b'][2] - $z['a'][2]];
    $l2 = $ab[0] * $ab[0] + $ab[1] * $ab[1] + $ab[2] * $ab[2];
    $t = (($q[0] - $z['a'][0]) * $ab[0] + ($q[1] - $z['a'][1]) * $ab[1] + ($q[2] - $z['a'][2]) * $ab[2]) / $l2;
    $t = max(0.0, min(1.0, $t));
    $c = [$z['a'][0] + $ab[0] * $t, $z['a'][1] + $ab[1] * $t, $z['a'][2] + $ab[2] * $t];
    return [$t, sqrt(($q[0] - $c[0]) ** 2 + ($q[1] - $c[1]) ** 2 + ($q[2] - $c[2]) ** 2)];
}

function stepZip(array $room, array &$p, array $in, float $dt): void
{
    $z = $room['zips'][$p['zip']['id']] ?? null;
    if ($z === null) {
        $p['zip'] = null;
        return;
    }
    $ux = ($z['b'][0] - $z['a'][0]) / $z['len'];
    $uy = ($z['b'][1] - $z['a'][1]) / $z['len'];
    $uz = ($z['b'][2] - $z['a'][2]) / $z['len'];
    $sp = ZIP_SPEED * $p['zip']['dir'];
    $t = $p['zip']['t'] + ($sp * $dt) / $z['len'];
    $off = $t <= 0 || $t >= 1 || $p['jumpQ'];
    $t = max(0.0, min(1.0, $t));
    $p['pos'][0] = $z['a'][0] + ($z['b'][0] - $z['a'][0]) * $t;
    $p['pos'][1] = $z['a'][1] + ($z['b'][1] - $z['a'][1]) * $t - ZIP_HANG;
    $p['pos'][2] = $z['a'][2] + ($z['b'][2] - $z['a'][2]) * $t;
    $p['vel'][0] = $ux * $sp;
    $p['vel'][1] = $uy * $sp;
    $p['vel'][2] = $uz * $sp;
    $p['ground'] = false;
    $p['swim'] = false;
    $p['glide'] = false;
    $p['slide'] = 0.0;
    if ($off) {
        $p['zip'] = null;
        $p['vel'][0] *= 0.6;
        $p['vel'][2] *= 0.6;
        $p['vel'][1] = $p['jumpQ'] ? JUMP_VELOCITY * 0.8 : 0.0;
    } else {
        $p['zip']['t'] = $t;
    }
    $p['jumpQ'] = false;
    $p['jumpBuf'] = 0.0;
    $p['coyote'] = 0.0;
}

function stepCar(array $room, array &$p, array $in, float $dt): void
{
    $s = $p['cspd'];
    if ($in['fwd'] > 0.1) {
        $s = $s < 0 ? $s + CAR_BRAKE * $dt : min(CAR_SPEED, $s + CAR_ACCEL * $dt);
    } elseif ($in['fwd'] < -0.1) {
        $s = $s > 0 ? $s - CAR_BRAKE * $dt : max(-CAR_REVERSE, $s - CAR_ACCEL * $dt);
    } else {
        $s = $s > 0 ? max(0.0, $s - CAR_DRAG * $dt) : min(0.0, $s + CAR_DRAG * $dt);
    }
    if ($p['ground']) {
        $p['cyaw'] -= $in['side'] * CAR_TURN * max(-1.0, min(1.0, $s / 5)) * $dt;
    }
    $fx = -sin($p['cyaw']);
    $fz = -cos($p['cyaw']);
    $ox = $p['pos'][0];
    $oy = $p['pos'][1];
    $oz = $p['pos'][2];
    $pos = [$ox + $fx * $s * $dt, $oy, $oz + $fz * $s * $dt];
    if (terrainHeight($pos[0], $pos[2]) < WATER_Y - 0.2) {
        $pos[0] = $ox;
        $pos[2] = $oz;
        $s = 0.0;
    }
    $dist = sqrt($pos[0] * $pos[0] + $pos[2] * $pos[2]);
    if ($dist > PLAY_RADIUS) {
        $pos[0] *= PLAY_RADIUS / $dist;
        $pos[2] *= PLAY_RADIUS / $dist;
        $s *= 0.5;
    }
    $bx = $pos[0];
    $bz = $pos[2];
    for ($k = -1; $k <= 1; $k++) {
        $c = [$pos[0] + $fx * CAR_AXLE * $k, $oy + 0.3, $pos[2] + $fz * CAR_AXLE * $k];
        $cx = $c[0];
        $cz = $c[2];
        pushOutOfWalls($room, $c, CAR_R, CAR_H);
        pushOutOfNodes($room, $c, CAR_R, CAR_H);
        $pos[0] += $c[0] - $cx;
        $pos[2] += $c[2] - $cz;
    }
    if (abs($pos[0] - $bx) + abs($pos[2] - $bz) > 0.02) {
        $s *= 0.6;
    }
    $ground = max(terrainHeight($pos[0], $pos[2]), supportHeight($room, $pos[0], $oy + 0.45, $pos[2]));
    if ($p['ground'] && $ground > $oy + 1.2) {
        $pos[0] = $ox;
        $pos[2] = $oz;
        $s = 0.0;
        $ground = max(terrainHeight($ox, $oz), supportHeight($room, $ox, $oy + 0.45, $oz));
    }
    $vy = $p['vel'][1] - GRAVITY * $dt;
    $y = $oy + $vy * $dt;
    if ($p['ground'] && $y > $ground && $y - $ground < 0.6 + abs($s) * $dt) {
        $y = $ground;
    }
    if ($y <= $ground) {
        $y = $ground;
        $vy = 0.0;
        $p['ground'] = true;
    } else {
        $p['ground'] = false;
    }
    $p['pos'] = [$pos[0], $y, $pos[2]];
    $p['vel'] = [$fx * $s, $vy, $fz * $s];
    $p['cspd'] = $s;
    $p['swim'] = false;
    $p['glide'] = false;
    $p['slide'] = 0.0;
    $p['jumpQ'] = false;
    $p['jumpBuf'] = 0.0;
    $p['coyote'] = 0.0;
}

function stepBody(array $room, array &$p, array $in, float $dt): void
{
    if ($p['veh'] !== null) {
        stepCar($room, $p, $in, $dt);
        return;
    }
    if ($p['zip'] !== null) {
        stepZip($room, $p, $in, $dt);
        return;
    }
    $falling = $p['state'] === 'falling';
    if ($falling && !$p['glide']) {
        $agl = $p['pos'][1] - groundOrWater($p['pos'][0], $p['pos'][2]);
        if ($in['glide'] || ($agl < AUTO_GLIDER && $p['vel'][1] < 0)) {
            $p['glide'] = true;
        }
    }

    $yaw = $p['yaw'];
    $mx = -sin($yaw) * $in['fwd'] + cos($yaw) * $in['side'];
    $mz = -cos($yaw) * $in['fwd'] - sin($yaw) * $in['side'];
    $len = sqrt($mx * $mx + $mz * $mz);
    if ($len > 1.0) {
        $mx /= $len;
        $mz /= $len;
    }
    $moving = $len > 0.1;

    if ($p['ground'] && !$p['swim'] && $in['crouch'] && $in['sprint'] && $moving && $p['slide'] <= 0.0) {
        $p['slide'] = SLIDE_TIME;
        $p['slideDir'] = [$mx, $mz];
    }

    if ($p['slide'] > 0.0) {
        $p['slide'] -= $dt;
        // on oriente sa glissade (comme dans Fortnite) : la direction suit la touche, sans à-coup
        if ($moving) {
            $t = min(1.0, SLIDE_TURN * $dt);
            $sx = $p['slideDir'][0] + ($mx - $p['slideDir'][0]) * $t;
            $sz = $p['slideDir'][1] + ($mz - $p['slideDir'][1]) * $t;
            $sl = sqrt($sx * $sx + $sz * $sz);
            if ($sl > 1e-4) {
                $p['slideDir'] = [$sx / $sl, $sz / $sl];
            }
        }
        $k = max(SLIDE_MIN, $p['slide'] / SLIDE_TIME);
        $tx = $p['slideDir'][0] * SLIDE_SPEED * $k;
        $tz = $p['slideDir'][1] * SLIDE_SPEED * $k;
    } else {
        $speed = WALK_SPEED;
        if ($falling) {
            $speed = $p['glide'] ? GLIDER_SPEED : ($in['fwd'] > 0 ? SKY_DIVE_SPEED : SKY_SPEED);
        } elseif ($p['swim']) {
            $speed = SWIM_SPEED;
        } else {
            if ($in['crouch']) {
                $speed = CROUCH_SPEED;
            } elseif ($in['sprint'] && $in['fwd'] > 0 && !$in['ads']) {
                $speed = SPRINT_SPEED;
            }
            if ($in['ads']) {
                $speed *= ADS_FACTOR;
            }
        }
        $tx = $mx * $speed;
        $tz = $mz * $speed;
    }

    $rate = $p['ground'] ? ($moving ? ACCEL_GROUND : DECEL_GROUND) : ($falling ? ACCEL_SKY : ACCEL_AIR);
    $k = min(1.0, $rate * $dt);
    $p['vel'][0] += ($tx - $p['vel'][0]) * $k;
    $p['vel'][2] += ($tz - $p['vel'][2]) * $k;

    // saut tolérant : mémorise l'appui (tampon) et laisse un court instant après avoir quitté le sol
    if ($p['jumpQ']) {
        $p['jumpBuf'] = JUMP_BUFFER;
    }
    $p['jumpQ'] = false;
    $canJump = ($p['ground'] || ($p['coyote'] ?? 0.0) > 0.0) && $p['slide'] <= 0.0 && !$p['swim'] && !$falling;
    if (($p['jumpBuf'] ?? 0.0) > 0.0 && $canJump) {
        $p['vel'][1] = JUMP_VELOCITY;
        $p['ground'] = false;
        $p['jumpBuf'] = 0.0;
        $p['coyote'] = 0.0;
    } else {
        $p['jumpBuf'] = max(0.0, ($p['jumpBuf'] ?? 0.0) - $dt);
    }
    $snap = $p['ground'] && !$falling;

    if (!$p['ground']) {
        $p['vel'][1] -= GRAVITY * $dt;
        if ($falling) {
            $term = $p['glide'] ? -GLIDER_FALL : ($in['fwd'] > 0 ? -SKY_DIVE : -SKY_FALL);
            if ($p['vel'][1] < $term) {
                $p['vel'][1] += ($term - $p['vel'][1]) * min(1.0, 4 * $dt);
            }
        }
    }

    $oldY = $p['pos'][1];
    $p['pos'][0] += $p['vel'][0] * $dt;
    $p['pos'][1] += $p['vel'][1] * $dt;
    $p['pos'][2] += $p['vel'][2] * $dt;

    $dist = sqrt($p['pos'][0] * $p['pos'][0] + $p['pos'][2] * $p['pos'][2]);
    if ($dist > PLAY_RADIUS) {
        $f = PLAY_RADIUS / $dist;
        $p['pos'][0] *= $f;
        $p['pos'][2] *= $f;
        $p['vel'][0] = 0.0;
        $p['vel'][2] = 0.0;
    }

    pushOutOfWalls($room, $p['pos']);
    pushOutOfNodes($room, $p['pos']);
    if ($p['vel'][1] > 0 && ceilingHit($room, $p['pos'], $oldY)) {
        $p['vel'][1] = 0.0;
    }

    $water = groundOrWater($p['pos'][0], $p['pos'][2]);
    $ground = max($water, supportHeight($room, $p['pos'][0], $oldY, $p['pos'][2]));
    if ($p['pos'][1] <= $ground || ($snap && $p['pos'][1] - $ground < SNAP_DOWN)) {
        $p['pos'][1] = $ground;
        if ($p['vel'][1] < 0.0) {
            $p['vel'][1] = 0.0;
        }
        $p['ground'] = true;
        $p['swim'] = $ground === $water && terrainHeight($p['pos'][0], $p['pos'][2]) < SWIM_Y;
        if ($p['state'] === 'falling') {
            $p['state'] = 'alive';
            $p['glide'] = false;
        }
        $pad = $p['state'] === 'alive' && !$p['swim'] ? padUnder($room, $p['pos']) : null;
        if ($pad !== null) {
            $p['vel'][1] = PAD_VY;
            $p['ground'] = false;
            $p['state'] = 'falling';
            $p['glide'] = false;
            $p['slide'] = 0.0;
        }
    } else {
        $p['ground'] = false;
        $p['swim'] = false;
    }
    $p['coyote'] = $p['ground'] && !$falling ? COYOTE_TIME : max(0.0, ($p['coyote'] ?? 0.0) - $dt);
}

// =========================================================== LANCER DE RAYONS (serveur seulement)

function dirFromAngles(float $yaw, float $pitch): array
{
    $cp = cos($pitch);
    return [-sin($yaw) * $cp, sin($pitch), -cos($yaw) * $cp];
}

function raySphere(array $o, array $d, array $c, float $r): ?float
{
    $ox = $o[0] - $c[0];
    $oy = $o[1] - $c[1];
    $oz = $o[2] - $c[2];
    $b = $ox * $d[0] + $oy * $d[1] + $oz * $d[2];
    $cc = $ox * $ox + $oy * $oy + $oz * $oz - $r * $r;
    $disc = $b * $b - $cc;
    if ($disc < 0.0) {
        return null;
    }
    $s = sqrt($disc);
    $t = -$b - $s;
    if ($t < 0.0) {
        $t = -$b + $s;
    }
    return $t < 0.0 ? null : $t;
}

function rayBox(array $o, array $d, array $b): ?float
{
    $tmin = -INF;
    $tmax = INF;
    for ($i = 0; $i < 3; $i++) {
        if (abs($d[$i]) < 1e-9) {
            if ($o[$i] < $b[$i] || $o[$i] > $b[$i + 3]) {
                return null;
            }
            continue;
        }
        $t1 = ($b[$i] - $o[$i]) / $d[$i];
        $t2 = ($b[$i + 3] - $o[$i]) / $d[$i];
        if ($t1 > $t2) {
            [$t1, $t2] = [$t2, $t1];
        }
        $tmin = max($tmin, $t1);
        $tmax = min($tmax, $t2);
        if ($tmin > $tmax) {
            return null;
        }
    }
    if ($tmax < 0.0) {
        return null;
    }
    return max($tmin, 0.0);
}

/** Cylindre vertical [y0, y1] de rayon r centré en (cx, cz). */
function rayCylinder(array $o, array $d, float $cx, float $cz, float $r, float $y0, float $y1): ?float
{
    $ox = $o[0] - $cx;
    $oz = $o[2] - $cz;
    $a = $d[0] * $d[0] + $d[2] * $d[2];
    if ($a < 1e-9) {
        if ($ox * $ox + $oz * $oz > $r * $r) {
            return null;
        }
        $tE = -INF;
        $tX = INF;
    } else {
        $b = $ox * $d[0] + $oz * $d[2];
        $c = $ox * $ox + $oz * $oz - $r * $r;
        $disc = $b * $b - $a * $c;
        if ($disc < 0.0) {
            return null;
        }
        $s = sqrt($disc);
        $tE = (-$b - $s) / $a;
        $tX = (-$b + $s) / $a;
    }
    if (abs($d[1]) < 1e-9) {
        if ($o[1] < $y0 || $o[1] > $y1) {
            return null;
        }
    } else {
        $t1 = ($y0 - $o[1]) / $d[1];
        $t2 = ($y1 - $o[1]) / $d[1];
        if ($t1 > $t2) {
            [$t1, $t2] = [$t2, $t1];
        }
        $tE = max($tE, $t1);
        $tX = min($tX, $t2);
    }
    if ($tE > $tX || $tX < 0.0) {
        return null;
    }
    return max($tE, 0.0);
}

/**
 * Premier impact le long du rayon : joueur, pièce, arbre/rocher/voiture ou relief.
 * Parcours des cases traversées (DDA) : rapide même avec des milliers de pièces.
 * @return ?array{kind:string, t:float, id?:int, key?:string, head?:bool}
 */
function raycastWorld(array $room, array $o, array $d, float $maxT, ?int $ignore, bool $withPlayers = true): ?array
{
    $best = null;
    $bestT = $maxT;

    if ($withPlayers) {
        foreach ($room['players'] as $pid => $p) {
            if ($pid === $ignore || $p['state'] !== 'alive') {
                continue;
            }
            $c = $p['pos'];
            $crouch = !empty($p['in']['crouch']) ? 0.35 : 0.0;
            $bodyB = 0.0;
            if (($p['veh'] ?? null) !== null) {
                // conducteur : assis à gauche, la tête et le buste dépassent de la carrosserie (on peut lui tirer dessus)
                $c = [$c[0] - cos($p['cyaw']) * 0.42, $c[1], $c[2] + sin($p['cyaw']) * 0.42];
                $crouch = 0.3;
                $bodyB = 0.5;
            } elseif (!empty($p['seat'])) {
                $crouch = 0.3;
                $bodyB = 0.5;
            }
            $th = raySphere($o, $d, [$c[0], $c[1] + 1.58 - $crouch, $c[2]], 0.27);
            if ($th !== null && $th < $bestT) {
                $bestT = $th;
                $best = ['kind' => 'player', 'id' => $pid, 'head' => true];
            }
            $tb = rayCylinder($o, $d, $c[0], $c[2], $bodyB > 0 ? 0.36 : 0.42, $c[1] + $bodyB, $c[1] + 1.38 - $crouch);
            if ($tb !== null && $tb < $bestT) {
                $bestT = $tb;
                $best = ['kind' => 'player', 'id' => $pid, 'head' => false];
            }
        }
    }

    // véhicules conduits (les véhicules garés sont des obstacles, voir les nœuds 'veh')
    $ownVeh = $ignore !== null ? ($room['players'][$ignore]['seat'][0] ?? $room['players'][$ignore]['veh'] ?? null) : null;
    foreach ($room['vehicles'] ?? [] as $vid => $v) {
        if ($v['driver'] === null || !empty($v['wreck']) || $vid === $ownVeh || !isset($room['players'][$v['driver']])) {
            continue;
        }
        $dp = $room['players'][$v['driver']];
        $fx = -sin($dp['cyaw']);
        $fz = -cos($dp['cyaw']);
        foreach ([1.15, -1.15] as $off) {
            $tv = rayCylinder($o, $d, $dp['pos'][0] + $fx * $off, $dp['pos'][2] + $fz * $off, 0.95, $dp['pos'][1], $dp['pos'][1] + VEH_BODY_H);
            if ($tv !== null && $tv < $bestT) {
                $bestT = $tv;
                $best = ['kind' => 'veh', 'id' => $vid];
            }
        }
    }

    // pièces et obstacles : cases traversées
    $gx = (int) floor($o[0] / CELL);
    $gz = (int) floor($o[2] / CELL);
    $sx = $d[0] > 0 ? 1 : -1;
    $sz = $d[2] > 0 ? 1 : -1;
    $tMaxX = abs($d[0]) > 1e-9 ? ((($gx + ($sx > 0 ? 1 : 0)) * CELL) - $o[0]) / $d[0] : INF;
    $tMaxZ = abs($d[2]) > 1e-9 ? ((($gz + ($sz > 0 ? 1 : 0)) * CELL) - $o[2]) / $d[2] : INF;
    $tDX = abs($d[0]) > 1e-9 ? CELL / abs($d[0]) : INF;
    $tDZ = abs($d[2]) > 1e-9 ? CELL / abs($d[2]) : INF;
    $seenP = [];
    $seenN = [];
    $t = 0.0;
    $guard = 0;
    while ($t <= $bestT && $guard++ < 400) {
        foreach ([[$gx, $gz], [$gx + 1, $gz], [$gx, $gz + 1]] as [$cx, $cz]) {
            $ck = cellKey($cx, $cz);
            foreach ($room['cells'][$ck] ?? [] as $key) {
                if (isset($seenP[$key]) || !isset($room['buildings'][$key])) {
                    continue;
                }
                $seenP[$key] = true;
                foreach (pieceBoxes($room['buildings'][$key]) as $box) {
                    $tb = rayBox($o, $d, $box);
                    if ($tb !== null && $tb < $bestT) {
                        $bestT = $tb;
                        $best = ['kind' => 'build', 'key' => $key];
                    }
                }
            }
            foreach ($room['ncells'][$ck] ?? [] as $nid) {
                if (isset($seenN[$nid]) || !isset($room['nodes'][$nid])) {
                    continue;
                }
                $seenN[$nid] = true;
                $n = $room['nodes'][$nid];
                if ($n['k'] === 'veh' && $n['var'] === $ownVeh) {
                    continue;   // on tire depuis ce véhicule
                }
                $tn = rayCylinder($o, $d, $n['x'], $n['z'], $n['k'] === 'tree' ? 0.45 : $n['r'], $n['y'], $n['y'] + ($n['k'] === 'veh' ? VEH_BODY_H : $n['h']));
                if ($tn !== null && $tn < $bestT) {
                    $bestT = $tn;
                    $best = ['kind' => 'node', 'id' => $nid];
                }
            }
        }
        if ($tMaxX < $tMaxZ) {
            $t = $tMaxX;
            $tMaxX += $tDX;
            $gx += $sx;
        } else {
            $t = $tMaxZ;
            $tMaxZ += $tDZ;
            $gz += $sz;
        }
    }

    // relief : marche par pas de 2 m puis affinage
    $prev = 0.0;
    for ($s = 2.0; $s <= $bestT + 2.0; $s += 2.0) {
        $tt = min($s, $bestT);
        $y = $o[1] + $d[1] * $tt;
        if ($y < terrainHeight($o[0] + $d[0] * $tt, $o[2] + $d[2] * $tt)) {
            $lo = $prev;
            $hi = $tt;
            for ($k = 0; $k < 6; $k++) {
                $mid = ($lo + $hi) / 2;
                if ($o[1] + $d[1] * $mid < terrainHeight($o[0] + $d[0] * $mid, $o[2] + $d[2] * $mid)) {
                    $hi = $mid;
                } else {
                    $lo = $mid;
                }
            }
            if ($hi < $bestT) {
                $bestT = $hi;
                $best = ['kind' => 'ground'];
            }
            break;
        }
        $prev = $tt;
        if ($tt >= $bestT) {
            break;
        }
    }

    if ($best !== null) {
        $best['t'] = $bestT;
    }
    return $best;
}
