// Arme vue à la première personne : un modèle accroché à la caméra, avec balancement
// (marche), recul au tir, mise en joue et descente de l'arme pendant un soin.
import * as THREE from 'three';
import { weaponModel } from './items.js';

const damp = (c, t, l, dt) => c + (t - c) * (1 - Math.exp(-l * dt));

/** Position de repos / en visée de chaque arme (x droite, y haut, z avant), dans le repère caméra. */
const POSE = {
    pistol: { hip: [0.13, -0.13, -0.52], ads: [0, -0.062, -0.46], s: 0.5 },
    smg: { hip: [0.145, -0.14, -0.56], ads: [0, -0.066, -0.5], s: 0.44 },
    ar: { hip: [0.15, -0.14, -0.58], ads: [0, -0.068, -0.52], s: 0.4 },
    pump: { hip: [0.15, -0.14, -0.58], ads: [0, -0.068, -0.52], s: 0.38 },
    sniper: { hip: [0.15, -0.13, -0.6], ads: [0, -0.066, -0.54], s: 0.35 },
    rocket: { hip: [0.17, -0.15, -0.6], ads: [0.03, -0.09, -0.54], s: 0.32 },
};
const DEFAULT_POSE = { hip: [0.12, -0.12, -0.5], ads: [0.03, -0.08, -0.44], s: 0.56 };

/** Teintes des gants et des manches de l'opérateur (cohérentes avec les tenues). */
const GLOVE = 0x6b6155;
const SLEEVE = 0x414852;
const SLEEVE_PATCH = 0x535b66;

/**
 * Bras et mains gantées tenant l'arme, comme sur Warzone. Tout est en mètres dans le repère
 * du porte-arme (la caméra regarde vers -z). La main se pose sur l'arme et l'avant-bras va
 * jusqu'à un coude fixe, en bas, en arrière et vers l'extérieur : il sort du champ comme
 * dans un vrai FPS, au lieu de traverser la caméra.
 */
function buildArms(type, pose) {
    const g = new THREE.Group();
    const glove = new THREE.MeshStandardMaterial({ color: GLOVE, roughness: 0.85, metalness: 0.02, flatShading: true });
    const sleeve = new THREE.MeshStandardMaterial({ color: SLEEVE, roughness: 0.95, metalness: 0 });
    const patch = new THREE.MeshStandardMaterial({ color: SLEEVE_PATCH, roughness: 0.9 });
    // position de la main gauche sur le garde-main (l'arme est déjà à l'échelle)
    const fore = ({ pistol: 0, smg: 0.2, ar: 0.26, pump: 0.26, sniper: 0.28, rocket: 0.22 }[type] ?? 0.22) * (pose.s ?? 1) * 2;

    /** Main gantée en `hand`, avant-bras tendu jusqu'à `elbow`. */
    const arm = (side, hand, elbow) => {
        const a = new THREE.Group();
        const palm = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.05, 0.06), glove);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.041, 0.016, 0.056), patch);
        back.position.y = 0.029;
        const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.026, 3, 6), glove);
        thumb.rotation.set(1.25, 0, 0);
        thumb.position.set(-side * 0.018, 0.009, -0.016);
        const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.04, 0.022), glove);
        fingers.position.set(0, -0.019, -0.026);
        a.add(palm, back, thumb, fingers);
        a.position.copy(hand);
        g.add(a);

        // avant-bras : un cylindre orienté de la main vers le coude
        const dir = new THREE.Vector3().subVectors(elbow, hand);
        const len = dir.length();
        const fa = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.04, len, 10), sleeve);
        fa.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        fa.position.copy(hand).addScaledVector(dir, 0.5);
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.026, 10), patch);
        cuff.quaternion.copy(fa.quaternion);
        cuff.position.copy(hand).addScaledVector(dir.clone().normalize(), 0.05);
        g.add(fa, cuff);
    };

    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    // main droite sur la poignée, coude en bas à droite derrière la caméra
    arm(1, V(0.024, -0.03, 0.0), V(0.15, -0.5, 0.2));
    // main gauche sur le garde-main (armes à deux mains), coude en bas à gauche
    if (fore > 0) arm(-1, V(-0.024, -0.016, -fore), V(-0.13, -0.48, 0.14));
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 20; } });
    g.name = 'arms';
    return g;
}

export class ViewModel {
    constructor(camera) {
        this.camera = camera;
        this.root = new THREE.Group();
        this.root.renderOrder = 20;
        camera.add(this.root);
        this.holder = new THREE.Group();
        this.root.add(this.holder);
        this.type = undefined;
        this.rarity = -1;
        this.obj = null;
        this.ads = 0;
        this.bob = 0;
        this.kick = 0;
        this.kickT = 1;
        this.sway = new THREE.Vector2();
        this.lastYaw = 0;
        this.lastPitch = 0;
        this.lower = 0;
        this.visible = false;
    }

    /** Modèle de l'arme tenue (null : mains vides, rien n'est affiché). */
    set(type, rarity = 0) {
        if (this.type === type && this.rarity === rarity) return;
        this.type = type;
        this.rarity = rarity;
        this.holder.clear();
        this.obj = null;
        this.muzzle = null;
        if (!type) return;
        const w = weaponModel(type, rarity);
        if (!w) return;
        // l'arme pointe vers +z ; devant la caméra, l'avant est -z. Légère ouverture vers
        // l'intérieur de l'écran, comme dans les FPS : on voit le flanc de l'arme, pas son dos.
        w.rotation.set(0, Math.PI - 0.1, 0);
        const pose = POSE[type] ?? DEFAULT_POSE;
        w.scale.setScalar(pose.s);
        this.holder.add(w);
        this.holder.add(buildArms(type, pose));
        this.obj = w;
        this.muzzle = w.getObjectByName('muzzle');
        // l'arme ne doit jamais être coupée par un mur tout proche
        w.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = false;
            o.receiveShadow = false;
            o.renderOrder = 20;
        });
    }

    /** Un tir : l'arme recule et remonte brièvement. */
    shoot(amount = 1) {
        this.kick = Math.min(1.6, this.kick + amount);
        this.kickT = 0;
    }

    /**
     * a : { on, speed, grounded, aiming, scoped, using, reloading, sprinting, yaw, pitch }
     * `on` à false range complètement l'arme (3e personne, mort, véhicule…).
     */
    update(dt, a) {
        const show = !!a.on && !!this.obj && !a.scoped;
        this.root.visible = show;
        this.visible = show;
        if (!show) {
            this.bob = 0;
            return;
        }
        const pose = POSE[this.type] ?? DEFAULT_POSE;
        this.ads = damp(this.ads, a.aiming ? 1 : 0, 16, dt);
        this.kickT = Math.min(1, this.kickT + dt * 7);
        this.kick = Math.max(0, this.kick - dt * 5.5);
        // arme baissée : soin en cours, rechargement, sprint
        this.lower = damp(this.lower, a.using ? 1 : a.sprinting ? 0.55 : 0, 10, dt);

        // balancement de marche
        const moving = a.grounded && a.speed > 0.6 ? Math.min(1, a.speed / 7) : 0;
        this.bob += dt * (6 + a.speed * 0.9) * (moving > 0 ? 1 : 0);
        const bobAmp = moving * (1 - this.ads * 0.8) * (1 - this.lower) * 0.016;
        const bx = Math.sin(this.bob) * bobAmp * 1.6;
        const by = Math.abs(Math.cos(this.bob)) * bobAmp;

        // inertie de la souris : l'arme traîne derrière la visée
        let dy = (a.yaw ?? 0) - this.lastYaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const dp = (a.pitch ?? 0) - this.lastPitch;
        this.lastYaw = a.yaw ?? 0;
        this.lastPitch = a.pitch ?? 0;
        const swayK = (1 - this.ads * 0.75) * 0.6;
        this.sway.x = damp(this.sway.x, THREE.MathUtils.clamp(dy * 2.2, -0.1, 0.1) * swayK, 9, dt);
        this.sway.y = damp(this.sway.y, THREE.MathUtils.clamp(-dp * 2.2, -0.08, 0.08) * swayK, 9, dt);

        const hip = pose.hip;
        const ads = pose.ads;
        const k = this.ads;
        const recoil = (this.kick || 0) * (1 - this.kickT) ** 2;
        this.holder.position.set(
            hip[0] + (ads[0] - hip[0]) * k + bx + this.sway.x,
            hip[1] + (ads[1] - hip[1]) * k + by + this.sway.y - this.lower * 0.22 + recoil * 0.012,
            hip[2] + (ads[2] - hip[2]) * k + recoil * 0.055,
        );
        this.holder.rotation.set(
            -recoil * 0.26 + this.lower * 0.75 + this.sway.y * 1.2,
            this.sway.x * 1.4 - this.lower * 0.3,
            (1 - k) * -0.05 + this.lower * 0.35,
        );
    }

    /** Position du canon dans le monde (traçantes partant de l'arme vue en FPS). */
    muzzleWorld(out = new THREE.Vector3()) {
        if (this.muzzle && this.visible) return this.muzzle.getWorldPosition(out);
        return this.camera.getWorldPosition(out);
    }
}
