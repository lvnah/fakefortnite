// Décor 3D : meubles et objets de ville (KayKit, instanciés), tapis et tableaux, caisses de
// munitions, plateformes de saut, tyroliennes et véhicules.
import * as THREE from 'three';
import { addDamage, instancedDamage } from './damage.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PROPS, terrainHeight } from './shared.js';
import { loadProps } from './models.js';
import { tex } from './textures.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
const BIG = new Set(['watertower', 'streetlight']);
const OUTDOOR = new Set(['dumpster', 'hydrant', 'bench', 'boxes', 'crates', 'crate2']);

/** Meubles (nœuds « prop ») + décor sans collision, rendus en InstancedMesh par type. */
export class PropRenderer {
    constructor(parent) {
        this.group = new THREE.Group();
        parent.add(this.group);
        this.refs = new Map();      // id -> [{ im, index }]
        this.nodes = [];
        this.deco = [];
        this.assets = null;
        loadProps().then((a) => {
            this.assets = a;
            this.build();
        }).catch((e) => console.warn('décor', e));
    }

    /** nodes : [{ id, v, x, y, z, s(rotation) }] ; deco : [[type, x, y, z, rot]] */
    load(nodes, deco = this.deco) {
        this.nodes = nodes;
        this.deco = deco;
        if (this.assets) this.build();
    }

    build() {
        this.group.clear();
        this.refs.clear();
        const byKind = new Map();
        for (const n of this.nodes) {
            const key = PROPS[n.v]?.[0];
            if (!key) continue;
            if (!byKind.has(key)) byKind.set(key, []);
            byKind.get(key).push({ id: n.id, x: n.x, y: n.y, z: n.z, rot: n.s });
        }
        this.decoRefs = [];
        for (const [type, x, y, z, rot] of this.deco) {
            const key = type === 'rug' ? 'rug' : 'frame';
            if (!byKind.has(key)) byKind.set(key, []);
            byKind.get(key).push({ id: null, deco: true, x, y: type === 'rug' ? y + 0.01 : y, z, rot });
        }
        // regroupement par zone de 96 m : chaque zone est cachée hors du champ de vision ou trop loin
        this.chunks = [];
        for (const [key, all] of byKind) {
            const zones = new Map();
            for (const it of all) {
                const zk = `${Math.floor(it.x / 96)}:${Math.floor(it.z / 96)}`;
                if (!zones.has(zk)) zones.set(zk, []);
                zones.get(zk).push(it);
            }
            const parts = this.assets.get(key);
            const far = BIG.has(key) ? 420 : OUTDOOR.has(key) ? 240 : 150;
            for (const list of zones.values()) {
                const grp = new THREE.Group();
                let cx = 0;
                let cz = 0;
                for (const it of list) { cx += it.x / list.length; cz += it.z / list.length; }
                for (const { geometry, material } of parts) {
                    const im = new THREE.InstancedMesh(geometry, addDamage(material), list.length);
                    im.castShadow = key !== 'rug' && key !== 'frame';
                    im.receiveShadow = true;
                    const dmg = key !== 'rug' && key !== 'frame' ? instancedDamage(im) : null;
                    list.forEach((it, i) => {
                        _e.set(0, it.rot, 0);
                        _m.compose(_p.set(it.x, it.y, it.z), _q.setFromEuler(_e), _s.set(1, 1, 1));
                        im.setMatrixAt(i, _m);
                        if (it.id !== null) {
                            if (!this.refs.has(it.id)) this.refs.set(it.id, []);
                            this.refs.get(it.id).push({ im, index: i, dmg });
                        }
                        if (it.deco) this.decoRefs.push({ im, index: i, x: it.x, y: it.y, z: it.z });
                    });
                    im.instanceMatrix.needsUpdate = true;
                    im.computeBoundingSphere();
                    grp.add(im);
                }
                this.group.add(grp);
                this.chunks.push({ grp, x: cx, z: cz, far });
            }
        }
    }

    /** Cache les meubles lointains (intérieurs invisibles de loin). */
    update(cam) {
        if (!this.chunks || !cam) return;
        for (const c of this.chunks) c.grp.visible = Math.hypot(c.x - cam.x, c.z - cam.z) < c.far;
    }

    /** Usure d'un meuble (fissures). */
    setDamage(id, d) {
        for (const { dmg, index } of this.refs.get(id) ?? []) {
            if (!dmg) continue;
            dmg.setX(index, d);
            dmg.needsUpdate = true;
        }
    }

    /** Tableaux et tapis accrochés à une pièce de maison détruite : ils disparaissent avec elle. */
    hideDecoIn(box) {
        _m.makeScale(0, 0, 0);
        this.decoRefs = (this.decoRefs ?? []).filter((r) => {
            const inside = r.x > box[0] - 0.35 && r.x < box[3] + 0.35 && r.y > box[1] - 0.35 && r.y < box[4] + 0.35 && r.z > box[2] - 0.35 && r.z < box[5] + 0.35;
            if (!inside) return true;
            r.im.setMatrixAt(r.index, _m);
            r.im.instanceMatrix.needsUpdate = true;
            return false;
        });
    }

    remove(id) {
        const refs = this.refs.get(id);
        this.nodes = this.nodes.filter((n) => n.id !== id);
        if (!refs) return;
        _m.makeScale(0, 0, 0);
        for (const { im, index } of refs) {
            im.setMatrixAt(index, _m);
            im.instanceMatrix.needsUpdate = true;
        }
        this.refs.delete(id);
    }
}

// ------------------------------------------------------------ vitres des voitures

const GLASS = new THREE.MeshStandardMaterial({ color: 0x9cc4d6, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
let atlasPx = null;
/** Couleur de l'atlas (KayKit City) au point uv. */
function atlasColor(img, u, v) {
    if (!atlasPx || atlasPx.img !== img) {
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = img.height;
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        atlasPx = { img, w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data };
    }
    const x = Math.min(atlasPx.w - 1, Math.max(0, Math.floor(u * atlasPx.w)));
    const y = Math.min(atlasPx.h - 1, Math.max(0, Math.floor(v * atlasPx.h)));
    const i = (y * atlasPx.w + x) * 4;
    return [atlasPx.d[i], atlasPx.d[i + 1], atlasPx.d[i + 2]];
}
/** Sépare la carrosserie et les vitres (gris-vert pâle dans l'atlas). null si rien trouvé. */
function splitGlass(mesh) {
    const img = mesh.material?.map?.image;
    const geo = mesh.geometry;
    const uv = geo.attributes.uv;
    if (!img || !uv || !img.width) return null;
    const idx = geo.index ? geo.index.array : Array.from({ length: geo.attributes.position.count }, (_, i) => i);
    const body = [];
    const glass = [];
    for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t];
        const b = idx[t + 1];
        const c = idx[t + 2];
        const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
        const v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
        const [r, g, bl] = atlasColor(img, u, v);
        const isGlass = Math.abs(r - g) < 12 && r >= 92 && r <= 138 && bl < r - 8 && bl > r - 28;
        (isGlass ? glass : body).push(a, b, c);
    }
    if (glass.length < 9) return null;
    const mk = (list) => {
        const g2 = new THREE.BufferGeometry();
        for (const [k, attr] of Object.entries(geo.attributes)) g2.setAttribute(k, attr);
        g2.setIndex(list);
        g2.computeBoundingSphere();
        return g2;
    };
    return { body: mk(body), glass: mk(glass) };
}

// ------------------------------------------------------------ plateformes de saut

export class PadRenderer {
    constructor(parent) {
        this.group = new THREE.Group();
        parent.add(this.group);
        this.pads = new Map();
        const base = new THREE.CylinderGeometry(1.25, 1.4, 0.22, 24).translate(0, 0.11, 0);
        const top = new THREE.CylinderGeometry(1.05, 1.05, 0.06, 24).translate(0, 0.25, 0);
        const arrows = [];
        for (let k = 0; k < 3; k++) {
            const sh = new THREE.Shape();
            sh.moveTo(-0.45, 0); sh.lineTo(0, 0.4); sh.lineTo(0.45, 0); sh.lineTo(0.3, 0); sh.lineTo(0, 0.25); sh.lineTo(-0.3, 0);
            const g = new THREE.ShapeGeometry(sh);
            g.rotateX(-Math.PI / 2).translate(0, 0.29, 0.35 - k * 0.38);
            arrows.push(g);
        }
        this.geoBase = base;
        this.geoTop = top;
        this.geoArrows = mergeGeometries(arrows);
        this.matBase = new THREE.MeshStandardMaterial({ color: 0x5a6578, map: tex('metal'), roughness: 0.5, metalness: 0.5 });
        this.matTop = new THREE.MeshStandardMaterial({ color: 0x1fb6ff, emissive: 0x19a8ff, emissiveIntensity: 0.8, roughness: 0.3 });
        this.matArrow = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const ringGeo = new THREE.RingGeometry(0.9, 1.2, 32).rotateX(-Math.PI / 2);
        this.ringMat = new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
        this.ringGeo = ringGeo;
        this.t = 0;
    }

    add(id, x, y, z) {
        if (this.pads.has(id)) return;
        const g = new THREE.Group();
        g.position.set(x, y - 0.05, z);
        const b = new THREE.Mesh(this.geoBase, this.matBase);
        b.receiveShadow = true;
        b.castShadow = true;
        g.add(b, new THREE.Mesh(this.geoTop, this.matTop), new THREE.Mesh(this.geoArrows, this.matArrow));
        const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
        ring.position.y = 0.3;
        g.add(ring);
        g.userData.ring = ring;
        this.group.add(g);
        this.pads.set(id, g);
    }

    remove(id) {
        const g = this.pads.get(id);
        if (g) this.group.remove(g);
        this.pads.delete(id);
    }

    clear() {
        this.group.clear();
        this.pads.clear();
    }

    bounce(id) {
        const g = this.pads.get(id);
        if (g) g.userData.kick = 1;
    }

    update(dt) {
        this.t += dt;
        this.matTop.emissiveIntensity = 0.6 + 0.4 * Math.sin(this.t * 4);
        for (const g of this.pads.values()) {
            const r = g.userData.ring;
            const k = (this.t * 0.8 + g.position.x * 0.01) % 1;
            r.position.y = 0.3 + k * 1.6;
            r.scale.setScalar(1 - k * 0.35);
            g.userData.kick = Math.max(0, (g.userData.kick ?? 0) - dt * 3);
            g.children[1].position.y = g.userData.kick * 0.25;
        }
        this.ringMat.opacity = 0.45;
    }
}

// ------------------------------------------------------------ tyroliennes

export class ZipRenderer {
    constructor(parent) {
        this.group = new THREE.Group();
        parent.add(this.group);
    }

    load(zips) {
        this.group.clear();
        const poles = [];
        const cables = [];
        const tops = [];
        for (const [, a, b] of zips) {
            for (const e of [a, b]) {
                const g0 = terrainHeight(e[0], e[2]) - 0.3;
                const h = e[1] + 0.5 - g0;
                poles.push(new THREE.CylinderGeometry(0.16, 0.22, h, 8).translate(e[0], g0 + h / 2, e[2]));
                tops.push(new THREE.BoxGeometry(0.9, 0.25, 0.25).translate(e[0], e[1] + 0.4, e[2]));
                tops.push(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 12).rotateZ(Math.PI / 2).translate(e[0], e[1] + 0.1, e[2]));
            }
            const A = new THREE.Vector3(...a);
            const B = new THREE.Vector3(...b);
            const len = A.distanceTo(B);
            const g = new THREE.CylinderGeometry(0.035, 0.035, len, 6);
            g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, B.clone().sub(A).normalize()));
            g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
            cables.push(g);
        }
        if (!poles.length) return;
        const pole = new THREE.Mesh(mergeGeometries(poles), new THREE.MeshStandardMaterial({ color: 0xc8a070, map: tex('wood'), roughness: 0.85 }));
        pole.castShadow = true;
        const top = new THREE.Mesh(mergeGeometries(tops), new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5, metalness: 0.4 }));
        const cable = new THREE.Mesh(mergeGeometries(cables), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.7 }));
        this.group.add(pole, top, cable);
    }
}

// ------------------------------------------------------------ véhicules

export class VehicleRenderer {
    constructor(parent) {
        this.group = new THREE.Group();
        parent.add(this.group);
        this.list = new Map();   // id -> { id, kind, pos:[x,y,z], yaw, driver, obj }
        this.assets = null;
        loadProps().then((a) => {
            this.assets = a;
            for (const v of this.list.values()) this.ensure(v);
        });
    }

    load(list) {
        this.group.clear();
        this.list.clear();
        for (const w of list) this.set(w);
    }

    /** w : [id, kind, x, y, z, yaw, driver, pv, épave, passagers] */
    set(w) {
        const [id, kind, x, y, z, yaw, driver, hp, wreck, pass] = w;
        let v = this.list.get(id);
        if (!v) {
            v = { id, kind, pos: [x, y, z], yaw, driver: driver ?? null, obj: null, spin: 0, hp: 800, wreck: false, pass: [null, null, null] };
            this.list.set(id, v);
        }
        v.kind = kind;
        v.pos = [x, y, z];
        v.yaw = yaw;
        v.driver = driver ?? null;
        if (hp != null) v.hp = hp;
        if (pass) v.pass = [...pass];
        if (wreck && !v.wreck) { v.wreck = true; v.driver = null; this.burn(v); }
        this.ensure(v);
        this.place(v, v.pos, v.yaw, 0, 0);
        return v;
    }

    get(id) {
        return this.list.get(id);
    }

    ensure(v) {
        if (v.obj || !this.assets) return;
        v.obj = new THREE.Group();
        const m = this.assets.model(v.kind);
        this.glassify(m, v.kind);
        m.rotation.y = Math.PI;
        m.position.y = 0.28;        // roues posées sur le sol     // les voitures KayKit regardent vers +z, nos véhicules vers -z (comme le lacet)
        v.obj.add(m);
        this.group.add(v.obj);
        if (v.wreck) this.burn(v);
        this.place(v, v.pos, v.yaw, 0, 0);
    }

    /**
     * Vitres transparentes : les triangles dont la couleur (dans la texture atlas) est celle du verre
     * passent dans un maillage à part, translucide — on voit le conducteur et les passagers.
     */
    glassify(model, kind) {
        this.glassCache ??= new Map();
        const list = [];
        model.traverse((o) => { if (o.isMesh && !/wheel/i.test(o.name) && !o.userData.glassDone) list.push(o); });
        list.forEach((o) => {
            o.userData.glassDone = true;
            let entry = this.glassCache.get(`${kind}|${o.name}`);
            if (entry === undefined) {
                entry = splitGlass(o);
                this.glassCache.set(`${kind}|${o.name}`, entry);
            }
            if (!entry) return;
            o.geometry = entry.body;
            const glass = new THREE.Mesh(entry.glass, GLASS);
            glass.userData.glassDone = true;
            glass.renderOrder = 2;
            o.add(glass);
        });
    }

    /** Carcasse calcinée après l'explosion. */
    burn(v) {
        if (!v.obj || v.burnt) return;
        v.burnt = true;
        v.obj.traverse((o) => {
            if (!o.isMesh) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            const out = mats.map((mt) => {
                const c = mt.clone();
                c.color = new THREE.Color(0x2a2522).lerp(c.color ?? new THREE.Color(0x333333), 0.12);
                c.map = null;
                c.roughness = 1;
                c.metalness = 0.1;
                return c;
            });
            o.material = Array.isArray(o.material) ? out : out[0];
        });
        v.obj.children[0].position.y = 0.12;     // plus de pneus
        v.obj.children[0].rotation.z = 0.06;
    }

    /** Position (monde) d'une place passager : s = 0 avant droite, 1 arrière gauche, 2 arrière droite. */
    seatWorld(v, s, out = new THREE.Vector3()) {
        const SEATS = [[0.42, 0.05], [-0.42, -0.85], [0.42, -0.85]];
        const [side, fwd] = SEATS[s] ?? SEATS[0];
        const yaw = v.yaw;
        const base = v.obj ? v.obj.position : new THREE.Vector3(...v.pos);
        return out.set(base.x + Math.cos(yaw) * side - Math.sin(yaw) * fwd, base.y + 0.12, base.z - Math.sin(yaw) * side - Math.cos(yaw) * fwd);
    }

    /**
     * Place un véhicule : les 4 roues sont posées sur le sol (relief ou construction), la caisse
     * s'incline selon la pente (tangage et roulis) et ne s'enfonce jamais.
     */
    place(v, pos, yaw, speed, dt) {
        v.pos = pos;
        v.yaw = yaw;
        if (!v.obj) return;
        const ground = this.groundAt ?? ((x, y, z) => terrainHeight(x, z));
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
        const L = 1.35;
        const W = 0.8;
        const h = [[L, -W], [L, W], [-L, -W], [-L, W]].map(([a, b]) => ground(pos[0] + fx * a + rx * b, pos[1], pos[2] + fz * a + rz * b));
        const front = (h[0] + h[1]) / 2;
        const back = (h[2] + h[3]) / 2;
        const right = (h[1] + h[3]) / 2;
        const left = (h[0] + h[2]) / 2;
        const pitch = Math.max(-0.5, Math.min(0.5, Math.atan2(front - back, 2 * L)));
        const roll = Math.max(-0.4, Math.min(0.4, Math.atan2(right - left, 2 * W)));
        // hauteur : chaque roue au-dessus de son point de sol
        let y = (front + back) / 2;
        const s = [[L, -W], [L, W], [-L, -W], [-L, W]];
        for (let i = 0; i < 4; i++) {
            const lift = h[i] - (y + Math.sin(pitch) * s[i][0] + Math.sin(roll) * s[i][1]);
            if (lift > 0) y += lift;
        }
        y = Math.max(y, pos[1] - 0.05);
        v.obj.position.set(pos[0], y, pos[2]);
        v.obj.rotation.set(0, yaw, 0);
        v.obj.rotateX(pitch);
        v.obj.rotateZ(roll);
        v.spin += dt * Math.abs(speed) * 2.5;
        v.obj.children[0].position.y = 0.28 + Math.sin(v.spin) * 0.015 * Math.min(1, Math.abs(speed) / 5);
    }
}

/**
 * Points d'achat : une caisse-comptoir avec un écran lumineux et un panneau au-dessus.
 * On s'en approche et on achète un largage contenant sa classe du lobby.
 */
export class ShopRenderer {
    constructor(parent) {
        this.group = new THREE.Group();
        parent.add(this.group);
        this.shops = new Map();
        this.t = 0;
        this.reach = 3.6;
        this.geoBase = new THREE.BoxGeometry(1.6, 1.0, 0.9).translate(0, 0.5, 0);
        this.geoTop = new THREE.BoxGeometry(1.75, 0.12, 1.05).translate(0, 1.06, 0);
        this.geoPost = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8).translate(0, 1.7, 0);
        this.geoSign = new THREE.BoxGeometry(1.5, 0.75, 0.08).translate(0, 2.55, 0);
        this.geoScreen = new THREE.PlaneGeometry(1.2, 0.5).translate(0, 0.62, 0.46);
        this.matBase = new THREE.MeshStandardMaterial({ color: 0x2f3a46, map: tex('metal'), roughness: 0.55, metalness: 0.5 });
        this.matTop = new THREE.MeshStandardMaterial({ color: 0x1d242c, roughness: 0.6, metalness: 0.4 });
        this.matSign = new THREE.MeshStandardMaterial({ color: 0x14d07a, emissive: 0x0f9e5c, emissiveIntensity: 0.8, roughness: 0.4 });
        this.matScreen = new THREE.MeshBasicMaterial({ color: 0x8ffcd0, transparent: true, opacity: 0.9 });
        this.ringGeo = new THREE.RingGeometry(1.5, 1.9, 36).rotateX(-Math.PI / 2);
        this.ringMat = new THREE.MeshBasicMaterial({ color: 0x3ff0a6, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    }

    /** list : [id, x, y, z, rot, nom] */
    load(list) {
        this.clear();
        for (const [id, x, y, z, rot, name] of list ?? []) this.add(id, x, y, z, rot, name);
    }

    add(id, x, y, z, rot, name) {
        if (this.shops.has(id)) return;
        const g = new THREE.Group();
        g.position.set(x, y, z);
        g.rotation.y = rot;
        const base = new THREE.Mesh(this.geoBase, this.matBase);
        base.castShadow = true;
        base.receiveShadow = true;
        const sign = new THREE.Mesh(this.geoSign, this.matSign);
        sign.castShadow = true;
        g.add(base, new THREE.Mesh(this.geoTop, this.matTop), new THREE.Mesh(this.geoPost, this.matTop), sign,
            new THREE.Mesh(this.geoScreen, this.matScreen));
        const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
        ring.position.y = 0.04;
        g.add(ring);
        g.userData = { ring, sign, id, x, y, z, name };
        this.group.add(g);
        this.shops.set(id, g);
    }

    /** Point d'achat à portée du joueur (le plus proche), ou null. */
    nearest(x, y, z) {
        let best = null;
        for (const g of this.shops.values()) {
            const u = g.userData;
            const d = Math.hypot(u.x - x, u.z - z);
            if (d < this.reach && Math.abs(u.y - y) < 3 && (!best || d < best.d)) best = { id: u.id, name: u.name, d, x: u.x, y: u.y, z: u.z };
        }
        return best;
    }

    list() {
        return [...this.shops.values()].map((g) => g.userData);
    }

    update(dt) {
        this.t += dt;
        const k = 1 + Math.sin(this.t * 2.4) * 0.06;
        this.ringMat.opacity = 0.22 + Math.sin(this.t * 2.4) * 0.12;
        for (const g of this.shops.values()) g.userData.ring.scale.setScalar(k);
    }

    clear() {
        for (const g of this.shops.values()) this.group.remove(g);
        this.shops.clear();
    }
}
