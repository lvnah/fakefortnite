// =====================================================================
// shared.js : miroir EXACT de server/engine.php.
// Relief (carte island.json), pièces de construction, collisions et
// physique du joueur doivent rester identiques côté client et serveur.
// Vérifié par tools/parity.mjs.
// =====================================================================

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const MAP_RADIUS = 500;
export const PLAY_RADIUS = 480;
export const WATER_Y = -1.5;
export const CELL = 4;
export const FLOOR_THICK = 0.4;
export const WALL_THICK = 0.4;
export const ROOF_H = 2;               // hauteur d'un cône / d'une pente de toit
export const GRAVITY = 30;
export const WALK_SPEED = 6.2;
export const SPRINT_SPEED = 8.6;
export const TAC_SPEED = 11.2;         // sprint tactique (double appui sur Sprinter)
export const TAC_TIME = 2.2;           // durée maximale du sprint tactique
export const TAC_RECHARGE = 5.0;       // temps pour récupérer toute l'endurance
export const CROUCH_SPEED = 2.9;
export const ADS_FACTOR = 0.55;
export const BACK_FACTOR = 0.78;       // on recule moins vite qu'on avance
export const SIDE_FACTOR = 0.88;       // pas chassés un peu plus lents
export const SWIM_SPEED = 4;
export const SLIDE_SPEED = 12.5;
export const SLIDE_TIME = 0.75;
export const SLIDE_CD = 1.1;           // délai avant de pouvoir reglisser
export const SLIDE_MIN_SPEED = 5.5;    // il faut courir pour déclencher une glissade
export const SLIDE_JUMP = 0.82;        // saut pour annuler une glissade (fraction du saut normal)
export const LAND_SLOW_VY = 13;        // atterrissage appuyé : au-delà, on se réceptionne
export const LAND_SLOW_TIME = 0.22;
export const LAND_SLOW_K = 0.55;
export const JUMP_VELOCITY = 8.6;
export const SKY_FALL = 30;            // chute libre
export const SKY_DIVE = 44;            // chute libre en piqué (avancer)
export const SKY_SPEED = 16;
export const SKY_DIVE_SPEED = 22;
export const GLIDER_FALL = 4.5;
export const GLIDER_SPEED = 17;
export const AUTO_GLIDER = 50;         // déploiement automatique du planeur (m au-dessus du sol)
export const SWIM_Y = WATER_Y - 1.25;  // hauteur des pieds quand on nage
export const PLAYER_R = 0.35;
export const PLAYER_H = 1.9;
export const STEP_UP = 0.6;
export const INTERACT_REACH = 3.2;
export const MATERIAL_HP = { wood: 150, stone: 300, metal: 500 };
export const ACCEL_GROUND = 36;        // accélération au sol
export const ACCEL_TURN = 22;          // changement de direction : un peu d'inertie (plus réaliste)
export const DECEL_GROUND = 44;        // freinage au sol
export const ACCEL_AIR = 9;            // contrôle en l'air : on corrige sa trajectoire, sans voler
export const ACCEL_SKY = 3.2;          // contrôle en chute libre / planeur
export const COYOTE_TIME = 0.12;       // on peut encore sauter 0,12 s après avoir quitté le bord
export const JUMP_BUFFER = 0.15;       // un saut demandé juste avant d'atterrir part à l'atterrissage
export const SLIDE_TURN = 3.4;         // on peut orienter sa glissade
export const SLIDE_MIN = 0.3;          // vitesse minimale de glissade (fraction) avant de se relever
export const SNAP_DOWN = 0.75;         // colle au sol dans les descentes
// rétablissement : on se hisse sur un rebord compris entre ces hauteurs
export const MANTLE_MIN = 0.62;
export const MANTLE_MAX = 1.7;
export const MANTLE_REACH = 0.85;
export const MANTLE_TIME = 0.42;       // durée de la montée
export const PAD_R = 1.3;              // plateforme de saut
export const PAD_VY = 36;
export const ZIP_SPEED = 18;           // tyrolienne
export const ZIP_HANG = 2.15;
export const CAR_SPEED = 15;           // véhicules : vitesse plus réaliste
export const CAR_REVERSE = 6;
export const CAR_ACCEL = 6.5;
export const CAR_BRAKE = 17;
export const CAR_DRAG = 3.2;
export const CAR_TURN = 1.55;
export const CAR_R = 1.0;
export const CAR_AXLE = 1.25;
export const CAR_H = 1.6;

/** Meubles et objets du décor qui bloquent (clé, rayon, hauteur). Index = « var » du nœud. */
export const PROPS = [
    ['couch', 0.7, 0.9], ['armchair', 0.6, 0.9], ['bed2', 1.0, 0.75], ['bed1', 0.7, 0.75],
    ['cabinet', 0.6, 1.4], ['chair', 0.3, 0.95], ['lamp', 0.25, 1.9], ['table', 0.8, 0.75],
    ['tablelow', 0.6, 0.4], ['cactus', 0.3, 0.6], ['fridge', 0.7, 1.9], ['counter', 0.7, 1.0],
    ['sink', 0.7, 1.0], ['rtable', 0.9, 0.8], ['kchair', 0.3, 0.9], ['crates', 0.65, 0.7],
    ['dumpster', 1.0, 1.5], ['streetlight', 0.15, 4.4], ['hydrant', 0.25, 1.0], ['watertower', 2.6, 10.5],
    ['boxes', 0.45, 0.8], ['bench', 0.5, 0.5], ['shelf', 0.6, 1.4],
];

// ------------------------------------------------------------ relief (carte des hauteurs)

const MAP = { n: 0, step: 4, half: 500, h: null, splat: null };

/** Charge island.json (déjà décodé en objet). */
export function setMap(map) {
    const bin = atob(map.h);
    const n = map.n;
    const h = new Float64Array(n * n);
    for (let k = 0; k < n * n; k++) {
        let v = bin.charCodeAt(2 * k) | (bin.charCodeAt(2 * k + 1) << 8);
        if (v >= 32768) v -= 65536;
        h[k] = v / 10;
    }
    const sb = atob(map.splat);
    const splat = new Uint8Array(n * n);
    for (let k = 0; k < n * n; k++) splat[k] = sb.charCodeAt(k);
    MAP.n = n;
    MAP.step = map.step;
    MAP.half = map.size / 2;
    MAP.h = h;
    MAP.h0 = h.slice();
    MAP.splat = splat;
}

export function mapInfo() {
    return MAP;
}

/** Altitude du sol (interpolation bilinéaire). Identique à terrainHeight() de engine.php. */
export const CRATER_R = 9;
export const CRATER_D = 4;

/** Remet le relief d'origine (début de partie), avant d'appliquer les cratères reçus. */
export function resetTerrain() {
    if (MAP.h0) MAP.h.set(MAP.h0);
}

/**
 * Cratère de grenade : même calcul que applyCrater() de engine.php.
 * Retourne les indices modifiés (pour mettre à jour le maillage).
 */
export function applyCrater(x, z, y) {
    const n = MAP.n;
    const step = MAP.step;
    const half = MAP.half;
    const h = MAP.h;
    const R = CRATER_R;
    const i0 = Math.max(0, Math.floor((x - R + half) / step));
    const i1 = Math.min(n - 1, Math.ceil((x + R + half) / step));
    const j0 = Math.max(0, Math.floor((z - R + half) / step));
    const j1 = Math.min(n - 1, Math.ceil((z + R + half) / step));
    const changed = [];
    for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
            const dx = i * step - half - x;
            const dz = j * step - half - z;
            const d2 = dx * dx + dz * dz;
            if (d2 >= R * R) continue;
            const k = 1 - d2 / (R * R);
            const target = Math.max(-6, y - CRATER_D * k);
            const idx = j * n + i;
            if (h[idx] > target) {
                h[idx] = target;
                changed.push(idx);
            }
        }
    }
    return changed;
}

export function terrainHeight(x, z) {
    const n = MAP.n;
    if (n === 0) return 0;
    const fx = (x + MAP.half) / MAP.step;
    const fz = (z + MAP.half) / MAP.step;
    if (fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return -12;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i > n - 2) i = n - 2;
    if (j > n - 2) j = n - 2;
    const u = fx - i;
    const v = fz - j;
    const h = MAP.h;
    const a = h[j * n + i];
    const b = h[j * n + i + 1];
    const c = h[(j + 1) * n + i];
    const d = h[(j + 1) * n + i + 1];
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}

/** Sol « praticable » : relief ou surface de l'eau quand c'est profond (nage). */
export function groundOrWater(x, z) {
    const t = terrainHeight(x, z);
    return t < SWIM_Y ? SWIM_Y : t;
}

/** Arrondi PHP (demi vers l'extérieur de zéro), pour coller à round() côté serveur. */
export function phpRound(v) {
    return v < 0 ? -Math.round(-v) : Math.round(v);
}

/** Altitude de fondation d'une colonne construite sur le terrain. */
export function snapColumn(x, z) {
    return Math.max(phpRound(terrainHeight(x, z) * 2) / 2, -1);
}

/**
 * Altitude de fondation d'une case : la sienne si elle existe, sinon celle d'une case voisine
 * déjà construite (les constructions restent alignées, les rampes s'enchaînent), sinon le relief.
 */
export function columnOf(store, gx, gz) {
    const own = store.cols.get(`${gx}:${gz}`);
    if (own !== undefined) return own;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const v = store.cols.get(`${gx + dx}:${gz + dz}`);
        if (v !== undefined) return v;
    }
    return snapColumn((gx + 0.5) * CELL, (gz + 0.5) * CELL);
}

// ------------------------------------------------------------ pièces et obstacles

export const NODE_SHAPES = {
    tree: { r: 0.55, h: 9 },
    rock: { r: 1.25, h: 1.7 },
    car: { r: 1.7, h: 1.6 },
    veh: { r: 1.05, h: 1.7 },
};

/** Forme d'un nœud : arbre, rocher, épave, meuble (prop), véhicule garé (veh). */
export function nodeShape(k, s, v) {
    if (k === 'prop') {
        const pr = PROPS[v] ?? PROPS[0];
        return { r: pr[1], h: pr[2] };
    }
    const sh = NODE_SHAPES[k] ?? NODE_SHAPES.rock;
    const sc = k === 'rock' ? s : 1;
    return { r: sh.r * sc, h: sh.h * sc };
}

export class PieceStore {
    constructor() {
        this.buildings = new Map(); // clé -> pièce
        this.cells = new Map();     // "gx:gz" -> [clés]
        this.cols = new Map();      // "gx:gz" -> altitude de fondation
        this.nodes = new Map();     // id -> { id, k, x, z, y, r, h }
        this.ncells = new Map();    // "gx:gz" -> [ids]
        this.pads = new Map();      // id -> { id, x, y, z }
        this.zips = new Map();      // id -> { id, a:[x,y,z], b:[x,y,z], len }
    }

    addPad(id, x, y, z) {
        this.pads.set(id, { id, x, y, z });
    }

    addZip(id, a, b) {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        this.zips.set(id, { id, a, b, len });
    }

    static key(type, gx, gy, gz, rot) {
        return `${type}:${gx}:${gy}:${gz}:${rot}`;
    }

    static ck(gx, gz) {
        return `${gx}:${gz}`;
    }

    load(list, cols) {
        this.buildings.clear();
        this.cells.clear();
        this.cols.clear();
        for (const [k, v] of Object.entries(cols || {})) this.cols.set(k, v);
        for (const pc of list) this.add(pc);
    }

    add(pc) {
        const key = pc.key ?? PieceStore.key(pc.type, pc.gx, pc.gy, pc.gz, pc.rot);
        pc.key = key;
        if (this.buildings.has(key)) this.remove(key);
        this.buildings.set(key, pc);
        const ck = PieceStore.ck(pc.gx, pc.gz);
        if (!this.cells.has(ck)) this.cells.set(ck, []);
        this.cells.get(ck).push(key);
        return pc;
    }

    remove(key) {
        const pc = this.buildings.get(key);
        if (!pc) return null;
        this.buildings.delete(key);
        const ck = PieceStore.ck(pc.gx, pc.gz);
        const rest = (this.cells.get(ck) || []).filter((k) => k !== key);
        if (rest.length) this.cells.set(ck, rest);
        else this.cells.delete(ck);
        return pc;
    }

    has(key) {
        return this.buildings.has(key);
    }

    inCell(gx, gz) {
        return (this.cells.get(PieceStore.ck(gx, gz)) || []).map((k) => this.buildings.get(k));
    }

    hasPiece(gx, gy, gz, types) {
        return this.inCell(gx, gz).some((p) => p.gy === gy && types.includes(p.type));
    }

    hasType(gx, gy, gz, type) {
        return this.inCell(gx, gz).some((p) => p.gy === gy && p.type === type);
    }

    nearby(x, z) {
        const gx = Math.floor(x / CELL);
        const gz = Math.floor(z / CELL);
        const out = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) out.push(...this.inCell(gx + dx, gz + dz));
        }
        return out;
    }

    // --- arbres, rochers, voitures
    addNode(n) {
        const sh = nodeShape(n.k, n.s, n.v ?? n.var ?? 0);
        const node = { id: n.id, k: n.k, x: n.x, z: n.z, y: n.y ?? terrainHeight(n.x, n.z), r: sh.r, h: sh.h };
        this.nodes.set(n.id, node);
        const g0 = Math.floor((n.x - node.r) / CELL);
        const g1 = Math.floor((n.x + node.r) / CELL);
        const h0 = Math.floor((n.z - node.r) / CELL);
        const h1 = Math.floor((n.z + node.r) / CELL);
        for (let gx = g0; gx <= g1; gx++) {
            for (let gz = h0; gz <= h1; gz++) {
                const ck = PieceStore.ck(gx, gz);
                if (!this.ncells.has(ck)) this.ncells.set(ck, []);
                this.ncells.get(ck).push(n.id);
            }
        }
        return node;
    }

    removeNode(id) {
        const n = this.nodes.get(id);
        if (!n) return;
        this.nodes.delete(id);
        for (const [ck, ids] of this.ncells) {
            const i = ids.indexOf(id);
            if (i >= 0) ids.splice(i, 1);
            if (!ids.length) this.ncells.delete(ck);
        }
    }

    nodesNear(x, z) {
        const gx = Math.floor(x / CELL);
        const gz = Math.floor(z / CELL);
        const out = [];
        const seen = new Set();
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                for (const id of this.ncells.get(PieceStore.ck(gx + dx, gz + dz)) || []) {
                    if (seen.has(id)) continue;
                    seen.add(id);
                    out.push(this.nodes.get(id));
                }
            }
        }
        return out;
    }
}

/** Boîtes de collision d'une pièce : [minX, minY, minZ, maxX, maxY, maxZ][]. */
// ------------------------------------------------------------ édition (cases à la Fortnite)
/** Mur : 3 colonnes x 3 rangées de cases (bornes en m). Bit de la case = rangée * 3 + colonne. */
export const WALL_X = [0, 1.2, 2.8, 4];
export const WALL_Y = [0, 1.0, 2.6, 4];
export const DOOR_MASK = 18;          // colonne du milieu, 2 cases du bas : une porte
/** Sol : 2 x 2 cases de 2 m. Bit = j * 2 + i (i le long de x, j le long de z). */

export function isDoor(pc) {
    return pc.type === 'wall' && (pc.e != null ? pc.e === DOOR_MASK : pc.v === 1);
}

/** Segments [a0, a1, y0, y1] (le long du mur) d'un mur, porte fermée comprise. */
export function wallSegs(pc) {
    const C = CELL;
    if (pc.e == null) {
        if (pc.v === 1) {
            const segs = [[0, 1.2, 0, C], [2.8, C, 0, C], [1.2, 2.8, 2.6, C]];
            if (!pc.o) segs.push([1.2, 2.8, 0, 2.6]);   // porte fermée
            return segs;
        }
        if (pc.v === 2) return [[0, C, 0, 1.1], [0, C, 2.9, C], [0, 1.0, 1.1, 2.9], [3.0, C, 1.1, 2.9]];
        return [[0, C, 0, C]];
    }
    const segs = [];
    const door = pc.e === DOOR_MASK && !pc.o;
    for (let c = 0; c < 3; c++) {
        let r = 0;
        while (r < 3) {
            const solid = (rr) => !((pc.e >> (rr * 3 + c)) & 1) || (door && c === 1 && rr < 2);
            if (!solid(r)) { r++; continue; }
            let r1 = r;
            while (r1 + 1 < 3 && solid(r1 + 1)) r1++;
            segs.push([WALL_X[c], WALL_X[c + 1], WALL_Y[r], WALL_Y[r1 + 1]]);
            r = r1 + 1;
        }
    }
    return segs;
}

/** Case de sol retirée sous le point (x, z) ? */
export function floorHole(pc, x, z) {
    if (!pc.e) return false;
    const i = x - pc.gx * CELL < CELL / 2 ? 0 : 1;
    const j = z - pc.gz * CELL < CELL / 2 ? 0 : 1;
    return ((pc.e >> (j * 2 + i)) & 1) === 1;
}

export function pieceBoxes(pc) {
    const C = CELL;
    const x0 = pc.gx * C;
    const z0 = pc.gz * C;
    const y0 = pc.base;
    switch (pc.type) {
        case 'floor': {
            if (!pc.e) return [[x0, y0, z0, x0 + C, y0 + FLOOR_THICK, z0 + C]];
            const out = [];
            const H = C / 2;
            for (let j = 0; j < 2; j++) {
                for (let i = 0; i < 2; i++) {
                    if (!((pc.e >> (j * 2 + i)) & 1)) out.push([x0 + i * H, y0, z0 + j * H, x0 + (i + 1) * H, y0 + FLOOR_THICK, z0 + (j + 1) * H]);
                }
            }
            return out;
        }
        case 'wall': {
            // segments [a0, a1, y0, y1] le long du mur
            const segs = wallSegs(pc);
            const h = WALL_THICK / 2;
            return segs.map(([a0, a1, b0, b1]) => (pc.rot === 0
                ? [x0 + a0, y0 + b0, z0 - h, x0 + a1, y0 + b1, z0 + h]
                : [x0 - h, y0 + b0, z0 + a0, x0 + h, y0 + b1, z0 + a1]));
        }
        case 'stairs':
            return stepBoxes(pc, 4, C);
        case 'roof':
            if (pc.v === 1) return stepBoxes(pc, 2, ROOF_H);
            return [
                [x0, y0, z0, x0 + C, y0 + ROOF_H / 2, z0 + C],
                [x0 + 1, y0 + ROOF_H / 2, z0 + 1, x0 + 3, y0 + ROOF_H, z0 + 3],
            ];
        default:
            return [[x0, y0, z0, x0 + C, y0 + C, z0 + C]];
    }
}

/** Rampe approchée par k marches (pour les tirs et la caméra). */
function stepBoxes(pc, k, height) {
    const C = CELL;
    const x0 = pc.gx * C;
    const z0 = pc.gz * C;
    const y0 = pc.base;
    const out = [];
    for (let s = 0; s < k; s++) {
        const a0 = (s * C) / k;
        const a1 = ((s + 1) * C) / k;
        const top = y0 + (height * (s + 1)) / k;
        let b;
        if (pc.rot === 0) b = [x0 + a0, y0, z0, x0 + a1, top, z0 + C];
        else if (pc.rot === 1) b = [x0, y0, z0 + a0, x0 + C, top, z0 + a1];
        else if (pc.rot === 2) b = [x0 + C - a1, y0, z0, x0 + C - a0, top, z0 + C];
        else b = [x0, y0, z0 + C - a1, x0 + C, top, z0 + C - a0];
        out.push(b);
    }
    return out;
}

/** Position le long de la pente (0 en bas, CELL en haut) selon l'orientation. */
function slopeLocal(pc, x, z) {
    const x0 = pc.gx * CELL;
    const z0 = pc.gz * CELL;
    if (pc.rot === 0) return x - x0;
    if (pc.rot === 1) return z - z0;
    if (pc.rot === 2) return x0 + CELL - x;
    return z0 + CELL - z;
}

/** Surface marchable de la pièce au point (x, z), ou null. */
export function pieceTop(pc, x, z) {
    const y0 = pc.base;
    if (pc.type === 'floor') return floorHole(pc, x, z) ? null : y0 + FLOOR_THICK;
    if (pc.type === 'stairs') {
        return y0 + Math.max(0, Math.min(CELL, slopeLocal(pc, x, z)));
    }
    if (pc.type === 'roof') {
        if (pc.v === 1) return y0 + (ROOF_H * Math.max(0, Math.min(CELL, slopeLocal(pc, x, z)))) / CELL;
        const u = Math.abs(x - (pc.gx * CELL + CELL / 2)) / CELL;
        const w = Math.abs(z - (pc.gz * CELL + CELL / 2)) / CELL;
        return y0 + ROOF_H * Math.max(0, 1 - 2 * Math.max(u, w));
    }
    return null;
}

export function supportHeight(store, x, y, z) {
    let best = -Infinity;
    for (const pc of store.inCell(Math.floor(x / CELL), Math.floor(z / CELL))) {
        const top = pieceTop(pc, x, z);
        if (top !== null && top <= y + STEP_UP && top > best) best = top;
    }
    return best;
}

/**
 * Rétablissement (mantle) : hauteur du rebord devant soi si on peut s'y hisser.
 * On cherche un appui entre MANTLE_MIN et MANTLE_MAX au-dessus des pieds, avec la place
 * de tenir debout dessus. Renvoie la hauteur, ou null.
 */
export function mantleTarget(store, p, yaw) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const x = p.pos[0] + fx * MANTLE_REACH;
    const z = p.pos[2] + fz * MANTLE_REACH;
    const feet = p.pos[1];
    // appui le plus haut sous la limite, dans la case visée
    let top = terrainHeight(x, z);
    for (const pc of store.inCell(Math.floor(x / CELL), Math.floor(z / CELL))) {
        const t = pieceTop(pc, x, z);
        if (t !== null && t <= feet + MANTLE_MAX && t > top) top = t;
    }
    // caisses, bennes, comptoirs, épaves… : on se hisse aussi dessus
    for (const n of store.nodesNear(x, z)) {
        const t = n.y + n.h;
        if (t <= feet + MANTLE_MAX && t > top && Math.hypot(x - n.x, z - n.z) < n.r + 0.2) top = t;
    }
    const up = top - feet;
    if (up < MANTLE_MIN || up > MANTLE_MAX) return null;
    // il faut pouvoir tenir debout sur le rebord, et ne pas être coincé en dessous
    if (insideSolid(store, x, top + 0.45, z) || insideSolid(store, x, top + 1.5, z)) return null;
    return top;
}

export function insideSolid(store, x, y, z) {
    for (const pc of store.nearby(x, z)) {
        for (const b of pieceBoxes(pc)) {
            if (x > b[0] && x < b[3] && y > b[1] && y < b[4] && z > b[2] && z < b[5]) return true;
        }
    }
    for (const n of store.nodesNear(x, z)) {
        if (y > n.y && y < n.y + n.h && Math.hypot(x - n.x, z - n.z) < n.r) return true;
    }
    return false;
}

/** Boîtes « opaques » d'une pièce : les fenêtres comptent comme pleines (vitres), pas les portes ouvertes. */
export function opaqueBoxes(pc) {
    if (pc.type === 'wall' && pc.e == null && pc.v === 2) return pieceBoxes({ ...pc, v: 0 });
    return pieceBoxes(pc);
}

/** Une construction coupe-t-elle le segment a -> b ? (coffres derrière un mur) */
export function lineBlocked(store, a, b) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(d / 0.2));
    for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = a[0] + (b[0] - a[0]) * t;
        const y = a[1] + (b[1] - a[1]) * t;
        const z = a[2] + (b[2] - a[2]) * t;
        for (const pc of store.inCell(Math.floor(x / CELL), Math.floor(z / CELL))) {
            for (const bx of opaqueBoxes(pc)) {
                if (x > bx[0] && x < bx[3] && y > bx[1] && y < bx[4] && z > bx[2] && z < bx[5]) return true;
            }
        }
        // les murs sont à cheval sur deux cases
        for (const pc of store.inCell(Math.floor((x + 0.25) / CELL), Math.floor((z + 0.25) / CELL))) {
            if (pc.type !== 'wall') continue;
            for (const bx of opaqueBoxes(pc)) {
                if (x > bx[0] && x < bx[3] && y > bx[1] && y < bx[4] && z > bx[2] && z < bx[5]) return true;
            }
        }
    }
    return false;
}

/** Collision horizontale avec les murs (portes et fenêtres comprises). */
export function pushOutOfWalls(store, pos, R = PLAYER_R, H = PLAYER_H) {
    for (const pc of store.nearby(pos[0], pos[2])) {
        if (pc.type !== 'wall') continue;
        for (const [minX, minY, minZ, maxX, maxY, maxZ] of pieceBoxes(pc)) {
            if (pos[1] + H <= minY + 0.05 || pos[1] >= maxY - 0.05) continue;
            if (pos[0] + R <= minX || pos[0] - R >= maxX) continue;
            if (pos[2] + R <= minZ || pos[2] - R >= maxZ) continue;
            const options = [
                [0, maxX + R], [0, minX - R],
                [2, maxZ + R], [2, minZ - R],
            ];
            let best = null;
            for (const [axis, target] of options) {
                const d = Math.abs(target - pos[axis]);
                if (best === null || d < best[2]) best = [axis, target, d];
            }
            pos[best[0]] = best[1];
        }
    }
}

/** Arbres, rochers, voitures : cylindres verticaux. */
export function pushOutOfNodes(store, pos, R = PLAYER_R, H = PLAYER_H) {
    for (const n of store.nodesNear(pos[0], pos[2])) {
        if (pos[1] >= n.y + n.h || pos[1] + H <= n.y) continue;
        const dx = pos[0] - n.x;
        const dz = pos[2] - n.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const min = n.r + R;
        if (d >= min) continue;
        if (d < 1e-6) {
            pos[0] = n.x + min;
            continue;
        }
        pos[0] = n.x + (dx / d) * min;
        pos[2] = n.z + (dz / d) * min;
    }
}

/** Plafond : la tête bute sous un sol. Renvoie true si contact. */
export function ceilingHit(store, pos, oldY) {
    let hit = false;
    for (const pc of store.inCell(Math.floor(pos[0] / CELL), Math.floor(pos[2] / CELL))) {
        if (pc.type !== 'floor' || floorHole(pc, pos[0], pos[2])) continue;
        const bottom = pc.base;
        if (oldY + PLAYER_H <= bottom + 0.01 && pos[1] + PLAYER_H > bottom) {
            pos[1] = bottom - PLAYER_H;
            hit = true;
        }
    }
    return hit;
}

// ------------------------------------------------------------ physique

/** Plateforme de saut sous les pieds ? */
export function padUnder(store, pos) {
    for (const pad of store.pads.values()) {
        const dx = pos[0] - pad.x;
        const dz = pos[2] - pad.z;
        if (dx * dx + dz * dz < PAD_R * PAD_R && Math.abs(pos[1] - pad.y) < 0.8) return pad;
    }
    return null;
}

/** Point de la tyrolienne le plus proche : { t, d } (d = distance au câble). */
export function zipClosest(z, q) {
    const ab = [z.b[0] - z.a[0], z.b[1] - z.a[1], z.b[2] - z.a[2]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    let t = ((q[0] - z.a[0]) * ab[0] + (q[1] - z.a[1]) * ab[1] + (q[2] - z.a[2]) * ab[2]) / l2;
    t = Math.max(0, Math.min(1, t));
    const c = [z.a[0] + ab[0] * t, z.a[1] + ab[1] * t, z.a[2] + ab[2] * t];
    return { t, d: Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) };
}

/**
 * Tyrolienne attrapable depuis la position des pieds : à moins de 2,4 m à l'horizontale du câble,
 * qui passe entre 0,5 et 6,5 m au-dessus des pieds. Renvoie { id, t } ou null.
 */
export function zipAttach(zips, pos) {
    let best = null;
    for (const z of zips.values()) {
        const dx = z.b[0] - z.a[0];
        const dz = z.b[2] - z.a[2];
        const l2 = dx * dx + dz * dz;
        let t = ((pos[0] - z.a[0]) * dx + (pos[2] - z.a[2]) * dz) / l2;
        t = Math.max(0, Math.min(1, t));
        const hx = z.a[0] + dx * t - pos[0];
        const hz = z.a[2] + dz * t - pos[2];
        const h = Math.sqrt(hx * hx + hz * hz);
        const up = z.a[1] + (z.b[1] - z.a[1]) * t - pos[1];
        if (h < 2.4 && up > 0.5 && up < 6.5 && (best === null || h < best.h)) best = { id: z.id, t, h };
    }
    return best;
}

function stepZip(store, p, inp, dt) {
    const z = store.zips.get(p.zip.id);
    if (!z) {
        p.zip = null;
        return p;
    }
    const ux = (z.b[0] - z.a[0]) / z.len;
    const uy = (z.b[1] - z.a[1]) / z.len;
    const uz = (z.b[2] - z.a[2]) / z.len;
    const sp = ZIP_SPEED * p.zip.dir;
    let t = p.zip.t + (sp * dt) / z.len;
    const off = t <= 0 || t >= 1 || p.jumpQ;
    t = Math.max(0, Math.min(1, t));
    p.pos[0] = z.a[0] + (z.b[0] - z.a[0]) * t;
    p.pos[1] = z.a[1] + (z.b[1] - z.a[1]) * t - ZIP_HANG;
    p.pos[2] = z.a[2] + (z.b[2] - z.a[2]) * t;
    p.vel[0] = ux * sp;
    p.vel[1] = uy * sp;
    p.vel[2] = uz * sp;
    p.ground = false;
    p.swim = false;
    p.glide = false;
    p.slide = 0;
    if (off) {
        p.zip = null;
        p.vel[0] *= 0.6;
        p.vel[2] *= 0.6;
        p.vel[1] = p.jumpQ ? JUMP_VELOCITY * 0.8 : 0;
    } else {
        p.zip.t = t;
    }
    p.jumpQ = false;
    p.jumpBuf = 0;
    p.coyote = 0;
    p.land = 0;
    p.slideCd = 0;
    p.tac = Math.min(p.tacMax ?? TAC_TIME, (p.tac ?? TAC_TIME) + dt * ((p.tacMax ?? TAC_TIME) / TAC_RECHARGE));
    return p;
}

/** Conduite d'un véhicule (le joueur est le véhicule). */
function stepCar(store, p, inp, dt) {
    let s = p.cspd;
    if (inp.fwd > 0.1) s = s < 0 ? s + CAR_BRAKE * dt : Math.min(CAR_SPEED, s + CAR_ACCEL * dt);
    else if (inp.fwd < -0.1) s = s > 0 ? s - CAR_BRAKE * dt : Math.max(-CAR_REVERSE, s - CAR_ACCEL * dt);
    else s = s > 0 ? Math.max(0, s - CAR_DRAG * dt) : Math.min(0, s + CAR_DRAG * dt);
    if (p.ground) p.cyaw -= inp.side * CAR_TURN * Math.max(-1, Math.min(1, s / 5)) * dt;
    const fx = -Math.sin(p.cyaw);
    const fz = -Math.cos(p.cyaw);
    const ox = p.pos[0];
    const oy = p.pos[1];
    const oz = p.pos[2];
    const pos = [ox + fx * s * dt, oy, oz + fz * s * dt];
    if (terrainHeight(pos[0], pos[2]) < WATER_Y - 0.2) {
        pos[0] = ox;
        pos[2] = oz;
        s = 0;
    }
    const dist = Math.sqrt(pos[0] * pos[0] + pos[2] * pos[2]);
    if (dist > PLAY_RADIUS) {
        pos[0] *= PLAY_RADIUS / dist;
        pos[2] *= PLAY_RADIUS / dist;
        s *= 0.5;
    }
    const bx = pos[0];
    const bz = pos[2];
    for (let k = -1; k <= 1; k++) {
        const c = [pos[0] + fx * CAR_AXLE * k, oy + 0.3, pos[2] + fz * CAR_AXLE * k];
        const cx = c[0];
        const cz = c[2];
        pushOutOfWalls(store, c, CAR_R, CAR_H);
        pushOutOfNodes(store, c, CAR_R, CAR_H);
        pos[0] += c[0] - cx;
        pos[2] += c[2] - cz;
    }
    if (Math.abs(pos[0] - bx) + Math.abs(pos[2] - bz) > 0.02) s *= 0.6;
    let ground = Math.max(terrainHeight(pos[0], pos[2]), supportHeight(store, pos[0], oy + 0.45, pos[2]));
    if (p.ground && ground > oy + 1.2) {
        pos[0] = ox;
        pos[2] = oz;
        s = 0;
        ground = Math.max(terrainHeight(ox, oz), supportHeight(store, ox, oy + 0.45, oz));
    }
    let vy = p.vel[1] - GRAVITY * dt;
    let y = oy + vy * dt;
    if (p.ground && y > ground && y - ground < 0.6 + Math.abs(s) * dt) y = ground;
    if (y <= ground) {
        y = ground;
        vy = 0;
        p.ground = true;
    } else {
        p.ground = false;
    }
    p.pos[0] = pos[0];
    p.pos[1] = y;
    p.pos[2] = pos[2];
    p.vel[0] = fx * s;
    p.vel[1] = vy;
    p.vel[2] = fz * s;
    p.cspd = s;
    p.swim = false;
    p.glide = false;
    p.slide = 0;
    p.jumpQ = false;
    p.jumpBuf = 0;
    p.coyote = 0;
    p.land = 0;
    p.slideCd = 0;
    p.tac = Math.min(p.tacMax ?? TAC_TIME, (p.tac ?? TAC_TIME) + dt * ((p.tacMax ?? TAC_TIME) / TAC_RECHARGE));
    return p;
}

/**
 * Un pas de simulation (même ordre que stepBody() de engine.php).
 * p : { pos, vel, yaw, ground, glide, slide, slideDir, state, jumpQ, swim, zip, veh, cyaw, cspd }
 * inp : { fwd, side, sprint, crouch, glide, ads }
 */
export function stepPhysics(store, p, inp, dt) {
    if (p.veh != null) return stepCar(store, p, inp, dt);
    if (p.zip) return stepZip(store, p, inp, dt);
    // --- rétablissement en cours : on glisse jusqu'au haut du rebord, sans rien d'autre
    if ((p.mantle ?? 0) > 0) {
        p.mantle = Math.max(0, p.mantle - dt);
        const k = 1 - p.mantle / MANTLE_TIME;
        const e = k * k * (3 - 2 * k);
        p.pos[0] = p.mx0 + (p.mx1 - p.mx0) * e;
        p.pos[1] = p.my0 + (p.my1 - p.my0) * e;
        p.pos[2] = p.mz0 + (p.mz1 - p.mz0) * e;
        p.vel[0] = 0;
        p.vel[1] = 0;
        p.vel[2] = 0;
        p.ground = p.mantle <= 0;
        p.swim = false;
        p.glide = false;
        p.slide = 0;
        p.jumpQ = false;
        p.jumpBuf = 0;
        p.coyote = 0;
        p.land = 0;
        return p;
    }
    const falling = p.state === 'falling';
    if (falling && !p.glide) {
        const agl = p.pos[1] - groundOrWater(p.pos[0], p.pos[2]);
        if (inp.glide || (agl < AUTO_GLIDER && p.vel[1] < 0)) p.glide = true;
    }

    let mx = -Math.sin(p.yaw) * inp.fwd + Math.cos(p.yaw) * inp.side;
    let mz = -Math.cos(p.yaw) * inp.fwd - Math.sin(p.yaw) * inp.side;
    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 1) {
        mx /= len;
        mz /= len;
    }
    const moving = len > 0.1;
    const spd0 = Math.sqrt(p.vel[0] * p.vel[0] + p.vel[2] * p.vel[2]);

    // --- sprint tactique : court, très rapide, puis il faut récupérer.
    // tacMax vient des atouts (« Athlète »), spdK des atouts et des accessoires de l'arme.
    const tacMax = p.tacMax ?? TAC_TIME;
    const spdK = p.spdK ?? 1;
    const wantTac = !!inp.tac && !inp.ads && !inp.crouch && inp.fwd > 0 && p.ground && !p.swim && !falling;
    let tacOn = false;
    if (wantTac && (p.tac ?? tacMax) > 0.05) {
        tacOn = true;
        p.tac = Math.max(0, (p.tac ?? tacMax) - dt);
    } else {
        p.tac = Math.min(tacMax, (p.tac ?? tacMax) + dt * (tacMax / TAC_RECHARGE));
    }

    // --- glissade : il faut courir, et elle a un temps de recharge
    p.slideCd = Math.max(0, (p.slideCd ?? 0) - dt);
    if (p.ground && !p.swim && inp.crouch && inp.sprint && moving && p.slide <= 0
        && p.slideCd <= 0 && spd0 > SLIDE_MIN_SPEED) {
        p.slide = SLIDE_TIME;
        p.slideDir = [mx, mz];
    }

    // --- réception d'un saut ou d'une chute : on est ralenti un court instant
    p.land = Math.max(0, (p.land ?? 0) - dt);

    let tx;
    let tz;
    if (p.slide > 0) {
        p.slide -= dt;
        // on oriente un peu sa glissade (la direction suit la touche, sans à-coup)
        if (moving) {
            const t = Math.min(1, SLIDE_TURN * dt);
            const sx = p.slideDir[0] + (mx - p.slideDir[0]) * t;
            const sz = p.slideDir[1] + (mz - p.slideDir[1]) * t;
            const sl = Math.sqrt(sx * sx + sz * sz);
            if (sl > 1e-4) p.slideDir = [sx / sl, sz / sl];
        }
        // élan franc au départ, puis la glissade s'éteint (comme une glissade de CoD)
        const k = Math.max(SLIDE_MIN, Math.min(1, (p.slide / SLIDE_TIME) * 1.7));
        tx = p.slideDir[0] * SLIDE_SPEED * k;
        tz = p.slideDir[1] * SLIDE_SPEED * k;
        if (p.slide <= 0) p.slideCd = SLIDE_CD;
    } else {
        let speed = WALK_SPEED;
        if (falling) {
            speed = p.glide ? GLIDER_SPEED : (inp.fwd > 0 ? SKY_DIVE_SPEED : SKY_SPEED);
        } else if (p.swim) {
            speed = SWIM_SPEED;
        } else {
            if (inp.crouch) speed = CROUCH_SPEED;
            else if (tacOn) speed = TAC_SPEED;
            else if (inp.sprint && inp.fwd > 0 && !inp.ads) speed = SPRINT_SPEED;
            if (inp.ads) speed *= ADS_FACTOR;
            // on recule et on se déplace de côté moins vite qu'on avance
            if (!tacOn) {
                if (inp.fwd < -0.1) speed *= BACK_FACTOR;
                else if (Math.abs(inp.side) > 0.1 && Math.abs(inp.fwd) < 0.1) speed *= SIDE_FACTOR;
            }
            if (p.land > 0) speed *= LAND_SLOW_K;
            speed *= spdK;
        }
        tx = mx * speed;
        tz = mz * speed;
    }

    // inertie : accélérer dans une direction neuve coûte un peu plus que continuer tout droit
    let rate;
    if (!p.ground) {
        rate = falling ? ACCEL_SKY : ACCEL_AIR;
    } else if (!moving) {
        rate = DECEL_GROUND;
    } else {
        const dot = spd0 > 0.2 ? (p.vel[0] * tx + p.vel[2] * tz) / (spd0 * Math.max(0.001, Math.sqrt(tx * tx + tz * tz))) : 1;
        rate = ACCEL_TURN + (ACCEL_GROUND - ACCEL_TURN) * Math.max(0, Math.min(1, (dot + 1) / 2));
    }
    const k = Math.min(1, rate * dt);
    p.vel[0] += (tx - p.vel[0]) * k;
    p.vel[2] += (tz - p.vel[2]) * k;

    // --- rétablissement : en poussant vers l'avant contre un rebord (au sol ou en sautant)
    if (!falling && !p.swim && p.slide <= 0 && inp.fwd > 0.5) {
        const top = mantleTarget(store, p, p.yaw);
        if (top !== null && (p.ground || p.vel[1] > -2)) {
            p.mantle = MANTLE_TIME;
            p.mx0 = p.pos[0];
            p.my0 = p.pos[1];
            p.mz0 = p.pos[2];
            p.mx1 = p.pos[0] - Math.sin(p.yaw) * (MANTLE_REACH + PLAYER_R + 0.1);
            p.my1 = top;
            p.mz1 = p.pos[2] - Math.cos(p.yaw) * (MANTLE_REACH + PLAYER_R + 0.1);
            return p;
        }
    }

    // saut tolérant : mémorise l'appui (tampon) et laisse un court instant après avoir quitté le sol
    if (p.jumpQ) p.jumpBuf = JUMP_BUFFER;
    p.jumpQ = false;
    const sliding = p.slide > 0;
    const canJump = (p.ground || (p.coyote ?? 0) > 0) && !p.swim && !falling;
    if ((p.jumpBuf ?? 0) > 0 && canJump) {
        // sauter pendant une glissade l'annule (saut un peu plus court, élan conservé)
        p.vel[1] = sliding ? JUMP_VELOCITY * SLIDE_JUMP : JUMP_VELOCITY;
        if (sliding) {
            p.slide = 0;
            p.slideCd = SLIDE_CD;
        }
        p.ground = false;
        p.jumpBuf = 0;
        p.coyote = 0;
    } else {
        p.jumpBuf = Math.max(0, (p.jumpBuf ?? 0) - dt);
    }
    const snap = p.ground && !falling;

    if (!p.ground) {
        p.vel[1] -= GRAVITY * dt;
        if (falling) {
            const term = p.glide ? -GLIDER_FALL : (inp.fwd > 0 ? -SKY_DIVE : -SKY_FALL);
            if (p.vel[1] < term) p.vel[1] += (term - p.vel[1]) * Math.min(1, 4 * dt);
        }
    }

    const oldY = p.pos[1];
    p.pos[0] += p.vel[0] * dt;
    p.pos[1] += p.vel[1] * dt;
    p.pos[2] += p.vel[2] * dt;

    const dist = Math.sqrt(p.pos[0] * p.pos[0] + p.pos[2] * p.pos[2]);
    if (dist > PLAY_RADIUS) {
        const f = PLAY_RADIUS / dist;
        p.pos[0] *= f;
        p.pos[2] *= f;
        p.vel[0] = 0;
        p.vel[2] = 0;
    }

    pushOutOfWalls(store, p.pos);
    pushOutOfNodes(store, p.pos);
    if (p.vel[1] > 0 && ceilingHit(store, p.pos, oldY)) p.vel[1] = 0;

    const water = groundOrWater(p.pos[0], p.pos[2]);
    const ground = Math.max(water, supportHeight(store, p.pos[0], oldY, p.pos[2]));
    if (p.pos[1] <= ground || (snap && p.pos[1] - ground < SNAP_DOWN)) {
        p.pos[1] = ground;
        // réception appuyée : on se relève, on repart plus lentement un court instant
        if (!p.ground && p.vel[1] < -LAND_SLOW_VY && p.slide <= 0) p.land = LAND_SLOW_TIME;
        if (p.vel[1] < 0) p.vel[1] = 0;
        p.ground = true;
        p.swim = ground === water && terrainHeight(p.pos[0], p.pos[2]) < SWIM_Y;
        if (p.state === 'falling') {
            p.state = 'alive';
            p.glide = false;
        }
        const pad = p.state === 'alive' && !p.swim ? padUnder(store, p.pos) : null;
        if (pad) {
            p.vel[1] = PAD_VY;
            p.ground = false;
            p.state = 'falling';
            p.glide = false;
            p.slide = 0;
        }
    } else {
        p.ground = false;
        p.swim = false;
    }
    p.coyote = p.ground && !falling ? COYOTE_TIME : Math.max(0, (p.coyote ?? 0) - dt);
    return p;
}
