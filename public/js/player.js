// Joueur : personnage articulé animé mathématiquement, contrôles, interpolation, caméra TPS.
import * as THREE from 'three';
import { terrainHeight, insideSolid, PLAYER_H } from './shared.js';

export const STYLES = {
    classic: { shirt: 0x3a7bd5, pants: 0x2c3e50, skin: 0xf2c9a0, hair: 0x5b3a1a, acc: 'cap', pack: 0x8a5a2b },
    neon:    { shirt: 0x00e5ff, pants: 0x1b1b3a, skin: 0xf6d7b8, hair: 0xff2fd6, acc: 'visor', pack: 0x222244 },
    ninja:   { shirt: 0x262626, pants: 0x111111, skin: 0xd8b08c, hair: 0x111111, acc: 'mask', pack: 0x330000 },
    robot:   { shirt: 0x9aa4b2, pants: 0x4b5563, skin: 0xc0c8d4, hair: 0x6b7280, acc: 'antenna', pack: 0x374151 },
    pirate:  { shirt: 0x8b1e1e, pants: 0x3b2a1a, skin: 0xe9b98f, hair: 0x2a1a0a, acc: 'hat', pack: 0x6b4f2a },
};

function part(w, h, d, color) {
    const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true }),
    );
    m.castShadow = true;
    return m;
}

function damp(current, target, lambda, dt) {
    return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function nameSprite(name) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.strokeText(name, 128, 44);
    g.fillStyle = '#ffffff';
    g.fillText(name, 128, 44);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    sp.scale.set(2.2, 0.55, 1);
    sp.position.y = PLAYER_H + 0.55;
    sp.renderOrder = 10;
    return sp;
}

export class Character {
    constructor(skin, name) {
        const st = STYLES[skin] ?? STYLES.classic;
        this.root = new THREE.Group();
        this.pelvis = new THREE.Group();
        this.pelvis.position.y = 0.95;
        this.root.add(this.pelvis);

        const torso = part(0.6, 0.7, 0.36, st.shirt);
        torso.position.y = 0.35;
        const hips = part(0.58, 0.22, 0.34, st.pants);
        hips.position.y = -0.02;
        const pack = part(0.45, 0.55, 0.22, st.pack);
        pack.position.set(0, 0.38, -0.27);
        this.pelvis.add(torso, hips, pack);

        this.head = new THREE.Group();
        this.head.position.y = 0.85;
        const face = part(0.5, 0.5, 0.5, st.skin);
        face.position.y = 0.2;
        const hair = part(0.54, 0.16, 0.54, st.hair);
        hair.position.y = 0.5;
        this.head.add(face, hair);
        this.addAccessory(st.acc, st);
        this.pelvis.add(this.head);

        this.armL = this.pivot(-0.38, 0.6, 0);
        this.armR = this.pivot(0.38, 0.6, 0);
        const armGeoL = part(0.2, 0.65, 0.2, st.shirt);
        armGeoL.position.y = -0.3;
        const armGeoR = part(0.2, 0.65, 0.2, st.shirt);
        armGeoR.position.y = -0.3;
        this.armL.add(armGeoL);
        this.armR.add(armGeoR);

        this.legL = this.pivot(-0.15, 0, 0);
        this.legR = this.pivot(0.15, 0, 0);
        const legGeoL = part(0.24, 0.9, 0.26, st.pants);
        legGeoL.position.y = -0.45;
        const legGeoR = part(0.24, 0.9, 0.26, st.pants);
        legGeoR.position.y = -0.45;
        this.legL.add(legGeoL);
        this.legR.add(legGeoR);

        this.weaponSlot = new THREE.Group();
        this.weaponSlot.position.set(0, -0.6, 0.15);
        this.armR.add(this.weaponSlot);
        this.weapon = null;
        this.setWeapon(null);

        this.label = nameSprite(name);
        this.root.add(this.label);
        this.phase = 0;
        this.t = 0;
        this.pose = { legL: 0, legR: 0, armL: 0, armR: 0, armLz: 0, armRz: 0, pelvisY: 0.95, pelvisRx: 0 };
    }

    pivot(x, y, z) {
        const g = new THREE.Group();
        g.position.set(x, y, z);
        this.pelvis.add(g);
        return g;
    }

    addAccessory(kind, st) {
        if (kind === 'cap') {
            const c = part(0.56, 0.12, 0.56, st.shirt);
            c.position.set(0, 0.6, 0);
            this.head.add(c);
            const brim = part(0.3, 0.04, 0.22, st.shirt);
            brim.position.set(0, 0.5, 0.36);
            this.head.add(brim);
        } else if (kind === 'visor') {
            const v = part(0.52, 0.12, 0.06, 0x00ffff);
            v.material.emissive = new THREE.Color(0x00aaff);
            v.position.set(0, 0.24, 0.27);
            this.head.add(v);
        } else if (kind === 'mask') {
            const m = part(0.52, 0.22, 0.06, 0x000000);
            m.position.set(0, 0.08, 0.27);
            this.head.add(m);
        } else if (kind === 'antenna') {
            const a = part(0.05, 0.5, 0.05, 0xff3333);
            a.position.set(0, 0.85, 0);
            this.head.add(a);
        } else if (kind === 'hat') {
            const crown = part(0.5, 0.25, 0.5, 0x111111);
            crown.position.set(0, 0.62, 0);
            const brim = part(0.9, 0.05, 0.7, 0x111111);
            brim.position.set(0, 0.5, 0);
            this.head.add(crown, brim);
        }
    }

    /** Arme tenue dans la main droite : 'ar' | 'shotgun' | 'sniper' | 'pickaxe' | null. */
    setWeapon(type) {
        if (this.weaponType === type) return;
        this.weaponType = type;
        this.weaponSlot.clear();
        if (!type) return;
        const metal = new THREE.MeshStandardMaterial({ color: 0x444a52, roughness: 0.4, metalness: 0.5 });
        const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.8 });
        const add = (geo, mat, x, y, z) => {
            const m = new THREE.Mesh(geo, mat);
            m.position.set(x, y, z);
            m.castShadow = true;
            this.weaponSlot.add(m);
        };
        if (type === 'ar') {
            add(new THREE.BoxGeometry(0.14, 0.18, 0.7), metal, 0, 0, 0.3);
            add(new THREE.BoxGeometry(0.08, 0.2, 0.16), wood, 0, -0.12, -0.05);
        } else if (type === 'shotgun') {
            add(new THREE.BoxGeometry(0.16, 0.16, 0.9), wood, 0, 0, 0.35);
            add(new THREE.BoxGeometry(0.2, 0.1, 0.3), metal, 0, 0.1, 0.1);
        } else if (type === 'sniper') {
            add(new THREE.BoxGeometry(0.1, 0.12, 1.2), metal, 0, 0, 0.45);
            add(new THREE.BoxGeometry(0.1, 0.16, 0.1), metal, 0, 0.13, 0.15);
        } else {
            add(new THREE.BoxGeometry(0.06, 0.7, 0.06), wood, 0, 0.25, 0);
            add(new THREE.BoxGeometry(0.5, 0.12, 0.12), metal, 0, 0.6, 0);
        }
    }

    /** a : { speed, grounded, crouch, sliding, gliding, aiming, shooting, harvesting, building, dead } */
    update(dt, a) {
        this.t += dt;
        this.root.visible = !a.dead;
        const amp = Math.min(1, a.speed / 7) * (a.grounded ? 1 : 0.2);
        if (a.speed > 0.2 && a.grounded) this.phase += dt * (6 + a.speed * 1.1);
        const swing = Math.sin(this.phase) * 0.9 * amp;

        let legL = swing;
        let legR = -swing;
        let armL = -swing * 0.8;
        let armR = swing * 0.5;
        let armLz = 0;
        let armRz = 0;
        let pelvisY = 0.95 + Math.abs(Math.sin(this.phase)) * 0.05 * amp;
        let pelvisRx = 0;

        if (!a.grounded && !a.gliding) {
            legL = 0.5;
            legR = -0.2;
        }
        if (a.gliding) {
            armL = -0.2; armLz = -2.5;
            armR = -0.2; armRz = 2.5;
            legL = 0.2; legR = -0.2;
        }
        if (a.crouch && a.grounded && !a.sliding) {
            pelvisY = 0.65;
            legL = 1.0;
            legR = 1.0;
        }
        if (a.sliding) {
            pelvisRx = 1.1;
            pelvisY = 0.5;
            legL = -0.2;
            legR = -0.2;
        }
        if (a.aiming || a.shooting) {
            armR = -1.35;
            armL = -1.0;
            armLz = -0.3;
        }
        if (a.harvesting || a.building) {
            armR = -1.0 + Math.sin(this.t * 14) * 0.7;
            armL = -0.6;
        }

        const p = this.pose;
        const k = 14;
        p.legL = damp(p.legL, legL, k, dt);
        p.legR = damp(p.legR, legR, k, dt);
        p.armL = damp(p.armL, armL, k, dt);
        p.armR = damp(p.armR, armR, k, dt);
        p.armLz = damp(p.armLz, armLz, k, dt);
        p.armRz = damp(p.armRz, armRz, k, dt);
        p.pelvisY = damp(p.pelvisY, pelvisY, k, dt);
        p.pelvisRx = damp(p.pelvisRx, pelvisRx, k, dt);

        this.legL.rotation.x = p.legL;
        this.legR.rotation.x = p.legR;
        this.armL.rotation.x = p.armL;
        this.armR.rotation.x = p.armR;
        this.armL.rotation.z = p.armLz;
        this.armR.rotation.z = p.armRz;
        this.pelvis.position.y = p.pelvisY;
        this.pelvis.rotation.x = p.pelvisRx;
    }
}

/** Tampon d'échantillons pour interpoler un joueur distant. */
export class RemoteBuffer {
    constructor() {
        this.samples = [];
    }

    push(t, p) {
        this.samples.push({ t, p });
        if (this.samples.length > 12) this.samples.shift();
    }

    /** Renvoie { a, b, k } à l'instant renderT (ms). */
    sample(renderT) {
        const s = this.samples;
        if (!s.length) return null;
        if (renderT <= s[0].t) return { a: s[0].p, b: s[0].p, k: 0, dt: 0.05 };
        for (let i = s.length - 1; i >= 1; i--) {
            if (s[i - 1].t <= renderT) {
                const a = s[i - 1];
                const b = s[i];
                const span = Math.max(1, b.t - a.t);
                return { a: a.p, b: b.p, k: Math.min(1, (renderT - a.t) / span), dt: span / 1000 };
            }
        }
        const last = s[s.length - 1].p;
        return { a: last, b: last, k: 0, dt: 0.05 };
    }
}

/** Souris + clavier. yaw/pitch suivent la convention du serveur (yaw 0 regarde -Z). */
export class Controls {
    constructor(canvas) {
        this.canvas = canvas;
        this.keys = new Set();
        this.yaw = 0;
        this.pitch = 0.1;
        this.mouseL = false;
        this.mouseR = false;
        this.jumpQueued = false;
        this.locked = false;

        addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                if (!e.repeat) this.jumpQueued = true;
                e.preventDefault();
            }
            this.keys.add(e.code);
        });
        addEventListener('keyup', (e) => this.keys.delete(e.code));
        addEventListener('blur', () => this.keys.clear());
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) this.mouseL = true;
            if (e.button === 2) this.mouseR = true;
        });
        addEventListener('mouseup', (e) => {
            if (e.button === 0) this.mouseL = false;
            if (e.button === 2) this.mouseR = false;
        });
        document.addEventListener('pointerlockchange', () => {
            this.locked = document.pointerLockElement === canvas;
        });
        addEventListener('mousemove', (e) => {
            if (!this.locked) return;
            this.yaw -= e.movementX * 0.0022;
            this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - e.movementY * 0.0022));
        });
    }

    lock() {
        this.canvas.requestPointerLock?.();
    }

    /** Entrée d'un tick de simulation. jump n'est vrai qu'une fois par appui. */
    sample() {
        const k = this.keys;
        const jump = this.jumpQueued;
        this.jumpQueued = false;
        return {
            fwd: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
            side: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
            sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
            crouch: k.has('ControlLeft') || k.has('KeyC'),
            glide: k.has('Space'),
            jump,
            yaw: this.yaw,
            pitch: this.pitch,
        };
    }

    forward() {
        return new THREE.Vector3(
            -Math.sin(this.yaw) * Math.cos(this.pitch),
            Math.sin(this.pitch),
            -Math.cos(this.yaw) * Math.cos(this.pitch),
        );
    }
}

/**
 * Caméra TPS épaule droite. Se rapproche si un mur ou le relief la masque.
 * Renvoie la position de la caméra et met à jour son FOV (zoom en visée).
 */
export function updateCameraRig(camera, pivot, controls, aiming, store, dt) {
    const fwd = controls.forward();
    const right = new THREE.Vector3(Math.cos(controls.yaw), 0, -Math.sin(controls.yaw));
    const shoulder = aiming ? 0.7 : 0.9;
    const maxDist = aiming ? 2.4 : 4.4;

    const target = new THREE.Vector3(pivot.x, pivot.y + 1.55, pivot.z);
    let dist = maxDist;
    for (let d = 0.3; d <= maxDist; d += 0.2) {
        const x = target.x - fwd.x * d + right.x * shoulder;
        const y = target.y - fwd.y * d + right.y * shoulder;
        const z = target.z - fwd.z * d + right.z * shoulder;
        if (y < terrainHeight(x, z) + 0.3 || insideSolid(store, x, y, z)) {
            dist = Math.max(0.6, d - 0.3);
            break;
        }
    }

    const want = new THREE.Vector3(
        target.x - fwd.x * dist + right.x * shoulder,
        target.y - fwd.y * dist + right.y * shoulder,
        target.z - fwd.z * dist + right.z * shoulder,
    );
    camera.position.lerp(want, 1 - Math.exp(-dt * 25));
    camera.lookAt(target.x + fwd.x * 10 + right.x * shoulder * 0.2, target.y + fwd.y * 10, target.z + fwd.z * 10 + right.z * shoulder * 0.2);

    const fovWant = aiming ? 50 : 70;
    camera.fov += (fovWant - camera.fov) * (1 - Math.exp(-dt * 10));
    camera.updateProjectionMatrix();
    return camera.position;
}
