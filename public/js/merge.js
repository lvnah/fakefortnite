// Fusion des petites pièces d'un modèle (moins d'appels de dessin) : couleurs par sommet.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function plain(mesh) {
    const m = mesh.material;
    if (!m || Array.isArray(m) || m.map || m.transparent) return false;
    if (m.emissive && m.emissiveIntensity > 0.2 && m.emissive.getHex() !== 0) return false;
    return true;
}

/**
 * Pour chaque groupe (os) de l'arbre, fusionne ses meshes « simples » directs en un seul mesh.
 * material : matériau partagé (vertexColors).
 */
export function mergeStatic(root, material) {
    const groups = [];
    root.traverse((o) => { if (!o.isMesh) groups.push(o); });
    for (const g of groups) {
        const meshes = g.children.filter((c) => c.isMesh && plain(c) && c.children.length === 0);
        if (meshes.length < 2) continue;
        const geos = [];
        for (const m of meshes) {
            m.updateMatrix();
            let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
            geo.applyMatrix4(m.matrix);
            for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
            const n = geo.attributes.position.count;
            const col = new Float32Array(n * 3);
            const c = m.material.color;
            for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
            geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
            geos.push(geo);
        }
        const merged = mergeGeometries(geos, false);
        if (!merged) continue;
        for (const m of meshes) g.remove(m);
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = true;
        g.add(mesh);
    }
    return root;
}
