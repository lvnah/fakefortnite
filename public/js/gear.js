// Équipement militaire modulaire des tenues « opérateur » : casque, jumelles de vision
// nocturne, lunettes, cagoule, gilet porte-plaques avec ses poches, radio, sac et
// genouillères. Tout est construit en géométrie simple et accroché aux os du squelette,
// donc ça suit les animations sans toucher aux modèles d'origine.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Camouflages disponibles pour les gilets et les poches. */
export const CAMOS = {
    multicam: { base: 0x7d7048, patch: 0x8e7f4f, trim: 0x4c4634 },
    ranger: { base: 0x5c5a4a, patch: 0x6b6957, trim: 0x343227 },
    black: { base: 0x2a2d31, patch: 0x3a3e44, trim: 0x16181b },
    woodland: { base: 0x4a5a3a, patch: 0x5a6a44, trim: 0x2a3322 },
};

const MATS = new Map();
function mat(color, rough = 0.85, metal = 0.03) {
    const k = `${color}:${rough}:${metal}`;
    if (!MATS.has(k)) MATS.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
    return MATS.get(k);
}

/** Boîte arrondie bon marché (pas de RoundedBox : on reste léger). */
function box(w, h, d, x = 0, y = 0, z = 0) {
    return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/**
 * Casque balistique : calotte, bord, rails latéraux et support de jumelles.
 * Construit autour de l'origine de l'os de tête, échelle 1 = tête de 0,26 m.
 */
function helmet(c) {
    const parts = [];
    const shell = new THREE.SphereGeometry(0.145, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
    parts.push(shell.translate(0, 0.055, 0));
    parts.push(new THREE.TorusGeometry(0.142, 0.012, 6, 18).rotateX(Math.PI / 2).translate(0, 0.05, 0));
    // rails : deux plaques sur les côtés
    for (const sx of [-1, 1]) parts.push(box(0.012, 0.035, 0.16, sx * 0.142, 0.07, -0.005));
    const g = mergeGeometries(parts);
    const m = new THREE.Mesh(g, mat(c.trim, 0.72, 0.08));
    m.castShadow = true;
    return m;
}

/** Support + jumelles de vision nocturne relevées sur le casque. */
function nvg(c) {
    const g = new THREE.Group();
    const arm = new THREE.Mesh(box(0.045, 0.085, 0.03, 0, 0.17, 0.1), mat(0x1d2024, 0.6, 0.25));
    const bridge = new THREE.Mesh(box(0.1, 0.03, 0.04, 0, 0.215, 0.13), mat(0x1d2024, 0.6, 0.25));
    g.add(arm, bridge);
    for (const sx of [-1, 1]) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.085, 10), mat(0x15181b, 0.5, 0.3));
        tube.rotation.x = Math.PI / 2;
        tube.position.set(sx * 0.034, 0.215, 0.175);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 12), mat(0x1b3b2a, 0.15, 0.6));
        lens.position.set(sx * 0.034, 0.215, 0.218);
        g.add(tube, lens);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
}

/** Lunettes de protection remontées sur le casque. */
function goggles() {
    const g = new THREE.Group();
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.138, 0.016, 6, 18), mat(0x202327, 0.9));
    strap.rotation.x = Math.PI / 2;
    strap.position.y = 0.012;
    const lens = new THREE.Mesh(box(0.2, 0.055, 0.03, 0, 0.012, 0.125), mat(0x6a7c52, 0.18, 0.45));
    g.add(strap, lens);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
}

/** Cagoule / cache-cou. */
function mask() {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 9, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.42),
        mat(0x24262a, 0.95));
    m.position.y = -0.01;
    m.castShadow = true;
    return m;
}

/**
 * Gilet porte-plaques : plastron, dossard, ceinture et poches (chargeurs, radio,
 * trousse). Construit autour de l'os de poitrine.
 */
function carrier(c, pouches = 5) {
    const parts = [];
    parts.push(box(0.4, 0.44, 0.17, 0, 0.1, 0.02));                 // plastron + dossard
    parts.push(box(0.46, 0.1, 0.2, 0, -0.14, 0.02));                // ceinture
    for (const sx of [-1, 1]) parts.push(box(0.07, 0.3, 0.12, sx * 0.21, 0.1, 0.02));   // épaulières
    const g = mergeGeometries(parts);
    const grp = new THREE.Group();
    const body = new THREE.Mesh(g, mat(c.base, 0.9));
    body.castShadow = true;
    grp.add(body);
    // poches de chargeurs sur le plastron
    const pouch = [];
    for (let i = 0; i < pouches; i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        pouch.push(box(0.09, 0.12, 0.06, (col - 1) * 0.1, 0.06 - row * 0.14, 0.115));
    }
    const pm = new THREE.Mesh(mergeGeometries(pouch), mat(c.patch, 0.95));
    pm.castShadow = true;
    grp.add(pm);
    // radio à l'épaule gauche et trousse à la ceinture
    const radio = new THREE.Mesh(box(0.05, 0.1, 0.04, -0.2, 0.19, 0.08), mat(0x1c1f22, 0.7, 0.2));
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 5), mat(0x15181b, 0.6));
    ant.position.set(-0.2, 0.3, 0.07);
    const kit = new THREE.Mesh(box(0.1, 0.07, 0.06, 0.18, -0.15, 0.09), mat(0x7a2a24, 0.9));
    grp.add(radio, ant, kit);
    return grp;
}

/** Sac à dos plat avec sa poche hydratation. */
function pack(c) {
    const parts = [box(0.3, 0.36, 0.13, 0, 0.1, -0.14), box(0.18, 0.14, 0.09, 0, -0.03, -0.2)];
    const m = new THREE.Mesh(mergeGeometries(parts), mat(c.trim, 0.95));
    m.castShadow = true;
    return m;
}

/**
 * Habille un personnage : accroche l'équipement aux os fournis.
 * bones : { head, chest } — les os du squelette déjà chargés.
 * gear  : { helmet, nvg, goggles, mask, carrier, pouches, pack, camo }
 * scale : facteur appliqué (les modèles sont mis à l'échelle de CHAR_HEIGHT).
 */
export function dressCharacter(bones, gear = {}, scale = 1) {
    const c = CAMOS[gear.camo] ?? CAMOS.multicam;
    const added = [];
    const put = (parent, obj, k = 1) => {
        if (!parent || !obj) return;
        obj.scale.multiplyScalar(k / scale);
        parent.add(obj);
        added.push(obj);
    };
    if (bones.head) {
        if (gear.mask) put(bones.head, mask());
        if (gear.goggles) put(bones.head, goggles());
        if (gear.helmet) put(bones.head, helmet(c));
        if (gear.nvg) put(bones.head, nvg(c));
    }
    if (bones.chest) {
        if (gear.carrier) put(bones.chest, carrier(c, gear.pouches ?? 5));
        if (gear.pack) put(bones.chest, pack(c));
    }
    return added;
}
