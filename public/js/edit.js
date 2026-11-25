// Édition « à la Fortnite » : grille de cases sur la pièce visée, sélection au clic / glisser.
// Mur 3x3 (bit = rangée * 3 + colonne), sol / rampe / toit 2x2 (bit = j * 2 + i).
import * as THREE from 'three';
import { CELL, WALL_X, WALL_Y, FLOOR_THICK, ROOF_H } from './shared.js';

const C = CELL;
const H = C / 2;

/** Hauteur de la surface « pleine » d'une pièce horizontale (sans tenir compte des trous). */
function surfaceY(pc, x, z) {
    const x0 = pc.gx * C;
    const z0 = pc.gz * C;
    if (pc.type === 'floor') return pc.base + FLOOR_THICK;
    const local = [x - x0, z - z0, x0 + C - x, z0 + C - z][pc.rot] ?? 0;
    const t = Math.max(0, Math.min(C, local));
    if (pc.type === 'stairs') return pc.base + t;
    if (pc.v === 1) return pc.base + (ROOF_H * t) / C;
    const u = Math.abs(x - (x0 + H)) / C;
    const w = Math.abs(z - (z0 + H)) / C;
    return pc.base + ROOF_H * Math.max(0, 1 - 2 * Math.max(u, w));
}

/** Liste des cases : coins (monde) de chaque case, dans l'ordre des bits. */
export function tilesOf(pc) {
    const x0 = pc.gx * C;
    const z0 = pc.gz * C;
    const out = [];
    if (pc.type === 'wall') {
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const a0 = WALL_X[c];
                const a1 = WALL_X[c + 1];
                const y0 = pc.base + WALL_Y[r];
                const y1 = pc.base + WALL_Y[r + 1];
                const P = (a, y) => (pc.rot === 0 ? [x0 + a, y, z0] : [x0, y, z0 + a]);
                out.push([P(a0, y0), P(a1, y0), P(a1, y1), P(a0, y1)]);
            }
        }
        return out;
    }
    const lift = 0.06;
    for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
            const cs = [[i * H, j * H], [(i + 1) * H, j * H], [(i + 1) * H, (j + 1) * H], [i * H, (j + 1) * H]];
            out.push(cs.map(([a, b]) => [x0 + a, surfaceY(pc, x0 + a, z0 + b) + lift, z0 + b]));
        }
    }
    return out;
}

/** Case visée par le rayon (origine o, direction f) ou null. */
export function pickTile(pc, o, f) {
    const x0 = pc.gx * C;
    const z0 = pc.gz * C;
    if (pc.type === 'wall') {
        const n = pc.rot === 0 ? f.z : f.x;
        if (Math.abs(n) < 1e-4) return null;
        const t = pc.rot === 0 ? (z0 - o.z) / f.z : (x0 - o.x) / f.x;
        if (t < 0 || t > 12) return null;
        const a = pc.rot === 0 ? o.x + f.x * t - x0 : o.z + f.z * t - z0;
        const y = o.y + f.y * t - pc.base;
        if (a < -0.3 || a > C + 0.3 || y < -0.3 || y > C + 0.3) return null;
        const col = a < WALL_X[1] ? 0 : a < WALL_X[2] ? 1 : 2;
        const row = y < WALL_Y[1] ? 0 : y < WALL_Y[2] ? 1 : 2;
        return row * 3 + col;
    }
    // pièce horizontale : on avance le long du rayon jusqu'à traverser la surface
    let prev = null;
    for (let d = 0.3; d < 12; d += 0.04) {
        const x = o.x + f.x * d;
        const y = o.y + f.y * d;
        const z = o.z + f.z * d;
        const inside = x >= x0 - 0.2 && x <= x0 + C + 0.2 && z >= z0 - 0.2 && z <= z0 + C + 0.2;
        if (!inside) { prev = null; continue; }
        const s = Math.sign(y - surfaceY(pc, Math.min(x0 + C, Math.max(x0, x)), Math.min(z0 + C, Math.max(z0, z))));
        if (prev !== null && s !== prev) {
            const i = x - x0 < H ? 0 : 1;
            const j = z - z0 < H ? 0 : 1;
            return j * 2 + i;
        }
        prev = s;
    }
    return null;
}

/** État initial de la sélection d'après la pièce. */
export function initialSel(pc) {
    if (pc.type === 'wall' || pc.type === 'floor') return pc.e ?? (pc.type === 'wall' && pc.v === 1 ? 18 : 0);
    if (pc.type === 'roof' && pc.v === 1) return [0b1010, 0b1100, 0b0101, 0b0011][pc.rot];
    return 0;
}

/** Message d'édition à envoyer, ou null si rien ne change / sélection invalide (avec raison). */
export function editMessage(pc, sel, path) {
    if (pc.type === 'wall') {
        if (sel === 511) return { err: 'Impossible de tout retirer' };
        if (sel === (pc.e ?? (pc.v === 1 ? 18 : 0)) && pc.v !== 2) return null;
        return { t: 'edit', key: pc.key, e: sel };
    }
    if (pc.type === 'floor') {
        if (sel === 15) return { err: 'Impossible de tout retirer' };
        if (sel === (pc.e ?? 0)) return null;
        return { t: 'edit', key: pc.key, e: sel };
    }
    if (pc.type === 'stairs') {
        if (!path || path.length < 2) return null;
        const a = path[0];
        const b = path[path.length - 1];
        const di = (b & 1) - (a & 1);
        const dj = (b >> 1) - (a >> 1);
        let r;
        if (Math.abs(di) >= Math.abs(dj) && di !== 0) r = di > 0 ? 0 : 2;
        else if (dj !== 0) r = dj > 0 ? 1 : 3;
        else return null;
        if (r === pc.rot) return null;
        return { t: 'edit', key: pc.key, r };
    }
    if (pc.type === 'roof') {
        if (sel === 0) return pc.v === 1 ? { t: 'edit', key: pc.key, v: 0, r: 0 } : null;
        const r = [0b1010, 0b1100, 0b0101, 0b0011].indexOf(sel);
        if (r < 0) return { err: 'Sélectionne 2 cases côte à côte' };
        if (pc.v === 1 && pc.rot === r) return null;
        return { t: 'edit', key: pc.key, v: 1, r };
    }
    return null;
}

/** Message de réinitialisation (pièce d'origine). */
export function resetMessage(pc) {
    if (pc.type === 'wall' || pc.type === 'floor') return (pc.e ?? 0) || pc.v ? { t: 'edit', key: pc.key, e: 0 } : null;
    if (pc.type === 'roof' && pc.v === 1) return { t: 'edit', key: pc.key, v: 0, r: 0 };
    return null;
}

const COL_TILE = new THREE.Color(0x4fb4ff);
const COL_SEL = new THREE.Color(0x0b2850);
const COL_HOVER = new THREE.Color(0xbfe6ff);
const COL_PATH = new THREE.Color(0xffd34f);

/** Grille d'édition affichée par-dessus la pièce (toujours visible, même à travers). */
export class EditOverlay {
    constructor(scene) {
        this.group = new THREE.Group();
        this.group.renderOrder = 20;
        this.group.visible = false;
        scene.add(this.group);
        this.tiles = [];
        this.lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
    }

    show(pc) {
        this.clear();
        for (const cs of tilesOf(pc)) {
            // léger retrait pour voir le joint entre les cases
            const cx = cs.reduce((s, p) => s + p[0], 0) / 4;
            const cy = cs.reduce((s, p) => s + p[1], 0) / 4;
            const cz = cs.reduce((s, p) => s + p[2], 0) / 4;
            const sh = cs.map(([x, y, z]) => [cx + (x - cx) * 0.94, cy + (y - cy) * 0.94, cz + (z - cz) * 0.94]);
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute([...sh[0], ...sh[1], ...sh[2], ...sh[0], ...sh[2], ...sh[3]], 3));
            const m = new THREE.MeshBasicMaterial({ color: COL_TILE, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
            const mesh = new THREE.Mesh(g, m);
            mesh.renderOrder = 20;
            const lg = new THREE.BufferGeometry();
            lg.setAttribute('position', new THREE.Float32BufferAttribute([...sh[0], ...sh[1], ...sh[1], ...sh[2], ...sh[2], ...sh[3], ...sh[3], ...sh[0]], 3));
            const line = new THREE.LineSegments(lg, this.lineMat);
            line.renderOrder = 21;
            this.group.add(mesh, line);
            this.tiles.push({ mesh, line });
        }
        this.group.visible = true;
    }

    /** sel : bits retirés · hover : case visée · path : cases du glisser (rampe). */
    update(sel, hover, path, t) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 8);
        this.tiles.forEach(({ mesh, line }, i) => {
            const on = ((sel >> i) & 1) === 1;
            const inPath = path?.includes(i);
            const m = mesh.material;
            m.color.copy(inPath ? COL_PATH : on ? COL_SEL : COL_TILE);
            m.opacity = inPath ? 0.55 : on ? 0.12 : 0.3;
            if (i === hover) { m.color.lerp(COL_HOVER, 0.6); m.opacity += 0.18 + 0.1 * pulse; }
            line.visible = !on || i === hover;
        });
    }

    clear() {
        for (const { mesh, line } of this.tiles) {
            mesh.geometry.dispose();
            mesh.material.dispose();
            line.geometry.dispose();
            this.group.remove(mesh, line);
        }
        this.tiles = [];
    }

    hide() {
        this.clear();
        this.group.visible = false;
    }
}
