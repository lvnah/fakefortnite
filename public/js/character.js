// Personnages : vrais modèles 3D animés (KayKit Adventurers + Skeletons, CC0), 9 skins.
// Animations du squelette partagé (course, pas chassés, saut, visée à deux mains / à une main,
// tir, rechargement, pioche, soin, mort, assis en voiture, danses) mélangées haut / bas du corps,
// plus des retouches procédurales (visée haut/bas, chute libre, planeur, nage, tyrolienne).
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { stripes, sprayTexture } from './textures.js';
import { weaponModel } from './items.js';
import { loadSkin, loadAnims, CHAR_SCALE, rigOf } from './models.js';

export const SKINS = {
    knight: { name: 'Chevalier', glider: ['#2f6fd6', '#f2f2f2', '#d63a2f'] },
    barbarian: { name: 'Barbare', glider: ['#8b1e1e', '#e8c07a', '#3b2a1a'] },
    mage: { name: 'Mage', glider: ['#6a4c93', '#ffca3a', '#1982c4'] },
    rogue: { name: 'Voleuse', glider: ['#2d6a4f', '#95d5b2', '#1b4332'] },
    hooded: { name: 'Capuche', glider: ['#264653', '#e9c46a', '#2a9d8f'] },
    skel_warrior: { name: 'Squelette guerrier', glider: ['#111122', '#00e5ff', '#111122'] },
    skel_mage: { name: 'Squelette mage', glider: ['#3c096c', '#c77dff', '#10002b'] },
    skel_rogue: { name: 'Squelette voleur', glider: ['#1a1a1a', '#c0202a'] },
    skel_minion: { name: 'Sbire squelette', glider: ['#556b2f', '#d8d8c0', '#2d3a22'] },
    // taille humaine (Quaternius, CC0)
    homme: { name: 'Grand gaillard', glider: ['#b5651d', '#f4e3c1', '#5a3a1a'] },
    femme: { name: 'Voyageuse', glider: ['#2a9d8f', '#f4f1de', '#e76f51'] },
};

/**
 * Taille de TOUS les personnages, quel que soit le modèle d'origine : chaque skin est mis à
 * l'échelle sur cette hauteur (pieds au sol). Personne n'est plus grand ou plus petit qu'un
 * autre : même visibilité, même hitbox (PLAYER_H côté physique), même caméra.
 */
export const CHAR_HEIGHT = 1.85;

/** Noms des animations KayKit -> animations Quaternius (squelette « q »). */
const QMAP = {
    Idle: 'Idle_Loop', Walking_A: 'Walk_Loop', Walking_Backwards: 'Walk_Loop', Running_A: 'Jog_Fwd_Loop',
    Running_Strafe_Left: 'Jog_Fwd_Loop', Running_Strafe_Right: 'Jog_Fwd_Loop', Jump_Idle: 'Jump_Loop', Death_A: 'Death01',
    Hit_A: 'Hit_Chest', Sit_Chair_Idle: 'Driving_Loop', Spellcast_Raise: 'Idle_Rail_Loop', Use_Item: 'Consume', Interact: 'Interact',
    '2H_Ranged_Reload': 'Pistol_Reload', '1H_Ranged_Reload': 'Pistol_Reload', '2H_Ranged_Shoot': 'Pistol_Shoot',
    '1H_Ranged_Shoot': 'Pistol_Shoot', '2H_Ranged_Aiming': 'Pistol_Aim_Neutral', '1H_Ranged_Aiming': 'Pistol_Aim_Neutral',
    '1H_Melee_Attack_Chop': 'Sword_Attack', Throw: 'OverhandThrow',
    Cheer: 'Yes', Taunt: 'Idle_No_Loop', Spellcasting: 'Spell_Simple_Idle_Loop', Sit_Floor_Idle: 'Sitting_Idle_Loop',
    Lie_Idle: 'Idle_FoldArms_Loop', Taunt_Longer: 'Zombie_Scratch', Unarmed_Melee_Attack_Punch_A: 'Punch_Cross',
    '2H_Melee_Attack_Spinning': 'Dance_Loop',
};
/** Os utilisés pour les retouches, selon le squelette. */
const BONES = {
    kay: { chest: 'chest', head: 'head', spine: 'spine', hips: 'hips', handR: 'handslotr', handL: 'handslotl', armL: 'upperarml', armR: 'upperarmr', chain: ['hips', 'spine'] },
    q: { chest: 'spine_03', head: 'Head', spine: 'spine_02', hips: 'pelvis', handR: 'hand_r', handL: 'hand_l', armL: 'upperarm_l', armR: 'upperarm_r', chain: ['pelvis', 'spine_01', 'spine_02'] },
};

function mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0, ...opts });
}
function mesh(geo, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
}
const damp = (c, t, l, dt) => c + (t - c) * (1 - Math.exp(-l * dt));

function nameSprite(name) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprayTexture(name, '#ffffff', 'bold 56px system-ui'), depthTest: false, transparent: true }));
    sp.scale.set(2.4, 0.6, 1);
    sp.position.y = 2.4;
    sp.renderOrder = 10;
    return sp;
}

/**
 * Planeur : voile cintrée (parapente) à rayures, suspentes et barre tenue à deux mains.
 * Symétrique avant / arrière : il ne peut pas paraître « à l'envers ».
 */
export function makeGlider(colors) {
    const g = new THREE.Group();
    const R = 2.6;
    const SPAN = 1.6;
    const canopy = new THREE.CylinderGeometry(R, R, 1.7, 20, 1, true, Math.PI - SPAN / 2, SPAN);
    canopy.rotateX(Math.PI / 2);
    canopy.translate(0, -R, 0);
    const sail = new THREE.Mesh(canopy, new THREE.MeshStandardMaterial({ map: stripes(colors, 10), side: THREE.DoubleSide, roughness: 0.55 }));
    sail.castShadow = true;
    g.add(sail);
    // bourrelet avant et arrière (épaisseur de la voile)
    const rimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colors[0]), roughness: 0.5 });
    for (const zz of [-0.85, 0.85]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.06, 6, 24, SPAN), rimMat);
        rim.rotation.z = Math.PI / 2 - SPAN / 2;
        rim.position.set(0, -R, zz);
        g.add(rim);
    }
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const barY = -1.55;
    const tipX = Math.sin(SPAN / 2) * R;
    const tipY = R * Math.cos(SPAN / 2) - R;
    for (const sx of [-1, 1]) {
        for (const [ax, ay] of [[tipX, tipY], [tipX * 0.5, R * Math.cos(SPAN / 4) - R]]) {
            for (const zz of [-0.6, 0.6]) {
                const a = new THREE.Vector3(sx * ax, ay, zz);
                const b = new THREE.Vector3(sx * 0.32, barY, 0.05);
                const len = a.distanceTo(b);
                const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 4), lineMat);
                line.position.copy(a).add(b).multiplyScalar(0.5);
                line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
                g.add(line);
            }
        }
    }
    const bar = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), mat(0x333333, { metalness: 0.6, roughness: 0.4 }), 0, barY, 0.05);
    bar.rotation.z = Math.PI / 2;
    g.add(bar);
    return g;
}

const GUN2 = new Set(['ar', 'smg', 'pump', 'sniper', 'rocket']);
const GUNS = new Set(['pistol', 'ar', 'smg', 'pump', 'sniper', 'rocket']);
/** Danses (touche B) : [animation, nom affiché] */
export const EMOTES = [['Cheer', 'Joie'], ['Taunt', 'Provocation'], ['Spellcasting', 'Magie'], ['Sit_Floor_Idle', 'Assis'],
    ['Lie_Idle', 'Sieste'], ['Taunt_Longer', 'Grosse provoc'], ['Unarmed_Melee_Attack_Punch_A', 'Boxe'], ['2H_Melee_Attack_Spinning', 'Toupie']];
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const interpCache = new Map();
/** Rotation d'un os dans une animation complète à l'instant t. */
function sampleRot(clip, bone, t, out) {
    const key = `${clip.uuid}|${bone}`;
    let it = interpCache.get(key);
    if (it === undefined) {
        const tr = clip.tracks.find((k) => k.name === `${bone}.quaternion`);
        it = tr ? tr.createInterpolant() : null;
        interpCache.set(key, it);
    }
    if (!it) return out.identity();
    const v = it.evaluate(Math.min(t, clip.duration));
    return out.set(v[0], v[1], v[2], v[3]);
}

/** Une couche d'animation (haut ou bas du corps) avec fondus enchaînés. */
class Layer {
    constructor(char, part) {
        this.c = char;
        this.part = part;
        this.actions = new Map();
        this.w = new Map();
        this.cur = null;
        this.fade = 0.15;
    }

    action(name) {
        let a = this.actions.get(name);
        if (!a) {
            const clip = (this.c.anims.get(name) ?? this.c.anims.get(this.c.amap?.[name]))?.[this.part];
            if (!clip) return null;
            a = this.c.mixer.clipAction(clip);
            a.setEffectiveWeight(0);
            this.actions.set(name, a);
            this.w.set(name, 0);
        }
        return a;
    }

    /** `hold` (0..1) : pose figée à cet instant de l'animation (visée immobile, sans à-coups). */
    play(name, { fade = 0.15, once = false, speed = 1, restart = false, hold = null } = {}) {
        const a = this.action(name);
        if (!a) return;
        a.timeScale = hold != null ? 0 : speed;
        if (hold != null) a.time = hold * a.getClip().duration;
        if (this.cur === name && !restart) return;
        if (restart || !a.isRunning() || this.w.get(name) === 0) a.reset();
        a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        a.clampWhenFinished = once;
        a.enabled = true;
        a.play();
        if (hold != null) a.time = hold * a.getClip().duration;
        this.cur = name;
        this.fade = fade;
    }

    /** Durée écoulée de l'animation en cours (0..1) */
    progress() {
        const a = this.cur && this.actions.get(this.cur);
        return a ? Math.min(1, a.time / a.getClip().duration) : 1;
    }

    update(dt) {
        for (const [name, a] of this.actions) {
            const target = name === this.cur ? 1 : 0;
            let w = this.w.get(name);
            if (w === target) continue;
            const step = this.fade > 0 ? dt / this.fade : 1;
            w = target > w ? Math.min(1, w + step) : Math.max(0, w - step);
            this.w.set(name, w);
            a.setEffectiveWeight(w);
            if (w === 0) a.stop();
        }
    }
}

export class Character {
    constructor(skinId, name, opts = {}) {
        this.skinId = SKINS[skinId] ? skinId : 'knight';
        this.style = SKINS[this.skinId];
        this.rig = rigOf(this.skinId);
        this.amap = this.rig === 'q' ? QMAP : null;
        this.bn = BONES[this.rig];
        this.root = new THREE.Group();
        this.pivot = new THREE.Group();          // bascule du corps (chute libre, nage, planeur)
        this.pivot.position.y = 0.95;
        this.root.add(this.pivot);
        this.holder = new THREE.Group();         // arme dans la main droite
        this.weaponType = undefined;
        this.weaponRarity = -1;
        this.weaponObj = null;
        this.muzzleRef = null;
        this.glider = makeGlider(this.style.glider);
        this.glider.position.set(0, 3.55, 0.05);
        this.glider.visible = false;
        this.root.add(this.glider);
        if (name && !opts.noLabel) {
            this.label = nameSprite(name);
            this.root.add(this.label);
        }
        this.t = 0;
        this.swingT = 1;
        this.shotT = 1;
        this.recoil = 0;
        this.tilt = 0;
        this.bob = 0;
        this.emoteUntil = 0;
        this.emoteName = null;
        this.shadows = true;
        this.ready = false;
        this.disposed = false;
        Promise.all([loadSkin(this.skinId), loadAnims(this.rig)]).then(([gltf, anims]) => {
            if (!this.disposed) this.init(gltf, anims);
        }).catch((e) => console.warn('personnage', e));
    }

    init(gltf, anims) {
        const model = cloneSkinned(gltf.scene);
        // tous les skins à la même taille : on mesure le modèle et on le met à l'échelle de
        // CHAR_HEIGHT, pieds posés sur le sol (origine du personnage).
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model, true);
        const h = Math.max(0.5, box.max.y - box.min.y);
        const k = CHAR_HEIGHT / h;
        model.scale.setScalar(k);
        model.position.y = -0.95 - box.min.y * k;
        this.scaleK = k;
        if (this.label) this.label.position.y = CHAR_HEIGHT + 0.5;
        model.traverse((o) => {
            if (o.isMesh) {
                o.castShadow = this.shadows;
                o.receiveShadow = false;
                if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
            }
        });
        this.model = model;
        this.pivot.add(model);
        const bone = (n) => model.getObjectByName(n);
        const B = this.bn;
        this.b = {
            chest: bone(B.chest), head: bone(B.head), spine: bone(B.spine), hips: bone(B.hips),
            handR: bone(B.handR), handL: bone(B.handL), armL: bone(B.armL), armR: bone(B.armR),
            chain: B.chain.map(bone),
        };
        // squelette « q » : l'arme suit la main mais reste dans l'axe de visée (orientation des os différente)
        if (this.rig === 'q') this.root.add(this.holder);
        else (this.b.handR ?? model).add(this.holder);
        // pose de repos des os retouchés à la main : remise à zéro à chaque image (sinon la
        // retouche s'ajoute d'une image à l'autre et la tête finit par tourner sur elle-même)
        this.rest = [this.b.chest, this.b.head, this.b.armL, this.b.armR, this.b.spine]
            .filter(Boolean).map((bn) => [bn, bn.quaternion.clone()]);
        this.anims = anims;
        this.mixer = new THREE.AnimationMixer(model);
        this.lower = new Layer(this, 'lower');
        this.upper = new Layer(this, 'upper');
        this.lower.play('Idle', { fade: 0 });
        this.upper.play('Idle', { fade: 0 });
        if (this.weaponType) { const t = this.weaponType; this.weaponType = undefined; this.setWeapon(t, this.weaponRarity, this.weaponPick ?? 'classic'); }
        this.ready = true;
    }

    setShadows(on) {
        if (on === this.shadows) return;
        this.shadows = on;
        this.model?.traverse((o) => { if (o.isMesh) o.castShadow = on; });
    }

    /** Arme tenue (modèle selon le type, la rareté et le skin de pioche), dans la main droite. */
    setWeapon(type, rarity = 0, pick = 'classic') {
        if (this.weaponType === type && this.weaponRarity === rarity && this.weaponPick === pick) return;
        this.weaponType = type;
        this.weaponRarity = rarity;
        this.weaponPick = pick;
        this.holder.clear();
        this.weaponObj = null;
        this.muzzleRef = null;
        if (!type) return;
        const w = weaponModel(type, rarity, pick);
        if (!w) return;
        this.weaponObj = w;
        // l'arme garde la même taille réelle quel que soit le skin : pour le squelette « kay »
        // le porte-arme est dans la main (donc déjà à l'échelle du modèle), on compense.
        const s = this.rig === 'q' ? 1.0 : 1.15 / (this.scaleK || CHAR_SCALE);
        w.scale.setScalar(s);
        if (this.rig === 'q') {
            // tenue « dans l'axe » : canon vers l'avant du personnage
            w.rotation.set(0, 0, 0);
            w.position.set(0, 0, 0.04);
        } else {
            // canon vers +x de l'emplacement de main (comme l'arbalète KayKit)
            w.rotation.set(0, Math.PI / 2, 0);
            w.position.set(-0.105, -0.01, 0);
        }
        this.holder.add(w);
        this.muzzleRef = w.getObjectByName('muzzle') || null;
        if (this.fadeMats) {
            const a = this.fadeA ?? 1;
            w.traverse((o) => {
                if (!o.isMesh) return;
                o.material = o.material.clone();
                o.material.transparent = a < 1;
                o.material.opacity = a;
                this.fadeMats.push(o.material);
            });
        }
    }

    muzzleWorld(out = new THREE.Vector3()) {
        if (this.muzzleRef) return this.muzzleRef.getWorldPosition(out);
        return this.root.getWorldPosition(out).add(new THREE.Vector3(0, 1.4, 0));
    }

    triggerSwing() { this.swingT = 0; this.swingNew = true; }
    /** Un tir : l'arme recule un peu dans la main (le haut du corps garde sa pose de visée). */
    triggerShot(kick = 1) { this.recoil = Math.min(1.5, this.recoil + kick); this.shotT = 0; this.kickT = 0; this.kickAmp = kick; }
    /** Danse : elle tourne en boucle jusqu'à ce qu'on bouge (10 s au plus). */
    emote(e) {
        this.emoteName = (EMOTES[e] ?? EMOTES[0])[0];
        this.emoteUntil = this.t + 10;
    }

    /** Transparence (caméra collée au personnage dans une pièce étroite). */
    setFade(alpha) {
        if (!this.model) return;
        if (!this.fadeMats) {
            if (alpha >= 1) return;
            this.fadeMats = [];
            this.model.traverse((o) => {
                if (!o.isMesh) return;
                o.material = o.material.clone();
                this.fadeMats.push(o.material);
            });
            this.holder.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); this.fadeMats.push(o.material); } });
        }
        const a = Math.max(0.12, Math.min(1, alpha));
        if (Math.abs(a - (this.fadeA ?? 1)) < 0.01) return;
        this.fadeA = a;
        for (const m of this.fadeMats) {
            m.transparent = a < 1;
            m.opacity = a;
            m.depthWrite = a >= 1;
            m.needsUpdate = true;
        }
    }

    /**
     * a : { speed, vel:[x,y,z], yaw, grounded, crouch, sliding, gliding, falling, diving, swimming, aiming,
     *       shooting, holding, using, reloading, pitch, dead, driving, zipping }
     */
    update(dt, a) {
        this.t += dt;
        this.swingT = Math.min(1, this.swingT + dt * 2.6);
        this.shotT = Math.min(1, this.shotT + dt * 4);
        this.kickT = Math.min(1, (this.kickT ?? 1) + dt * 9);
        this.recoil = Math.max(0, this.recoil - dt * 8);
        this.glider.visible = !!a.gliding && !a.zipping;
        if (!a.gliding) this.gliderHeld = false;
        if (!this.ready) return;
        const air = a.falling || a.gliding;
        const gun = !!a.holding && GUNS.has(a.holding);
        const two = GUN2.has(a.holding);
        const busy = a.dead || a.driving || a.zipping || air || a.swimming;
        if (a.speed > 0.6 || busy || a.using) this.emoteUntil = 0;

        // ---- bas du corps
        let low = 'Idle';
        let lowSpeed = 1;
        let tiltT = 0;
        let bobT = 0;
        if (a.dead) low = 'Death_A';
        else if (a.driving) low = 'Sit_Chair_Idle';
        else if (a.zipping) low = 'Jump_Idle';
        else if (a.gliding) { low = 'Jump_Idle'; tiltT = 0.25; }
        else if (a.falling) { low = 'Jump_Idle'; tiltT = a.diving ? 1.35 : 1.1; }
        else if (a.swimming) { low = 'Running_A'; lowSpeed = 0.55; tiltT = 1.2; bobT = -0.45; }
        else if (a.sliding) { low = 'Jump_Idle'; tiltT = -0.5; bobT = -0.45; }
        else if (!a.grounded) low = 'Jump_Idle';
        else if (a.speed > 0.5) {
            // direction du mouvement dans le repère du personnage
            const fx = -Math.sin(a.yaw ?? 0);
            const fz = -Math.cos(a.yaw ?? 0);
            const vx = a.vel?.[0] ?? 0;
            const vz = a.vel?.[2] ?? 0;
            const f = vx * fx + vz * fz;
            const sd = vx * -fz + vz * fx;   // > 0 : vers la droite
            if (a.speed < 3.6 || a.crouch) { low = f < -0.3 && Math.abs(f) > Math.abs(sd) ? 'Walking_Backwards' : 'Walking_A'; lowSpeed = Math.max(0.6, a.speed / 2.4); }
            else if (Math.abs(f) >= Math.abs(sd) * 0.8) {
                if (f >= 0) { low = 'Running_A'; lowSpeed = Math.min(1.6, Math.max(0.7, a.speed / 6.2)); }
                else { low = 'Walking_Backwards'; lowSpeed = Math.min(1.8, a.speed / 3); }
            } else {
                low = sd > 0 ? 'Running_Strafe_Right' : 'Running_Strafe_Left';
                lowSpeed = Math.min(1.5, Math.max(0.7, a.speed / 6));
            }
        } else if (this.t < this.emoteUntil) low = this.emoteName;
        if (a.crouch && a.grounded && !a.sliding && !busy) bobT = -0.32;
        // sprint tactique : le personnage se penche nettement en avant
        if (a.grounded && !busy && !a.crouch && !a.sliding && a.speed > 9.5) tiltT = 0.22;
        if (this.rig === 'q') {
            // squelette « q » : vraies animations accroupi, nage, glissade et sprint
            if (a.swimming) { low = a.speed > 0.5 ? 'Swim_Fwd_Loop' : 'Swim_Idle_Loop'; lowSpeed = 1; tiltT = 0; bobT = -1.15; }
            else if (a.sliding) { low = 'Slide_Loop'; tiltT = 0; bobT = 0; }
            else if (a.crouch && a.grounded && !busy) { low = a.speed > 0.5 ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop'; bobT = 0; }
            else if (low === 'Running_A' && a.speed > 7.0) low = 'Sprint_Loop';
            if (low === 'Walking_Backwards') lowSpeed = -lowSpeed;
        }
        this.lower.play(low, { speed: lowSpeed, once: low === 'Death_A' || low === 'Hit_A', fade: low === 'Death_A' ? 0.1 : 0.11 });

        // ---- haut du corps
        let up = low;
        let upOpts = { speed: lowSpeed };
        const seatedGun = a.driving && gun && (a.aiming || a.shooting || this.shotT < 1);
        if (a.dead || a.swimming || (a.driving && !seatedGun)) { up = low; }
        else if (a.zipping) { up = 'Spellcast_Raise'; upOpts = { once: true, speed: 1.4 }; }
        else if (a.gliding) { up = 'Jump_Idle'; }
        else if (a.falling) { up = 'Jump_Idle'; }
        else if (a.using) { up = 'Use_Item'; upOpts = { speed: 1 }; }
        else if (gun && this.swingT < 1) {
            // coup de crosse avec l'arme tenue
            up = '1H_Melee_Attack_Chop';
            upOpts = { once: true, speed: 2.1, restart: this.swingNew, fade: 0.06 };
        } else if (gun && a.reloading) {
            up = two ? '2H_Ranged_Reload' : '1H_Ranged_Reload';
            upOpts = { speed: 1.3 };
        } else if (gun) {
            // pose de visée figée, même en rafale : pas d'animation de tir, et pas de « reprise »
            // de l'animation de visée en boucle (son début baisse l'arme) — les bras ne font plus le yoyo
            up = two ? '2H_Ranged_Aiming' : '1H_Ranged_Aiming';
            upOpts = { fade: 0.08, hold: 0.45 };
        } else if (a.holding === 'grenade' && this.swingT < 1) {
            up = 'Throw';
            upOpts = { once: true, speed: 1.8, restart: this.swingNew, fade: 0.05 };
        } else if (this.t < this.emoteUntil) up = this.emoteName;
        this.swingNew = false;
        this.upper.play(up, upOpts);

        for (const [bn, q] of this.rest) bn.quaternion.copy(q);
        this.dirtyRestBindings();
        this.lower.update(dt);
        this.upper.update(dt);
        this.mixer.update(dt);
        this.alignChest();

        // ---- retouches procédurales
        this.tilt = damp(this.tilt, tiltT, air ? 5 : 10, dt);
        this.bob = damp(this.bob, bobT, 10, dt);
        this.pivot.rotation.x = this.tilt;
        // inclinaison dans les virages en vol (planeur, chute libre)
        this.bank = damp(this.bank ?? 0, air ? Math.max(-0.6, Math.min(0.6, -(a.turn ?? 0) * 0.22)) : 0, 4, dt);
        this.pivot.rotation.z = this.bank;
        this.glider.rotation.z = this.bank * 0.8;
        this.glider.rotation.x = -0.12;
        this.pivot.position.y = 0.95 + this.bob;
        if (a.driving && this.rig !== 'q') this.pivot.position.y = 0.95 - 0.35;
        const pitch = a.pitch ?? 0;
        if (this.b.chest && gun && !busy && !a.using) {
            // visée haut / bas répartie entre la poitrine et la tête
            this.bendAim(this.b.chest, -pitch * 0.75);
            this.bendAim(this.b.head, -pitch * 0.25);
        } else if (this.b.head && !busy) {
            this.bendAim(this.b.head, -pitch * 0.4);
        }
        if (this.rig !== 'q' && a.falling && !a.gliding && this.b.armL && this.b.armR) {
            // bras écartés en chute libre
            const k = a.diving ? 0.4 : 1.1;
            this.b.armL.rotateZ(k);
            this.b.armR.rotateZ(-k);
        }
        // planeur : bras levés, la barre suit les mains (le personnage tient vraiment son parapente)
        if (this.rig !== 'q' && a.gliding && !a.zipping && this.b.armL && this.b.armR) {
            this.b.armL.rotateZ(2.45);
            this.b.armR.rotateZ(-2.45);
        }
        if (a.gliding && this.b.handL && this.b.handR) this.holdGlider(dt);
        // l'arme reste rangée en l'air, dans l'eau, en voiture et sur la tyrolienne
        this.holder.visible = !busy && !(a.using && !gun);
        if (this.rig === 'q' && this.holder.visible && this.b.handR) {
            // l'arme suit la main droite, orientée dans l'axe de visée
            this.root.updateMatrixWorld(true);
            this.b.handR.getWorldPosition(_v2);
            this.root.worldToLocal(_v2);
            this.holder.position.copy(_v2);
            const swing = this.swingT < 1 ? Math.sin(this.swingT * Math.PI) * 1.0 : 0;
            this.holder.rotation.set(gun ? -pitch * 0.9 : swing, 0, 0);
        }
        // recul : l'arme glisse de quelques centimètres vers l'arrière puis revient (rien d'autre ne bouge)
        const kick = gun && this.holder.visible ? (this.kickAmp ?? 0) * (1 - (this.kickT ?? 1)) ** 2 : 0;
        if (this.rig === 'q') {
            if (kick > 0) { this.holder.translateZ(-0.05 * kick); this.holder.rotateX(-0.035 * kick); }
        } else {
            this.holder.position.set(-0.05 * kick / (this.scaleK || CHAR_SCALE), 0, 0);
        }
    }

    /**
     * L'AnimationMixer n'écrit un os que si sa valeur animée a changé depuis l'image précédente.
     * Comme on remet certains os au repos à chaque image (retouches procédurales), on l'oblige à
     * les réécrire — sinon une pose fixe (visée immobile) resterait… au repos.
     */
    dirtyRestBindings() {
        const list = this.mixer._bindings;
        if (!list) return;
        if (this.restBindN !== list.length) {
            const bones = new Set(this.rest.map(([bn]) => bn));
            this.restBind = list.filter((b) => bones.has(b.binding.node));
            this.restBindN = list.length;
        }
        for (const b of this.restBind) b.buffer.fill(NaN, b.valueSize, 3 * b.valueSize);
    }

    /** Place la voile pour que sa barre soit entre les deux mains. */
    holdGlider(dt) {
        this.root.updateMatrixWorld(true);
        this.b.handL.getWorldPosition(_v2);
        this.b.handR.getWorldPosition(_v3);
        _v2.add(_v3).multiplyScalar(0.5);
        this.root.worldToLocal(_v2);
        // barre à GLIDER_BAR sous l'origine de la voile (voir makeGlider)
        const tx = _v2.x;
        const ty = Math.max(_v2.y + 1.55 - 0.03, CHAR_HEIGHT + 1.45);
        const tz = _v2.z - 0.05;
        const g = this.glider.position;
        if (!this.gliderHeld) { g.set(tx, ty, tz); this.gliderHeld = true; }
        else g.set(damp(g.x, tx, 18, dt), damp(g.y, ty, 18, dt), damp(g.z, tz, 18, dt));
    }

    /**
     * Le haut du corps (visée, tir, soin…) garde l'orientation de son animation d'origine,
     * quel que soit le mouvement des hanches et du dos joué par les jambes (course, pas chassés).
     */
    alignChest() {
        const name = this.upper.cur;
        if (!name || name === this.lower.cur || !this.b.chest || !this.b.hips || !this.b.spine) return;
        const w = this.upper.w.get(name) ?? 0;
        const act = this.upper.actions.get(name);
        const full = (this.anims.get(name) ?? this.anims.get(this.amap?.[name]))?.full;
        if (w <= 0 || !act || !full) return;
        const t = act.time;
        const chain = this.bn.chain;
        _q1.identity();
        for (const n of chain) _q1.multiply(sampleRot(full, n, t, _q3));
        _q1.multiply(sampleRot(full, this.bn.chest, t, _q3));                      // pose voulue
        _q2.identity();
        for (const bn of this.b.chain) if (bn) _q2.multiply(bn.quaternion);
        _q2.invert();                                                              // pose actuelle du dos
        _q2.multiply(_q1);
        this.b.chest.quaternion.slerp(_q2, w);
    }

    /** Penche un os vers l'avant / l'arrière autour de l'axe droite-gauche du personnage. */
    bendAim(bone, angle) {
        if (!bone || Math.abs(angle) < 1e-4) return;
        bone.parent.getWorldQuaternion(_q1);
        this.root.getWorldQuaternion(_q2);
        _v1.set(1, 0, 0).applyQuaternion(_q2).applyQuaternion(_q1.invert()).normalize();
        bone.quaternion.premultiply(_q3.setFromAxisAngle(_v1, angle));
    }

    dispose() {
        this.disposed = true;
        this.mixer?.stopAllAction();
        this.mixer?.uncacheRoot(this.model);
    }
}
