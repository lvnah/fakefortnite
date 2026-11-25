// Clavier + souris (touches physiques : ZQSD en AZERTY = WASD en QWERTY) et caméra.
import * as THREE from 'three';
import { terrainHeight, insideSolid } from './shared.js';
import { settings } from './settings.js';

const FALLBACK_LABELS = { KeyQ: 'A', KeyW: 'Z', KeyA: 'Q', KeyZ: 'W', KeyM: ',' };

export class Controls {
    constructor(canvas) {
        this.canvas = canvas;
        this.keys = new Set();
        this.yaw = 0;
        this.pitch = 0;
        this.mouseL = false;
        this.mouseR = false;
        this.clickQueued = false;
        this.jumpQueued = false;
        this.locked = false;
        this.layout = null;
        this.onWheel = null;
        navigator.keyboard?.getLayoutMap?.().then((m) => { this.layout = m; }).catch(() => {});

        addEventListener('keydown', (e) => {
            if (!this.locked && document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            if (['Space', 'Tab', 'F1', 'F2', 'F3', 'F4'].includes(e.code)) e.preventDefault();
            if (e.code === settings.keys.jump && !e.repeat) this.jumpQueued = true;
            this.keys.add(e.code);
        });
        addEventListener('keyup', (e) => this.keys.delete(e.code));
        addEventListener('blur', () => {
            this.keys.clear();
            this.mouseL = this.mouseR = false;
        });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        canvas.addEventListener('mousedown', (e) => {
            if (!this.locked) return;
            if (e.button === 0) { this.mouseL = true; this.clickQueued = true; }
            if (e.button === 2) this.mouseR = true;
        });
        addEventListener('mouseup', (e) => {
            if (e.button === 0) this.mouseL = false;
            if (e.button === 2) this.mouseR = false;
        });
        addEventListener('wheel', (e) => {
            if (this.locked && this.onWheel) this.onWheel(Math.sign(e.deltaY));
        }, { passive: true });
        document.addEventListener('pointerlockchange', () => {
            this.locked = document.pointerLockElement === canvas;
            if (!this.locked) this.mouseL = this.mouseR = false;
        });
        addEventListener('mousemove', (e) => {
            if (!this.locked) return;
            // souris prise en compte dès l'évènement (pas d'attente de l'image suivante)
            const k = 0.0021 * settings.sens * (this.adsScale ? this.adsScale * settings.adsSens / 0.75 : 1);
            this.yaw -= e.movementX * k;
            this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * k * (settings.invertY ? -1 : 1)));
        });
    }

    lock() {
        if (!this.canvas.requestPointerLock) return;
        // souris brute : pas d'accélération du système, visée plus précise
        const p = settings.rawMouse ? this.canvas.requestPointerLock({ unadjustedMovement: true }) : this.canvas.requestPointerLock();
        p?.catch?.(() => this.canvas.requestPointerLock());
    }

    /** Lettre de la touche associée à une action (selon la disposition du clavier). */
    key(action) {
        return this.label(settings.keys[action] ?? action);
    }

    /** Lettre affichée pour une touche physique, selon la disposition du clavier. */
    label(code) {
        if (code.startsWith('Digit')) return code.slice(5);
        if (code === 'Space') return 'Espace';
        if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Maj';
        if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
        if (code === 'AltLeft') return 'Alt';
        if (code === 'Tab') return 'Tab';
        if (code.startsWith('Mouse')) return `Souris ${code.slice(5)}`;
        if (code.startsWith('F') && code.length <= 3) return code;
        const v = this.layout?.get(code);
        if (v) return v.toUpperCase();
        if (code.startsWith('Key')) return FALLBACK_LABELS[code] ?? code.slice(3);
        return code;
    }

    sample(building) {
        const k = this.keys;
        const jump = this.jumpQueued;
        this.jumpQueued = false;
        const b = settings.keys;
        return {
            fwd: (k.has(b.fwd) || k.has('ArrowUp') ? 1 : 0) - (k.has(b.back) || k.has('ArrowDown') ? 1 : 0),
            side: (k.has(b.right) || k.has('ArrowRight') ? 1 : 0) - (k.has(b.left) || k.has('ArrowLeft') ? 1 : 0),
            sprint: k.has(b.sprint) || (b.sprint === 'ShiftLeft' && k.has('ShiftRight')),
            crouch: k.has(b.crouch),
            glide: k.has(b.jump),
            jump,
            ads: this.mouseR && !building,
            yaw: this.yaw,
            pitch: this.pitch,
        };
    }

    forward(out = new THREE.Vector3()) {
        return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    }
}

/**
 * Caméra à la troisième personne, épaule droite. L'axe de la caméra passe par le point
 * d'épaule (comme le départ des tirs côté serveur) : le viseur tombe pile où partent les balles.
 */
export class CameraRig {
    constructor(camera) {
        this.camera = camera;
        this.dist = 3.4;
        this.fov = 75;
        this.tmp = new THREE.Vector3();
        this.right = new THREE.Vector3();
        this.fwd = new THREE.Vector3();
    }

    /** mode : 'normal' | 'scope' | 'sky' | 'glide' | 'orbit' ; pivot : point regardé (tête). */
    update(mode, pivot, yaw, pitch, store, dt, opts = {}) {
        const cam = this.camera;
        const f = this.fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        const right = this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
        const F = settings.fov;
        let shoulder = 0.85;
        let dist = 3.7;
        let fov = F;
        if (mode === 'ads') { dist = 2.5; fov = F * 0.77; }
        if (mode === 'scope') { dist = 0.0; fov = 22; }
        if (mode === 'sky') { shoulder = 0; dist = 7.5; fov = F + 5; }
        if (mode === 'glide') { shoulder = 0; dist = 6.5; fov = F + 3; }
        if (mode === 'orbit') { shoulder = 0; dist = opts.dist ?? 32; fov = 70; }
        if (mode === 'car') { shoulder = 0; dist = 8; fov = F + 3; }
        if (mode === 'zip') { shoulder = 0.4; dist = 4.5; fov = F + 5; }
        if (mode === 'spec') { shoulder = 0; dist = 5; fov = F; }
        if (opts.crouch) pivot = this.tmp.set(pivot.x, pivot.y - 0.35, pivot.z).clone();

        // l'épaule peut être bouchée par un mur juste à droite
        let s = shoulder;
        for (let d = 0.1; d <= shoulder; d += 0.15) {
            const x = pivot.x + right.x * d;
            const z = pivot.z + right.z * d;
            if (insideSolid(store, x, pivot.y, z)) { s = Math.max(0, d - 0.2); break; }
        }
        const sx = pivot.x + right.x * s;
        const sy = pivot.y;
        const sz = pivot.z + right.z * s;
        let want = dist;
        if (mode !== 'orbit') {
            for (let d = 0.25; d <= dist; d += 0.2) {
                const x = sx - f.x * d;
                const y = sy - f.y * d;
                const z = sz - f.z * d;
                if (y < terrainHeight(x, z) + 0.25 || insideSolid(store, x, y, z)) { want = Math.max(0.3, d - 0.25); break; }
            }
        }
        this.dist += (want - this.dist) * (want < this.dist ? 1 : 1 - Math.exp(-dt * 6));
        cam.position.set(sx - f.x * this.dist, sy - f.y * this.dist, sz - f.z * this.dist);
        if (mode === 'orbit') cam.position.y = Math.max(cam.position.y, terrainHeight(cam.position.x, cam.position.z) + 1);
        cam.lookAt(cam.position.x + f.x, cam.position.y + f.y, cam.position.z + f.z);
        this.fov += (fov - this.fov) * (1 - Math.exp(-dt * (mode === 'scope' ? 26 : 18)));
        if (Math.abs(cam.fov - this.fov) > 0.01) {
            cam.fov = this.fov;
            cam.updateProjectionMatrix();
        }
        return cam.position;
    }
}
