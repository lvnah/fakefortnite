// Objets : noms, raretés, modèles 3D (armes en main et objets au sol) et icônes de l'interface.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeStatic } from './merge.js';

export const RARITY_NAMES = ['Commun', 'Peu commun', 'Rare', 'Épique', 'Légendaire'];
export const RARITY_COLORS = ['#a7aeb5', '#5ccf4a', '#3d9bff', '#b55cff', '#ffad1f'];
export const ITEM_NAMES = {
    pistol: 'Pistolet',
    smg: 'Mitraillette',
    ar: "Fusil d'assaut",
    pump: 'Fusil à pompe',
    sniper: 'Sniper',
    rocket: 'Lance-roquettes',
    pad: 'Plateforme de saut',
    bandage: 'Bandages',
    medkit: 'Trousse de soin',
    grenade: 'Grenade',
    smoke: 'Fumigène',
    plate: 'Plaque de gilet',
};
/** Description courte (infobulle de l'inventaire). */
export const ITEM_INFO = {
    bandage: '+30 PV', medkit: 'PV au maximum', grenade: 'Creuse un cratère', smoke: 'Rideau de fumée',
    pad: 'Se pose au sol, propulse en l\'air', plate: '+50 d\'armure (touche plaques)',
};
export const AMMO_NAMES = { light: 'Munitions légères', medium: 'Munitions moyennes', shells: 'Cartouches', heavy: 'Munitions lourdes', rockets: 'Roquettes' };
export const AMMO_SHORT = { light: 'Légères', medium: 'Moyennes', shells: 'Cartouches', heavy: 'Lourdes', rockets: 'Roquettes' };
export const WEAPON_AMMO = { pistol: 'light', smg: 'light', ar: 'medium', pump: 'shells', sniper: 'heavy', rocket: 'rockets' };
export const WEAPONS = ['pistol', 'smg', 'ar', 'pump', 'sniper', 'rocket'];
/** Armes et équipements proposés dans « Créer une classe ». */
export const LOADOUT_WEAPONS = ['pistol', 'smg', 'ar', 'pump', 'sniper', 'rocket'];
export const LETHALS = ['grenade', 'smoke'];
export const TACTICALS = ['bandage', 'medkit'];
export const UTILS = ['pad'];

/** Accessoires d'arme (miroir de ATTACHMENTS côté serveur) : visée, tenue, portée, chargeur. */
export const ATTACHMENTS = {
    holo: { name: 'Viseur holographique', desc: 'Tir en visée bien plus droit, mise en joue plus rapide' },
    scope: { name: 'Lunette 4×', desc: 'Visée très précise et plus longue portée, mise en joue plus lente' },
    laser: { name: 'Laser', desc: 'Tir au jugé nettement plus groupé' },
    grip: { name: 'Poignée avant', desc: 'Recul mieux tenu en rafale' },
    heavy: { name: 'Canon lourd', desc: 'Plus de portée utile, déplacement un peu plus lent' },
    mag: { name: 'Chargeur étendu', desc: 'Chargeur de moitié plus grand' },
    stock: { name: 'Crosse légère', desc: 'Déplacement et mise en joue plus rapides, recul un peu moins tenu' },
};
export const ATTACH_MAX = 3;

/** Atouts (miroir de PERKS côté serveur) : deux par classe. */
export const PERKS = {
    athlete: { name: 'Athlète', desc: 'Sprint tactique bien plus long' },
    light: { name: 'Léger', desc: 'Déplacement 8 % plus rapide' },
    medic: { name: 'Infirmier', desc: 'Soins et plaques 35 % plus rapides' },
    quickfix: { name: 'Mains sûres', desc: 'Rechargement 25 % plus rapide' },
    scavenger: { name: 'Charognard', desc: 'Munitions ramassées × 1,5' },
    carrier: { name: 'Porteur', desc: '8 plaques au lieu de 5' },
};
export const PERK_SLOTS = 2;
export const CONSUMABLES = ['bandage', 'medkit', 'pad', 'grenade', 'smoke'];

export function itemName(it) {
    if (!it) return '';
    if (it.type === 'ammo') return `${AMMO_NAMES[it.a]} (${it.n})`;
    if (it.type === 'cash') return `${it.n.toLocaleString('fr-FR')} $`;
    const base = ITEM_NAMES[it.type] ?? it.type;
    return it.n > 1 ? `${base} (${it.n})` : base;
}

export function rarityOf(it) {
    return it && typeof it.r === 'number' ? it.r : 0;
}

// ------------------------------------------------------------ modèles 3D

const G = new Map();
function rb(w, h, d, r = 0.012) {
    const k = `${w}:${h}:${d}:${r}`;
    if (!G.has(k)) G.set(k, new RoundedBoxGeometry(w, h, d, 2, r));
    return G.get(k);
}
function cyl(r, len, seg = 12) {
    const k = `c:${r}:${len}:${seg}`;
    if (!G.has(k)) {
        const g = new THREE.CylinderGeometry(r, r, len, seg);
        g.rotateX(Math.PI / 2);
        G.set(k, g);
    }
    return G.get(k);
}
const M = new Map();
function m(color, opts = {}) {
    const k = `${color}:${JSON.stringify(opts)}`;
    if (!M.has(k)) M.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35, ...opts }));
    return M.get(k);
}
function part(g, geo, material, x, y, z, rx = 0) {
    const o = new THREE.Mesh(geo, material);
    o.position.set(x, y, z);
    o.rotation.x = rx;
    o.castShadow = true;
    g.add(o);
    return o;
}
function muzzleAt(g, z, y = 0.04) {
    const mz = new THREE.Object3D();
    mz.name = 'muzzle';
    mz.position.set(0, y, z);
    g.add(mz);
}

/** Modèle d'arme pointant vers +z, poignée à l'origine. */
export function weaponModel(type, rarity = 0) {
    const g = new THREE.Group();
    const rc = new THREE.Color(RARITY_COLORS[rarity] ?? RARITY_COLORS[0]);
    const legendary = rarity === 4;
    const dark = m(legendary ? 0xb8860b : 0x2d3138, legendary ? { metalness: 0.8, roughness: 0.3 } : {});
    const mid = m(legendary ? 0xd4a017 : 0x4a5059, legendary ? { metalness: 0.8, roughness: 0.25 } : {});
    const accent = m(rc.getHex(), { roughness: 0.4, metalness: 0.2, emissive: rc, emissiveIntensity: rarity >= 3 ? 0.35 : 0.08 });
    const wood = m(0x7a4a24, { metalness: 0, roughness: 0.7 });
    switch (type) {
        case 'pistol':
            part(g, rb(0.045, 0.06, 0.22), mid, 0, 0.06, 0.07);
            part(g, rb(0.04, 0.035, 0.16), dark, 0, 0.02, 0.06);
            part(g, rb(0.038, 0.12, 0.055), accent, 0, -0.03, -0.01, 0.3);
            part(g, rb(0.01, 0.02, 0.05), dark, 0, 0.0, 0.05);
            muzzleAt(g, 0.19, 0.06);
            break;
        case 'smg':
            part(g, rb(0.06, 0.09, 0.32), mid, 0, 0.05, 0.08);
            part(g, rb(0.062, 0.03, 0.2), accent, 0, 0.1, 0.1);
            part(g, cyl(0.015, 0.12), dark, 0, 0.06, 0.29);
            part(g, rb(0.035, 0.17, 0.05), dark, 0, -0.07, 0.12, 0.1);
            part(g, rb(0.035, 0.1, 0.045), dark, 0, -0.04, -0.01, 0.3);
            part(g, rb(0.03, 0.08, 0.03), dark, 0, -0.03, 0.2);
            part(g, rb(0.04, 0.05, 0.14), accent, 0, 0.04, -0.13);
            muzzleAt(g, 0.36, 0.06);
            break;
        case 'ar':
            part(g, rb(0.06, 0.1, 0.42), mid, 0, 0.05, 0.12);
            part(g, rb(0.066, 0.075, 0.2), accent, 0, 0.06, 0.32);
            part(g, cyl(0.016, 0.2), dark, 0, 0.065, 0.5);
            part(g, rb(0.042, 0.17, 0.07), dark, 0, -0.07, 0.15, 0.3);
            part(g, rb(0.036, 0.1, 0.046), dark, 0, -0.04, -0.01, 0.3);
            part(g, rb(0.05, 0.11, 0.24), accent, 0, 0.03, -0.2);
            part(g, rb(0.035, 0.045, 0.09), dark, 0, 0.12, 0.1);
            part(g, cyl(0.016, 0.05), m(0x111111), 0, 0.15, 0.1);
            muzzleAt(g, 0.61, 0.065);
            break;
        case 'pump':
            part(g, cyl(0.022, 0.6), dark, 0, 0.06, 0.34);
            part(g, cyl(0.018, 0.46), mid, 0, 0.015, 0.3);
            part(g, cyl(0.032, 0.15), wood, 0, 0.015, 0.33);
            part(g, rb(0.06, 0.1, 0.18), accent, 0, 0.04, 0.03);
            part(g, rb(0.036, 0.1, 0.046), dark, 0, -0.04, -0.04, 0.4);
            part(g, rb(0.05, 0.1, 0.28), wood, 0, 0.0, -0.2, -0.12);
            muzzleAt(g, 0.65, 0.06);
            break;
        case 'sniper':
            part(g, cyl(0.016, 0.78), dark, 0, 0.055, 0.55);
            part(g, rb(0.055, 0.085, 0.38), accent, 0, 0.04, 0.08);
            part(g, cyl(0.03, 0.34), m(0x111111), 0, 0.13, 0.1);
            part(g, cyl(0.036, 0.04), mid, 0, 0.13, 0.27);
            part(g, cyl(0.036, 0.04), mid, 0, 0.13, -0.07);
            part(g, rb(0.036, 0.1, 0.046), dark, 0, -0.04, -0.03, 0.35);
            part(g, rb(0.05, 0.12, 0.3), mid, 0, 0.0, -0.24, -0.1);
            part(g, rb(0.02, 0.02, 0.06), mid, 0.04, 0.07, 0.0);
            muzzleAt(g, 0.95, 0.055);
            break;
        case 'rocket': {
            const olive = m(legendary ? 0xb8860b : 0x4b5d33, { metalness: 0.3, roughness: 0.6 });
            part(g, cyl(0.075, 1.05, 14), olive, 0, 0.1, 0.18);
            part(g, cyl(0.09, 0.12, 14), dark, 0, 0.1, 0.72);
            part(g, cyl(0.085, 0.1, 14), dark, 0, 0.1, -0.36);
            part(g, rb(0.08, 0.06, 0.3), accent, 0, 0.19, 0.2);
            part(g, rb(0.036, 0.12, 0.05), dark, 0, -0.03, 0.0, 0.2);
            part(g, rb(0.036, 0.1, 0.05), dark, 0, -0.02, 0.32, 0.1);
            part(g, rb(0.03, 0.06, 0.05), m(0x111111), 0.07, 0.2, 0.2);
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 10), m(0x8a2a1a));
            tip.rotation.x = Math.PI / 2;
            tip.position.set(0, 0.1, 0.82);
            g.add(tip);
            muzzleAt(g, 0.9, 0.1);
            break;
        }
        default:
            if (CONSUMABLES.includes(type)) return heldModel(type);
            return null;
    }
    mergeStatic(g, WEAPON_MAT);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
}
const WEAPON_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.4 });

const AMMO_COLOR = { light: 0x7fa3c7, medium: 0x6e8b4a, shells: 0xc23b2b, heavy: 0x3a3a3a, rockets: 0x5a6b3a };

/** Modèle d'un objet au sol. */
export function dropModel(it) {
    const g = new THREE.Group();
    if (WEAPONS.includes(it.type)) {
        const w = weaponModel(it.type, rarityOf(it));
        w.scale.setScalar(1.7);
        w.rotation.set(0, Math.PI / 2, 0.15);
        w.position.y = 0.1;
        g.add(w);
    } else if (it.type === 'ammo') {
        part(g, rb(0.36, 0.2, 0.26, 0.02), m(AMMO_COLOR[it.a], { metalness: 0.3 }), 0, 0.1, 0);
        part(g, rb(0.37, 0.05, 0.27, 0.01), m(0xe6b422, { metalness: 0.2 }), 0, 0.16, 0);
        for (let i = 0; i < 3; i++) part(g, cyl(0.025, 0.06), m(0xd4a64a, { metalness: 0.9, roughness: 0.2 }), -0.08 + i * 0.08, 0.24, 0, Math.PI / 2);
    } else if (it.type === 'cash') {
        // liasse de billets, cerclée d'un bandeau
        const bill = m(0x4f9e5c, { metalness: 0, roughness: 0.85 });
        for (let i = 0; i < 4; i++) {
            const b = part(g, rb(0.34, 0.035, 0.18, 0.01), bill, 0, 0.04 + i * 0.045, 0);
            b.rotation.y = (i - 1.5) * 0.14;
        }
        part(g, rb(0.08, 0.2, 0.2, 0.01), m(0xe8c23a, { metalness: 0.2, roughness: 0.6 }), 0, 0.12, 0);
    } else if (it.type === 'bandage') {
        for (const x of [-0.08, 0.08]) part(g, cyl(0.08, 0.12, 16), m(0xf3efe4, { metalness: 0, roughness: 0.9 }), x, 0.08, 0).rotation.y = Math.PI / 2;
    } else if (it.type === 'medkit') {
        part(g, rb(0.42, 0.22, 0.3, 0.04), m(0xf4f4f4, { metalness: 0.1 }), 0, 0.12, 0);
        part(g, rb(0.2, 0.02, 0.06, 0.005), m(0xe02424), 0, 0.235, 0);
        part(g, rb(0.06, 0.02, 0.2, 0.005), m(0xe02424), 0, 0.235, 0);
        part(g, rb(0.14, 0.04, 0.03, 0.01), m(0x333333), 0, 0.25, 0);
    } else if (it.type === 'pad') {
        part(g, new THREE.CylinderGeometry(0.32, 0.36, 0.08, 20), m(0x2a2f3a), 0, 0.04, 0);
        part(g, new THREE.CylinderGeometry(0.26, 0.26, 0.03, 20), m(0x37e0ff, { emissive: new THREE.Color(0x19b8ff), emissiveIntensity: 0.9 }), 0, 0.09, 0);
    } else if (POTIONS[it.type]) {
        g.add(potionModel(it.type));
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    return g;
}

// ------------------------------------------------------------ potions, cruche, grenade

const POTIONS = { grenade: 1, smoke: 1, plate: 1 };

/** Modèle d'une grenade, d'un fumigène ou d'une plaque de gilet (origine au pied). */
export function potionModel(type) {
    const g = new THREE.Group();
    if (type === 'plate') {
        // plaque de céramique : un rectangle bombé, sangle et poignée
        const face = m(0x3c4a3a, { roughness: 0.75, metalness: 0.08 });
        const edge = m(0x242b22, { roughness: 0.9 });
        part(g, rb(0.26, 0.34, 0.05, 0.02), face, 0, 0.18, 0);
        part(g, rb(0.28, 0.06, 0.06, 0.02), edge, 0, 0.03, 0);
        part(g, rb(0.28, 0.06, 0.06, 0.02), edge, 0, 0.33, 0);
        part(g, rb(0.06, 0.2, 0.03, 0.01), m(0x8d8257, { roughness: 0.9 }), 0, 0.18, 0.04);
        return g;
    }
    if (type === 'grenade' || type === 'smoke') {
        const hull = type === 'smoke' ? 0x2f4a5a : 0x4b5a2e;
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), m(hull, { metalness: 0.3, roughness: 0.6 }));
        body.scale.set(1, 1.18, 1);
        body.position.y = 0.09;
        g.add(body);
        for (let i = 0; i < 3; i++) part(g, new THREE.TorusGeometry(0.077, 0.007, 4, 18), m(type === 'smoke' ? 0x243a47 : 0x39461f), 0, 0.05 + i * 0.04, 0).rotation.x = Math.PI / 2;
        part(g, new THREE.CylinderGeometry(0.028, 0.03, 0.05, 10), m(0x8a8f96, { metalness: 0.8 }), 0, 0.19, 0);
        part(g, rb(0.022, 0.12, 0.012, 0.004), m(0x8a8f96, { metalness: 0.8 }), 0.04, 0.16, 0).rotation.z = -0.35;
        part(g, new THREE.TorusGeometry(0.025, 0.005, 5, 14), m(0xd9d9d9, { metalness: 0.9 }), -0.035, 0.21, 0);
    }
    return g;
}

/** Objet tenu en main (potions, cruche, grenade, soins) : orienté comme les armes (canon vers +z). */
function heldModel(type) {
    const g = new THREE.Group();
    let inner;
    if (POTIONS[type]) inner = potionModel(type);
    else inner = dropModel({ type, r: 0 });
    const s = { grenade: 1.3, smoke: 1.3, medkit: 0.7, bandage: 0.9, pad: 0.6, plate: 0.9 }[type] ?? 1;
    inner.scale.setScalar(s);
    inner.position.set(0, -0.08, 0.12);
    g.add(inner);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
}

// ------------------------------------------------------------ icônes (SVG)

const ICON_PATHS = {
    plate: '<path d="M14 12 h36 v24 q0 14 -18 20 q-18 -6 -18 -20 z" fill="#5d7a52" stroke="#2c3a26" stroke-width="3"/><path d="M24 30 l6 7 l12 -14" stroke="#eaf5e4" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    smoke: '<ellipse cx="30" cy="40" rx="13" ry="16" fill="#44606f"/><path d="M18 34 h24 M17 42 h26" stroke="#2c414d" stroke-width="3"/><rect x="25" y="16" width="10" height="8" fill="#9aa0a8"/><path d="M35 18 l12 14" stroke="#9aa0a8" stroke-width="4" stroke-linecap="round"/><circle cx="48" cy="16" r="6" fill="none" stroke="#cfd8e3" stroke-width="3"/>',
    cash: '<rect x="6" y="18" width="52" height="30" rx="4" fill="#4f9e5c"/><rect x="11" y="23" width="42" height="20" rx="2" fill="none" stroke="#bfeccb" stroke-width="2"/><circle cx="32" cy="33" r="7" fill="#bfeccb"/><path d="M32 27 v12 M29 30 h6 M29 36 h6" stroke="#4f9e5c" stroke-width="2"/>',
    pistol: '<path d="M10 22 h40 v9 h-24 l-4 16 h-10 l3 -16 h-5 z" fill="#fff"/>',
    smg: '<path d="M4 24 h12 v-4 h30 v-3 h8 v3 h4 v8 h-14 v14 h-6 v-14 h-6 l-3 9 h-7 l2 -9 h-20 z" fill="#fff"/>',
    ar: '<path d="M2 26 l10 -4 h16 v-4 h4 v4 h22 v-2 h8 v6 h-14 l-2 4 h-10 l-3 12 h-7 l2 -10 l-6 -2 h-8 l-6 6 h-6 z" fill="#fff"/>',
    pump: '<path d="M2 30 l12 -6 h46 v5 h-20 v4 h-12 v-3 h-6 l-6 4 h-6 l-4 8 h-6 z" fill="#fff"/>',
    sniper: '<path d="M2 30 l12 -5 h48 v3 h-28 v3 h-10 l-6 4 l-4 8 h-6 l2 -9 z M24 18 h18 v5 h-18 z" fill="#fff"/>',
    rocket: '<rect x="6" y="22" width="50" height="11" rx="5" fill="#fff"/><path d="M56 22 l6 5.5 l-6 5.5 z" fill="#ff8a65"/><rect x="22" y="33" width="5" height="11" fill="#fff"/><rect x="34" y="33" width="5" height="8" fill="#fff"/>',
    pad: '<ellipse cx="32" cy="42" rx="26" ry="9" fill="#37e0ff"/><path d="M32 8 l12 14 h-7 v10 h-10 v-10 h-7 z" fill="#fff"/>',
    rockets: '<rect x="27" y="14" width="10" height="34" rx="3" fill="#a3b07c"/><path d="M27 14 l5 -8 l5 8 z" fill="#e05040"/><path d="M24 48 h16 l-3 -6 h-10 z" fill="#777"/>',
    bandage: '<rect x="12" y="18" width="40" height="22" rx="6" fill="#fff"/><path d="M20 18 v22 M44 18 v22" stroke="#bbb" stroke-width="3"/>',
    medkit: '<rect x="10" y="14" width="44" height="32" rx="5" fill="#fff"/><path d="M32 20 v20 M22 30 h20" stroke="#e02424" stroke-width="7"/>',
    grenade: '<ellipse cx="30" cy="38" rx="15" ry="18" fill="#6b7a3e"/><path d="M16 32 h28 M15 40 h30 M17 48 h26" stroke="#4b5a2e" stroke-width="3"/><rect x="25" y="14" width="10" height="8" fill="#9aa0a8"/><path d="M35 16 l12 14" stroke="#9aa0a8" stroke-width="4" stroke-linecap="round"/><circle cx="22" cy="14" r="5" fill="none" stroke="#ddd" stroke-width="3"/>',
    light: '<rect x="22" y="14" width="8" height="34" rx="3" fill="#a8c6e6"/><rect x="34" y="14" width="8" height="34" rx="3" fill="#a8c6e6"/>',
    medium: '<rect x="18" y="12" width="9" height="38" rx="3" fill="#a3c27c"/><rect x="30" y="12" width="9" height="38" rx="3" fill="#a3c27c"/><rect x="42" y="12" width="9" height="38" rx="3" fill="#a3c27c"/>',
    shells: '<rect x="18" y="14" width="12" height="34" rx="3" fill="#e05040"/><rect x="34" y="14" width="12" height="34" rx="3" fill="#e05040"/><rect x="18" y="40" width="28" height="8" fill="#d4a64a"/>',
    heavy: '<rect x="24" y="8" width="14" height="44" rx="4" fill="#d8d8d8"/><rect x="24" y="40" width="14" height="12" fill="#d4a64a"/>',
    wall: '<rect x="12" y="10" width="40" height="44" fill="none" stroke="#fff" stroke-width="5"/><path d="M12 32 h40" stroke="#fff" stroke-width="3"/>',
    floor: '<path d="M6 40 L32 28 L58 40 L32 52 Z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>',
    stairs: '<path d="M8 52 L56 12 L56 52 Z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>',
    roof: '<path d="M6 50 L32 14 L58 50 Z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>',
};

export function iconSvg(name, size = 46) {
    const p = ICON_PATHS[name];
    if (!p) return '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${p}</svg>`;
}
