// Bâtiments de la carte : géométries des pièces (murs, sols, rampes, toits, portes),
// fusionnées par matériau et par zone, avec fissures et destruction.
import * as THREE from 'three';
import { addDamage, zeroDamage } from './damage.js';
import { CELL, FLOOR_THICK, WALL_THICK, ROOF_H, PieceStore, wallSegs, isDoor, DOOR_MASK } from './shared.js';
import { tex } from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const C = CELL;

// ------------------------------------------------------------ géométries (repère local de la case)

class GeoBuilder {
    constructor() {
        this.pos = [];
        this.nor = [];
        this.uv = [];
        this.groups = [[], [], [], []];   // 0 façade, 1 dessus (sol), 2 boiseries / plafond, 3 vitre
    }

    quad(a, b, c, d, n, uvs, group) {
        this.groups[group].push([a, b, c, a, c, d], n, [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]]);
    }

    tri(a, b, c, n, uvs, group) {
        this.groups[group].push([a, b, c], n, uvs);
    }

    /** Boîte alignée ; UV projetés sur la case (une tuile = 4 m). groups : [côtés, dessus, dessous]. */
    box(x0, y0, z0, x1, y1, z1, groups = [0, 0, 0]) {
        const u = (v) => v / C;
        const [gs, gt, gb] = groups;
        // +x / -x
        this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[u(z1), u(y0)], [u(z0), u(y0)], [u(z0), u(y1)], [u(z1), u(y1)]], gs);
        this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[u(z0), u(y0)], [u(z1), u(y0)], [u(z1), u(y1)], [u(z0), u(y1)]], gs);
        // +z / -z
        this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[u(x0), u(y0)], [u(x1), u(y0)], [u(x1), u(y1)], [u(x0), u(y1)]], gs);
        this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[u(x1), u(y0)], [u(x0), u(y0)], [u(x0), u(y1)], [u(x1), u(y1)]], gs);
        // dessus / dessous
        this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[u(x0), u(z1)], [u(x1), u(z1)], [u(x1), u(z0)], [u(x0), u(z0)]], gt);
        this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[u(x0), u(z0)], [u(x1), u(z0)], [u(x1), u(z1)], [u(x0), u(z1)]], gb);
    }

    build() {
        const g = new THREE.BufferGeometry();
        const pos = [];
        const nor = [];
        const uv = [];
        let start = 0;
        const groups = [];
        this.groups.forEach((list, gi) => {
            let count = 0;
            for (let k = 0; k < list.length; k += 3) {
                const verts = list[k];
                const n = list[k + 1];
                const uvs = list[k + 2];
                verts.forEach((v, i) => {
                    pos.push(...v);
                    nor.push(...n);
                    uv.push(...uvs[i]);
                });
                count += verts.length;
            }
            if (count) groups.push([start, count, gi]);
            start += count;
        });
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        for (const [s, c, m] of groups) g.addGroup(s, c, m);
        return g;
    }
}

/** Rampe / pente : prisme montant vers +x, de 0 à h. */
function wedge(b, h, slopeGroup, sideGroup) {
    const n = new THREE.Vector3(-h, C, 0).normalize();
    const L = Math.hypot(C, h) / C;
    b.quad([0, 0, C], [C, h, C], [C, h, 0], [0, 0, 0], [n.x, n.y, n.z], [[0, 0], [L, 0], [L, 1], [0, 1]].map(([a, c]) => [c, a]), slopeGroup);
    b.quad([C, 0, 0], [C, h, 0], [C, h, C], [C, 0, C], [1, 0, 0], [[0, 0], [0, h / C], [1, h / C], [1, 0]], sideGroup);
    b.quad([0, 0, 0], [C, 0, 0], [C, 0, C], [0, 0, C], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 2);
    b.tri([0, 0, 0], [C, h, 0], [C, 0, 0], [0, 0, -1], [[0, 0], [1, h / C], [1, 0]], sideGroup);
    b.tri([0, 0, C], [C, 0, C], [C, h, C], [0, 0, 1], [[0, 0], [1, 0], [1, h / C]], sideGroup);
}

function rotateY(geo, rot) {
    const ang = [0, -Math.PI / 2, Math.PI, Math.PI / 2][rot];
    if (!ang) return geo;
    geo.translate(-C / 2, 0, -C / 2);
    geo.rotateY(ang);
    geo.translate(C / 2, 0, C / 2);
    return geo;
}

const GEO = new Map();

/** Géométrie d'une forme : 'floor', 'wall:v:rot', 'stairs:rot', 'roof:v:rot'. */
export function shapeGeometry(shape) {
    if (GEO.has(shape)) return GEO.get(shape);
    const [type, a, c] = shape.split(':');
    const b = new GeoBuilder();
    let geo;
    if (type === 'floor') {
        const e = Number(a) || 0;
        const H = C / 2;
        if (!e) b.box(0, 0, 0, C, FLOOR_THICK, C, [0, 1, 2]);
        else {
            for (let j = 0; j < 2; j++) {
                for (let i = 0; i < 2; i++) if (!((e >> (j * 2 + i)) & 1)) b.box(i * H, 0, j * H, (i + 1) * H, FLOOR_THICK, (j + 1) * H, [0, 1, 2]);
            }
        }
        geo = b.build();
    } else if (type === 'wallE') {      // mur édité : masque 3x3
        const e = Number(a);
        const rot = Number(c);
        const t = WALL_THICK / 2;
        for (const [a0, a1, y0, y1] of wallSegs({ e, o: 1 })) b.box(a0, y0, -t, a1, y1, t);
        if (e === DOOR_MASK) {
            const f = 0.06;
            b.box(1.05, 0, -t - f, 1.2, 2.6, t + f, [2, 2, 2]);
            b.box(2.8, 0, -t - f, 2.95, 2.6, t + f, [2, 2, 2]);
            b.box(1.05, 2.6, -t - f, 2.95, 2.75, t + f, [2, 2, 2]);
        }
        geo = b.build();
        if (rot === 1) geo.rotateY(-Math.PI / 2);
    } else if (type === 'wall') {
        const v = Number(a);
        const rot = Number(c);
        const t = WALL_THICK / 2;
        const segs = v === 1 ? [[0, 1.2, 0, C], [2.8, C, 0, C], [1.2, 2.8, 2.6, C]]
            : v === 2 ? [[0, C, 0, 1.1], [0, C, 2.9, C], [0, 1.0, 1.1, 2.9], [3.0, C, 1.1, 2.9]]
                : [[0, C, 0, C]];
        for (const [a0, a1, y0, y1] of segs) b.box(a0, y0, -t, a1, y1, t);
        const e = 0.06;
        if (v === 1) {     // encadrement de porte
            b.box(1.05, 0, -t - e, 1.2, 2.6, t + e, [2, 2, 2]);
            b.box(2.8, 0, -t - e, 2.95, 2.6, t + e, [2, 2, 2]);
            b.box(1.05, 2.6, -t - e, 2.95, 2.75, t + e, [2, 2, 2]);
        } else if (v === 2) {   // fenêtre : cadre, appui, vitre
            b.box(0.85, 1.0, -t - e, 1.0, 2.9, t + e, [2, 2, 2]);
            b.box(3.0, 1.0, -t - e, 3.15, 2.9, t + e, [2, 2, 2]);
            b.box(0.85, 2.9, -t - e, 3.15, 3.05, t + e, [2, 2, 2]);
            b.box(0.8, 0.95, -t - 0.16, 3.2, 1.1, t + 0.16, [2, 2, 2]);
            b.box(1.95, 1.1, -0.03, 2.05, 2.9, 0.03, [2, 2, 2]);
            b.box(1.0, 1.1, -0.02, 3.0, 2.9, 0.02, [3, 3, 3]);
        }
        geo = b.build();
        if (rot === 1) {   // mur le long de z, en x = 0
            geo.rotateY(-Math.PI / 2);
        }
    } else if (type === 'stairs') {
        wedge(b, C, 0, 0);
        geo = rotateY(b.build(), Number(a));
    } else if (type === 'roof') {
        const v = Number(a);
        if (v === 1) {
            wedge(b, ROOF_H, 0, 1);
            geo = rotateY(b.build(), Number(c));
        } else {
            const h = ROOF_H;
            const m = C / 2;
            const sides = [
                [[0, 0, 0], [C, 0, 0], [m, h, m], [0, 0.45, -0.9]],
                [[C, 0, 0], [C, 0, C], [m, h, m], [0.9, 0.45, 0]],
                [[C, 0, C], [0, 0, C], [m, h, m], [0, 0.45, 0.9]],
                [[0, 0, C], [0, 0, 0], [m, h, m], [-0.9, 0.45, 0]],
            ];
            for (const [p0, p1, p2, n] of sides) b.tri(p0, p2, p1, n, [[0, 0], [0.5, 1], [1, 0]], 0);
            b.quad([0, 0, 0], [C, 0, 0], [C, 0, C], [0, 0, C], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 2);
            geo = b.build();
        }
    }
    geo.computeBoundingSphere();
    GEO.set(shape, geo);
    return geo;
}

export function shapeOf(pc) {
    if (pc.type === 'floor') return pc.e ? `floor:${pc.e}` : 'floor';
    if (pc.type === 'wall') return pc.e != null && pc.e > 0 ? `wallE:${pc.e}:${pc.rot}` : `wall:${pc.v || 0}:${pc.rot}`;
    if (pc.type === 'stairs') return `stairs:${pc.rot}`;
    if (pc.v === 1) return `roof:1:${pc.rot}`;
    return 'roof:0';
}

// ------------------------------------------------------------ matériaux

const SIDING = { 1: 0x7fa8de, 2: 0xf1cf6a, 8: 0x96c784, 9: 0xf2aec0 };
const ROOF_TINT = { 10: 0xb4503a, 11: 0x52667f, 12: 0x6b5140, 5: 0x7a2a22, 7: 0x4c3a2a };
const MATS = new Map();

const BASE = new Map();
/** Matériau partagé par description (texture + teinte) : moins de matériaux = moins de lots. */
function std(texName, color = 0xffffff, extra = {}) {
    const k = `${texName}:${color}:${JSON.stringify(extra)}`;
    if (!BASE.has(k)) BASE.set(k, addDamage(new THREE.MeshStandardMaterial({ map: texName ? tex(texName) : null, color, roughness: 0.86, metalness: 0, ...extra })));
    return BASE.get(k);
}
const TRIM = () => std(null, 0xf3efe6);
let GLASS = null;
const glassMat = () => (GLASS ??= new THREE.MeshStandardMaterial({ color: 0x9fd4ff, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.35 }));

/** [façade, dessus, boiseries/plafond, vitre] pour un style et un type de pièce. */
export function materialsFor(style, mat, type) {
    const key = `${style}:${mat}:${type === 'roof' ? 'roof' : type === 'stairs' ? 'stairs' : 'std'}`;
    if (MATS.has(key)) return MATS.get(key);
    let side;
    let top;
    if (style === 0) {
        side = std(mat, 0xffffff, mat === 'metal' ? { metalness: 0.35, roughness: 0.55 } : {});
        top = side;
    } else if (type === 'roof' || style >= 10) {
        if (style === 6) side = std('corrugated', 0x8c969e, { metalness: 0.3, roughness: 0.6 });
        else if (style >= 10 && type !== 'roof') side = std('concrete', 0x6d6a66);
        else side = std('shingles', ROOF_TINT[style] ?? 0x8a4a35);
        top = side;
    } else {
        if (SIDING[style]) side = std('siding', SIDING[style]);
        else if (style === 3) side = std('brick');
        else if (style === 4) side = std('plaster');
        else if (style === 5) side = std('barn');
        else if (style === 6) side = std('corrugated', 0x9aa6b0, { metalness: 0.3, roughness: 0.6 });
        else if (style === 7) side = std('logs');
        else side = std('siding');
        top = style === 6 ? std('concrete') : std('parquet');
        if (type === 'stairs') side = top;
    }
    const list = [side, top, TRIM(), glassMat()];
    MATS.set(key, list);
    return list;
}

const MAT_COLOR = { wood: 0xa06b3a, stone: 0x9aa0a8, metal: 0x9fb4c7 };
/**
 * Usure 0..1 d'une pièce : les dégâts vraiment reçus (et pas les PV qui montent pendant
 * la construction — une pièce qu'on vient de poser est neuve, sans fissure).
 */
function damageOf(pc) {
    return pc.max > 1 && pc.lost > 0 ? Math.min(1, pc.lost / pc.max) : 0;
}
export const MAT_DEBRIS = MAT_COLOR;

// ------------------------------------------------------------ rendu des pièces

function pieceCenter(pc) {
    return new THREE.Vector3(pc.gx * C + C / 2, pc.base + C / 2, pc.gz * C + C / 2);
}

/** Morceau d'une géométrie correspondant à un groupe de matériau (non indexée). */
const SLICES = new Map();
function slice(shape, gi) {
    const k = `${shape}|${gi}`;
    if (SLICES.has(k)) return SLICES.get(k);
    const geo = shapeGeometry(shape);
    const grp = geo.groups.find((g) => g.materialIndex === gi);
    let out = null;
    if (grp) {
        out = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) {
            const a = geo.attributes[name];
            out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize));
        }
    }
    SLICES.set(k, out);
    return out;
}

/**
 * Maisons de la carte : géométries fusionnées par matériau et par zone de 96 m
 * (quelques dizaines d'appels de dessin pour toute l'île). Une pièce détruite
 * reconstruit seulement les lots qui la contiennent. Pièces des joueurs : un mesh chacune.
 */
export class BuildRenderer {
    constructor(scene, store, fx) {
        this.scene = scene;
        this.store = store;
        this.fx = fx;
        this.group = new THREE.Group();
        scene.add(this.group);
        this.buckets = new Map();      // clé de lot -> { material, parts: Map(clé pièce -> géométrie), mesh, dirty }
        this.pieceBuckets = new Map(); // clé pièce -> [clés de lot]
        this.meshes = new Map();       // clé pièce -> Mesh (joueurs)
        this.doors = new DoorRenderer(scene);
    }

    /** Charge toutes les pièces (message de bienvenue). */
    loadAll(list) {
        this.clear();
        for (const pc of list) {
            pc.key ??= PieceStore.key(pc.type, pc.gx, pc.gy, pc.gz, pc.rot);
            if (pc.st > 0) this.addMapPiece(pc);
            else this.add(pc);
        }
        for (const b of this.buckets.values()) this.rebuild(b);
    }

    addMapPiece(pc) {
        this.doors.sync(pc);
        const shape = shapeOf(pc);
        const mats = materialsFor(pc.st, pc.mat, pc.type);
        const chunk = `${Math.floor(pc.gx * C / 96)}:${Math.floor(pc.gz * C / 96)}`;
        const keys = [];
        for (let gi = 0; gi < 4; gi++) {
            const part = slice(shape, gi);
            if (!part) continue;
            const bk = `${mats[gi].uuid}|${chunk}`;
            let b = this.buckets.get(bk);
            if (!b) {
                b = { material: mats[gi], parts: new Map(), mesh: null, dirty: true };
                this.buckets.set(bk, b);
            }
            b.parts.set(`${pc.key}#${gi}`, zeroDamage(part.clone().translate(pc.gx * C, pc.base, pc.gz * C), damageOf(pc)));
            b.dirty = true;
            keys.push([bk, `${pc.key}#${gi}`]);
        }
        this.pieceBuckets.set(pc.key, keys);
    }

    /** Re-dessine une pièce après édition (mur -> porte / fenêtre). */
    refresh(pc) {
        this.doors.remove(pc.key);
        this.remove(pc.key, false);
        if (pc.st > 0) {
            this.addMapPiece(pc);
            for (const b of this.buckets.values()) this.rebuild(b);
        } else {
            this.add(pc);
        }
    }

    rebuild(b) {
        if (!b.dirty) return;
        b.dirty = false;
        if (b.mesh) {
            this.group.remove(b.mesh);
            b.mesh.geometry.dispose();
            b.mesh = null;
        }
        if (!b.parts.size) return;
        // position de chaque pièce dans le maillage fusionné (pour l'usure)
        b.ranges = new Map();
        let start = 0;
        for (const [pk, g] of b.parts) {
            const n = g.attributes.position.count;
            b.ranges.set(pk, [start, n]);
            start += n;
        }
        const geo = mergeGeometries([...b.parts.values()], false);
        geo.computeBoundingSphere();
        b.mesh = new THREE.Mesh(geo, b.material);
        b.mesh.castShadow = !b.material.transparent;
        b.mesh.receiveShadow = true;
        this.group.add(b.mesh);
    }

    /** Pièce isolée (cas rare : pièce de carte sans style). Un mesh par pièce. */
    add(pc) {
        if (this.meshes.has(pc.key)) this.remove(pc.key, false);
        this.doors.sync(pc);
        const mesh = new THREE.Mesh(shapeGeometry(shapeOf(pc)), materialsFor(0, pc.mat, pc.type));
        mesh.position.set(pc.gx * C, pc.base, pc.gz * C);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { key: pc.key, mat: pc.mat };
        this.group.add(mesh);
        this.meshes.set(pc.key, mesh);
        if (damageOf(pc) > 0) this.setDamage(pc);
    }

    update(dt) {
        this.doors.update(dt);
    }

    hurt(key, hp, lost) {
        const pc = this.store.buildings.get(key);
        if (!pc) return;
        pc.hp = hp;
        pc.lost = lost ?? Math.max(pc.lost ?? 0, pc.max - hp);
        // PV annoncés en fin de montée (aucun dégât) : pas d'étincelles
        if (this.fx && pc.lost > 0) this.fx.burst(pieceCenter(pc), MAT_COLOR[pc.mat] ?? 0xaaaaaa, 5, 4);
        this.setDamage(pc);
    }

    /** Fissures de plus en plus visibles selon les dégâts reçus. */
    setDamage(pc) {
        const d = damageOf(pc);
        const m = this.meshes.get(pc.key);
        if (m) {
            if (!m.userData.ownGeo) {
                m.geometry = zeroDamage(m.geometry.clone());
                m.userData.ownGeo = true;
            }
            m.geometry.attributes.dmg.array.fill(d);
            m.geometry.attributes.dmg.needsUpdate = true;
            return;
        }
        for (const [bk, pk] of this.pieceBuckets.get(pc.key) ?? []) {
            const b = this.buckets.get(bk);
            const part = b?.parts.get(pk);
            if (!part) continue;
            part.attributes.dmg.array.fill(d);
            const r = b.ranges?.get(pk);
            const attr = b.mesh?.geometry.attributes.dmg;
            if (r && attr) {
                attr.array.fill(d, r[0], r[0] + r[1]);
                attr.needsUpdate = true;
            }
        }
    }

    remove(key, debris = true) {
        const pc = this.store.buildings.get(key);
        this.doors.remove(key);
        const bks = this.pieceBuckets.get(key);
        if (bks) {
            const touched = new Set();
            for (const [bk, pk] of bks) {
                const b = this.buckets.get(bk);
                if (!b) continue;
                b.parts.get(pk)?.dispose();
                b.parts.delete(pk);
                b.dirty = true;
                touched.add(b);
            }
            for (const b of touched) this.rebuild(b);
            this.pieceBuckets.delete(key);
        }
        const m = this.meshes.get(key);
        if (m) {
            this.group.remove(m);
            if (m.userData.ownGeo) m.geometry.dispose();
            this.meshes.delete(key);
        }
        if (debris && pc && this.fx) this.fx.debris(pieceCenter(pc), MAT_COLOR[pc.mat] ?? 0xaaaaaa);
    }

    /** Retire les pièces des joueurs (reset du mode construction). */
    clearPlayerPieces() {
        for (const key of [...this.meshes.keys()]) this.remove(key, false);
    }

    clear() {
        for (const b of this.buckets.values()) {
            if (b.mesh) {
                this.group.remove(b.mesh);
                b.mesh.geometry.dispose();
            }
            for (const g of b.parts.values()) g.dispose();
        }
        this.buckets.clear();
        this.pieceBuckets.clear();
        for (const key of [...this.meshes.keys()]) this.remove(key, false);
        this.doors.clear();
    }
}

/**
 * Battants des portes (murs « porte ») : un seul InstancedMesh pour toute l'île.
 * Le battant laisse 40 cm en bas (épaisseur du sol) : il ne traverse jamais le plancher.
 */
export class DoorRenderer {
    constructor(scene) {
        const geo = new THREE.BoxGeometry(1.54, 2.14, 0.1).translate(0.79, 1.07, 0);
        const mat = new THREE.MeshStandardMaterial({ map: tex('door'), roughness: 0.7, metalness: 0.05 });
        this.max = 800;
        this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        scene.add(this.mesh);
        this.doors = new Map();   // clé -> { i, pc, a (0..1), side }
        this.slots = [];          // index -> clé
        this.m = new THREE.Matrix4();
        this.q = new THREE.Quaternion();
        this.e = new THREE.Euler();
        this.p = new THREE.Vector3();
        this.s = new THREE.Vector3(1, 1, 1);
    }

    sync(pc) {
        if (!isDoor(pc)) {
            this.remove(pc.key);
            return;
        }
        let d = this.doors.get(pc.key);
        if (!d) {
            if (this.slots.length >= this.max) return;
            d = { i: this.slots.length, pc, a: pc.o ? 1 : 0, side: pc.ds ?? 1 };
            this.slots.push(pc.key);
            this.doors.set(pc.key, d);
            this.mesh.count = this.slots.length;
        }
        d.pc = pc;
        this.place(d);
    }

    remove(key) {
        const d = this.doors.get(key);
        if (!d) return;
        const lastKey = this.slots[this.slots.length - 1];
        const last = this.doors.get(lastKey);
        this.slots[d.i] = lastKey;
        last.i = d.i;
        this.slots.pop();
        this.doors.delete(key);
        this.mesh.count = this.slots.length;
        if (last !== d) this.place(last);
    }

    setOpen(key, open, side) {
        const d = this.doors.get(key);
        if (!d) return;
        d.pc.o = open ? 1 : 0;
        if (open) d.side = side ?? d.side;
    }

    /** Porte la plus proche du point (x, y, z), à portée. */
    nearest(x, y, z, reach = 2.8) {
        let best = null;
        for (const d of this.doors.values()) {
            const pc = d.pc;
            const cx = pc.rot === 0 ? pc.gx * C + 2 : pc.gx * C;
            const cz = pc.rot === 0 ? pc.gz * C : pc.gz * C + 2;
            const dist = Math.hypot(cx - x, cz - z);
            if (dist < reach && Math.abs(pc.base + 0.4 - y) < 2.2 && (!best || dist < best.dist)) best = { pc, dist, x: cx, z: cz };
        }
        return best;
    }

    place(d) {
        const pc = d.pc;
        const swing = d.a * 1.5 * d.side;
        // porte créée par édition : le battant va du sol jusqu'au linteau (2,6 m)
        const edited = pc.e != null;
        const y0 = pc.base + (edited ? 0.03 : 0.42);
        this.s.set(1, edited ? 2.55 / 2.14 : 1, 1);
        let yaw;
        if (pc.rot === 0) {
            this.p.set(pc.gx * C + 1.22, y0, pc.gz * C);
            yaw = -swing;
        } else {
            this.p.set(pc.gx * C, y0, pc.gz * C + 1.22);
            yaw = -Math.PI / 2 + swing;
        }
        this.e.set(0, yaw, 0);
        this.m.compose(this.p, this.q.setFromEuler(this.e), this.s);
        this.mesh.setMatrixAt(d.i, this.m);
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    update(dt) {
        for (const d of this.doors.values()) {
            const t = d.pc.o ? 1 : 0;
            if (d.a === t) continue;
            d.a = t > d.a ? Math.min(1, d.a + dt * 3.2) : Math.max(0, d.a - dt * 3.2);
            this.place(d);
        }
    }

    clear() {
        this.doors.clear();
        this.slots = [];
        this.mesh.count = 0;
    }
}
