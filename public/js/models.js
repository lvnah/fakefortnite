// Modèles 3D (glTF) : personnages KayKit animés, meubles, décor de ville et voitures.
// Packs CC0 de Kay Lousberg (kaylousberg.com) — voir LISEZMOI.md.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, deinterleaveGeometry } from 'three/addons/utils/BufferGeometryUtils.js';

const loader = new GLTFLoader();
const BASE = new URL('../models/', import.meta.url).href;
const cache = new Map();
function load(file) {
    if (!cache.has(file)) cache.set(file, loader.loadAsync(BASE + file));
    return cache.get(file);
}

// ------------------------------------------------------------ personnages

export const CHAR_SCALE = 0.8;
export const SKIN_IDS = ['knight', 'barbarian', 'mage', 'rogue', 'hooded', 'skel_warrior', 'skel_mage', 'skel_rogue', 'skel_minion', 'homme', 'femme'];
/** Personnages à taille humaine (Quaternius, CC0) : leur propre squelette et leurs animations. */
const Q_SKINS = new Set(['homme', 'femme']);
export const rigOf = (id) => (Q_SKINS.has(id) ? 'q' : 'kay');

/** Os du haut du corps (noms nettoyés par GLTFLoader : « upperarm.l » devient « upperarml »). */
const UPPER = new Set(['chest', 'head', 'upperarml', 'lowerarml', 'wristl', 'handl', 'upperarmr', 'lowerarmr', 'wristr', 'handr']);

const skinCache = new Map();
/** Charge un skin et fusionne ses morceaux déformés (bras, corps, tête…) en un seul maillage : 1 appel de rendu. */
export function loadSkin(id) {
    const key = SKIN_IDS.includes(id) ? id : 'knight';
    if (!skinCache.has(key)) {
        skinCache.set(key, load(Q_SKINS.has(key) ? `chars/q_${key}.glb` : `chars/${key}.glb`).then((g) => {
            mergeSkinned(g.scene);
            return g;
        }));
    }
    return skinCache.get(key);
}

function mergeSkinned(scene) {
    const groups = new Map();
    scene.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const k = `${o.parent.uuid}|${o.material.uuid}|${o.skeleton.uuid}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(o);
    });
    for (const list of groups.values()) {
        if (list.length < 2) continue;
        const first = list[0];
        if (!list.every((m) => m.bindMatrix.equals(first.bindMatrix) && m.matrix.equals(first.matrix))) continue;
        const geos = list.map((m) => {
            const g = m.geometry.clone();
            deinterleaveGeometry(g);
            for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(a)) g.deleteAttribute(a);
            return g.index ? g : g;
        });
        const allIdx = geos.every((g) => g.index);
        const merged = mergeGeometries(allIdx ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
        if (!merged) continue;
        const sm = new THREE.SkinnedMesh(merged, first.material);
        sm.name = 'corps';
        sm.position.copy(first.position);
        sm.quaternion.copy(first.quaternion);
        sm.scale.copy(first.scale);
        first.parent.add(sm);
        sm.bind(first.skeleton, first.bindMatrix);
        for (const m of list) m.parent.remove(m);
    }
}

/** Haut du corps du squelette Quaternius : à partir de spine_03 (poitrine). */
const UPPER_Q = new Set(['spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r']);

function splitClips(list, upperSet) {
    const out = new Map();
    for (const clip of list) {
        const upper = clip.clone();
        const lower = clip.clone();
        upper.tracks = clip.tracks.filter((t) => upperSet.has(t.name.split('.')[0]));
        lower.tracks = clip.tracks.filter((t) => !upperSet.has(t.name.split('.')[0]));
        upper.name = `${clip.name}|U`;
        lower.name = `${clip.name}|L`;
        out.set(clip.name, { full: clip, upper, lower, duration: clip.duration });
    }
    return out;
}

const animsP = new Map();
/** Animations partagées par tous les personnages d'un même squelette, découpées en haut / bas du corps. */
export function loadAnims(rig = 'kay') {
    if (!animsP.has(rig)) {
        animsP.set(rig, rig === 'q'
            ? load('animsq.glb').then((g) => splitClips(g.animations, UPPER_Q))
            : Promise.all([load('anims.glb'), load('anims2.glb').catch(() => ({ animations: [] }))])
                .then(([g, g2]) => splitClips([...g.animations, ...g2.animations], UPPER)));
    }
    return animsP.get(rig);
}

/** Précharge les animations et les skins demandés. */
export function preloadCharacters(ids = []) {
    return Promise.all([loadAnims(), ...ids.map((id) => loadSkin(id))]);
}

// ------------------------------------------------------------ décor (meubles, ville, voitures)

const SCALE = {
    couch: 0.75, armchair: 0.75, bed2: 0.75, bed1: 0.75, cabinet: 0.75, chair: 0.75, lamp: 0.75, rug: 0.75, shelf: 0.75,
    table: 0.75, tablelow: 0.75, cactus: 0.75, frame: 0.75, fridge: 0.75, counter: 0.75, sink: 0.75, stove: 0.75, rtable: 0.75,
    kchair: 0.75, crates: 0.75, crate2: 0.75,
    bench: 4.6, dumpster: 4.6, streetlight: 4.6, hydrant: 4.6, trash: 4.6, boxes: 4.6, watertower: 16,
    car_sedan: 4.6, car_taxi: 4.6, car_police: 4.6, car_hatchback: 4.6, car_wagon: 4.6,
};

let propsP = null;
/**
 * Charge props.glb. Renvoie get(clé) -> [{ geometry, material }] : géométries fusionnées par
 * matériau, à l'échelle du jeu, prêtes pour des InstancedMesh ; et model(clé) -> Group (voitures).
 */
export function loadProps() {
    propsP ??= load('props.glb').then((g) => {
        const parts = new Map();
        const roots = new Map();
        g.scene.updateMatrixWorld(true);
        for (const node of g.scene.children) {
            const key = node.name;
            const s = SCALE[key] ?? 1;
            const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
            const scale = new THREE.Matrix4().makeScale(s, s, s);
            const byMat = new Map();
            node.traverse((o) => {
                if (!o.isMesh) return;
                const geo = o.geometry.clone();
                deinterleaveGeometry(geo);
                geo.applyMatrix4(scale.clone().multiply(inv).multiply(o.matrixWorld));
                for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
                const mat = o.material;
                if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
                mat.roughness = Math.max(mat.roughness ?? 1, 0.6);
                mat.metalness = Math.min(mat.metalness ?? 0, 0.3);
                if (!byMat.has(mat)) byMat.set(mat, []);
                byMat.get(mat).push(geo);
            });
            const list = [];
            for (const [mat, geos] of byMat) {
                const all = geos.every((q) => q.index) || geos.every((q) => !q.index) ? geos : geos.map((q) => (q.index ? q.toNonIndexed() : q));
                const merged = all.length > 1 ? mergeGeometries(all, false) : all[0];
                if (merged) list.push({ geometry: merged, material: mat });
            }
            parts.set(key, list);
            roots.set(key, node);
        }
        return {
            keys: [...parts.keys()],
            get: (key) => parts.get(key) ?? [],
            model(key) {
                const grp = new THREE.Group();
                for (const { geometry, material } of parts.get(key) ?? []) {
                    const m = new THREE.Mesh(geometry, material);
                    m.castShadow = true;
                    m.receiveShadow = true;
                    grp.add(m);
                }
                return grp;
            },
        };
    });
    return propsP;
}
