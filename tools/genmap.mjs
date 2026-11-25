// Générateur de l'île de Battle Island -> public/map/island.json (+ aperçu PPM en option).
// Usage : node tools/genmap.mjs [apercu.ppm]
// Le fichier produit est lu par le serveur (server.php) ET par le client (js/shared.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROPS } from '../public/js/shared.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'public/map/island.json');

const SIZE = 1000;          // monde de -500 à +500
const STEP = 4;             // pas de la carte des hauteurs = taille d'une case de construction
const N = SIZE / STEP + 1;  // 251 points par côté
const HALF = SIZE / 2;
const CELL = 4;
const WATER = -1.5;

// ------------------------------------------------------------ hasard reproductible
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rnd = mulberry32(20261124);
const rr = (a, b) => a + rnd() * (b - a);

// ------------------------------------------------------------ bruit de Perlin simplex 2D
const perm = new Uint8Array(512);
{
    const p = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const G2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
function simplex(x, y) {
    const F2 = 0.5 * (Math.sqrt(3) - 1), G = (3 - Math.sqrt(3)) / 6;
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G, y1 = y0 - j1 + G, x2 = x0 - 1 + 2 * G, y2 = y0 - 1 + 2 * G;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    for (const [dx, dy, gi] of [[x0, y0, perm[ii + perm[jj]]], [x1, y1, perm[ii + i1 + perm[jj + j1]]], [x2, y2, perm[ii + 1 + perm[jj + 1]]]]) {
        let tt = 0.5 - dx * dx - dy * dy;
        if (tt > 0) { tt *= tt; const g = G2[gi & 7]; n += tt * tt * (g[0] * dx + g[1] * dy); }
    }
    return 70 * n; // ~[-1, 1]
}
function fbm(x, y, oct = 5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) { s += a * simplex(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------ lieux nommés (x, z, rayon du plateau, altitude)
const POIS = [
    { id: 'town',    name: 'Pignons Penchés', x: 24,   z: -36,  r: 78, h: 6.5 },
    { id: 'beach',   name: 'Plage Paisible',  x: -262, z: 262,  r: 46, h: 2.6 },
    { id: 'farm',    name: 'Ferme Frisquette', x: -214, z: -196, r: 64, h: 5.0 },
    { id: 'peak',    name: 'Mont Fringant',   x: 228,  z: -232, r: 20, h: 40 },
    { id: 'lake',    name: 'Lac Loot',        x: -52,  z: 146,  r: 38, h: 3.2 },
    { id: 'factory', name: 'Usine Usée',      x: 262,  z: 150,  r: 62, h: 4.2 },
    { id: 'forest',  name: 'Forêt Fourbe',    x: -300, z: -6,   r: 16, h: 6.0 },
    { id: 'hamlet',  name: 'Hameau Huppé',    x: 150,  z: 26,   r: 34, h: 7.0 },
    { id: 'motel',   name: 'Motel Malin',     x: -150, z: 72,   r: 42, h: 5.5 },
    { id: 'port',    name: 'Port Paumé',      x: 150,  z: 318,  r: 46, h: 2.6 },
    { id: 'camp',    name: 'Camping Cosy',    x: -40,  z: -292, r: 36, h: 6.5 },
    { id: 'green',   name: 'Serres Grises',   x: 96,   z: -322, r: 42, h: 4.0 },
    { id: 'swamp',   name: 'Marais Moisi',    x: -98,  z: 268,  r: 40, h: 2.2 },
];
const P = Object.fromEntries(POIS.map((p) => [p.id, p]));
const LAKE = { x: -40, z: 222, r: 58 };
const MOUNT = { x: 228, z: -232, r: 175 };
const FOREST = { x: -292, z: -10, r: 130 };

// ------------------------------------------------------------ biomes
// Chaque biome a son relief, son sol et sa végétation. Les frontières sont bruitées :
// on ne voit jamais de cercle parfait au sol.
//   plaine  : prairie vallonnée, arbres épars (biome par défaut)
//   foret   : conifères serrés, herbe sombre
//   mont    : crêtes, roche et neige en altitude
//   marais  : terres basses et boueuses, flaques, arbres morts
//   steppe  : plateau sec, herbe jaune, très peu d'arbres
//   friche  : gravier gris et pluie, arbres morts, serres (ambiance du village pluvieux)
const BIOMES = [
    { id: 'foret',  x: -292, z: -10,  r: 200 },
    { id: 'mont',   x: 228,  z: -232, r: 205 },
    { id: 'marais', x: -40,  z: 238,  r: 190 },
    { id: 'steppe', x: 312,  z: 120,  r: 195 },
    { id: 'friche', x: 70,   z: -330, r: 180 },
];
/** Biome dominant en (x, z) et sa force (0..1) ; 'plaine' par défaut. */
function biomeWeight(x, z) {
    let best = 'plaine';
    let bw = 0.5;
    for (const b of BIOMES) {
        const d = Math.hypot(x - b.x, z - b.z) / b.r;
        const n = 0.18 * fbm(x * 0.0055 + b.x * 0.013, z * 0.0055 + b.z * 0.013, 3);
        const w = smooth(1.3, 0.2, d + n);
        if (w > bw) { bw = w; best = b.id; }
    }
    return [best, bw];
}
const biomeAt = (x, z) => biomeWeight(x, z)[0];

function polyline(points, wiggle = 0) {
    // densifie et fait onduler un peu les routes
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
        const [ax, az] = points[i], [bx, bz] = points[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(2, Math.ceil(len / 12));
        const nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (let s = 0; s < steps; s++) {
            const t = s / steps;
            const w = wiggle * simplex(ax * 0.01 + t * len * 0.012, az * 0.01) * Math.sin(Math.PI * t);
            out.push([ax + (bx - ax) * t + nx * w, az + (bz - az) * t + nz * w]);
        }
    }
    out.push(points[points.length - 1]);
    return out.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
}
const ROADS = [
    polyline([[P.town.x, P.town.z], [-80, -110], [P.farm.x, P.farm.z]], 14),
    polyline([[P.town.x, P.town.z], [P.hamlet.x, P.hamlet.z], [P.factory.x, P.factory.z]], 12),
    polyline([[P.town.x, P.town.z], [-10, 60], [P.lake.x, P.lake.z]], 10),
    polyline([[P.lake.x, P.lake.z], [-160, 210], [P.beach.x, P.beach.z]], 12),
    polyline([[P.farm.x, P.farm.z], [-290, -90], [P.forest.x, P.forest.z]], 10),
    polyline([[P.factory.x, P.factory.z], [300, 40], [270, -100], [205, -150]], 12),
    polyline([[P.town.x, P.town.z], [-60, 20], [P.motel.x, P.motel.z]], 12),
    polyline([[P.town.x, P.town.z], [0, -160], [P.camp.x, P.camp.z]], 12),
    polyline([[P.factory.x, P.factory.z], [210, 250], [P.port.x, P.port.z]], 10),
];
const RIVER = polyline([[LAKE.x + 10, LAKE.z + 40], [-20, 300], [10, 360], [-10, 460]], 18);

function distToPolyline(x, z, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
        best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
    return best;
}

// ------------------------------------------------------------ relief
function naturalHeight(x, z) {
    const a = Math.atan2(z, x);
    const coast = 412 + 34 * simplex(Math.cos(a) * 1.3 + 7, Math.sin(a) * 1.3 + 3) + 16 * simplex(Math.cos(a) * 4 + 1, Math.sin(a) * 4);
    const d = Math.hypot(x, z) / coast;
    const land = smooth(1.02, 0.86, d);                       // 1 à l'intérieur, 0 en mer
    let h = 3.2 + 5.5 * (fbm(x * 0.0045 + 11, z * 0.0045 - 4, 5) + 0.35) + 2.2 * fbm(x * 0.02, z * 0.02, 3);
    // montagne au nord-est : crêtes
    const md = Math.hypot(x - MOUNT.x, z - MOUNT.z) / MOUNT.r;
    const mmask = smooth(1.0, 0.15, md);
    const ridge = 1 - Math.abs(fbm(x * 0.012 + 3, z * 0.012 + 9, 4));
    h += mmask * (30 * ridge * ridge + 14) * smooth(1.0, 0.0, md);
    // collines douces au sud-ouest
    h += 6 * smooth(1, 0, Math.hypot(x + 160, z - 40) / 140) * (fbm(x * 0.01, z * 0.01, 3) + 0.6);
    // --- relief propre à chaque biome
    const [bio, bw] = biomeWeight(x, z);
    if (bio === 'marais') {
        // terres basses et plates, parsemées de flaques
        const pond = fbm(x * 0.018 + 70, z * 0.018 - 30, 3);
        h = lerp(h, 2.0 + 1.6 * fbm(x * 0.01, z * 0.01, 2) + (pond > 0.33 ? -2.6 : 0), bw * 0.85);
    } else if (bio === 'steppe') {
        // plateau sec, longues ondulations
        h = lerp(h, 7.5 + 4.5 * fbm(x * 0.0045 - 21, z * 0.0045 + 13, 3), bw * 0.8);
    } else if (bio === 'friche') {
        // terrain bas et bosselé, creusé d'ornières
        h = lerp(h, 3.6 + 3.2 * fbm(x * 0.012 + 50, z * 0.012 + 50, 3) + 1.5 * fbm(x * 0.05, z * 0.05, 2), bw * 0.8);
    }
    // plage : rampe douce vers la mer
    h = h * smooth(0.97, 0.80, d) + 1.4 * smooth(1.02, 0.94, d) * (1 - smooth(0.97, 0.80, d));
    return land * h + (1 - land) * -12;
}

const H = new Float64Array(N * N);
const idx = (i, j) => j * N + i;
const wx = (i) => -HALF + i * STEP;

for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
        const x = wx(i), z = wx(j);
        let h = naturalHeight(x, z);
        // lac
        const ld = Math.hypot(x - LAKE.x, z - LAKE.z) / (LAKE.r * (1 + 0.15 * simplex(x * 0.03, z * 0.03)));
        h = lerp(h, -5.5, smooth(1.15, 0.7, ld));
        // rivière vers la côte sud
        const rd = distToPolyline(x, z, RIVER);
        h = lerp(h, Math.min(h, -3.2), smooth(11, 4, rd));
        // plateaux des lieux nommés
        for (const p of POIS) {
            const pd = Math.hypot(x - p.x, z - p.z);
            const w = smooth(p.r + 34, p.r, pd);
            if (w > 0) h = lerp(h, p.h, w);
        }
        // routes : lissage léger
        let rdmin = Infinity;
        for (const r of ROADS) rdmin = Math.min(rdmin, distToPolyline(x, z, r));
        if (rdmin < 10) h = lerp(h, Math.max(h, 1.2), smooth(10, 3, rdmin) * 0.4);
        H[idx(i, j)] = h;
    }
}

// ------------------------------------------------------------ bâtiments (en pièces de construction)
// pièce : [type, gx, gy, gz, rot, variante, matériau, style]
// type : 'floor' | 'wall' (v 0 plein, 1 porte, 2 fenêtre) | 'stairs' (rampe, rot 0..3) | 'roof' (v 0 cône, 1 pente)
// style : 0 = aspect construction du joueur ; 1.. = façades de maisons
const STYLE = { blue: 1, yellow: 2, brick: 3, white: 4, barn: 5, metal: 6, logs: 7, green: 8, pink: 9 };
const MAT_OF_STYLE = { 1: 'wood', 2: 'wood', 3: 'stone', 4: 'stone', 5: 'wood', 6: 'metal', 7: 'wood', 8: 'wood', 9: 'stone' };
const pieces = [];
const pieceSet = new Set();
const cols = {};
const occupied = new Set();
const chests = [];
const loot = [];
const buildings = [];
const props = [];     // meubles bloquants -> nœuds 'prop' : [x, y, z, rot, index]
const deco = [];      // décor sans collision : [type, x, y, z, rot]
const ammo = [];      // caisses de munitions : [x, y, z, rot]
const PI_ = Object.fromEntries(PROPS.map((p, i) => [p[0], i]));
// profondeur (m) des meubles posés contre un mur
const DEPTH = { couch: 1.2, armchair: 1.2, bed2: 2.25, bed1: 2.25, cabinet: 0.75, chair: 0.65, lamp: 0.7, cactus: 0.6,
    fridge: 1.2, counter: 1.2, sink: 1.2, kchair: 0.6, crates: 1.5, shelf: 0.5, boxes: 0.9, dumpster: 1.6, bench: 0.7 };
function prop(kind, x, y, z, rot) {
    props.push([round2(x), round2(y), round2(z), round2(rot), PI_[kind]]);
}

/** Meuble l'intérieur d'une maison (salon, chambre, cuisine) et pose des caisses de munitions. */
function furnish(gx0, gz0, W, D, floors, col, door, opts) {
    const stair = `${gx0}:${gz0 + D - 1}`;
    for (let L = 0; L < floors; L++) {
        const y = col + L * CELL + 0.4;
        const chestCell = `${L % 2 === 0 ? gx0 + W - 1 : gx0}:${gz0}`;
        const slots = [];
        const add = (gx, gz, side) => {
            const ck = `${gx}:${gz}`;
            if (ck === stair || ck === chestCell) return;
            if (L === 0) {
                const len = side === 'n' || side === 's' ? W : D;
                const k = side === 'n' || side === 's' ? gx - gx0 : gz - gz0;
                if (side === door && (k === Math.floor((len - 1) / 2) || opts.bigDoor)) return;
            }
            slots.push({ gx, gz, side });
        };
        for (let k = 0; k < W; k++) { add(gx0 + k, gz0, 'n'); add(gx0 + k, gz0 + D - 1, 's'); }
        for (let k = 0; k < D; k++) { add(gx0, gz0 + k, 'w'); add(gx0 + W - 1, gz0 + k, 'e'); }
        // mélange
        for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
        const used = new Set();
        const place = (kind) => {
            const sl = slots.find((q) => !used.has(`${q.gx}:${q.gz}`));
            if (!sl) return false;
            used.add(`${sl.gx}:${sl.gz}`);
            const m = (DEPTH[kind] ?? 1) / 2 + 0.25;
            let x = (sl.gx + 0.5) * CELL;
            let z = (sl.gz + 0.5) * CELL;
            let rot = 0;
            if (sl.side === 'n') { z = sl.gz * CELL + m; rot = 0; }
            else if (sl.side === 's') { z = (sl.gz + 1) * CELL - m; rot = Math.PI; }
            else if (sl.side === 'w') { x = sl.gx * CELL + m; rot = Math.PI / 2; }
            else { x = (sl.gx + 1) * CELL - m; rot = -Math.PI / 2; }
            if (kind === 'ammo') ammo.push([round2(x), round2(y), round2(z), round2(rot)]);
            else prop(kind, x, y, z, rot);
            return true;
        };
        if (opts.open) {
            for (let i = 0; i < 3; i++) place(rnd() < 0.5 ? 'crates' : 'boxes');
            if (rnd() < 0.7) place('ammo');
            continue;
        }
        const kind = opts.room ?? (floors > 1 && L > 0 ? 'bed' : ['living', 'kitchen', 'bed'][(((gx0 + gz0 + L) % 3) + 3) % 3]);
        const sets = {
            living: ['couch', 'armchair', 'cabinet', 'lamp', 'chair', 'cactus'],
            bed: [rnd() < 0.6 ? 'bed2' : 'bed1', 'cabinet', 'lamp', 'armchair', 'cactus'],
            kitchen: ['fridge', 'counter', 'sink', 'cabinet', 'cactus'],
            shop: ['counter', 'crates', 'crates', 'fridge', 'boxes', 'crates'],
            motel: ['bed2', 'lamp', 'cabinet', 'armchair'],
        };
        const n = Math.min(slots.length - 1, W * D >= 6 ? 5 : 3);
        let placed = 0;
        for (const it of sets[kind]) { if (placed >= n) break; if (place(it)) placed++; }
        if (rnd() < 0.4) place('ammo');
        // centre de la pièce : table (+ tapis), chaises
        if (W * D >= 4) {
            const cxm = (gx0 + W / 2) * CELL;
            const czm = (gz0 + D / 2) * CELL;
            const sgx = Math.floor(cxm / CELL);
            const sgz = Math.floor(czm / CELL);
            if (`${sgx}:${sgz}` !== stair && `${sgx - 1}:${sgz}` !== stair) {
                if (kind === 'living') { deco.push(['rug', round2(cxm), round2(y), round2(czm), 0]); prop('tablelow', cxm, y, czm, 0); }
                else if (kind === 'kitchen') { prop('rtable', cxm, y, czm, 0); prop('kchair', cxm - 1.5, y, czm, Math.PI / 2); prop('kchair', cxm + 1.5, y, czm, -Math.PI / 2); }
                else if (kind === 'bed' || kind === 'motel') deco.push(['rug', round2(cxm), round2(y), round2(czm), Math.PI / 2]);
            }
        }
        // tableaux aux murs
        if (rnd() < 0.7) deco.push(['frame', round2((gx0 + 0.5) * CELL), round2(y + 1.6), round2(gz0 * CELL + 0.25), 0]);
    }
}

function addPiece(type, gx, gy, gz, rot, v, style) {
    const k = `${type}:${gx}:${gy}:${gz}:${rot}`;
    if (pieceSet.has(k)) return;
    pieceSet.add(k);
    pieces.push([type, gx, gy, gz, rot, v, MAT_OF_STYLE[style] ?? 'wood', style]);
}
function cellCenter(gx, gz) { return [(gx + 0.5) * CELL, (gz + 0.5) * CELL]; }
function sampleIJ(x, z) { return [Math.round((x + HALF) / STEP), Math.round((z + HALF) / STEP)]; }

/** Aplatit les coins des cases (et lisse autour), fixe l'altitude de fondation. */
function flattenFootprint(gx0, gz0, W, D) {
    let sum = 0, n = 0;
    for (let gx = gx0; gx < gx0 + W; gx++) for (let gz = gz0; gz < gz0 + D; gz++) {
        const [x, z] = cellCenter(gx, gz);
        const [i, j] = sampleIJ(x, z);
        sum += H[idx(i, j)]; n++;
    }
    const col = Math.max(1.0, Math.round((sum / n) * 2) / 2);
    // coins des cases : sous le sol ; marge de 2 cases lissée
    const i0 = (gx0 * CELL + HALF) / STEP, j0 = (gz0 * CELL + HALF) / STEP;
    for (let j = j0 - 3; j <= j0 + D + 3; j++) for (let i = i0 - 3; i <= i0 + W + 3; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const di = Math.max(i0 - i, 0, i - (i0 + W)), dj = Math.max(j0 - j, 0, j - (j0 + D));
        const dd = Math.max(di, dj);
        const target = col - 0.08;
        if (dd === 0) H[idx(i, j)] = target;
        else H[idx(i, j)] = lerp(target, H[idx(i, j)], smooth(0, 3.2, dd));
    }
    for (let gx = gx0; gx < gx0 + W; gx++) for (let gz = gz0; gz < gz0 + D; gz++) cols[`${gx}:${gz}`] = col;
    return col;
}

function free(gx0, gz0, W, D, margin = 1) {
    for (let gx = gx0 - margin; gx < gx0 + W + margin; gx++) for (let gz = gz0 - margin; gz < gz0 + D + margin; gz++) {
        if (occupied.has(`${gx}:${gz}`)) return false;
    }
    return true;
}

/**
 * Maison W x D cases, `floors` étages. door : 'n' | 's' | 'e' | 'w'.
 * roof : 'gable' (toit à deux pentes) | 'flat' | 'none'
 */
function house(gx0, gz0, W, D, floors, style, door, roof = 'gable', opts = {}) {
    if (!free(gx0, gz0, W, D)) return false;
    for (let gx = gx0; gx < gx0 + W; gx++) for (let gz = gz0; gz < gz0 + D; gz++) occupied.add(`${gx}:${gz}`);
    const col = flattenFootprint(gx0, gz0, W, D);
    const roofStyle = opts.roofStyle ?? (style === STYLE.metal ? STYLE.metal : style === STYLE.barn ? STYLE.barn : 10 + Math.floor(rnd() * 3));
    // escalier intérieur : case (gx0, gz0+D-1), rampe vers +x
    const stairX = gx0, stairZ = gz0 + D - 1;
    for (let L = 0; L < floors; L++) {
        for (let gx = gx0; gx < gx0 + W; gx++) for (let gz = gz0; gz < gz0 + D; gz++) {
            if (L > 0 && gx === stairX && gz === stairZ) continue;   // trémie
            if (L === 0 || !opts.open) addPiece('floor', gx, L, gz, 0, 0, style);
        }
        if (L < floors - 1 && W >= 2 && !opts.open) addPiece('stairs', stairX, L, stairZ, 0, 0, style);
        const doorAt = (side, k, len) => L === 0 && side === door && k === Math.floor((len - 1) / 2);
        const variant = (side, k, len) => {
            if (doorAt(side, k, len)) return 1;
            if (opts.bigDoor && L === 0 && side === door) return 1;
            if (opts.allGlass) return 2;        // serre : parois entièrement vitrées
            if (opts.noWindows) return 0;
            return (k + L) % 2 === 0 || len === 1 ? 2 : 0;
        };
        for (let k = 0; k < W; k++) {
            addPiece('wall', gx0 + k, L, gz0, 0, variant('n', k, W), style);
            addPiece('wall', gx0 + k, L, gz0 + D, 0, variant('s', k, W), style);
        }
        for (let k = 0; k < D; k++) {
            addPiece('wall', gx0, L, gz0 + k, 1, variant('w', k, D), style);
            addPiece('wall', gx0 + W, L, gz0 + k, 1, variant('e', k, D), style);
        }
        // cloison intérieure avec une porte (grandes maisons) : une pièce de plus à ouvrir
        if (W >= 3 && D >= 2 && !opts.open) {
            for (let k = 0; k < D; k++) addPiece('wall', gx0 + W - 1, L, gz0 + k, 1, k === Math.floor((D - 1) / 2) ? 1 : 0, opts.innerStyle ?? STYLE.white);
        }
        // coffre et loot à chaque étage
        const cx = L % 2 === 0 ? gx0 + W - 1 : gx0;
        const cz = gz0;
        const [px, pz] = cellCenter(cx, cz);
        const y = col + L * CELL + 0.4;
        if (!opts.noChest || L > 0) chests.push([round2(px + (L % 2 === 0 ? 1.0 : -1.0)), round2(y), round2(pz - 1.0), L % 2 === 0 ? 0 : 0]);
        const [lx, lz] = cellCenter(gx0 + Math.floor(W / 2), gz0 + Math.floor(D / 2));
        loot.push([round2(lx + 0.6), round2(y), round2(lz + 0.4)]);
    }
    if (roof === 'gable' && D <= 3) {
        for (let gx = gx0; gx < gx0 + W; gx++) {
            addPiece('roof', gx, floors, gz0, 1, 1, roofStyle);                 // pente montant vers +z
            if (D === 3) addPiece('floor', gx, floors, gz0 + 1, 0, 0, roofStyle);
            addPiece('roof', gx, floors, gz0 + D - 1, 3, 1, roofStyle);          // pente montant vers -z
        }
    } else if (roof === 'gable' && W <= 3) {
        for (let gz = gz0; gz < gz0 + D; gz++) {
            addPiece('roof', gx0, floors, gz, 0, 1, roofStyle);
            if (W === 3) addPiece('floor', gx0 + 1, floors, gz, 0, 0, roofStyle);
            addPiece('roof', gx0 + W - 1, floors, gz, 2, 1, roofStyle);
        }
    } else if (roof !== 'none') {
        for (let gx = gx0; gx < gx0 + W; gx++) for (let gz = gz0; gz < gz0 + D; gz++) addPiece('floor', gx, floors, gz, 0, 0, roofStyle);
    }
    buildings.push({ gx0, gz0, W, D, floors, style });
    if (!opts.empty) furnish(gx0, gz0, W, D, floors, col, door, opts);
    return true;
}
const round2 = (v) => Math.round(v * 100) / 100;

function poiCell(p) { return [Math.floor(p.x / CELL), Math.floor(p.z / CELL)]; }

// --- Pignons Penchés : la ville
{
    const [cx, cz] = poiCell(P.town);
    const S = STYLE;
    const list = [
        [-1, -10, 3, 3, 4, S.brick, 's', 'flat'],   // la tour
        [-9, -9, 3, 2, 2, S.blue, 's'],
        [5, -9, 2, 2, 2, S.yellow, 's'],
        [9, -8, 3, 2, 1, S.white, 'w'],
        [-11, -3, 2, 3, 2, S.green, 'e'],
        [-11, 3, 2, 2, 1, S.pink, 'e'],
        [9, -2, 2, 3, 2, S.brick, 'w'],
        [9, 4, 3, 2, 2, S.blue, 'w'],
        [-7, 8, 3, 2, 2, S.white, 'n'],
        [-2, 9, 2, 2, 1, S.yellow, 'n'],
        [3, 8, 3, 2, 2, S.green, 'n'],
        [-4, -3, 2, 2, 1, S.pink, 's'],
        [3, -3, 2, 2, 3, S.brick, 'n', 'flat'],
    ];
    for (const [dx, dz, W, D, f, st, door, roof] of list) house(cx + dx, cz + dz, W, D, f, st, door, roof ?? 'gable');
}
// --- Plage Paisible
{
    const [cx, cz] = poiCell(P.beach);
    house(cx - 5, cz - 4, 2, 2, 1, STYLE.blue, 'e');
    house(cx + 1, cz - 6, 2, 2, 2, STYLE.yellow, 's');
    house(cx - 2, cz + 2, 3, 2, 1, STYLE.white, 'n');
    house(cx + 4, cz + 1, 1, 1, 2, STYLE.logs, 'w', 'flat');      // poste de secours
}
// --- Ferme Frisquette
{
    const [cx, cz] = poiCell(P.farm);
    house(cx - 2, cz - 3, 4, 3, 2, STYLE.barn, 's', 'gable', { open: true, bigDoor: true, noWindows: true });
    house(cx + 5, cz - 1, 3, 2, 2, STYLE.white, 'w');
    house(cx - 7, cz + 3, 2, 2, 1, STYLE.logs, 'e');
}
// --- Lac Loot
{
    const [cx, cz] = poiCell(P.lake);
    house(cx - 6, cz - 3, 2, 2, 2, STYLE.green, 's');
    house(cx - 1, cz - 5, 3, 2, 2, STYLE.blue, 's');
    house(cx + 4, cz - 3, 2, 2, 1, STYLE.pink, 's');
}
// --- Usine Usée
{
    const [cx, cz] = poiCell(P.factory);
    house(cx - 4, cz - 4, 5, 4, 2, STYLE.metal, 'w', 'flat', { open: true, bigDoor: true, noWindows: true });
    house(cx + 3, cz - 4, 2, 2, 2, STYLE.brick, 'w');
    for (const [dx, dz] of [[-5, 3], [-2, 3], [1, 3], [4, 2]]) house(cx + dx, cz + dz, 1, 2, 1, STYLE.metal, 'n', 'flat', { noWindows: true, noChest: true });
}
// --- Serres Grises : rangées de serres vitrées, hangar et cabanes (biome « friche »)
{
    const [cx, cz] = poiCell(P.green);
    // trois longues serres parallèles, toutes vitrées, toit en bâtière
    for (let r = 0; r < 3; r++) {
        house(cx - 6 + r * 5, cz - 5, 3, 7, 1, STYLE.white, 'n', 'gable',
            { allGlass: true, open: true, roofStyle: STYLE.white });
    }
    // hangar en tôle et deux cabanes
    house(cx - 7, cz + 4, 4, 3, 1, STYLE.metal, 'n', 'flat', { bigDoor: true, noWindows: true, open: true });
    house(cx + 4, cz + 4, 2, 2, 1, STYLE.logs, 'w');
    house(cx + 7, cz - 2, 2, 2, 2, STYLE.barn, 'w');
}
// --- Marais Moisi : cabanes sur pilotis au bord de l'eau
{
    const [cx, cz] = poiCell(P.swamp);
    house(cx - 4, cz - 3, 2, 2, 1, STYLE.logs, 's');
    house(cx + 1, cz - 4, 3, 2, 2, STYLE.barn, 's');
    house(cx + 4, cz + 2, 2, 2, 1, STYLE.logs, 'n');
    house(cx - 3, cz + 3, 2, 2, 1, STYLE.barn, 'e');
}
// --- Mont Fringant : chalet
{
    const [cx, cz] = poiCell(P.peak);
    house(cx - 1, cz - 1, 2, 2, 1, STYLE.logs, 's');
}
// --- Hameau Huppé
{
    const [cx, cz] = poiCell(P.hamlet);
    house(cx - 5, cz - 3, 2, 2, 2, STYLE.yellow, 'e');
    house(cx + 1, cz - 4, 3, 2, 1, STYLE.white, 's');
    house(cx, cz + 2, 2, 2, 2, STYLE.pink, 'n');
}
// --- Forêt Fourbe : cabane
{
    const [cx, cz] = poiCell(P.forest);
    house(cx - 1, cz - 1, 2, 2, 1, STYLE.logs, 's');
}

// --- Motel Malin : une rangée de chambres + l'accueil
{
    const [cx, cz] = poiCell(P.motel);
    for (let k = 0; k < 5; k++) house(cx - 9 + k * 3, cz - 4, 2, 2, 1, [STYLE.pink, STYLE.white, STYLE.yellow][k % 3], 's', 'flat', { room: 'motel' });
    house(cx + 6, cz + 2, 3, 2, 1, STYLE.blue, 'w', 'gable', { room: 'kitchen' });
    house(cx - 9, cz + 3, 2, 2, 2, STYLE.green, 'e');
}
// --- Port Paumé : entrepôts, phare
{
    const [cx, cz] = poiCell(P.port);
    house(cx - 7, cz - 5, 4, 3, 2, STYLE.metal, 's', 'flat', { open: true, bigDoor: true, noWindows: true });
    house(cx - 1, cz - 5, 4, 3, 1, STYLE.metal, 's', 'flat', { open: true, bigDoor: true, noWindows: true });
    house(cx + 5, cz - 3, 2, 2, 4, STYLE.white, 'w', 'flat');                     // le phare
    house(cx - 6, cz + 2, 2, 2, 1, STYLE.blue, 'n', 'gable', { room: 'kitchen' });
}
// --- Camping Cosy : chalets
{
    const [cx, cz] = poiCell(P.camp);
    house(cx - 5, cz - 3, 2, 2, 1, STYLE.logs, 's', 'gable', { room: 'bed' });
    house(cx + 2, cz - 4, 2, 2, 1, STYLE.logs, 's', 'gable', { room: 'living' });
    house(cx - 2, cz + 3, 3, 2, 1, STYLE.logs, 'n', 'gable', { room: 'kitchen' });
}
// --- Pignons Penchés : la supérette
{
    const [cx, cz] = poiCell(P.town);
    house(cx - 4, cz + 13, 4, 2, 1, STYLE.green, 'n', 'flat', { room: 'shop' });
}

// ------------------------------------------------------------ hauteur et sol finaux
const heightAt = (x, z) => {
    const fx = (x + HALF) / STEP, fz = (z + HALF) / STEP;
    const i = clamp(Math.floor(fx), 0, N - 2), j = clamp(Math.floor(fz), 0, N - 2);
    const u = fx - i, v = fz - j;
    return lerp(lerp(H[idx(i, j)], H[idx(i + 1, j)], u), lerp(H[idx(i, j + 1)], H[idx(i + 1, j + 1)], u), v);
};
const slopeAt = (x, z) => Math.hypot(heightAt(x + 2, z) - heightAt(x - 2, z), heightAt(x, z + 2) - heightAt(x, z - 2)) / 4;

// splat : 0 herbe, 1 herbe sombre (forêt), 2 sable, 3 roche, 4 neige, 5 chemin, 6 champ, 7 dalle (place)
const SPL = new Uint8Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = wx(i), z = wx(j), h = H[idx(i, j)];
    let s = 0;
    const [bio, bw] = biomeWeight(x, z);
    // sol de base du biome (le bruit fait baver les bordures)
    const edge = bw > 0.62 || (bw > 0.5 && fbm(x * 0.05 + 9, z * 0.05 - 4, 2) > 0.1);
    if (edge) {
        if (bio === 'foret') s = 1;
        else if (bio === 'marais') s = 9;
        else if (bio === 'steppe') s = 11;
        else if (bio === 'friche') s = 10;
    }
    const fd = Math.hypot(x - FOREST.x, z - FOREST.z) / FOREST.r;
    if (fd < 1 && fbm(x * 0.03, z * 0.03, 2) > -0.3) s = 1;
    if (bio === 'plaine' && fbm(x * 0.008 + 40, z * 0.008, 3) > 0.25) s = 1;
    const sl = slopeAt(x, z);
    // pied de montagne : herbe rase et froide, puis roche, puis neige
    if (bio === 'mont' && bw > 0.55 && h > 12) s = 8;
    if (h > 34) s = 4;
    else if (sl > 0.75 || h > 24) s = 3;
    if (h < 2.2) s = bio === 'marais' ? 9 : 2;
    let rd = Infinity;
    for (const r of ROADS) rd = Math.min(rd, distToPolyline(x, z, r));
    if (rd < 3.6 && h > 0.5) s = 5;
    const farm = P.farm;
    if (Math.abs(x - (farm.x + 70)) < 34 && Math.abs(z - (farm.z + 14)) < 40 && h > 2) s = 6;
    for (const p of [P.town, P.factory]) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.55) s = 7;
    SPL[idx(i, j)] = s;
}

// ------------------------------------------------------------ arbres, rochers, voitures (récoltables)
// nœud : [type, x, z, échelle, variante]   type : 'tree' | 'rock' | 'car'
const nodes = [];
const nearBuilding = (x, z, m) => {
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let a = -m; a <= m; a++) for (let b = -m; b <= m; b++) if (occupied.has(`${gx + a}:${gz + b}`)) return true;
    return false;
};
const nodeOk = (x, z, minD) => nodes.every((n) => Math.hypot(n[1] - x, n[2] - z) > minD);
const roadDist = (x, z) => Math.min(...ROADS.map((r) => distToPolyline(x, z, r)));
for (let gz = -HALF + 6; gz < HALF - 6; gz += 7) for (let gx = -HALF + 6; gx < HALF - 6; gx += 7) {
    const x = gx + rr(-3, 3), z = gz + rr(-3, 3);
    const h = heightAt(x, z);
    if (h < 2.4 || h > 33 || slopeAt(x, z) > 0.7) continue;
    if (nearBuilding(x, z, 1) || roadDist(x, z) < 6) continue;
    let pois = false;
    for (const p of POIS) if (p.id !== 'forest' && Math.hypot(x - p.x, z - p.z) < p.r * 0.85) pois = true;
    if (pois) continue;
    const fd = Math.hypot(x - FOREST.x, z - FOREST.z) / FOREST.r;
    let dens = 0.07 + 0.25 * smooth(0.1, 0.5, fbm(x * 0.008 + 40, z * 0.008, 3) + 0.25);
    if (fd < 1) dens = 0.75 * smooth(1, 0.5, fd) + 0.1;
    if (Math.hypot(x - MOUNT.x, z - MOUNT.z) < MOUNT.r) dens *= 0.8;
    // chaque biome a sa végétation : 0 conifère, 1 feuillu, 2 arbre mort
    const [bio, bw] = biomeWeight(x, z);
    let kind = h > 14 || rnd() < 0.45 ? 0 : 1;
    if (bio === 'foret') { dens = Math.max(dens, 0.55 * bw); kind = rnd() < 0.85 ? 0 : 1; }
    else if (bio === 'mont') { dens *= 0.75; kind = 0; }
    else if (bio === 'marais') { dens = 0.1 + 0.22 * bw; kind = rnd() < 0.7 ? 2 : 1; }
    else if (bio === 'steppe') { dens *= 0.18; kind = 1; }
    else if (bio === 'friche') { dens = 0.08 + 0.14 * bw; kind = rnd() < 0.75 ? 2 : 0; }
    const scale = kind === 2 ? rr(0.8, 1.2) : rr(0.85, 1.35);
    if (rnd() < dens && nodeOk(x, z, 3.2)) nodes.push(['tree', round2(x), round2(z), round2(scale), kind]);
}
for (let k = 0; k < 420; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 400;
    let x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (rnd() < 0.4) { const b = rnd() * Math.PI * 2, e = Math.sqrt(rnd()) * MOUNT.r; x = MOUNT.x + Math.cos(b) * e; z = MOUNT.z + Math.sin(b) * e; }
    const h = heightAt(x, z);
    if (h < 2.0 || nearBuilding(x, z, 1) || roadDist(x, z) < 4 || !nodeOk(x, z, 4)) continue;
    let inPoi = false;
    for (const p of POIS) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.7) inPoi = true;
    if (inPoi) continue;
    nodes.push(['rock', round2(x), round2(z), round2(rr(0.7, 1.6)), Math.floor(rnd() * 3)]);
}
// voitures : sur les routes près des lieux, et dans les villes
for (const p of [P.town, P.town, P.town, P.farm, P.factory, P.factory, P.hamlet, P.lake, P.beach]) {
    for (let t = 0; t < 30; t++) {
        const a = rnd() * Math.PI * 2, d = rr(8, p.r * 0.9);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (nearBuilding(x, z, 1) || !nodeOk(x, z, 6) || heightAt(x, z) < 1.5) continue;
        nodes.push(['car', round2(x), round2(z), round2(rnd() * Math.PI * 2), Math.floor(rnd() * 5)]);
        break;
    }
}
// coffres et loot extérieurs (forêt, camps, montagne, rochers)
for (let k = 0; k < 26; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 380;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = heightAt(x, z);
    if (h < 2 || nearBuilding(x, z, 1) || !nodeOk(x, z, 2.5)) continue;
    chests.push([round2(x), round2(h), round2(z), round2(rnd() * Math.PI * 2)]);
}
for (const p of POIS) {
    for (let k = 0; k < 7; k++) {
        const a = rnd() * Math.PI * 2, d = rr(4, p.r);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (nearBuilding(x, z, 0) || heightAt(x, z) < 1.5) continue;
        loot.push([round2(x), round2(heightAt(x, z)), round2(z)]);
    }
}
{ // camp de la forêt
    const c = P.forest;
    chests.push([round2(c.x + 9), round2(heightAt(c.x + 9, c.z + 6)), round2(c.z + 6), 1.2]);
}

// caisses de munitions et coffres supplémentaires en extérieur
for (let k = 0; k < 70; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 390;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = heightAt(x, z);
    if (h < 2 || slopeAt(x, z) > 0.5 || nearBuilding(x, z, 1) || !nodeOk(x, z, 2.5)) continue;
    if (k % 3 === 0) chests.push([round2(x), round2(h), round2(z), round2(rnd() * Math.PI * 2)]);
    else ammo.push([round2(x), round2(h), round2(z), round2(rnd() * Math.PI * 2)]);
}
for (const p of POIS) {
    for (let k = 0; k < 4; k++) {
        const a = rnd() * Math.PI * 2, d = rr(6, p.r * 0.9);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (nearBuilding(x, z, 0) || heightAt(x, z) < 1.5 || !nodeOk(x, z, 2.5)) continue;
        ammo.push([round2(x), round2(heightAt(x, z)), round2(z), round2(rnd() * Math.PI * 2)]);
    }
}

// décor des villes : lampadaires, bancs, bennes, bouches à incendie
const cityProp = (kind, x, z, rot) => {
    if (nearBuilding(x, z, 0) || heightAt(x, z) < 1.2) return;
    if (!nodeOk(x, z, 2) || props.some((q) => Math.hypot(q[0] - x, q[2] - z) < 2.2)) return;
    prop(kind, x, heightAt(x, z), z, rot);
};
for (const p of [P.town, P.hamlet, P.motel, P.port, P.lake, P.factory]) {
    for (let k = 0; k < (p.id === 'town' ? 26 : 10); k++) {
        const a = rnd() * Math.PI * 2, d = rr(6, p.r * 0.85);
        const kind = ['streetlight', 'streetlight', 'bench', 'dumpster', 'hydrant', 'boxes'][Math.floor(rnd() * 6)];
        cityProp(kind, p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, rnd() * Math.PI * 2);
    }
}
// château d'eau (repère) près de la ferme et du port
for (const [x, z] of [[P.farm.x + 34, P.farm.z - 30], [P.port.x + 30, P.port.z - 30]]) cityProp('watertower', x, z, 0);

// plateformes de saut : places et collines
const pads = [];
for (const p of [P.town, P.factory, P.hamlet, P.motel, P.port, P.camp, P.farm, P.lake]) {
    for (let t = 0; t < 20; t++) {
        const a = rnd() * Math.PI * 2, d = rr(4, p.r * 0.5);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (nearBuilding(x, z, 1) || slopeAt(x, z) > 0.3 || !nodeOk(x, z, 3) || props.some((q) => Math.hypot(q[0] - x, q[2] - z) < 3)) continue;
        pads.push([round2(x), round2(heightAt(x, z) + 0.05), round2(z)]);
        break;
    }
}
for (let k = 0; k < 6; k++) {
    const a = rnd() * Math.PI * 2, d = rr(80, 360);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (heightAt(x, z) < 3 || slopeAt(x, z) > 0.3 || nearBuilding(x, z, 2) || !nodeOk(x, z, 3)) continue;
    pads.push([round2(x), round2(heightAt(x, z) + 0.05), round2(z)]);
}

// tyrolienne : câble au-dessus du relief, poteaux aux deux bouts
const zips = [];
function zipline(ax, az, bx0, bz0) {
    // poteaux de 4,4 m : le câble reste attrapable depuis le sol aux deux bouts
    const clear = (bx, bz) => {
        const ya = heightAt(ax, az) + 4.4;
        const yb = heightAt(bx, bz) + 4.4;
        if (Math.min(heightAt(ax, az), heightAt(bx, bz)) < 1.5) return null;
        for (let t = 0.03; t < 0.98; t += 0.015) {
            const x = lerp(ax, bx, t), z = lerp(az, bz, t);
            if (lerp(ya, yb, t) - 2.6 < Math.max(heightAt(x, z), WATER) + 0.5) return null;
            if (nearBuilding(x, z, 1)) return null;     // pas à travers les maisons
        }
        return [[round2(ax), round2(ya), round2(az)], [round2(bx), round2(yb), round2(bz)]];
    };
    for (let f = 1; f >= 0.45; f -= 0.05) {
        const z = clear(lerp(ax, bx0, f), lerp(az, bz0, f));
        if (z && Math.hypot(bx0 - ax, bz0 - az) * f > 40) { zips.push(z); return true; }
    }
    return false;
}
// candidats : descentes depuis les hauteurs et traversées de vallées
const ZIP_TRIES = [
    [P.peak.x - 6, P.peak.z + 8, P.peak.x - 110, P.peak.z + 120], [P.peak.x + 4, P.peak.z + 10, P.peak.x + 40, P.peak.z + 150],
    [P.peak.x - 10, P.peak.z - 4, P.peak.x - 150, P.peak.z - 10],
    [P.town.x - 30, P.town.z - 60, P.hamlet.x - 40, P.hamlet.z - 10], [P.lake.x + 30, P.lake.z - 40, -10, 250],
    [P.lake.x - 30, P.lake.z + 10, -100, 230], [P.port.x + 20, P.port.z - 12, P.port.x + 95, P.port.z - 95],
    [P.forest.x + 30, P.forest.z - 30, P.farm.x - 10, P.farm.z + 70], [P.camp.x + 20, P.camp.z + 30, P.camp.x + 120, P.camp.z + 110],
    [P.motel.x + 30, P.motel.z - 20, P.town.x - 70, P.town.z + 20], [P.factory.x - 30, P.factory.z - 20, P.hamlet.x + 40, P.hamlet.z + 40],
    [P.farm.x + 40, P.farm.z + 40, P.farm.x + 140, P.farm.z + 120], [P.beach.x + 30, P.beach.z - 30, P.beach.x + 120, P.beach.z - 70],
    [P.hamlet.x + 30, P.hamlet.z + 40, P.factory.x - 60, P.factory.z - 40], [P.forest.x + 40, P.forest.z + 60, P.forest.x + 150, P.forest.z + 90],
    [P.camp.x - 30, P.camp.z + 20, P.camp.x - 140, P.camp.z + 60],
];
for (const [ax, az, bx, bz] of ZIP_TRIES) if (zips.length < 8) zipline(ax, az, bx, bz);

// véhicules garés : sur les routes près des lieux
const vehicles = [];
const KINDS = ['car_sedan', 'car_taxi', 'car_police', 'car_hatchback', 'car_wagon'];
for (const p of [P.town, P.town, P.town, P.motel, P.motel, P.farm, P.factory, P.hamlet, P.lake, P.port, P.camp, P.beach, P.factory, P.port]) {
    for (let t = 0; t < 40; t++) {
        const road = ROADS[Math.floor(rnd() * ROADS.length)];
        const i = Math.floor(rnd() * (road.length - 1));
        const [x, z] = road[i];
        if (Math.hypot(x - p.x, z - p.z) > p.r + 30) continue;
        if (nearBuilding(x, z, 1) || heightAt(x, z) < 1.5 || !nodeOk(x, z, 5) || vehicles.some((v) => Math.hypot(v[1] - x, v[2] - z) < 9)) continue;
        if (props.some((q) => Math.hypot(q[0] - x, q[2] - z) < 4)) continue;
        const [x2, z2] = road[i + 1];
        const yaw = Math.atan2(-(x2 - x), -(z2 - z)) + (rnd() < 0.5 ? Math.PI : 0);
        vehicles.push([KINDS[Math.floor(rnd() * KINDS.length)], round2(x + 2.2 * Math.cos(yaw)), round2(z - 2.2 * Math.sin(yaw)), round2(yaw)]);
        break;
    }
}

// ------------------------------------------------------------ lobby de départ
// grande plateforme au-dessus de la mer : tout le monde y attend la montgolfière ;
// plateforme centrale à escalader, coffres qui se remplissent, armes au sol (lance-roquettes…)
const lobby = (() => {
    const N2 = 9;                          // 9 x 9 cases = 36 m
    const DECK = 26;                       // altitude du pont (base des sols)
    for (let k = 0; k < 72; k++) {
        const a = Math.PI * 0.75 + (k * Math.PI * 2) / 72;
        const cx = Math.cos(a) * 438, cz = Math.sin(a) * 438;
        const gx0 = Math.floor(cx / CELL) - 4, gz0 = Math.floor(cz / CELL) - 4;
        let ok = true;
        for (let gx = gx0 - 2; gx < gx0 + N2 + 2 && ok; gx++) for (let gz = gz0 - 2; gz < gz0 + N2 + 2 && ok; gz++) {
            const [x, z] = cellCenter(gx, gz);
            if (heightAt(x, z) > -4 || Math.hypot(x, z) > 470) ok = false;
        }
        if (!ok) continue;
        const S = STYLE;
        for (let gx = gx0; gx < gx0 + N2; gx++) for (let gz = gz0; gz < gz0 + N2; gz++) {
            cols[`${gx}:${gz}`] = DECK;
            addPiece('floor', gx, 0, gz, 0, 0, (gx + gz) % 2 === 0 ? S.white : S.metal);
        }
        // garde-corps (fenêtres : on peut sauter par-dessus... et tomber dans l'eau)
        for (let k2 = 0; k2 < N2; k2++) {
            addPiece('wall', gx0 + k2, 0, gz0, 0, 2, S.blue);
            addPiece('wall', gx0 + k2, 0, gz0 + N2, 0, 2, S.blue);
            addPiece('wall', gx0, 0, gz0 + k2, 1, 2, S.blue);
            addPiece('wall', gx0 + N2, 0, gz0 + k2, 1, 2, S.blue);
        }
        // plateforme centrale (3 x 3, un étage plus haut) + 4 rampes
        const mx = gx0 + 4, mz = gz0 + 4;
        for (let gx = mx - 1; gx <= mx + 1; gx++) for (let gz = mz - 1; gz <= mz + 1; gz++) addPiece('floor', gx, 1, gz, 0, 0, S.yellow);
        addPiece('stairs', mx, 0, mz - 2, 1, 0, S.yellow);   // monte vers +z
        addPiece('stairs', mx, 0, mz + 2, 3, 0, S.yellow);   // monte vers -z
        addPiece('stairs', mx - 2, 0, mz, 0, 0, S.yellow);   // monte vers +x
        addPiece('stairs', mx + 2, 0, mz, 2, 0, S.yellow);   // monte vers -x
        const y0 = DECK + 0.4, y1 = DECK + CELL + 0.4;
        const [ccx, ccz] = cellCenter(mx, mz);
        const lchests = [];
        const lloot = [];
        const around = [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, -3.4], [0, 3.4], [-3.4, 0], [3.4, 0]];
        around.forEach(([dx, dz], i) => {
            const x = ccx + dx * CELL * 0.95, z = ccz + dz * CELL * 0.95;
            lchests.push([round2(x), round2(y0), round2(z), round2(Math.atan2(-dx, -dz) + Math.PI), i % 3 === 2 ? 1 : 0]);
        });
        // sur la plateforme centrale : 2 coffres
        lchests.push([round2(ccx - 2.5), round2(y1), round2(ccz), Math.PI / 2, 0], [round2(ccx + 2.5), round2(y1), round2(ccz), -Math.PI / 2, 0]);
        // armes au sol, réapparaissent pendant l'attente
        const guns = ['rocket', 'rocket', 'rocket', 'ar', 'pump', 'rocket', 'sniper', 'smg', 'rocket', 'ar', 'pad', 'rocket'];
        guns.forEach((g, i) => {
            const a2 = (i / guns.length) * Math.PI * 2;
            const r = 11 + (i % 2) * 3;
            lloot.push([g, round2(ccx + Math.cos(a2) * r), round2(y0), round2(ccz + Math.sin(a2) * r)]);
        });
        lloot.push(['rocket', round2(ccx), round2(y1), round2(ccz + 2.5)]);
        const lpads = [[round2(ccx - 12), round2(y0 + 0.05), round2(ccz + 12)], [round2(ccx + 12), round2(y0 + 0.05), round2(ccz - 12)],
            [round2(ccx), round2(y1 + 0.05), round2(ccz - 1)]];
        for (const [x, z, kind] of [[ccx - 15, ccz - 6, 'bench'], [ccx + 15, ccz + 6, 'bench'], [ccx - 15, ccz + 15, 'streetlight'], [ccx + 15, ccz - 15, 'streetlight'], [ccx + 15, ccz + 15, 'streetlight'], [ccx - 15, ccz - 15, 'streetlight']]) {
            prop(kind, x, y0, z, Math.atan2(ccx - x, ccz - z));
        }
        return { x: round2(ccx), z: round2(ccz), y: y0, half: (N2 * CELL) / 2 - 1.5, chests: lchests, loot: lloot, pads: lpads };
    }
    throw new Error('pas de place pour le lobby');
})();

// ------------------------------------------------------------ export
const h16 = new Int16Array(N * N);
for (let k = 0; k < N * N; k++) h16[k] = clamp(Math.round(H[k] * 10), -32000, 32000);
const b64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
const map = {
    v: 1,
    size: SIZE, step: STEP, n: N, water: WATER,
    h: b64(h16),
    splat: b64(SPL),
    pois: POIS.map(({ name, x, z, r }) => ({ name, x, z, r })),
    roads: ROADS,
    river: RIVER,
    cols,
    pieces,
    nodes: [...nodes, ...props.map(([x, y, z, rot, i]) => ['prop', x, z, rot, i, y])],
    chests,
    loot,
    ammo,
    deco,
    pads: [...pads, ...lobby.pads],
    zips,
    vehicles,
    lobby,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(map));
console.log(`carte : ${(fs.statSync(OUT).size / 1024).toFixed(0)} Ko — ${pieces.length} pièces, ${buildings.length} bâtiments, ${nodes.length} nœuds (${nodes.filter((n) => n[0] === 'tree').length} arbres), ${props.length} meubles, ${deco.length} déco, ${chests.length} coffres, ${ammo.length} caisses de munitions, ${loot.length} points de loot, ${pads.length} plateformes, ${zips.length} tyroliennes, ${vehicles.length} véhicules`);

// ------------------------------------------------------------ aperçu
if (process.argv[2]) {
    const S = 750;
    const img = Buffer.alloc(S * S * 3);
    const COL = [[96, 170, 70], [52, 120, 52], [226, 210, 150], [128, 126, 122], [240, 244, 250], [170, 140, 96], [196, 176, 80], [150, 150, 150]];
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const x = (px / S) * SIZE - HALF, z = (py / S) * SIZE - HALF;
        const h = heightAt(x, z);
        const fi = Math.round((x + HALF) / STEP), fj = Math.round((z + HALF) / STEP);
        let c = h < WATER ? [40, 110 + Math.max(-60, h * 4), 170] : COL[SPL[idx(clamp(fi, 0, N - 1), clamp(fj, 0, N - 1))]];
        const shade = clamp(1 + (heightAt(x + 2, z + 2) - h) * -0.25, 0.6, 1.3);
        const o = (py * S + px) * 3;
        img[o] = clamp(c[0] * shade, 0, 255); img[o + 1] = clamp(c[1] * shade, 0, 255); img[o + 2] = clamp(c[2] * shade, 0, 255);
    }
    const dot = (x, z, rgb, r = 1) => {
        const px = Math.round(((x + HALF) / SIZE) * S), py = Math.round(((z + HALF) / SIZE) * S);
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
            const X = px + a, Y = py + b;
            if (X < 0 || Y < 0 || X >= S || Y >= S) continue;
            const o = (Y * S + X) * 3; img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2];
        }
    };
    for (const n of nodes) dot(n[1], n[2], n[0] === 'tree' ? [20, 70, 20] : n[0] === 'rock' ? [90, 90, 90] : [220, 40, 40], n[0] === 'tree' ? 1 : 1);
    for (const pc of pieces) if (pc[0] === 'floor' && pc[2] === 0) dot((pc[1] + 0.5) * CELL, (pc[3] + 0.5) * CELL, [200, 90, 60], 2);
    for (const c of chests) dot(c[0], c[2], [255, 210, 0], 2);
    for (const l of loot) dot(l[0], l[2], [0, 220, 255], 1);
    fs.writeFileSync(process.argv[2], Buffer.concat([Buffer.from(`P6 ${S} ${S} 255\n`), img]));
}
