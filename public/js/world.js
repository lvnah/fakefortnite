// Monde : relief, eau, ciel, végétation, rochers, voitures, coffres, tempête, montgolfière, lumière.
import * as THREE from 'three';
import { PropRenderer, PadRenderer, ZipRenderer, VehicleRenderer, ShopRenderer } from './props.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight, mapInfo, WATER_Y, CELL } from './shared.js';
import { createWaterMaterial, createSkyMaterial, createStormMaterial } from './shaders.js';
import { tex, glowTexture, stripes } from './textures.js';
import { addDamage, instancedDamage } from './damage.js';

export const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.3).normalize();

const SPLAT = [0x74b84e, 0x4f9a3c, 0xead49a, 0x8f8b86, 0xf4f7fb, 0xa47d50, 0xcdb85a, 0xb4afa4];

function hash(n) {
    const s = Math.sin(n * 91.345 + 17.13) * 43758.5453;
    return s - Math.floor(s);
}

/** Lama à butin (piñata violette à rayures). Origine au sol. */
function llamaModel() {
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    const mat = (c, e = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, emissive: new THREE.Color(c), emissiveIntensity: e });
    const PURPLE = mat(0x8e5cf7, 0.12);
    const stripes = [mat(0xff6fb5, 0.15), mat(0xffd34f, 0.15), mat(0x4fd6ff, 0.15)];
    const box = (w, h, d, m, x, y, z) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        b.position.set(x, y, z);
        b.castShadow = true;
        body.add(b);
        return b;
    };
    box(1.0, 0.55, 0.55, PURPLE, 0, 1.0, 0);
    for (let i = 0; i < 5; i++) box(0.12, 0.57, 0.57, stripes[i % 3], -0.4 + i * 0.2, 1.0, 0);
    for (const [x, z] of [[-0.36, -0.18], [-0.36, 0.18], [0.36, -0.18], [0.36, 0.18]]) {
        box(0.16, 0.75, 0.16, PURPLE, x, 0.38, z);
        box(0.18, 0.1, 0.18, stripes[1], x, 0.05, z);
    }
    box(0.26, 0.7, 0.26, PURPLE, 0.48, 1.5, 0);
    box(0.28, 0.12, 0.28, stripes[0], 0.48, 1.3, 0);
    box(0.28, 0.12, 0.28, stripes[2], 0.48, 1.55, 0);
    box(0.42, 0.28, 0.3, PURPLE, 0.62, 1.88, 0);
    box(0.1, 0.1, 0.32, mat(0x22162e), 0.78, 1.92, 0);
    for (const z of [-0.09, 0.09]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 6), PURPLE);
        ear.position.set(0.5, 2.12, z);
        body.add(ear);
        box(0.02, 0.06, 0.06, mat(0xffffff, 0.5), 0.76, 1.95, z * 1.4);
    }
    box(0.16, 0.3, 0.16, stripes[0], -0.55, 1.15, 0).rotation.z = 0.6;
    const sparkle = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 1.2, 0], 3)),
        new THREE.PointsMaterial({ map: glowTexture(), color: 0xd59cff, size: 4.5, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.add(sparkle);
    g.scale.setScalar(1.15);
    g.userData = { body, sparkle };
    return g;
}

/** Largage : grosse caisse bleue sous un ballon ; une colonne lumineuse la signale une fois posée. */
function airdropModel() {
    const g = new THREE.Group();
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.2, ...o });
    const BLUE = mat(0x2f6fd8, { emissive: new THREE.Color(0x0b2a70), emissiveIntensity: 0.4 });
    const TRIM = mat(0xf2f5ff);
    const GOLD = mat(0xffd34f, { emissive: new THREE.Color(0xffb000), emissiveIntensity: 0.6 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.4), BLUE);
    crate.position.y = 0.55;
    crate.castShadow = true;
    g.add(crate);
    for (const [w, h, d, y] of [[1.46, 0.12, 1.46, 0.1], [1.46, 0.12, 1.46, 1.0]]) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), TRIM);
        t.position.y = y;
        g.add(t);
    }
    for (const a of [0, Math.PI / 2]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.02, 1.44), GOLD);
        band.position.y = 0.55;
        band.rotation.y = a;
        g.add(band);
    }
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 1.5), TRIM);
    lid.position.y = 1.12;
    g.add(lid);
    const balloon = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.7, 20, 14), new THREE.MeshStandardMaterial({ map: stripes(['#3d8bff', '#ffffff'], 8), roughness: 0.6 }));
    ball.position.y = 6.2;
    ball.scale.set(1, 1.15, 1);
    balloon.add(ball);
    const ropeMat = new THREE.LineBasicMaterial({ color: 0x333333 });
    for (const [x, z] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) {
        balloon.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 1.15, z), new THREE.Vector3(x * 0.6, 4.8, z * 0.6)]), ropeMat));
    }
    g.add(balloon);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 70, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x5fb2ff, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.y = 35;
    g.add(beam);
    g.userData = { lid, balloon, beam };
    return g;
}

export class World {
    constructor(scene, map) {
        this.scene = scene;
        this.map = map;
        this.waterMat = createWaterMaterial();
        this.skyMat = createSkyMaterial(SUN_DIR);
        this.chestMeshes = new Map();
        this.nodeRefs = new Map();
        this.wobbles = [];
        this.time = 0;
        this.buildLights();
        this.buildTerrain();
        this.buildWater();
        this.buildSky();
        this.buildDecor();
        this.buildStorm();
        this.balloon = this.buildBalloon();
        this.nodeGroup = new THREE.Group();
        scene.add(this.nodeGroup);
        this.chestGroup = new THREE.Group();
        scene.add(this.chestGroup);
        this.props = new PropRenderer(scene);
        this.pads = new PadRenderer(scene);
        this.zips = new ZipRenderer(scene);
        this.vehicles = new VehicleRenderer(scene);
        this.shops = new ShopRenderer(scene);
    }

    buildLights() {
        this.hemi = new THREE.HemisphereLight(0xcfe9ff, 0x4a6a32, 1.05);
        this.scene.add(this.hemi);
        const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const s = 70;
        Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 500 });
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.03;
        this.scene.add(sun, sun.target);
        this.sun = sun;
    }

    buildTerrain() {
        const info = mapInfo();
        const n = info.n;
        const step = info.step;
        const half = info.half;
        const pos = new Float32Array(n * n * 3);
        const col = new Float32Array(n * n * 3);
        const uv = new Float32Array(n * n * 2);
        const base = SPLAT.map((h) => new THREE.Color(h));
        const c = new THREE.Color();
        const tmp = new THREE.Color();
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const k = j * n + i;
                const x = -half + i * step;
                const z = -half + j * step;
                pos[k * 3] = x;
                pos[k * 3 + 1] = info.h[k];
                pos[k * 3 + 2] = z;
                uv[k * 2] = x / 7;
                uv[k * 2 + 1] = z / 7;
                // couleur lissée sur 3x3
                c.setRGB(0, 0, 0);
                let cnt = 0;
                for (let dj = -1; dj <= 1; dj++) {
                    for (let di = -1; di <= 1; di++) {
                        const ii = Math.min(n - 1, Math.max(0, i + di));
                        const jj = Math.min(n - 1, Math.max(0, j + dj));
                        let s = info.splat[jj * n + ii];
                        tmp.copy(base[s]);
                        if (s === 6 && ((ii >> 1) & 1)) tmp.multiplyScalar(0.86);
                        c.add(tmp);
                        cnt++;
                    }
                }
                c.multiplyScalar(1 / cnt);
                const h = info.h[k];
                const v = 0.9 + 0.2 * hash(i * 7.1 + j * 13.3);
                c.multiplyScalar(v);
                if (h < WATER_Y + 0.3) c.lerp(tmp.set(0xc8b27a), 0.6);
                col[k * 3] = c.r;
                col[k * 3 + 1] = c.g;
                col[k * 3 + 2] = c.b;
            }
        }
        const index = [];
        for (let j = 0; j < n - 1; j++) {
            for (let i = 0; i < n - 1; i++) {
                const a = j * n + i;
                const b = a + 1;
                const d = a + n;
                const e = d + 1;
                index.push(a, d, b, b, d, e);
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(index);
        geo.computeVertexNormals();
        const ground = tex('ground');
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: ground, roughness: 0.95, metalness: 0 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.terrain = mesh;

        // fond marin au-delà de la carte
        const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x1d5f80 }));
        sea.position.y = -14;
        this.scene.add(sea);
    }

    buildWater() {
        const geo = new THREE.PlaneGeometry(3000, 3000, 120, 120);
        geo.rotateX(-Math.PI / 2);
        this.water = new THREE.Mesh(geo, this.waterMat);
        this.water.position.y = WATER_Y;
        this.scene.add(this.water);
    }

    buildSky() {
        this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), this.skyMat);
        this.sky.frustumCulled = false;
        this.scene.add(this.sky);
    }

    /** Buissons, touffes d'herbe et fleurs (décor, sans collision). */
    buildDecor() {
        const info = mapInfo();
        const built = new Set(Object.keys(this.map.cols));
        const roadNear = (x, z) => built.has(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`);
        const bushes = [];
        const tufts = [];
        const flowers = [];
        let seed = 1;
        const rnd = () => hash(seed++ * 1.618);
        for (let z = -440; z < 440; z += 4.2) {
            for (let x = -440; x < 440; x += 4.2) {
                const jx = x + (rnd() - 0.5) * 3.5;
                const jz = z + (rnd() - 0.5) * 3.5;
                const i = Math.round((jx + info.half) / info.step);
                const j = Math.round((jz + info.half) / info.step);
                const s = info.splat[j * info.n + i];
                const h = terrainHeight(jx, jz);
                if (h < 1.8 || (s !== 0 && s !== 1 && s !== 6) || roadNear(jx, jz)) continue;
                const r = rnd();
                if (s === 6) { if (r < 0.5) tufts.push([jx, h, jz, 1.3, 0.13]); continue; }
                if (r < (s === 1 ? 0.12 : 0.05)) bushes.push([jx, h, jz, 0.7 + rnd() * 0.8]);
                else if (r < 0.62) tufts.push([jx, h, jz, 0.8 + rnd() * 0.6, rnd()]);
                else if (r < 0.68) flowers.push([jx, h, jz, rnd()]);
            }
        }
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const v = new THREE.Vector3();
        const sc = new THREE.Vector3();
        const col = new THREE.Color();
        const e = new THREE.Euler();

        const bushGeo = mergeGeometries([
            new THREE.IcosahedronGeometry(0.9, 0).translate(0, 0.55, 0),
            new THREE.IcosahedronGeometry(0.7, 0).translate(0.6, 0.45, 0.2),
            new THREE.IcosahedronGeometry(0.65, 0).translate(-0.5, 0.4, -0.3),
        ]);
        this.decorRefs = [];
        this.decorMeshes = [];
        let cat = 'bush';
        const chunked = (list, geo, mat, fill, shadow) => {
            const by = new Map();
            list.forEach((it, k) => {
                const key = `${Math.floor((it[0] + 500) / 200)}:${Math.floor((it[2] + 500) / 200)}`;
                if (!by.has(key)) by.set(key, []);
                by.get(key).push([it, k]);
            });
            for (const items of by.values()) {
                const im = new THREE.InstancedMesh(geo, mat, items.length);
                items.forEach(([it, k], i) => {
                    fill(im, i, it, k);
                    this.decorRefs.push([im, i, it[0], it[2]]);
                });
                this.decorMeshes.push([im, cat]);
                im.castShadow = shadow;
                im.receiveShadow = true;
                im.instanceMatrix.needsUpdate = true;
                im.computeBoundingSphere();
                this.scene.add(im);
            }
        };
        const bushMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
        chunked(bushes, bushGeo, bushMat, (im, i, [x, y, z, s], k) => {
            e.set(0, hash(k) * 6, 0);
            m.compose(v.set(x, y - 0.1, z), q.setFromEuler(e), sc.setScalar(s));
            im.setMatrixAt(i, m);
            im.setColorAt(i, col.setHSL(0.26 + hash(k + 3) * 0.06, 0.55, 0.26 + hash(k + 5) * 0.1));
        }, false);

        // touffe : 5 brins triangulaires
        const blades = [];
        for (let b = 0; b < 5; b++) {
            const a = (b / 5) * Math.PI * 2;
            const g = new THREE.BufferGeometry();
            const bx = Math.cos(a) * 0.12;
            const bz = Math.sin(a) * 0.12;
            g.setAttribute('position', new THREE.Float32BufferAttribute([bx - 0.05, 0, bz, bx + 0.05, 0, bz, bx * 2.4, 0.55 + (b % 2) * 0.15, bz * 2.4], 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
            blades.push(g);
        }
        const tuftGeo = mergeGeometries(blades);
        const tuftMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
        cat = 'tuft';
        chunked(tufts, tuftGeo, tuftMat, (im, i, [x, y, z, s, hue], k) => {
            e.set(0, hash(k + 11) * 6, 0);
            m.compose(v.set(x, y - 0.05, z), q.setFromEuler(e), sc.set(s, s, s));
            im.setMatrixAt(i, m);
            im.setColorAt(i, hue === 0.13 ? col.set(0xd8c463) : col.setHSL(0.24 + hue * 0.08, 0.6, 0.36 + hash(k) * 0.12));
        }, false);

        const flowerGeo = new THREE.IcosahedronGeometry(0.12, 0).translate(0, 0.35, 0);
        const fc = [0xff6b6b, 0xffd93d, 0xffffff, 0xc77dff, 0x4dabf7];
        cat = 'flower';
        chunked(flowers, flowerGeo, new THREE.MeshLambertMaterial(), (im, i, [x, y, z, r]) => {
            m.compose(v.set(x, y, z), q.identity(), sc.setScalar(1));
            im.setMatrixAt(i, m);
            im.setColorAt(i, col.set(fc[Math.floor(r * fc.length)]));
        }, false);
    }

    // ------------------------------------------------------------ arbres, rochers, voitures

    /** (Re)construit les nœuds récoltables. list : [id, k, x, z, s, var][] */
    loadNodes(list) {
        this.nodeGroup.clear();
        this.nodeRefs.clear();
        this.nodeData = new Map();
        const pines = [];
        const leafy = [];
        const rocks = [[], [], []];
        const cars = [];
        const props = [];
        for (const [id, k, x, z, s, v, y0] of list) {
            const y = y0 ?? terrainHeight(x, z);
            const n = { id, k, x, z, s, v, y };
            this.nodeData.set(id, n);
            if (k === 'tree') (v === 0 ? pines : leafy).push(n);
            else if (k === 'rock') rocks[v % 3].push(n);
            else if (k === 'prop') props.push(n);
            else if (k === 'car') cars.push(n);
        }
        this.props.load(props, this.map.deco ?? []);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const p = new THREE.Vector3();
        const sc = new THREE.Vector3();
        const col = new THREE.Color();
        const e = new THREE.Euler();
        const addSet = (parts, all, place) => {
            const byChunk = new Map();
            for (const n of all) {
                const k = `${Math.floor((n.x + 500) / 200)}:${Math.floor((n.z + 500) / 200)}`;
                if (!byChunk.has(k)) byChunk.set(k, []);
                byChunk.get(k).push(n);
            }
            for (const nodes of byChunk.values()) addChunk(parts, nodes, place);
        };
        const addChunk = (parts, nodes, place) => {
            const meshes = parts.map(([geo, material, colorFn, shadow]) => {
                const im = new THREE.InstancedMesh(geo, addDamage(material), Math.max(1, nodes.length));
                im.castShadow = shadow !== false;
                im.receiveShadow = true;
                im.count = nodes.length;
                im.userData.colorFn = colorFn;
                im.userData.dmg = instancedDamage(im);   // fissures, arbre par arbre
                this.nodeGroup.add(im);
                return im;
            });
            nodes.forEach((n, i) => {
                place(n, m);
                const ref = { meshes, index: i, matrix: m.clone() };
                for (const im of meshes) {
                    im.setMatrixAt(i, m);
                    if (im.userData.colorFn) im.setColorAt(i, im.userData.colorFn(n, col));
                }
                this.nodeRefs.set(n.id, ref);
            });
            for (const im of meshes) {
                im.instanceMatrix.needsUpdate = true;
                im.computeBoundingSphere();
            }
        };

        // sapins
        const pineFol = mergeGeometries([
            new THREE.ConeGeometry(2.3, 2.8, 8).translate(0, 3.1, 0),
            new THREE.ConeGeometry(1.8, 2.5, 8).translate(0, 4.6, 0),
            new THREE.ConeGeometry(1.2, 2.2, 8).translate(0, 5.9, 0),
        ]);
        const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 7).translate(0, 1.3, 0);
        const bark = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
        const foliage = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
        const treePlace = (n, out) => {
            e.set((hash(n.id) - 0.5) * 0.06, hash(n.id + 1) * 6.28, (hash(n.id + 2) - 0.5) * 0.06);
            out.compose(p.set(n.x, n.y - 0.1, n.z), q.setFromEuler(e), sc.setScalar(n.s));
        };
        addSet([
            [trunkGeo, bark],
            [pineFol, foliage, (n, c) => c.setHSL(0.33 + hash(n.id + 3) * 0.05, 0.5, 0.2 + hash(n.id + 4) * 0.08)],
        ], pines, treePlace);
        // feuillus
        const leafFol = mergeGeometries([
            new THREE.IcosahedronGeometry(1.9, 1).translate(0, 4.4, 0),
            new THREE.IcosahedronGeometry(1.5, 1).translate(1.1, 3.8, 0.4),
            new THREE.IcosahedronGeometry(1.45, 1).translate(-1.0, 3.9, -0.5),
            new THREE.IcosahedronGeometry(1.3, 1).translate(0.2, 5.4, -0.2),
        ]);
        const trunk2 = new THREE.CylinderGeometry(0.2, 0.32, 3.6, 7).translate(0, 1.8, 0);
        addSet([
            [trunk2, bark],
            [leafFol, foliage, (n, c) => c.setHSL(0.24 + hash(n.id + 3) * 0.08, 0.55, 0.3 + hash(n.id + 4) * 0.1)],
        ], leafy, treePlace);
        // rochers : icosaèdres cabossés
        const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
        rocks.forEach((list2, vi) => {
            const g = new THREE.IcosahedronGeometry(1.25, 1);
            const pa = g.attributes.position;
            for (let i = 0; i < pa.count; i++) {
                p.fromBufferAttribute(pa, i);
                const f = 0.75 + 0.45 * hash(Math.round(p.x * 10) * 3 + Math.round(p.y * 10) * 7 + Math.round(p.z * 10) * 11 + vi * 101);
                pa.setXYZ(i, p.x * f, Math.max(-0.2, p.y * f * 0.8), p.z * f);
            }
            g.computeVertexNormals();
            addSet([[g, rockMat, (n, c) => c.setHSL(0.08, 0.06, 0.42 + hash(n.id) * 0.16)]], list2, (n, out) => {
                e.set(0, hash(n.id) * 6.28, 0);
                out.compose(p.set(n.x, n.y + 0.35 * n.s, n.z), q.setFromEuler(e), sc.set(n.s * 1.1, n.s, n.s));
            });
        });
        // voitures abandonnées
        const carBody = mergeGeometries([
            new THREE.BoxGeometry(4.1, 0.75, 1.85).translate(0, 0.75, 0),
            new THREE.BoxGeometry(2.2, 0.65, 1.65).translate(-0.2, 1.45, 0),
        ]);
        const glass = mergeGeometries([new THREE.BoxGeometry(2.25, 0.45, 1.68).translate(-0.2, 1.48, 0)]);
        const wheels = mergeGeometries([[-1.3, -0.95], [-1.3, 0.95], [1.3, -0.95], [1.3, 0.95]].map(([x, z]) => new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12).rotateX(Math.PI / 2).translate(x, 0.42, z)));
        const carColors = [0xc0392b, 0x2e86de, 0xf1c40f, 0x27ae60, 0xecf0f1];
        addSet([
            [carBody, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.4 }), (n, c) => c.set(carColors[n.v % 5]).multiplyScalar(0.75 + hash(n.id) * 0.25)],
            [glass, new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.6 })],
            [wheels, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })],
        ], cars, (n, out) => {
            e.set(0, n.s, 0);
            out.compose(p.set(n.x, n.y - 0.05, n.z), q.setFromEuler(e), sc.setScalar(1));
        });
    }

    nodeInfo(id) {
        return this.nodeData?.get(id) ?? null;
    }

    removeNode(id) {
        const ref = this.nodeRefs.get(id);
        if (!ref) {
            this.props.remove(id);
            return;
        }
        const m = new THREE.Matrix4().makeScale(0, 0, 0);
        for (const im of ref.meshes) {
            im.setMatrixAt(ref.index, m);
            im.instanceMatrix.needsUpdate = true;
        }
        this.nodeRefs.delete(id);
        this.wobbles = this.wobbles.filter((w) => w.ref !== ref);
    }

    /** Usure d'un arbre, rocher, épave ou meuble (0 à 1) : fissures de plus en plus visibles. */
    setNodeDamage(id, d) {
        const ref = this.nodeRefs.get(id);
        if (!ref) {
            this.props.setDamage(id, d);
            return;
        }
        for (const im of ref.meshes) {
            const a = im.userData.dmg;
            if (!a) continue;
            a.setX(ref.index, d);
            a.needsUpdate = true;
        }
    }

    /** Petit tremblement quand on frappe un arbre / rocher. */
    wobble(id) {
        const ref = this.nodeRefs.get(id);
        if (!ref) return;
        this.wobbles = this.wobbles.filter((w) => w.ref !== ref);
        this.wobbles.push({ ref, t: 0 });
    }

    // ------------------------------------------------------------ coffres

    loadChests(all) {
        this.chestGroup.clear();
        this.chestMeshes.clear();
        this.specials = new Map();
        const list = all.filter((c) => (c[6] ?? 0) < 2);
        const colored = (geo, hex) => {
            const g = geo.index ? geo.toNonIndexed() : geo;
            const c = new THREE.Color(hex);
            const n = g.attributes.position.count;
            const arr = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
            g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
            if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
            return g;
        };
        const WOOD = 0x8b5a2b;
        const GOLD = 0xffc83a;
        const body = mergeGeometries([
            colored(new THREE.BoxGeometry(0.95, 0.5, 0.6).translate(0, 0.25, 0), WOOD),
            colored(new THREE.BoxGeometry(0.1, 0.52, 0.62).translate(-0.33, 0.25, 0), GOLD),
            colored(new THREE.BoxGeometry(0.1, 0.52, 0.62).translate(0.33, 0.25, 0), GOLD),
            colored(new THREE.BoxGeometry(0.14, 0.16, 0.05).translate(0, 0.45, 0.31), GOLD),
        ]);
        // couvercle bombé : demi-cylindre couché le long du coffre, charnière sur le bord arrière (z = 0)
        const lidShape = new THREE.CylinderGeometry(0.3, 0.3, 0.95, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2);
        lidShape.scale(1, 0.7, 1);
        const lid = mergeGeometries([
            colored(lidShape.translate(0, 0, 0.3), WOOD),
            colored(new THREE.BoxGeometry(0.1, 0.24, 0.62).translate(0, 0.06, 0.3), GOLD),
        ]);
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex('planks'), roughness: 0.55, metalness: 0.3, emissive: new THREE.Color(0x3a2400), emissiveIntensity: 0.35 });
        const n = Math.max(1, list.length);
        this.chestBodies = new THREE.InstancedMesh(body, mat, n);
        this.chestLids = new THREE.InstancedMesh(lid, mat, n);
        // caisses de munitions : caisse militaire verte à couvercle plat
        const OLIVE = 0x56663a;
        const STRAP = 0x2b2f24;
        const aBody = mergeGeometries([
            colored(new THREE.BoxGeometry(1.0, 0.42, 0.55).translate(0, 0.21, 0), OLIVE),
            colored(new THREE.BoxGeometry(1.02, 0.08, 0.57).translate(0, 0.08, 0), STRAP),
            colored(new THREE.BoxGeometry(0.06, 0.44, 0.57).translate(-0.3, 0.21, 0), STRAP),
            colored(new THREE.BoxGeometry(0.06, 0.44, 0.57).translate(0.3, 0.21, 0), STRAP),
            colored(new THREE.BoxGeometry(0.3, 0.12, 0.02).translate(0, 0.28, 0.285), 0xd9c36a),
        ]);
        const aLid = mergeGeometries([
            colored(new THREE.BoxGeometry(1.04, 0.1, 0.58).translate(0, 0.05, 0.29), OLIVE),
            colored(new THREE.BoxGeometry(0.2, 0.04, 0.3).translate(0, 0.11, 0.29), 0x9aa080),
        ]);
        this.ammoBodies = new THREE.InstancedMesh(aBody, mat, n);
        this.ammoLids = new THREE.InstancedMesh(aLid, mat, n);
        const zero = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < n; i++) {
            this.chestBodies.setMatrixAt(i, zero);
            this.chestLids.setMatrixAt(i, zero);
            this.ammoBodies.setMatrixAt(i, zero);
            this.ammoLids.setMatrixAt(i, zero);
        }
        for (const im of [this.chestBodies, this.chestLids, this.ammoBodies, this.ammoLids]) {
            im.castShadow = true;
            im.receiveShadow = true;
            this.chestGroup.add(im);
        }
        const glowPos = new Float32Array(n * 3);
        this.chestGlow = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
            map: glowTexture(), color: 0xffd25a, size: 2.6, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        this.chestGlow.geometry.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
        this.chestGlow.frustumCulled = false;
        this.chestGroup.add(this.chestGlow);
        list.forEach(([id, x, y, z, rot, open, k = 0, lobby = 0], i) => {
            const ammo = k === 1;
            const sc = ammo ? 1.2 : 1.45;    // coffres plus gros (comme dans Fortnite)
            const base = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(sc, sc, sc));
            (ammo ? this.ammoBodies : this.chestBodies).setMatrixAt(i, base);
            const data = { id, x, y, z, open: false, ammo, lobby: !!lobby };
            const c = { data, index: i, base, openT: 0, lidRot: 0, lids: ammo ? this.ammoLids : this.chestLids };
            this.chestMeshes.set(id, c);
            glowPos.set([x, ammo ? -9999 : y + 0.75, z], i * 3);
            this.setLid(c, 0);
            if (open) this.setChestOpen(id, true);
        });
        for (const im of [this.chestBodies, this.chestLids, this.ammoBodies, this.ammoLids]) {
            im.instanceMatrix.needsUpdate = true;
            im.computeBoundingSphere();
        }
        for (const c of all) if ((c[6] ?? 0) >= 2) this.addSpecial(c);
    }

    // ------------------------------------------------------------ lamas à butin et largages

    /** c : [id, x, y, z, rot, open, k, lobby, gy] — k = 2 lama, k = 3 largage. */
    addSpecial([id, x, y, z, rot, open, k, , gy]) {
        const obj = k === 2 ? llamaModel() : airdropModel();
        obj.position.set(x, y, z);
        obj.rotation.y = rot;
        this.chestGroup.add(obj);
        const data = { id, x, y, z, open: false, ammo: false, k, lobby: false, falling: k === 3 && gy != null && y > gy + 0.05 };
        const c = { data, special: obj, openT: 0, t: Math.random() * 6 };
        this.chestMeshes.set(id, c);
        this.specials.set(id, c);
        if (obj.userData.balloon) obj.userData.balloon.visible = data.falling;
        if (obj.userData.beam) obj.userData.beam.visible = !data.falling;
        if (open) this.setChestOpen(id, true);
        return c;
    }

    /** Largage qui descend : nouvelle hauteur. */
    setSpecialY(id, y, landed = false) {
        const c = this.specials?.get(id);
        if (!c) return;
        c.targetY = y;
        if (landed) {
            c.data.falling = false;
            c.data.y = y;
            c.special.position.y = y;
            c.balloonUp = 0.0001;
            if (c.special.userData.beam) c.special.userData.beam.visible = !c.data.open;
        }
    }

    /** Coffre (ou objet spécial) déplacé (cratère sous lui). */
    setChestY(id, y) {
        const c = this.chestMeshes.get(id);
        if (!c) return;
        c.data.y = y;
        if (c.special) { c.special.position.y = y; return; }
        c.base.elements[13] = y;
        (c.data.ammo ? this.ammoBodies : this.chestBodies).setMatrixAt(c.index, c.base);
        (c.data.ammo ? this.ammoBodies : this.chestBodies).instanceMatrix.needsUpdate = true;
        this.setLid(c, c.data.open ? -1.9 : 0);
        const pos = this.chestGlow.geometry.attributes.position;
        if (!c.data.open && !c.data.ammo) { pos.setY(c.index, y + 0.75); pos.needsUpdate = true; }
    }

    updateSpecials(dt, time) {
        if (!this.specials) return;
        for (const [id, c] of this.specials) {
            const o = c.special;
            const u = o.userData;
            c.t += dt;
            if (c.data.falling && c.targetY != null) {
                c.data.y += (c.targetY - c.data.y) * Math.min(1, dt * 6);
                o.position.y = c.data.y;
                o.rotation.z = Math.sin(c.t * 1.3) * 0.05;
            }
            if (c.balloonUp > 0 && u.balloon) {
                c.balloonUp += dt;
                u.balloon.position.y += dt * 6;
                u.balloon.scale.setScalar(Math.max(0.01, 1 - c.balloonUp / 3));
                if (c.balloonUp > 3) { u.balloon.visible = false; c.balloonUp = 0; }
            }
            if (u.beam && u.beam.visible) u.beam.material.opacity = 0.22 + Math.sin(time * 3) * 0.06;
            if (c.data.k === 2 && !c.data.open) {
                // le lama se dandine et brille
                u.body.position.y = 0.04 + Math.abs(Math.sin(c.t * 2.2)) * 0.06;
                u.body.rotation.y = Math.sin(c.t * 0.7) * 0.25;
                if (u.sparkle) u.sparkle.material.opacity = 0.5 + Math.sin(time * 5 + id) * 0.25;
            }
            if (c.openT > 0 && c.openT < 1) {
                c.openT = Math.min(1, c.openT + dt * (c.data.k === 2 ? 2.5 : 1.2));
                if (c.data.k === 2) {
                    o.scale.setScalar(Math.max(0.001, 1 + c.openT * 0.6) * (c.openT > 0.25 ? 0 : 1));
                } else if (u.lid) {
                    u.lid.position.y = 1.12 + c.openT * 1.2;
                    u.lid.rotation.x = -c.openT * 1.2;
                    u.lid.visible = c.openT < 0.95;
                }
            }
            if (c.data.open && c.openT >= 1 && c.data.k === 2) o.visible = false;
        }
    }

    // ------------------------------------------------------------ cratères

    /** Relief creusé (indices modifiés du maillage) : sommets, couleur terre brûlée, décor retiré. */
    applyCraters(changed, spots) {
        if (!changed.length && !spots.length) return;
        const info = mapInfo();
        const geo = this.terrain.geometry;
        const pos = geo.attributes.position;
        const col = geo.attributes.color;
        const dirt = new THREE.Color(0x5d4630);
        const c = new THREE.Color();
        for (const k of changed) {
            pos.setY(k, info.h[k]);
            c.setRGB(col.getX(k), col.getY(k), col.getZ(k)).lerp(dirt, 0.65);
            col.setXYZ(k, c.r, c.g, c.b);
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
        const zero = new THREE.Matrix4().makeScale(0, 0, 0);
        const R2 = 9.5 * 9.5;
        const touched = new Set();
        for (const ref of this.decorRefs ?? []) {
            for (const [x, z] of spots) {
                if ((ref[2] - x) ** 2 + (ref[3] - z) ** 2 < R2) {
                    ref[0].setMatrixAt(ref[1], zero);
                    touched.add(ref[0]);
                    break;
                }
            }
        }
        for (const im of touched) im.instanceMatrix.needsUpdate = true;
    }

    // ------------------------------------------------------------ qualité graphique

    setQuality(q) {
        const sun = this.sun;
        const want = q.shadows > 0;
        if (sun.castShadow !== want || (want && sun.shadow.mapSize.x !== q.shadows)) {
            sun.castShadow = want;
            if (want) sun.shadow.mapSize.set(q.shadows, q.shadows);
            sun.shadow.map?.dispose();
            sun.shadow.map = null;
        }
        for (const [im, cat] of this.decorMeshes ?? []) {
            im.visible = q.decor >= 1 || (q.decor > 0 && cat !== 'tuft');
        }
        if (this.props?.setRange) this.props.setRange(q.propsK);
    }

    setLid(c, angle) {
        const m = c.data.ammo
            ? new THREE.Matrix4().makeTranslation(0, 0.42, -0.29).multiply(new THREE.Matrix4().makeRotationX(angle * 0.9))
            : new THREE.Matrix4().makeTranslation(0, 0.5, -0.3).multiply(new THREE.Matrix4().makeRotationX(angle));
        c.lids.setMatrixAt(c.index, c.base.clone().multiply(m));
        c.lids.instanceMatrix.needsUpdate = true;
    }

    setChestOpen(id, instant = false) {
        const c = this.chestMeshes.get(id);
        if (!c || c.data.open) return;
        c.data.open = true;
        if (c.special) {
            c.openT = instant ? 1 : 0.0001;
            const u = c.special.userData;
            if (u.beam) u.beam.visible = false;
            if (u.sparkle) u.sparkle.visible = false;
            if (instant) {
                if (c.data.k === 2) c.special.visible = false;
                else if (u.lid) u.lid.visible = false;
            }
            return;
        }
        const pos = this.chestGlow.geometry.attributes.position;
        pos.setY(c.index, -9999);
        pos.needsUpdate = true;
        c.openT = instant ? 1 : 0.0001;
        if (instant) this.setLid(c, -1.9);
        else if (!c.data.ammo) this.chestBurst(c.data);
    }

    /** Ouverture d'un coffre : gerbe de lumière dorée qui jaillit puis s'éteint. */
    chestBurst(d) {
        this.chestFx ??= [];
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd25a, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.position.set(d.x, d.y + 0.8, d.z);
        glow.scale.setScalar(1.5);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 3.2, 12, 1, true).translate(0, 1.6, 0),
            new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
        beam.position.set(d.x, d.y + 0.55, d.z);
        this.chestGroup.add(glow, beam);
        this.chestFx.push({ glow, beam, t: 0 });
    }

    /** Coffre du lobby qui se referme (rempli à nouveau). */
    setChestClosed(id) {
        const c = this.chestMeshes.get(id);
        if (!c || !c.data.open) return;
        c.data.open = false;
        c.openT = 0;
        this.setLid(c, 0);
        if (!c.data.ammo) {
            const pos = this.chestGlow.geometry.attributes.position;
            pos.setY(c.index, c.data.y + 0.75);
            pos.needsUpdate = true;
        }
    }

    chestPosition(id) {
        const c = this.chestMeshes.get(id);
        return c ? new THREE.Vector3(c.data.x, c.data.y, c.data.z) : null;
    }

    chestList() {
        return [...this.chestMeshes.values()].map((c) => c.data);
    }

    // ------------------------------------------------------------ tempête

    buildStorm() {
        this.stormMat = createStormMaterial();
        const geo = new THREE.CylinderGeometry(1, 1, 600, 128, 1, true);
        this.stormMesh = new THREE.Mesh(geo, this.stormMat);
        this.stormMesh.position.y = 200;
        this.stormMesh.scale.set(560, 1, 560);
        this.stormMesh.frustumCulled = false;
        this.stormMesh.renderOrder = 2;
        this.scene.add(this.stormMesh);
        this.storm = { x: 0, z: 0, r: 560 };
    }

    setStorm(s) {
        if (!s) return;
        this.storm = s;
        this.stormMesh.position.x = s.x;
        this.stormMesh.position.z = s.z;
        const r = Math.max(0.5, s.r);
        this.stormMesh.scale.set(r, 1, r);
        this.stormMat.uniforms.uRadius.value = r;
    }

    inStorm(x, z) {
        const s = this.storm;
        return Math.hypot(x - s.x, z - s.z) > s.r;
    }

    // ------------------------------------------------------------ montgolfière

    buildBalloon() {
        const g = new THREE.Group();
        const pts = [];
        for (let i = 0; i <= 24; i++) {
            const t = i / 24;
            const a = t * Math.PI;
            const r = Math.sin(a) * 9.5 * (1 - 0.35 * Math.max(0, 1 - t * 2.2));
            pts.push(new THREE.Vector2(Math.max(1.2, r), 7 + t * 22 - Math.sin(a) * 1.5));
        }
        pts[0].set(1.4, 7);
        const env = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), new THREE.MeshStandardMaterial({
            map: stripes(['#ff4d4d', '#ffd23f', '#3ec1ff', '#ffffff', '#7bd93f', '#ff8c1a'], 16), roughness: 0.6, side: THREE.DoubleSide,
        }));
        env.castShadow = true;
        g.add(env);
        const basket = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.6, 1.4, 16), new THREE.MeshStandardMaterial({ map: tex('logs'), color: 0xd9b27c, roughness: 0.9 }));
        basket.position.y = 0.7;
        basket.castShadow = true;
        g.add(basket);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.12, 8, 24), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }));
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 1.4;
        g.add(rim);
        const ropes = [];
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ropes.push(Math.cos(a) * 1.8, 1.4, Math.sin(a) * 1.8, Math.cos(a) * 1.5, 7.2, Math.sin(a) * 1.5);
        }
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.Float32BufferAttribute(ropes, 3));
        g.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x3a2a1a })));
        const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8, roughness: 0.3 }));
        burner.position.y = 4.2;
        g.add(burner);
        this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.2, 12), new THREE.MeshBasicMaterial({ color: 0xffa52a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.flame.position.y = 5.6;
        g.add(this.flame);
        this.flameLight = new THREE.PointLight(0xffa040, 30, 30, 2);
        this.flameLight.position.y = 6;
        g.add(this.flameLight);
        g.visible = false;
        this.scene.add(g);
        return g;
    }

    /**
     * Montgolfière : avance à vitesse constante entre deux instantanés (extrapolation),
     * avec une correction douce : plus d'à-coups.
     */
    setBalloon(b, dt, age = 0) {
        if (!b) {
            this.balloon.visible = false;
            return;
        }
        const dx = b.b[0] - b.a[0];
        const dz = b.b[1] - b.a[1];
        const l = Math.hypot(dx, dz) || 1;
        const v = 19;   // BALLOON_SPEED du serveur
        const target = new THREE.Vector3(b.p[0] + (dx / l) * v * age, b.p[1], b.p[2] + (dz / l) * v * age);
        if (!this.balloon.visible || this.balloon.position.distanceTo(target) > 30) this.balloon.position.copy(target);
        else {
            this.balloon.position.x += (dx / l) * v * dt;
            this.balloon.position.z += (dz / l) * v * dt;
            this.balloon.position.lerp(target, 1 - Math.exp(-dt * 1.5));
        }
        this.balloon.visible = true;
        this.balloon.rotation.y = Math.atan2(b.b[0] - b.a[0], b.b[1] - b.a[1]);
        this.balloon.rotation.z = Math.sin(this.time * 0.7) * 0.03;
    }

    // ------------------------------------------------------------ animation

    update(dt, time, focus, camPos) {
        this.time = time;
        this.waterMat.uniforms.uTime.value = time;
        this.skyMat.uniforms.uTime.value = time;
        this.stormMat.uniforms.uTime.value = time;
        if (camPos) this.sky.position.copy(camPos);
        this.water.position.x = Math.round(focus.x / 25) * 25;
        this.water.position.z = Math.round(focus.z / 25) * 25;
        this.sun.target.position.set(focus.x, focus.y, focus.z);
        this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIR, 250);
        if (this.balloon.visible) {
            const f = 0.85 + Math.sin(time * 23) * 0.1 + Math.sin(time * 37) * 0.05;
            this.flame.scale.set(f, f * (1 + Math.sin(time * 9) * 0.1), f);
            this.flameLight.intensity = 25 + Math.sin(time * 31) * 8;
        }
        for (const c of this.chestMeshes.values()) {
            if (!c.special && c.openT > 0 && c.openT < 1) {
                c.openT = Math.min(1, c.openT + dt * 3.5);
                this.setLid(c, -1.9 * (1 - (1 - c.openT) ** 3));
            }
        }
        if (this.chestGlow) this.chestGlow.material.opacity = 0.45 + Math.sin(time * 4) * 0.12;
        this.updateSpecials(dt, time);
        if (this.chestFx?.length) {
            this.chestFx = this.chestFx.filter((f) => {
                f.t += dt;
                const k = f.t / 1.1;
                f.glow.scale.setScalar(1.5 + k * 2.5);
                f.glow.material.opacity = Math.max(0, 0.95 * (1 - k));
                f.beam.scale.set(1 - k * 0.6, 0.4 + k * 1.2, 1 - k * 0.6);
                f.beam.material.opacity = Math.max(0, 0.55 * (1 - k));
                if (k < 1) return true;
                this.chestGroup.remove(f.glow, f.beam);
                f.glow.material.dispose();
                f.beam.geometry.dispose();
                f.beam.material.dispose();
                return false;
            });
        }
        this.pads.update(dt);
        this.shops.update(dt);
        this.props.update(camPos ?? focus);
        const m = new THREE.Matrix4();
        const r = new THREE.Matrix4();
        this.wobbles = this.wobbles.filter((w) => {
            w.t += dt;
            const k = Math.max(0, 1 - w.t / 0.35);
            r.makeRotationZ(Math.sin(w.t * 40) * 0.06 * k);
            m.copy(w.ref.matrix).multiply(r);
            for (const im of w.ref.meshes) {
                im.setMatrixAt(w.ref.index, k > 0 ? m : w.ref.matrix);
                im.instanceMatrix.needsUpdate = true;
            }
            return k > 0;
        });
    }
}
