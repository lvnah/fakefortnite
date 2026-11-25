// Effets : étincelles, débris, traçantes, éclairs de bouche, chiffres de dégâts, éliminations.
import * as THREE from 'three';
import { glowTexture } from './textures.js';

const MAX = 1200;
const CHUNKS = 160;

export class Effects {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        // particules lumineuses (additives)
        this.pos = new Float32Array(MAX * 3).fill(-9999);
        this.col = new Float32Array(MAX * 3);
        this.vel = new Float32Array(MAX * 3);
        this.life = new Float32Array(MAX);
        this.grav = new Float32Array(MAX);
        this.next = 0;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
        this.points = new THREE.Points(geo, new THREE.PointsMaterial({
            size: 0.35, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        this.points.frustumCulled = false;
        scene.add(this.points);

        // débris solides (constructions, récolte)
        this.chunks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshStandardMaterial({ roughness: 0.8 }), CHUNKS);
        this.chunks.castShadow = true;
        this.chunkData = Array.from({ length: CHUNKS }, () => ({ p: new THREE.Vector3(0, -9999, 0), v: new THREE.Vector3(), r: new THREE.Euler(), life: 0, s: 1 }));
        this.chunkNext = 0;
        const m = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < CHUNKS; i++) {
            this.chunks.setMatrixAt(i, m);
            this.chunks.setColorAt(i, new THREE.Color(0xffffff));
        }
        scene.add(this.chunks);

        // traçantes
        this.tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
        this.tracers = [];
        // éclairs de bouche
        this.flashMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        this.flashes = [];
        this.light = new THREE.PointLight(0xffb060, 0, 12, 2);
        scene.add(this.light);
        this.lightT = 0;
        this.beams = [];
        // fumée (roquettes, explosions)
        this.smokeMax = 400;
        this.sPos = new Float32Array(this.smokeMax * 3).fill(-9999);
        this.sCol = new Float32Array(this.smokeMax * 4);
        this.sVel = new Float32Array(this.smokeMax * 3);
        this.sLife = new Float32Array(this.smokeMax);
        this.sMax = new Float32Array(this.smokeMax);
        this.sNext = 0;
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
        sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 4));
        this.smokePts = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false }));
        this.smokePts.frustumCulled = false;
        scene.add(this.smokePts);
        this.fireballs = [];
        this.fireGeo = new THREE.IcosahedronGeometry(1, 2);
        this.numLayer = document.getElementById('dmg-layer');
        this.numbers = [];
        this.tmp = new THREE.Vector3();
        this.tmpM = new THREE.Matrix4();
        this.tmpQ = new THREE.Quaternion();
        this.tmpC = new THREE.Color();
    }

    spark(p, color, count = 12, speed = 6, grav = 14, life = 0.5) {
        const c = this.tmpC.set(color);
        for (let i = 0; i < count; i++) {
            const k = this.next;
            this.next = (this.next + 1) % MAX;
            const a = Math.random() * Math.PI * 2;
            const up = Math.random() * 0.9 + 0.1;
            const s = speed * (0.35 + Math.random() * 0.65);
            this.pos.set([p.x, p.y, p.z], k * 3);
            this.vel.set([Math.cos(a) * s * (1 - up * 0.5), up * s, Math.sin(a) * s * (1 - up * 0.5)], k * 3);
            this.col.set([c.r, c.g, c.b], k * 3);
            this.life[k] = life * (0.6 + Math.random() * 0.6);
            this.grav[k] = grav;
        }
    }

    burst(p, color, count = 12, speed = 6) {
        this.spark(p, color, count, speed);
    }

    /** Morceaux qui tombent (pièce détruite, récolte). */
    debris(p, color, count = 10, spread = 1.8) {
        const c = this.tmpC.set(color);
        for (let i = 0; i < count; i++) {
            const d = this.chunkData[this.chunkNext];
            this.chunks.setColorAt(this.chunkNext, c);
            this.chunkNext = (this.chunkNext + 1) % CHUNKS;
            d.p.set(p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread);
            d.v.set((Math.random() - 0.5) * 7, Math.random() * 6 + 1, (Math.random() - 0.5) * 7);
            d.r.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
            d.life = 1.2 + Math.random() * 0.6;
            d.s = 0.6 + Math.random() * 0.9;
        }
        this.chunks.instanceColor.needsUpdate = true;
    }

    tracer(from, to, color = 0xffe9a8, width = 0.025) {
        const len = from.distanceTo(to);
        if (len < 0.5) return;
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
        const mesh = new THREE.Mesh(this.tracerGeo, mat);
        mesh.position.copy(from);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.tmp.copy(to).sub(from).normalize());
        mesh.scale.set(width, len, width);
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this.tracers.push({ mesh, ttl: 0.12, max: 0.12 });
    }

    muzzleFlash(p, scale = 1) {
        const sp = new THREE.Sprite(this.flashMat);
        sp.position.copy(p);
        const s = (0.6 + Math.random() * 0.3) * scale;
        sp.scale.set(s, s, 1);
        this.scene.add(sp);
        this.flashes.push({ sp, ttl: 0.05 });
        this.light.position.copy(p);
        this.light.intensity = 12 * scale;
        this.lightT = 0.06;
    }

    /** Colonne lumineuse d'élimination. */
    elimination(p) {
        this.spark(this.tmp.set(p.x, p.y + 1, p.z), 0x6fe3ff, 60, 7, -2, 1.2);
        this.spark(this.tmp.set(p.x, p.y + 1, p.z), 0xffffff, 20, 4, -4, 0.9);
        const mat = new THREE.MeshBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 30, 16, 1, true).translate(0, 15, 0), mat);
        beam.position.set(p.x, p.y, p.z);
        this.scene.add(beam);
        this.beams.push({ mesh: beam, ttl: 1.2 });
    }

    /** Bouffées de fumée grise. */
    smoke(p, count = 1, spread = 0.15, life = 1.1, shade = 0.75) {
        for (let i = 0; i < count; i++) {
            const k = this.sNext;
            this.sNext = (this.sNext + 1) % this.smokeMax;
            this.sPos.set([p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread], k * 3);
            this.sVel.set([(Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8], k * 3);
            const c = shade * (0.85 + Math.random() * 0.3);
            this.sCol.set([c, c, c, 0.55], k * 4);
            this.sLife[k] = life * (0.7 + Math.random() * 0.6);
            this.sMax[k] = this.sLife[k];
        }
    }

    /** Explosion de roquette : boule de feu, étincelles, débris, fumée, éclair. */
    explosion(p) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
        const ball = new THREE.Mesh(this.fireGeo, mat);
        ball.position.copy(p);
        ball.scale.setScalar(0.6);
        this.scene.add(ball);
        this.fireballs.push({ mesh: ball, t: 0 });
        this.spark(p, 0xffc060, 70, 14, 10, 0.7);
        this.spark(p, 0xff5a1a, 40, 9, 6, 0.9);
        this.debris(p, 0x3a3a3a, 10, 1.5);
        for (let i = 0; i < 26; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * 2.2;
            this.smoke(this.tmp.set(p.x + Math.cos(a) * r, p.y + Math.random() * 1.5, p.z + Math.sin(a) * r), 1, 0.5, 2.4, 0.35 + Math.random() * 0.25);
        }
        this.light.position.copy(p);
        this.light.intensity = 140;
        this.light.distance = 40;
        this.lightT = 0.18;
    }

    dust(p, count = 14) {
        this.spark(p, 0xd8cdb0, count, 3, 2, 0.7);
    }

    /** Chiffre de dégâts flottant (DOM, projeté chaque image). */
    damageNumber(p, value, kind) {
        if (!this.numLayer) return;
        const el = document.createElement('div');
        el.className = `dmg ${kind}`;
        el.textContent = value;
        this.numLayer.appendChild(el);
        this.numbers.push({ el, p: new THREE.Vector3(p.x + (Math.random() - 0.5) * 0.6, p.y, p.z + (Math.random() - 0.5) * 0.6), t: 0 });
        while (this.numbers.length > 24) this.numbers.shift().el.remove();
    }

    update(dt) {
        for (let k = 0; k < MAX; k++) {
            if (this.life[k] <= 0) continue;
            this.life[k] -= dt;
            this.vel[k * 3 + 1] -= this.grav[k] * dt;
            for (let a = 0; a < 3; a++) this.pos[k * 3 + a] += this.vel[k * 3 + a] * dt;
            const f = Math.max(0, Math.min(1, this.life[k] * 3));
            if (this.life[k] <= 0) this.pos[k * 3 + 1] = -9999;
            else if (f < 1) for (let a = 0; a < 3; a++) this.col[k * 3 + a] *= 0.92;
        }
        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.color.needsUpdate = true;

        let any = false;
        for (let i = 0; i < CHUNKS; i++) {
            const d = this.chunkData[i];
            if (d.life <= 0) continue;
            any = true;
            d.life -= dt;
            d.v.y -= 18 * dt;
            d.p.addScaledVector(d.v, dt);
            d.r.x += dt * 6;
            d.r.y += dt * 4;
            const s = d.life <= 0 ? 0 : d.s * Math.min(1, d.life * 2);
            this.tmpQ.setFromEuler(d.r);
            this.tmpM.compose(d.p, this.tmpQ, this.tmp.setScalar(s));
            this.chunks.setMatrixAt(i, this.tmpM);
        }
        if (any) this.chunks.instanceMatrix.needsUpdate = true;

        this.tracers = this.tracers.filter((t) => {
            t.ttl -= dt;
            t.mesh.material.opacity = Math.max(0, t.ttl / t.max) * 0.9;
            if (t.ttl > 0) return true;
            this.scene.remove(t.mesh);
            t.mesh.material.dispose();
            return false;
        });
        this.flashes = this.flashes.filter((f) => {
            f.ttl -= dt;
            if (f.ttl > 0) return true;
            this.scene.remove(f.sp);
            return false;
        });
        this.lightT -= dt;
        if (this.lightT <= 0) { this.light.intensity = 0; this.light.distance = 12; }
        for (let k = 0; k < this.smokeMax; k++) {
            if (this.sLife[k] <= 0) continue;
            this.sLife[k] -= dt;
            for (let a = 0; a < 3; a++) this.sPos[k * 3 + a] += this.sVel[k * 3 + a] * dt;
            this.sCol[k * 4 + 3] = Math.max(0, this.sLife[k] / this.sMax[k]) * 0.5;
            if (this.sLife[k] <= 0) this.sPos[k * 3 + 1] = -9999;
        }
        this.smokePts.geometry.attributes.position.needsUpdate = true;
        this.smokePts.geometry.attributes.color.needsUpdate = true;
        this.fireballs = this.fireballs.filter((f) => {
            f.t += dt;
            const k = f.t / 0.45;
            f.mesh.scale.setScalar(0.6 + 4.2 * Math.min(1, k * 1.6));
            f.mesh.material.opacity = Math.max(0, 1 - k) * 0.95;
            f.mesh.material.color.setHSL(0.08 - k * 0.06, 1, 0.55 - k * 0.2);
            if (k < 1) return true;
            this.scene.remove(f.mesh);
            f.mesh.material.dispose();
            return false;
        });
        this.beams = this.beams.filter((b) => {
            b.ttl -= dt;
            b.mesh.material.opacity = Math.max(0, b.ttl / 1.2) * 0.7;
            b.mesh.scale.x = b.mesh.scale.z = 1 + (1.2 - b.ttl) * 0.6;
            if (b.ttl > 0) return true;
            this.scene.remove(b.mesh);
            b.mesh.geometry.dispose();
            b.mesh.material.dispose();
            return false;
        });
        // chiffres de dégâts
        const w = innerWidth;
        const h = innerHeight;
        this.numbers = this.numbers.filter((n) => {
            n.t += dt;
            if (n.t > 1.0) {
                n.el.remove();
                return false;
            }
            this.tmp.copy(n.p);
            this.tmp.y += n.t * 1.2;
            this.tmp.project(this.camera);
            if (this.tmp.z > 1) {
                n.el.style.display = 'none';
                return true;
            }
            n.el.style.display = '';
            n.el.style.transform = `translate(${(this.tmp.x * 0.5 + 0.5) * w}px, ${(-this.tmp.y * 0.5 + 0.5) * h}px) translate(-50%, -50%) scale(${n.t < 0.12 ? 1.5 - n.t * 4 : 1})`;
            n.el.style.opacity = n.t > 0.7 ? String(1 - (n.t - 0.7) / 0.3) : '1';
            return true;
        });
    }
}
