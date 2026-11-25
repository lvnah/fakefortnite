// Objets au sol : modèle flottant, rayon et halo de la couleur de rareté, éjection en arc.
import * as THREE from 'three';
import { dropModel, RARITY_COLORS, rarityOf, WEAPONS, CONSUMABLES } from './items.js';
import { glowTexture, beamTexture } from './textures.js';

export class LootRenderer {
    constructor(scene) {
        this.scene = scene;
        this.drops = new Map();
        this.group = new THREE.Group();
        scene.add(this.group);
        this.beamGeo = new THREE.PlaneGeometry(0.5, 3.2).translate(0, 1.6, 0);
    }

    add(d, from = null) {
        if (this.drops.has(d.id)) this.remove(d.id);
        const g = new THREE.Group();
        const model = dropModel(d.it);
        model.traverse((o) => { if (o.isMesh) o.castShadow = false; });
        const holder = new THREE.Group();
        holder.add(model);
        g.add(holder);
        const rare = WEAPONS.includes(d.it.type) || CONSUMABLES.includes(d.it.type);
        const color = new THREE.Color(rare ? RARITY_COLORS[rarityOf(d.it)] : '#d7e3ee');
        const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
        ring.scale.set(1.5, 1.5, 1);
        ring.position.y = 0.15;
        g.add(ring);
        if (rare) {
            const bm = new THREE.MeshBasicMaterial({ map: beamTexture(), color, transparent: true, opacity: rarityOf(d.it) >= 2 ? 0.55 : 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
            for (const a of [0, Math.PI / 2]) {
                const beam = new THREE.Mesh(this.beamGeo, bm);
                beam.rotation.y = a;
                g.add(beam);
            }
        }
        const p = new THREE.Vector3(d.p[0], d.p[1], d.p[2]);
        g.position.copy(from ? new THREE.Vector3(from[0], from[1], from[2]) : p);
        this.group.add(g);
        this.drops.set(d.id, {
            id: d.id, it: d.it, p, g, holder, ring,
            pop: from ? { a: new THREE.Vector3(from[0], from[1], from[2]), t: 0 } : null,
            phase: Math.random() * 6,
        });
    }

    update(id, it) {
        const d = this.drops.get(id);
        if (d) d.it = it;
    }

    /** Objet déplacé (le sol s'est creusé sous lui). */
    move(id, p) {
        const d = this.drops.get(id);
        if (!d) return;
        d.p.set(p[0], p[1], p[2]);
        if (!d.pop) d.g.position.copy(d.p);
    }

    remove(id) {
        const d = this.drops.get(id);
        if (!d) return null;
        this.group.remove(d.g);
        d.g.traverse((o) => {
            if (o.isSprite) o.material.dispose();
        });
        this.drops.delete(id);
        return d;
    }

    clear() {
        for (const id of [...this.drops.keys()]) this.remove(id);
    }

    /** Objet le plus proche devant le joueur. */
    /** Objets d'un type donné à portée des pieds (ramassage automatique). */
    underfoot(pos, reach = 1.8, types = ['ammo', 'cash']) {
        const out = [];
        for (const [id, d] of this.drops) {
            if (!types.includes(d.it.type)) continue;
            const dx = d.p.x - pos.x;
            const dz = d.p.z - pos.z;
            if (dx * dx + dz * dz < reach * reach && Math.abs(d.p.y - pos.y) < 2.2) out.push(id);
        }
        return out;
    }

    nearest(pos, fwd, reach) {
        let best = null;
        let bestScore = Infinity;
        for (const d of this.drops.values()) {
            if (d.pop && d.pop.t < 1) continue;
            const dx = d.p.x - pos.x;
            const dz = d.p.z - pos.z;
            const dy = d.p.y - pos.y;
            const dist = Math.hypot(dx, dz);
            if (dist > reach || dy < -2.8 || dy > 2.4) continue;
            const facing = dist > 0.01 ? (dx * fwd.x + dz * fwd.z) / dist : 1;
            const score = dist - facing * 0.9;
            if (score < bestScore) {
                bestScore = score;
                best = d;
            }
        }
        return best;
    }

    animate(dt, t, focus) {
        for (const d of this.drops.values()) {
            if (focus) {
                d.g.visible = Math.abs(d.p.x - focus.x) < 90 && Math.abs(d.p.z - focus.z) < 90;
                if (!d.g.visible && !d.pop) continue;
            }
            if (d.pop) {
                d.pop.t = Math.min(1, d.pop.t + dt / 0.5);
                const k = d.pop.t;
                d.g.position.lerpVectors(d.pop.a, d.p, k);
                d.g.position.y += Math.sin(k * Math.PI) * 1.6;
                if (k >= 1) d.pop = null;
            }
            d.holder.position.y = 0.25 + Math.sin(t * 2.2 + d.phase) * 0.06;
            d.holder.rotation.y += dt * 0.8;
            d.ring.material.opacity = 0.45 + Math.sin(t * 3 + d.phase) * 0.12;
        }
    }
}
