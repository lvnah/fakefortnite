// Point d'entrée : menu (aperçu du skin), connexion, simulation 60 Hz avec prédiction, rendu, interface.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as S from './shared.js';
import { World } from './world.js';
import { BuildRenderer, MAT_DEBRIS } from './building.js';
import { Effects } from './effects.js';
import { initAudio, sfx, setAmbience, setListener, setVolumes, distVol, music_, chestHearRange } from './audio.js';
import { Character, EMOTES } from './character.js';
import { settings, onSettings, openSettings, settingsOpen, actionOf, setKeyLabeler, saveSettings, crosshairHtml, QUALITY } from './settings.js';
import { ViewModel } from './viewmodel.js';
import { preloadCharacters } from './models.js';
import { Controls, CameraRig } from './controls.js';
import { LootRenderer } from './loot.js';
import { Net } from './network.js';
import { UI } from './ui.js';
import { ITEM_NAMES, WEAPONS, CONSUMABLES, LETHALS, TACTICALS, ATTACHMENTS, ATTACH_MAX, PERKS, PERK_SLOTS, WEAPON_AMMO, itemName, potionModel } from './items.js';

const cfg = window.GAME_CONFIG || {};
const API = cfg.API_URL || 'api.php';
const TOKEN_KEY = 'bi_token';
const PREDICTABLE = new Set(['lobby', 'alive', 'falling']);
const RENDER_DELAY = 100;
const DRIVER_SIDE = 0.42;   // place du conducteur : à gauche du centre du véhicule
const CHEST_HEAR = 10;   // distance à laquelle on entend un coffre (m) : il faut s'approcher
const TRACER = { pistol: 0xfff0b0, smg: 0xfff0b0, ar: 0xffe08a, pump: 0xffc070, sniper: 0x9fdcff, rocket: 0xffb060 };
const KICK = { pistol: 0.018, smg: 0.007, ar: 0.011, pump: 0.05, sniper: 0.09, rocket: 0.06 };
preloadCharacters(['knight']);

// ------------------------------------------------------------ rendu

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbfe3ff, 0.0021);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 3000);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.28, 0.45, 0.88);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// scène du lobby (aperçu du personnage par-dessus l'île)
const lobbyScene = new THREE.Scene();
const lobbyCam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 50);
lobbyCam.position.set(0, 1.5, 7.4);
lobbyCam.lookAt(0, 1.0, 0);
lobbyScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(2, 4, 5);
lobbyScene.add(keyLight);
const rim = new THREE.DirectionalLight(0x88ccff, 1.6);
rim.position.set(-3, 2, -4);
lobbyScene.add(rim);
const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.2, 40), new THREE.MeshStandardMaterial({ color: 0x2b8cff, roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(0x0b3b8a), emissiveIntensity: 0.6 }));
podium.position.y = -0.1;
lobbyScene.add(podium);
let lobbyChar = null;

addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = lobbyCam.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    lobbyCam.updateProjectionMatrix();
    placeLobbyCam();
});
function placeLobbyCam() {
    // personnage centré même avec les panneaux latéraux
    lobbyCam.setViewOffset(innerWidth, innerHeight, 0, 0, innerWidth, innerHeight);
}

// ------------------------------------------------------------ carte et monde

const map = await (await fetch('map/island.json')).json();
S.setMap(map);
const ctl = new Controls(canvas);
const rig = new CameraRig(camera);
// arme vue à la première personne (accrochée à la caméra, qui doit donc être dans la scène)
scene.add(camera);
const viewModel = new ViewModel(camera);
const ui = new UI(ctl, map);
const world = new World(scene, map);
const fx = new Effects(scene, camera);
let store = new S.PieceStore();
setKeyLabeler((c) => ctl.label(c));

// ------------------------------------------------------------ paramètres : qualité graphique et volumes

let fogK = 1;
function applySettings() {
    const q = QUALITY[settings.quality] ?? QUALITY.haut;
    const pr = q.ratio >= 2 ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.5) * q.ratio;
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloomPass.enabled = q.bloom;
    camera.far = q.far;
    camera.updateProjectionMatrix();
    fogK = q.far < 1200 ? 1.8 : q.far < 2000 ? 1.25 : 1;
    world.setQuality(q);
    setVolumes(settings.vol);
}
onSettings(applySettings);
const buildings = new BuildRenderer(scene, store, fx);
const loot = new LootRenderer(scene);

function mapPieces() {
    return map.pieces.map(([type, gx, gy, gz, rot, v, mat, st]) => {
        const col = map.cols[`${gx}:${gz}`] ?? S.snapColumn((gx + 0.5) * 4, (gz + 0.5) * 4);
        return { type, gx, gy, gz, rot, v, mat, st, hp: 1, max: 1, base: col + gy * S.CELL };
    });
}
world.loadNodes(map.nodes.map(([k, x, z, s, v, y], id) => [id, k, x, z, s, v, y]));
world.loadChests([...map.chests.map(([x, y, z, rot]) => [x, y, z, rot, 0, 0]), ...map.ammo.map(([x, y, z, rot]) => [x, y, z, rot, 1, 0]),
    ...map.lobby.chests.map(([x, y, z, rot, k]) => [x, y, z, rot, k, 1])]
    .map(([x, y, z, rot, k, lb], id) => [id, x, y, z, rot, false, k, lb]));
map.pads.forEach(([x, y, z], id) => world.pads.add(id, x, y, z));
world.zips.load(map.zips.map(([a, b], id) => [id, a, b]));
world.vehicles.groundAt = (x, y, z) => Math.max(S.terrainHeight(x, z), S.supportHeight(store, x, y + 0.6, z));
world.vehicles.load(map.vehicles.map(([kind, x, z, yaw], id) => [id, kind, x, S.terrainHeight(x, z), z, yaw, null]));
buildings.loadAll(mapPieces());
ui.hideLoading();

// ------------------------------------------------------------ session / API

/**
 * Trois classes préparées dans le lobby (armes, accessoires, létal, tactique, atouts),
 * larguées aux points d'achat. Tout est revalidé par le serveur.
 */
const CLASS_COUNT = 3;
const LOADOUT_PRESETS = [
    { name: 'Assaut', primary: 'ar', primaryAtt: ['holo', 'grip'], secondary: 'pump', secondaryAtt: ['laser'],
        lethal: 'grenade', tactical: 'bandage', perks: ['athlete', 'medic'] },
    { name: 'Tireur', primary: 'sniper', primaryAtt: ['scope', 'heavy'], secondary: 'pistol', secondaryAtt: ['laser'],
        lethal: 'smoke', tactical: 'medkit', perks: ['light', 'quickfix'] },
    { name: 'Assaillant', primary: 'smg', primaryAtt: ['laser', 'mag', 'stock'], secondary: 'pump', secondaryAtt: ['grip'],
        lethal: 'grenade', tactical: 'bandage', perks: ['light', 'carrier'] },
];
function loadClasses() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('bi_classes') || 'null'); } catch { saved = null; }
    const out = [];
    for (let i = 0; i < CLASS_COUNT; i++) out.push(sanitizeClass(saved?.list?.[i], LOADOUT_PRESETS[i]));
    const sel = Number.isInteger(saved?.sel) && saved.sel >= 0 && saved.sel < CLASS_COUNT ? saved.sel : 0;
    return { list: out, sel };
}
function sanitizeClass(c, def) {
    const out = { ...def, primaryAtt: [...def.primaryAtt], secondaryAtt: [...def.secondaryAtt], perks: [...def.perks] };
    if (!c || typeof c !== 'object') return out;
    if (typeof c.name === 'string' && c.name.trim()) out.name = c.name.trim().slice(0, 20);
    for (const [w, a] of [['primary', 'primaryAtt'], ['secondary', 'secondaryAtt']]) {
        if (WEAPONS.includes(c[w])) out[w] = c[w];
        if (Array.isArray(c[a])) out[a] = c[a].filter((x) => ATTACHMENTS[x]).slice(0, ATTACH_MAX);
    }
    if (LETHALS.includes(c.lethal)) out.lethal = c.lethal;
    if (TACTICALS.includes(c.tactical)) out.tactical = c.tactical;
    if (Array.isArray(c.perks)) out.perks = c.perks.filter((x) => PERKS[x]).slice(0, PERK_SLOTS);
    return out;
}
function saveClasses() {
    try { localStorage.setItem('bi_classes', JSON.stringify(session.classes)); } catch { /* navigation privée */ }
}
/** Classe active (celle qui tombe au largage). */
const activeClass = () => session.classes.list[session.classes.sel];

const session = {
    token: localStorage.getItem(TOKEN_KEY), name: '', skin: localStorage.getItem('bi_skin') || 'knight',
    classes: loadClasses(),
};
let net = null;
let game = null;

async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (session.token) headers['X-Player-Token'] = session.token;
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `erreur ${res.status}`);
    return data;
}

ui.onLoadout = (classes) => {
    session.classes = classes;
    saveClasses();
    lobbyChar?.setWeapon(activeClass().primary, 3);
    net?.send({ t: 'loadout', lo: activeClass() });
};

ui.onSkin = (id) => {
    session.skin = id;
    localStorage.setItem('bi_skin', id);
    if (lobbyChar) lobbyScene.remove(lobbyChar.root);
    lobbyChar = new Character(id, null, { noLabel: true });
    lobbyChar.setWeapon(activeClass().primary, 3);
    lobbyScene.add(lobbyChar.root);
};

async function initMenu() {
    ui.showMenu();
    ui.initPrivatePanel();
    document.getElementById('open-settings').onclick = () => openSettings();
    // musique du lobby : démarre au premier clic (les navigateurs bloquent le son avant)
    music_('musique_lobby');
    addEventListener('pointerdown', () => initAudio(), { once: true });
    addEventListener('keydown', () => initAudio(), { once: true });
    let names = { knight: 'Chevalier', barbarian: 'Barbare', mage: 'Mage', rogue: 'Voleuse', hooded: 'Capuche', skel_warrior: 'Squelette guerrier', skel_mage: 'Squelette mage', skel_rogue: 'Squelette voleur', skel_minion: 'Sbire squelette' };
    try {
        names = (await api('/skins')).skins;
        ui.populateLeaderboard((await api('/leaderboard')).top);
    } catch (e) {
        ui.menuStatus(`API indisponible : ${e.message}`);
    }
    ui.skin = session.skin in names ? session.skin : 'knight';
    ui.populateSkins(names);
    ui.populateLoadout(session.classes);
    if (session.token) {
        try {
            const me = await api('/player');
            session.name = me.name;
            ui.setFormValues({ name: me.name });
            ui.menuStatus(`Bon retour ${me.name}`);
            ui.setStats(me);
        } catch {
            session.token = null;
            localStorage.removeItem(TOKEN_KEY);
        }
    }
    const auto = sessionStorage.getItem('bi_autoplay');
    if (auto) {
        sessionStorage.removeItem('bi_autoplay');
        const priv = JSON.parse(sessionStorage.getItem('bi_priv') || 'null');
        sessionStorage.removeItem('bi_priv');
        document.querySelectorAll('.mw-entry[data-mode]').forEach((x) => x.classList.toggle('active', x.dataset.mode === (priv ? 'priv' : auto)));
        play(priv ? { ...ui.menuForm(), mode: 'br', priv } : null);
    }
}

async function saveProfile(form) {
    const body = JSON.stringify({ name: form.name, skin: form.skin });
    const p = session.token ? await api('/player', { method: 'PATCH', body }) : await api('/player', { method: 'POST', body });
    if (p.token) {
        session.token = p.token;
        localStorage.setItem(TOKEN_KEY, p.token);
    }
    session.name = p.name;
}

let joining = false;
async function play(override = null) {
    if (joining || game) return;
    const form = override ?? ui.menuForm();
    if (form.priv && !form.priv.create && !form.priv.code) {
        ui.menuStatus('Entrez le code de la partie privée.');
        return;
    }
    joining = true;
    if (!form.name) form.name = 'Joueur';
    session.mode = form.mode;
    session.priv = form.priv;
    initAudio();
    ui.menuStatus('Connexion…');
    try {
        await saveProfile(form);
    } catch (e) {
        session.name = form.name;
        ui.menuStatus(`Profil non sauvegardé (${e.message}). Connexion en invité…`);
    }
    const url = cfg.WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    net = new Net(url, { welcome: onWelcome, snap: onSnap, err: (m) => (m.fatal ? fatalErr(m.msg) : toastErr(m.msg)), pong: (m) => ui.setPing(Math.round(performance.now() - m.ts)), close: onClose });
    try {
        await net.connect();
    } catch (e) {
        ui.menuStatus(`Impossible de joindre le serveur de jeu (${e.message}).`);
        joining = false;
        return;
    }
    net.send({ t: 'join', mode: form.mode, name: session.name, skin: session.skin, lo: activeClass(), token: session.token, room: form.priv ?? undefined });
}

function fatalErr(msg) {
    ui.menuStatus(msg);
    joining = false;
    try { net.ws?.close(); } catch { /* déjà fermé */ }
    net = null;
}

function toastErr(msg) {
    if (msg.includes('matériaux')) { sfx.empty(); ui.noMats(); return; }
    ui.toast(msg);
}

function onClose() {
    if (game && !game.ended) {
        ui.endscreen({ title: 'Connexion perdue', sub: 'Le serveur de jeu ne répond plus.', win: false, onMenu: () => location.reload() });
        document.exitPointerLock?.();
    } else if (!game && net) {
        ui.menuStatus('Connexion fermée.');
        joining = false;
    }
}

// ------------------------------------------------------------ bienvenue

function wirePiece(w) {
    const [type, gx, gy, gz, krot, v, mat, st, hp, max, base, bt, o, ds, e, rot, ow, lost] = w;
    const pc = { type, gx, gy, gz, rot: rot ?? krot, v, mat, st, hp, max, base, bt, o: o ?? 0, ds: ds ?? 1, ow: ow ?? -1, lost: lost ?? 0 };
    if (e != null && e >= 0) pc.e = e;
    pc.key = S.PieceStore.key(type, gx, gy, gz, krot);
    return pc;
}

function onWelcome(msg) {
    joining = false;
    store = new S.PieceStore();
    const pcs = msg.world.buildings.map(wirePiece);
    store.load(pcs, msg.world.cols);
    for (const [id, k, x, z, s, v, y] of msg.world.nodes) store.addNode({ id, k, x, z, s, v, y });
    for (const [id, x, y, z] of msg.world.pads) store.addPad(id, x, y, z);
    for (const [id, a, b] of msg.world.zips) store.addZip(id, a, b);
    buildings.store = store;
    buildings.loadAll(pcs);
    world.loadNodes(msg.world.nodes);
    world.loadChests(msg.world.chests);
    world.pads.clear();
    for (const [id, x, y, z] of msg.world.pads) world.pads.add(id, x, y, z);
    world.zips.load(msg.world.zips);
    world.shops.load(msg.world.shops ?? []);
    world.vehicles.load(msg.world.vehicles);
    loot.clear();
    for (const d of msg.world.drops) loot.add(d);
    // cratères déjà creusés dans cette partie
    S.resetTerrain();
    const changed = [];
    for (const [x, z, y] of msg.world.craters ?? []) changed.push(...S.applyCrater(x, z, y));
    world.applyCraters(changed, (msg.world.craters ?? []).map(([x, z]) => [x, z]));

    const char = new Character(session.skin, null, { noLabel: true });
    scene.add(char.root);
    game = {
        id: msg.id, mode: msg.mode, cfg: msg.config, state: msg.state,
        names: new Map(), remotes: new Map(), bullets: new Map(),
        me: { char, pred: null, pending: [], offset: [0, 0, 0], prevPos: null, state: 'lobby', serverPos: null, view: null, lastView: 0, localMag: null, viewAt: 0 },
        stepT: 0, emoteAt: -10,
        seq: 0, acc: 0, time: 0,
        lastFire: -10, lastSwing: -10, bloom: 0, recoil: 0,
        lastInp: null, storm: null, bal: null, balPath: null, alive: 0, poi: null,
        spectate: null, ended: false, dead: false, deathAt: null, lastMap: 0, prevRight: false, fpsT: 0,
        priv: msg.room ?? null, edit: null, nades: new Map(), fpsN: 0, fpsAt: performance.now(), smokeT: 0,
    };
    ui.onEmote = (i) => { net.send({ t: 'emote', e: i }); ui.emoteMenu(false); };
    if (msg.state === 'lobby' && msg.mode === 'br') music_('musique_lobby');
    else music_(null);
    ui.showGame();
    ui.hideEnd();
    ui.hint(`Cliquez pour jouer · <span class="key">${ctl.key('help')}</span> aide`);
    setInterval(() => net.send({ t: 'ping', ts: performance.now() }), 2000);
    if (msg.mode === 'train') ui.banner("Terrain d'entraînement");
}

// ------------------------------------------------------------ instantanés

function onSnap(msg) {
    if (!game) return;
    const now = performance.now();
    const g = game;
    for (const p of msg.players) g.names.set(p.id, p.n);
    g.state = msg.state;
    g.alive = msg.alive;
    g.storm = msg.storm;
    g.bal = msg.bal;
    if (msg.bal) g.balAt = now;
    if (msg.bal) g.balPath = { a: msg.bal.a, b: msg.bal.b };
    else if (msg.state !== 'bus') g.balPath = null;
    g.cd = msg.cd;
    g.priv = msg.pv ?? null;
    if (msg.state !== 'lobby') music_(null);
    syncNades(msg.nd ?? []);
    for (const [cid, y] of msg.ad ?? []) world.setSpecialY(cid, y);
    world.setStorm(msg.storm.ph >= 0 ? msg.storm : { x: 0, z: 0, r: 560 });

    if (msg.me) applyMe(msg.me);
    const mine = msg.players.find((p) => p.id === g.id);
    if (mine) reconcile(mine);

    const seen = new Set();
    for (const p of msg.players) {
        if (p.id === g.id) continue;
        seen.add(p.id);
        let r = g.remotes.get(p.id);
        if (!r || r.skin !== p.s) {
            if (r) { scene.remove(r.char.root); r.char.dispose(); }
            r = { char: new Character(p.s, p.n), buf: new RemoteBuffer(), skin: p.s, last: p };
            scene.add(r.char.root);
            g.remotes.set(p.id, r);
        }
        r.last = p;
        r.buf.push(now, p);
    }
    for (const [id, r] of g.remotes) {
        if (!seen.has(id)) {
            scene.remove(r.char.root);
            r.char.dispose();
            g.remotes.delete(id);
        }
    }
    syncBullets(msg.bullets);
    for (const ev of msg.ev) handleEvent(ev);
    ui.setStatus({ alive: msg.alive, storm: msg.storm, kills: msg.me?.kills ?? 0, state: msg.state });
}

function applyMe(m) {
    const me = game.me;
    const prev = me.view;
    me.view = m;
    me.viewAt = performance.now();
    me.localMag = null;
    ui.setVitals(m.hp, m.sh, (m.plMax ? 150 : 150));
    if (m.state === 'dead' && prev && prev.state !== 'dead') onMyDeath(m);
    if (m.state !== 'dead' && game.dead) {
        game.dead = false;
        ui.hideEnd();
    }
    ui.setInventory(m, game.mode);
}

function reconcile(p) {
    const me = game.me;
    me.state = p.st;
    me.serverPos = p.p;
    me.serverPlayer = p;
    me.seat = p.ps ?? null;
    if (!PREDICTABLE.has(p.st) || me.seat) {
        me.pred = null;
        me.pending = [];
        me.offset = [0, 0, 0];
        return;
    }
    const prev = me.pred ? [...me.pred.pos] : null;
    if (!me.pred) me.pred = { pos: [], vel: [], yaw: 0, ground: true, glide: false, swim: false, slide: 0, slideDir: [0, 0], state: p.st, jumpQ: false, jumpBuf: 0, coyote: 0, tac: S.TAC_TIME, slideCd: 0, land: 0, mantle: 0, zip: null, veh: null, cyaw: 0, cspd: 0 };
    const pr = me.pred;
    pr.zip = p.zp ? { id: p.zp[0], t: p.zp[1], dir: p.zp[2] } : null;
    pr.veh = p.vh ? p.vh[0] : null;
    pr.cyaw = p.vh ? p.vh[1] : pr.cyaw;
    pr.cspd = p.vh ? p.vh[2] : 0;
    pr.pos = [...p.p];
    pr.vel = [...p.v];
    pr.ground = p.gr;
    pr.slide = p.sl;
    pr.slideDir = [...p.sdir];
    pr.coyote = p.cy ?? 0;
    pr.jumpBuf = p.jb ?? 0;
    pr.tac = p.tc ?? S.TAC_TIME;
    pr.slideCd = p.scd ?? 0;
    pr.land = p.ld ?? 0;
    pr.tacMax = p.tmax ?? S.TAC_TIME;
    pr.spdK = p.sk ?? 1;
    // rétablissement en cours : on reprend la montée exactement où le serveur en est
    if (p.mt) {
        [pr.mantle, pr.mx0, pr.my0, pr.mz0, pr.mx1, pr.my1, pr.mz1] = p.mt;
    } else {
        pr.mantle = 0;
    }
    pr.state = p.st;
    pr.glide = p.g;
    pr.swim = p.sw;
    me.pending = me.pending.filter((e) => e.seq > p.ack);
    for (const e of me.pending) {
        pr.yaw = e.inp.yaw;
        pr.jumpQ = !!e.inp.jump;
        S.stepPhysics(store, pr, e.inp, S.DT);
    }
    if (prev) {
        const d = [prev[0] - pr.pos[0], prev[1] - pr.pos[1], prev[2] - pr.pos[2]];
        if (Math.hypot(...d) < 4) me.offset = me.offset.map((v, i) => v + d[i]);
        else { me.offset = [0, 0, 0]; me.prevPos = null; }
    }
}

class RemoteBuffer {
    constructor() { this.s = []; }
    push(t, p) { this.s.push({ t, p }); if (this.s.length > 14) this.s.shift(); }
    sample(rt) {
        const s = this.s;
        if (!s.length) return null;
        if (rt <= s[0].t) return { a: s[0].p, b: s[0].p, k: 0, dt: 0.05 };
        for (let i = s.length - 1; i >= 1; i--) {
            if (s[i - 1].t <= rt) {
                const span = Math.max(1, s[i].t - s[i - 1].t);
                return { a: s[i - 1].p, b: s[i].p, k: Math.min(1, (rt - s[i - 1].t) / span), dt: span / 1000 };
            }
        }
        const l = s[s.length - 1].p;
        return { a: l, b: l, k: 0, dt: 0.05 };
    }
}

const bulletMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff });
const bulletGeo = new THREE.SphereGeometry(0.09, 8, 6);
const rocketGeo = (() => {
    const body = new THREE.CylinderGeometry(0.07, 0.07, 0.7, 10).rotateX(Math.PI / 2);
    const tip = new THREE.ConeGeometry(0.07, 0.22, 10).rotateX(Math.PI / 2).translate(0, 0, 0.46);
    return mergeGeometries([body, tip]);
})();
const rocketMat = new THREE.MeshStandardMaterial({ color: 0x55663a, roughness: 0.5, metalness: 0.4, emissive: 0x331100 });
function syncBullets(list) {
    const seen = new Set();
    for (const b of list) {
        seen.add(b.id);
        let m = game.bullets.get(b.id);
        const rocket = b.w === 'rocket';
        if (!m) {
            m = new THREE.Mesh(rocket ? rocketGeo : bulletGeo, rocket ? rocketMat : bulletMat);
            m.userData.rocket = rocket;
            m.userData.vel = new THREE.Vector3(...(b.v ?? [0, 0, 0]));
            m.position.set(...b.p);
            scene.add(m);
            game.bullets.set(b.id, m);
        }
        const np = new THREE.Vector3(...b.p);
        if (b.v) m.userData.vel.set(...b.v);
        m.userData.target = np;
        if (!rocket) {
            fx.tracer(m.position.clone(), np, 0x9fdcff, 0.03);
            m.position.copy(np);
        }
    }
    for (const [id, m] of game.bullets) {
        if (!seen.has(id)) {
            scene.remove(m);
            game.bullets.delete(id);
        }
    }
}

/** Roquettes : vol fluide entre deux instantanés + traînée de fumée. */
function animateBullets(dt) {
    for (const m of game.bullets.values()) {
        if (!m.userData.rocket) continue;
        const v = m.userData.vel;
        m.position.addScaledVector(v, dt);
        if (m.userData.target) m.position.lerp(m.userData.target.clone().addScaledVector(v, 0.05), 0.15);
        if (v.lengthSq() > 1) m.lookAt(m.position.clone().add(v));
        fx.smoke(m.position.clone().addScaledVector(v, -0.012), 1);
    }
}

// ------------------------------------------------------------ événements

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const nameOf = (id) => (id === null || id === undefined ? 'La tempête' : id === game.id ? 'Vous' : game.names.get(id) ?? 'Joueur');

function charOf(id) {
    if (id === game.id) return game.me.char;
    return game.remotes.get(id)?.char ?? null;
}

function soundAt(p) {
    const d = camera.position.distanceTo(p);
    const right = new THREE.Vector3(Math.cos(ctl.yaw), 0, -Math.sin(ctl.yaw));
    const dir = p.clone().sub(camera.position).normalize();
    return [distVol(d), dir.dot(right) * 0.8];
}

function handleEvent(ev) {
    const g = game;
    const me = g.me;
    switch (ev.k) {
        case 'fire': {
            const mine = ev.a === g.id;
            const ch = charOf(ev.a);
            if (!mine) {
                if (ch) ch.triggerShot(1);
                const from = ch ? ch.muzzleWorld() : V3(ev.o);
                fx.muzzleFlash(from, 0.8);
                for (const e of ev.e) if (e) fx.tracer(from, V3(e[0]), TRACER[ev.w] ?? 0xffe9a8);
                const [v, pan] = soundAt(from);
                sfx.shot(ev.w, v, pan);
            }
            for (const e of ev.e) {
                if (!e || !e[1]) continue;
                const p = V3(e[0]);
                if (e[1] === 'player') continue;
                if (e[1] === 'build') fx.spark(p, 0xffd9a0, 5, 4, 14, 0.3);
                else if (e[1] === 'ground') fx.dust(p, 6);
                else fx.spark(p, 0xc8b08a, 4, 3, 14, 0.3);
            }
            break;
        }
        case 'impact':
            fx.spark(V3(ev.p), 0xbfe8ff, 14, 6);
            break;
        case 'hit':
            if (ev.a === g.id) {
                ui.hitmarker(ev.h ? 'head' : '');
                sfx.hit(ev.h, ev.s);
                if (ev.p) fx.damageNumber(V3(ev.p), ev.d, ev.h ? 'head' : ev.s ? 'shield' : '');
            }
            if (ev.v === g.id) {
                sfx.hurt();
                ui.flash();
                const ang = angleTo(ev.a);
                if (ang !== null) ui.damageFrom(ang, ev.a);
            }
            if (ev.p && ev.v !== g.id) fx.spark(V3(ev.p), ev.s ? 0x6fc8ff : 0xff6060, 8, 4, 10, 0.35);
            break;
        case 'kill': {
            const ch = charOf(ev.v);
            if (ch) {
                fx.elimination(ch.root.position);
                if (ev.v !== g.id) {
                    const [v] = soundAt(ch.root.position);
                    if (v > 0.05) sfx.elim();
                }
            }
            if (ev.a === g.id && ev.v !== g.id) {
                ui.hitmarker('kill');
                sfx.kill();
                ui.banner(`${nameOf(ev.v)} éliminé`);
            }
            // spectateur : on suit le vainqueur du duel
            if (g.dead && ev.v === g.spectate) g.spectate = ev.a !== null && ev.a !== undefined && ev.a !== ev.v && ev.a !== g.id ? ev.a : null;
            const CAUSE = { fall: 'est tombé de trop haut', water: "s'est noyé", storm: 'a été pris par la tempête' };
            const how = ev.a === null || ev.a === undefined ? `${esc(nameOf(ev.v))} ${CAUSE[ev.c] ?? 'a été éliminé'}`
                : ev.a === ev.v ? `${nameOf(ev.v)} s'est éliminé` : `<em>${esc(nameOf(ev.a))}</em> a éliminé ${esc(nameOf(ev.v))}`;
            ui.killfeed(how);
            break;
        }
        case 'chest':
            world.setChestOpen(ev.c);
            {
                const cp = world.chestPosition(ev.c);
                if (cp) {
                    fx.spark(cp.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xffd25a, 30, 5, 8, 0.7);
                    const [v, pan] = soundAt(cp);
                    const cd = world.chestList().find((c) => c.id === ev.c);
                    if (cd?.k === 2) {
                        // le lama éclate en confettis
                        for (const col of [0xff6fb5, 0xffd34f, 0x4fd6ff, 0x8e5cf7]) fx.spark(cp.clone().add(new THREE.Vector3(0, 1.3, 0)), col, 26, 7, 9, 1.1);
                        sfx.llama(v, pan, cp);
                    } else {
                        // le son reste au coffre : il baisse (puis s'éteint en fondu) quand on s'éloigne
                        sfx.chest(cd?.ammo || cd?.k === 1, cp);
                    }
                }
            }
            break;
        case 'dropAdd':
            loot.add(ev.d, ev.f ?? null);
            break;
        case 'dropUpd':
            loot.update(ev.d.id, ev.d.it);
            break;
        case 'dropDel':
            loot.remove(ev.id);
            if (ev.by === g.id) sfx.pick();
            break;
        case 'bDel': {
            const pc = store.buildings.get(ev.key);
            buildings.remove(ev.key, !ev.q);
            store.remove(ev.key);
            if (pc && !ev.q) {
                const c = new THREE.Vector3(pc.gx * 4 + 2, pc.base + 2, pc.gz * 4 + 2);
                const [v, pan] = soundAt(c);
                if (v > 0.1) sfx.breakBuild(v, pan);
                if (ev.c) {
                    // effondrement : nuage de poussière et gravats qui tombent
                    fx.dust(c.clone().setY(pc.base + 0.5), 10);
                    fx.debris(c, MAT_DEBRIS[pc.mat] ?? 0xaaaaaa, 10, 2.2);
                }
                // maisons : les tableaux / tapis accrochés à la pièce disparaissent avec elle
                if (pc.ow === -1) world.props.hideDecoIn(S.pieceBoxes({ ...pc, e: undefined, v: 0, o: 1 }).reduce((b, x) => [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.min(b[2], x[2]), Math.max(b[3], x[3]), Math.max(b[4], x[4]), Math.max(b[5], x[5])], [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]));
            }
            break;
        }
        case 'bHp':
            buildings.hurt(ev.key, ev.hp, ev.l);
            break;
        case 'chipB': {
            const pc = store.buildings.get(ev.key);
            if (pc) {
                fx.debris(V3(ev.p), MAT_DEBRIS[pc.mat] ?? 0xaaaaaa, 3, 0.4);
                const [v, pan] = soundAt(V3(ev.p));
                if (v > 0.1) sfx.harvest(pc.mat, v, pan);
            }
            break;
        }
        case 'chip': {
            world.wobble(ev.n);
            if (ev.d !== undefined) world.setNodeDamage(ev.n, ev.d);
            const n = world.nodeInfo(ev.n);
            if (n) {
                fx.debris(ev.p ? V3(ev.p) : new THREE.Vector3(n.x, n.y + 1, n.z), n.k === 'tree' || n.k === 'prop' ? 0x7a4f2a : n.k === 'rock' ? 0x9a9a96 : 0x9fb4c7, 3, 0.4);
                const [v, pan] = soundAt(new THREE.Vector3(n.x, n.y + 1, n.z));
                if (v > 0.1) sfx.harvest(n.k, v, pan);
            }
            break;
        }
        case 'gone': {
            const n = world.nodeInfo(ev.n);
            world.removeNode(ev.n);
            store.removeNode(ev.n);
            if (n) {
                fx.debris(new THREE.Vector3(n.x, n.y + 1.5, n.z), n.k === 'tree' ? 0x3c7a32 : n.k === 'rock' ? 0x8a8a86 : n.k === 'prop' ? 0x8b5a2b : 0xc0392b, 14, 2.5);
                const [v, pan] = soundAt(new THREE.Vector3(n.x, n.y + 1, n.z));
                if (v > 0.05) sfx.breakNode(n.k, v, pan);
            }
            break;
        }
        case 'cash':
            if (ev.a === g.id) {
                ui.cash(ev.total, ev.n);
                if (ev.n > 0) sfx.coin();
            }
            break;
        case 'loadoutDrop':
            if (ev.a === g.id) {
                ui.banner('Largage de votre classe en approche !');
                sfx.airdrop();
            }
            break;
        case 'swing': {
            const ch = charOf(ev.a);
            if (ch && ev.a !== g.id) ch.triggerSwing();
            break;
        }
        case 'reload':
            if (ev.a === g.id) sfx.reload(curItem()?.type);
            break;
        case 'noAmmo':
            if (ev.a === g.id) { ui.toast('Plus de munitions pour cette arme'); sfx.empty(); }
            break;
        case 'toast':
            if (ev.a === g.id) ui.toast(ev.msg);
            break;
        case 'healed':
            if (ev.a === g.id) sfx.heal();
            break;
        case 'balloon':
            ui.banner('La montgolfière décolle !');
            break;
        case 'jump':
            if (ev.a === g.id) sfx.jump();
            break;
        case 'land': {
            const ch = charOf(ev.a);
            if (ch) fx.dust(ch.root.position.clone(), 18);
            if (ev.a === g.id) sfx.land();
            break;
        }
        case 'left': {
            const r = g.remotes.get(ev.id);
            if (r) { scene.remove(r.char.root); r.char.dispose(); g.remotes.delete(ev.id); }
            break;
        }
        case 'boom': {
            const p = V3(ev.p);
            fx.explosion(p);
            if (ev.g === 'g' || ev.g === 'v') {
                // grosse explosion : deuxième boule de feu, poussière et débris de terre
                fx.explosion(p.clone().add(new THREE.Vector3(0, 1.2, 0)));
                fx.dust(p, 40);
                fx.debris(p, 0x6b5034, 18, 3);
            }
            const [v, pan] = soundAt(p);
            if (ev.g === 'g') sfx.grenade(v, pan);
            else if (ev.g === 'v') sfx.vehBoom(v, pan);
            else sfx.explosion(v, pan);
            const d = camera.position.distanceTo(p);
            const R = ev.g === 'r' || !ev.g ? 40 : 55;
            if (d < R) g.shake = Math.max(g.shake ?? 0, (1 - d / R) * (ev.g === 'g' ? 1.6 : 1.2));
            break;
        }
        case 'throw': {
            const ch = charOf(ev.a);
            if (ch) ch.triggerSwing();
            const [v, pan] = ev.a === g.id ? [1, 0] : soundAt(ch ? ch.root.position : camera.position);
            sfx.throwNade(v, pan);
            break;
        }
        case 'nBounce': {
            const [v, pan] = soundAt(V3(ev.p));
            sfx.bounce(v, pan);
            break;
        }
        case 'crater': {
            const [x, z, y] = ev.c;
            world.applyCraters(S.applyCrater(x, z, y), [[x, z]]);
            if (me.pred) me.pred.ground = false;      // le sol a pu se dérober sous nos pieds
            break;
        }
        case 'chestAdd':
            world.addSpecial(ev.c);
            break;
        case 'airdrop':
            ui.banner('Largage en approche !');
            sfx.airdrop();
            break;
        case 'adLand': {
            world.setSpecialY(ev.c, ev.y, true);
            const cp = world.chestPosition(ev.c);
            if (cp) fx.dust(cp, 30);
            break;
        }
        case 'chestY':
            world.setChestY(ev.c, ev.y);
            break;
        case 'dropPos':
            loot.move(ev.id, ev.p);
            break;
        case 'vHp': {
            const v = world.vehicles.get(ev.v);
            if (v) {
                v.hp = ev.hp;
                const [vv, pan] = soundAt(new THREE.Vector3(...v.pos));
                if (ev.a === g.id) ui.hitmarker('');
                if (vv > 0.15) sfx.vehHit(vv, pan);
            }
            break;
        }
        case 'vBoom': {
            const v = world.vehicles.set(ev.v);
            v.boomAt = g.time;
            break;
        }
        case 'vUpd':
            world.vehicles.set(ev.v);
            break;
        case 'vSeat': {
            const v = world.vehicles.get(ev.v);
            if (v) v.pass[ev.s] = ev.in ? ev.a : null;
            if (ev.a === g.id) {
                sfx.car(!!ev.in);
                if (ev.in) ui.toast(`Passager ! ${ctl.key('interact')} pour descendre · vous pouvez tirer`);
            }
            break;
        }
        case 'plate':
            if (ev.a === g.id) { sfx.pick(); ui.armor(ev.sh); }
            break;
        case 'plateStart':
            if (ev.a === g.id) sfx.click();
            break;
        case 'crush': {
            // gravats : la pièce détruite retombe sur le joueur
            const c = V3(ev.p);
            fx.debris(c, MAT_DEBRIS[ev.mat] ?? 0xaaaaaa, 12, 2.4);
            fx.dust(c, 8);
            const [v, pan] = soundAt(c);
            if (v > 0.1) sfx.breakBuild(v, pan);
            if (ev.v === g.id) {
                sfx.hurt();
                ui.flash();
                g.shake = Math.max(g.shake ?? 0, 1);
                ui.toast('Écrasé par les gravats !');
            }
            break;
        }
        case 'fallDmg':
            if (ev.a === g.id) {
                sfx.hurt();
                sfx.land(1);
                ui.flash();
                g.shake = Math.max(g.shake ?? 0, Math.min(1.4, ev.d / 60));
                ui.toast(`Chute : -${ev.d} PV`);
            }
            break;
        case 'privGo':
            ui.banner('Départ dans 10 secondes !');
            break;
        case 'padAdd':
            store.addPad(ev.id, ...ev.p);
            world.pads.add(ev.id, ...ev.p);
            if (ev.a === g.id) sfx.place();
            break;
        case 'door': {
            const pc = store.buildings.get(ev.key);
            if (pc) {
                pc.o = ev.o;
                pc.ds = ev.s;
                buildings.doors.setOpen(ev.key, ev.o, ev.s);
                const [v, pan] = soundAt(new THREE.Vector3(pc.gx * 4 + 2, pc.base + 1.5, pc.gz * 4 + 2));
                if (ev.a === g.id || v > 0.15) sfx.door(ev.o, ev.a === g.id ? 1 : v, pan);
            }
            break;
        }
        case 'chestShut':
            world.setChestClosed(ev.c);
            break;
        case 'drown':
            if (ev.v === g.id) sfx.drown();
            ui.killfeed(`${esc(nameOf(ev.v))} s'est noyé`);
            break;
        case 'padDel':
            store.pads.delete(ev.id);
            world.pads.remove(ev.id);
            break;
        case 'bEdit': {
            const np = wirePiece(ev.p);
            const pc = store.buildings.get(np.key);
            if (pc) {
                pc.v = np.v;
                pc.o = np.o;
                pc.rot = np.rot;
                if (np.e != null) pc.e = np.e; else delete pc.e;
                buildings.refresh(pc);
                const [v] = soundAt(new THREE.Vector3(pc.gx * 4 + 2, pc.base + 2, pc.gz * 4 + 2));
                if (ev.a === g.id || v > 0.2) sfx.edit();
            }
            break;
        }
        case 'vEnter': {
            const v = world.vehicles.get(ev.v);
            if (v) v.driver = ev.a;
            store.removeNode(100000 + ev.v * 2);
            store.removeNode(100000 + ev.v * 2 + 1);
            if (ev.a === g.id) { sfx.car(true); ui.toast(`Au volant ! ${ctl.key('interact')} pour descendre`); }
            break;
        }
        case 'vExit': {
            const [id, kind, x, y, z, yaw] = ev.v;
            world.vehicles.set(ev.v);
            const fx2 = -Math.sin(yaw);
            const fz2 = -Math.cos(yaw);
            for (const k of [0, 1]) {
                const o = k === 0 ? 1.15 : -1.15;
                store.addNode({ id: 100000 + id * 2 + k, k: 'veh', x: x + fx2 * o, z: z + fz2 * o, s: 0, v: id, y });
            }
            if (ev.a === g.id) sfx.car(false);
            void kind;
            break;
        }
        case 'zip':
            if (ev.a === g.id) sfx.zip();
            break;
        case 'emote': {
            const ch = charOf(ev.a);
            if (ch) ch.emote(ev.e);
            break;
        }
        case 'end':
            onEnd(ev.w);
            break;
        default:
            break;
    }
}

/** Amortissement indépendant du nombre d'images par seconde. */
function dampTo(cur, target, lambda, dt) {
    return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function onMyDeath(m) {
    game.dead = true;
    game.deathAt = performance.now();
    game.place = m.place || null;
    game.total = m.tot || null;
    const killer = m.killer;
    if (game.mode === 'train') {
        ui.toast(`Éliminé par ${nameOf(killer)} — réapparition…`);
        return;
    }
    document.exitPointerLock?.();
    sfx.elim();
    const how = killer !== null && killer !== undefined ? `Éliminé par ${nameOf(killer)}`
        : { fall: 'Tombé de trop haut', water: 'Noyé', storm: 'Pris par la tempête' }[m.dc] ?? 'Éliminé';
    ui.endscreen({
        title: `VOUS AVEZ FAIT TOP ${m.place || '?'}`, place: `#${m.place || '?'}`, win: false,
        sub: `${how} · ${m.kills} élimination(s)${m.tot ? ` · ${m.tot} participants` : ''}`,
        onAgain: () => replay(),
        onSpectate: () => { game.spectate = killer !== null && killer !== undefined && killer !== game.id && game.remotes.has(killer) ? killer : nextSpectate(null); ui.hideEnd(); },
        onMenu: () => location.reload(),
    });
}

/** Joueur suivant à regarder (vivant), après `cur`. */
function nextSpectate(cur) {
    const ids = [...game.remotes.entries()].filter(([, r]) => r.last.st === 'alive' || r.last.st === 'falling').map(([id]) => id).sort((a, b) => a - b);
    if (!ids.length) return null;
    const i = ids.indexOf(cur);
    return ids[(i + 1) % ids.length];
}

/** Angle (radians, écran) vers un joueur — pour l'indicateur de dégâts. */
function angleTo(id) {
    const g = game;
    const att = g.remotes.get(id);
    const me = g.me;
    if (!att || !me.char) return null;
    const ap = att.char.root.position;
    const mp = me.char.root.position;
    const rel = Math.atan2(-(ap.x - mp.x), -(ap.z - mp.z)) - ctl.yaw;
    return -rel;
}

function onEnd(winner) {
    if (game.ended) return;
    game.ended = true;
    document.exitPointerLock?.();
    const g = game;
    const won = winner === g.id;
    if (won) {
        sfx.victory();
        ui.endscreen({ title: '#1 VICTOIRE ROYALE', win: true, sub: `${g.me.view?.kills ?? 0} élimination(s). Bravo !`,
            onAgain: () => replay(), onMenu: () => location.reload() });
        return;
    }
    // mort puis spectateur : on annonce le vainqueur et le classement du joueur
    const top1 = winner !== null && winner !== undefined ? nameOf(winner) : null;
    ui.killfeed(top1 ? `<em>${esc(top1)}</em> remporte la partie !` : 'Aucun survivant');
    ui.endscreen({
        title: top1 ? `TOP 1 : ${top1}` : 'FIN DE PARTIE',
        place: g.place ? `#${g.place}` : null, win: false,
        sub: g.place ? `Vous avez fait top ${g.place}${g.total ? ` sur ${g.total}` : ''} · ${g.me.view?.kills ?? 0} élimination(s)`
            : 'Fin de la partie',
        onAgain: () => replay(), onMenu: () => location.reload(),
    });
}

function replay() {
    sessionStorage.setItem('bi_autoplay', session.mode || 'br');
    // partie privée : on garde le même code (on la rejoint, ou on la recrée si on est le premier)
    if (game?.priv) sessionStorage.setItem('bi_priv', JSON.stringify({ code: game.priv.code, create: true, bots: game.priv.bots, lvl: game.priv.lvl }));
    location.reload();
}

// ------------------------------------------------------------ actions

function curItem() {
    const v = game.me.view;
    return v ? v.slots[v.sel] : null;
}

function aimPoint(maxD = 250) {
    const f = ctl.forward();
    const o = camera.position;
    const p = new THREE.Vector3();
    for (let d = 1; d < maxD; d += 1.5) {
        p.set(o.x + f.x * d, o.y + f.y * d, o.z + f.z * d);
        if (p.y < S.terrainHeight(p.x, p.z) || S.insideSolid(store, p.x, p.y, p.z)) return p;
        for (const r of game.remotes.values()) {
            const q = r.char.root.position;
            if (Math.abs(p.x - q.x) < 0.5 && Math.abs(p.z - q.z) < 0.5 && p.y > q.y && p.y < q.y + 1.9) return p;
        }
    }
    return p;
}

function tryFire(semi) {
    const g = game;
    const me = g.me;
    const it = curItem();
    if (!it || !WEAPONS.includes(it.type) || me.state !== 'alive' || riding()) return;
    const w = g.cfg.weapons[it.type];
    if (!w.auto && !semi) return;
    if (g.time - g.lastFire < w.rate) return;
    if (me.view.rl || me.view.us) return;
    const mag = me.localMag ?? it.mag;
    if (mag <= 0) {
        if (g.time - g.lastFire > 0.4) { sfx.empty(); g.lastFire = g.time; net.send({ t: 'reload' }); }
        return;
    }
    me.localMag = mag - 1;
    g.lastFire = g.time;
    net.send({ t: 'fire', yaw: ctl.yaw, pitch: ctl.pitch });
    // en vue FPS, les traçantes et l'éclair partent de l'arme tenue devant la caméra
    const kick = it.type === 'pump' || it.type === 'sniper' || it.type === 'rocket' ? 1.4 : 1;
    viewModel.shoot(kick);
    const muzzle = viewModel.visible ? viewModel.muzzleWorld() : me.char.muzzleWorld();
    fx.muzzleFlash(muzzle, kick);
    const pellets = it.type === 'pump' ? 6 : 1;
    const target = aimPoint(w.range);
    for (let i = 0; i < pellets; i++) {
        const t = target.clone();
        if (pellets > 1) t.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(target.distanceTo(camera.position) * 0.12));
        if (it.type !== 'sniper' && it.type !== 'rocket') fx.tracer(muzzle, t, TRACER[it.type]);
    }
    sfx.shot(it.type, 1);
    me.char.triggerShot(it.type === 'pump' || it.type === 'sniper' ? 1.5 : 0.6);
    const k = KICK[it.type] * (ctl.mouseR ? 0.6 : 1);
    ctl.pitch = Math.min(1.45, ctl.pitch + k);
    ctl.yaw += (Math.random() - 0.5) * k * 0.6;
    g.recoil = Math.min(1, g.recoil + k * 8);
    g.bloom = Math.min(1, g.bloom + (w.bloom ?? 0));
}

/** Coup de crosse avec l'arme tenue : 10 PV, de quoi finir quelqu'un. */
function trySwing() {
    const g = game;
    if (g.me.state !== 'alive' || g.time - g.lastSwing < 0.5 || riding() || g.me.view?.us) return;
    g.lastSwing = g.time;
    net.send({ t: 'swing', yaw: ctl.yaw, pitch: ctl.pitch });
    g.me.char.triggerSwing();
    sfx.swing();
}

/** Au volant ou sur une tyrolienne ? */
function riding() {
    const p = game.me.pred;
    return !!p && (p.veh !== null && p.veh !== undefined || !!p.zip);
}

function interactTarget() {
    const g = game;
    const me = g.me;
    if (me.seat && me.state === 'alive') return { kind: 'exit' };
    if (!me.pred || me.state !== 'alive') return null;
    if (me.pred.veh !== null && me.pred.veh !== undefined) return { kind: 'exit' };
    if (me.pred.zip) return null;
    const pos = new THREE.Vector3(...me.pred.pos);
    const f = ctl.forward();
    const d = loot.nearest(pos, f, S.INTERACT_REACH);
    const sees = (x, y, z) => !S.lineBlocked(store, [pos.x, pos.y + 1.5, pos.z], [x, y, z]) || !S.lineBlocked(store, [pos.x, pos.y + 0.9, pos.z], [x, y, z]);
    let chest = null;
    let cd = Infinity;
    for (const c of world.chestList()) {
        if (c.open || (c.lobby && g.state !== 'lobby')) continue;
        const dist = Math.hypot(c.x - pos.x, c.z - pos.z);
        if (dist < S.INTERACT_REACH + 0.6 && Math.abs(c.y - pos.y) < 2.4 && dist < cd && sees(c.x, c.y + 0.45, c.z)) { cd = dist; chest = c; }
    }
    const door = buildings.doors.nearest(pos.x, pos.y, pos.z, 3.1);
    const dd = door ? door.dist : Infinity;
    if (chest && cd <= dd && (!d || cd < Math.hypot(d.p.x - pos.x, d.p.z - pos.z) + 0.3)) return { kind: 'chest', c: chest };
    if (d && (!door || Math.hypot(d.p.x - pos.x, d.p.z - pos.z) < dd)) return { kind: 'drop', d };
    if (door) return { kind: 'door', door };
    for (const v of world.vehicles.list.values()) {
        if (v.wreck || (v.driver !== null && !v.pass.includes(null))) continue;
        const vp = v.obj ? v.obj.position : new THREE.Vector3(...v.pos);
        if (Math.hypot(vp.x - pos.x, vp.z - pos.z) < 3.4 && Math.abs(vp.y - pos.y) < 2.4) return { kind: 'car', v };
    }
    const zt = S.zipAttach(store.zips, [pos.x, pos.y, pos.z]);
    if (zt) return { kind: 'zip', z: zt };
    const shop = world.shops.nearest(pos.x, pos.y, pos.z);
    if (shop) return { kind: 'shop', s: shop };
    return null;
}

/** Pièce de construction visée (pour afficher ses PV). */
function aimedPiece() {
    const g = game;
    if (!g.me.pred || g.me.state !== 'alive' || riding() || g.me.seat) return null;
    const f = ctl.forward();
    const o = camera.position;
    const C = S.CELL;
    for (let d = 0.5; d < 9.5; d += 0.2) {
        const x = o.x + f.x * d;
        const y = o.y + f.y * d;
        const z = o.z + f.z * d;
        if (y < S.terrainHeight(x, z)) return null;
        for (const pc of store.nearby(x, z)) {
            let hit = false;
            for (const b of S.pieceBoxes(pc)) {
                if (x > b[0] - 0.12 && x < b[3] + 0.12 && y > b[1] - 0.05 && y < b[4] + 0.05 && z > b[2] - 0.12 && z < b[5] + 0.12) { hit = true; break; }
            }
            // cases déjà retirées : on vise quand même la pièce
            if (!hit && pc.type === 'wall') {
                hit = (pc.rot === 0 ? Math.abs(z - pc.gz * C) < 0.22 && x > pc.gx * C && x < pc.gx * C + C
                    : Math.abs(x - pc.gx * C) < 0.22 && z > pc.gz * C && z < pc.gz * C + C) && y > pc.base && y < pc.base + C;
            } else if (!hit && pc.type === 'floor' && pc.e) {
                hit = x > pc.gx * C && x < pc.gx * C + C && z > pc.gz * C && z < pc.gz * C + C && Math.abs(y - pc.base - S.FLOOR_THICK / 2) < 0.25;
            }
            if (hit) return pc;
        }
    }
    return null;
}

// ------------------------------------------------------------ grenades (vol entre deux instantanés)

const nadeLight = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
function syncNades(list) {
    const g = game;
    const seen = new Set();
    for (const [id, x, y, z, vx, vy, vz, fuse] of list) {
        seen.add(id);
        let n = g.nades.get(id);
        if (!n) {
            const obj = potionModel('grenade');
            obj.scale.setScalar(1.6);
            const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), nadeLight);
            led.position.set(0, 0.32, 0);
            obj.add(led);
            obj.position.set(x, y, z);
            scene.add(obj);
            n = { obj, led, spin: Math.random() * 6 };
            g.nades.set(id, n);
        }
        n.p = new THREE.Vector3(x, y, z);
        n.v = new THREE.Vector3(vx, vy, vz);
        n.fuse = fuse;
        n.at = performance.now();
    }
    for (const [id, n] of g.nades) {
        if (!seen.has(id)) {
            scene.remove(n.obj);
            g.nades.delete(id);
        }
    }
}

function animateNades(dt) {
    const now = performance.now();
    for (const n of game.nades.values()) {
        const t = Math.min(0.12, (now - n.at) / 1000);
        const target = n.p.clone().addScaledVector(n.v, t);
        target.y += -0.5 * 22 * t * t;
        target.y = Math.max(target.y, S.terrainHeight(target.x, target.z) + 0.05);
        n.obj.position.lerp(target, Math.min(1, dt * 20));
        const moving = n.v.lengthSq() > 1;
        if (moving) { n.spin += dt * 12; n.obj.rotation.set(n.spin, n.spin * 0.7, 0); }
        const left = n.fuse - t;
        n.led.visible = Math.sin(now / (left < 0.8 ? 40 : 110)) > 0;
    }
}

/** Trajectoire prévue de la grenade (en visant). */
const arcGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
const arcLine = new THREE.Line(arcGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.85, depthTest: false }));
arcLine.renderOrder = 15;
arcLine.visible = false;
arcLine.frustumCulled = false;
scene.add(arcLine);
function updateGrenadeArc(show) {
    if (!show || !game.me.pred) { arcLine.visible = false; return; }
    const me = game.me;
    const pitch = Math.min(1.2, ctl.pitch + 0.12);
    const dir = [-Math.sin(ctl.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(ctl.yaw) * Math.cos(pitch)];
    const p = [me.pred.pos[0] + dir[0] * 0.4, me.pred.pos[1] + 1.55, me.pred.pos[2] + dir[2] * 0.4];
    const v = [dir[0] * 24 + me.pred.vel[0] * 0.4, dir[1] * 24 + 4, dir[2] * 24 + me.pred.vel[2] * 0.4];
    const arr = arcGeo.attributes.position.array;
    let n = 0;
    for (let i = 0; i < 60; i++) {
        arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2];
        n = i + 1;
        if (p[1] < S.terrainHeight(p[0], p[2]) || S.insideSolid(store, p[0], p[1], p[2])) break;
        const dt = 0.05;
        v[1] -= 22 * dt;
        p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
    }
    arcGeo.setDrawRange(0, n);
    arcGeo.attributes.position.needsUpdate = true;
    arcLine.computeLineDistances();
    arcLine.visible = true;
}

function selectSlot(i) {
    const g = game;
    if (!g.me.view) return;
    if (g.me.view.sel !== i) {
        g.me.view.sel = i;
        net.send({ t: 'slot', slot: i });
        sfx.stopReload();
        ui.setInventory(g.me.view, g.mode);
        sfx.click();
    }
}

function doInteract() {
    const t = interactTarget();
    if (t?.kind === 'chest') net.send({ t: 'open', id: t.c.id });
    else if (t?.kind === 'drop') net.send({ t: 'pick', id: t.d.id });
    else if (t?.kind === 'car' || t?.kind === 'exit') net.send({ t: 'veh' });
    else if (t?.kind === 'zip') net.send({ t: 'zip' });
    else if (t?.kind === 'door') net.send({ t: 'door', key: t.door.pc.key });
    else if (t?.kind === 'shop') net.send({ t: 'buy' });
}

addEventListener('keydown', (e) => {
    // F1…F10 et Tab : pas d'action du navigateur pendant la partie (aide, recherche…)
    if (game && !settingsOpen() && ((/^F\d+$/.test(e.code) && e.code !== 'F11' && e.code !== 'F12') || e.code === 'Tab')) e.preventDefault();
    if (!game || e.repeat || settingsOpen()) return;
    const g = game;
    const me = g.me;
    const act = actionOf(e.code);
    // partie privée : l'hôte lance le départ
    if (e.code === 'Enter' && g.priv && g.priv.host === g.id && g.state === 'lobby' && !g.priv.go) { net.send({ t: 'start' }); return; }
    if (act === 'map') { ui.toggleBigMap(); return; }
    if (act === 'help') { ui.toggleHelp(); return; }
    if (act === 'jump' && me.state === 'bus') { net.send({ t: 'drop' }); return; }
    if (me.state !== 'alive') return;
    if (ui.emoteOpen) {
        const n = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : 0;
        if (n >= 1 && n <= EMOTES.length) net.send({ t: 'emote', e: n - 1 });
        ui.emoteMenu(false);
        if (n || act === 'emote') return;
    }
    if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n === 1 || n === 2) selectSlot(n - 1);
        return;
    }
    switch (act) {
        case 'reload':
            net.send({ t: 'reload' });
            break;
        case 'interact':
            doInteract();
            break;
        case 'melee':
            trySwing();
            break;
        case 'plate':
            net.send({ t: 'plate' });
            break;
        case 'lethal':
            net.send({ t: 'lethal' });
            break;
        case 'tactical':
            net.send({ t: 'tactical' });
            break;
        case 'util':
            net.send({ t: 'util' });
            break;
        case 'emote':
            ui.emoteMenu(true);
            break;
        case 'drop':
            net.send({ t: 'dropItem' });
            break;
        default:
    }
});

ctl.onWheel = (dir) => {
    const g = game;
    if (!g || g.me.state !== 'alive' || !g.me.view) return;
    selectSlot(g.me.view.sel === 0 ? 1 : 0);
};

canvas.addEventListener('mousedown', () => {
    const g = game;
    if (!g) return;
    if (g.dead && g.spectate !== null && !g.ended) { g.spectate = nextSpectate(g.spectate); return; }
    if (ui.emoteOpen) { ui.emoteMenu(false); ctl.clickQueued = false; return; }
    if (!ctl.locked && !g.dead && !g.ended && !ui.pauseOpen()) ctl.lock();
});

// Échap (souris libérée) : menu pause avec les paramètres
function showPause() {
    const g = game;
    ui.pause(true, {
        priv: g.priv, isHost: g.priv?.host === g.id, lobby: g.state === 'lobby',
        onResume: () => { ui.pause(false); ctl.lock(); },
        onSettings: () => openSettings(),
        onQuit: () => location.reload(),
        onStart: () => { net.send({ t: 'start' }); ui.pause(false); ctl.lock(); },
        onCfg: (c) => net.send({ t: 'privCfg', ...c }),
    });
}
document.addEventListener('pointerlockchange', () => {
    const g = game;
    if (!g) return;
    if (document.pointerLockElement === canvas) { ui.pause(false); return; }
    ui.emoteMenu(false);
    if (!g.dead && !g.ended) showPause();
});

// ------------------------------------------------------------ boucle

function simTick() {
    const g = game;
    const me = g.me;
    const inp = ctl.sample(false);
    if (me.state === 'bus') {
        inp.fwd = inp.side = 0;
        g.glideBlock = true;
    }
    // la touche du saut hors de la montgolfière ne doit pas ouvrir le planeur : il faut la relâcher
    if (g.glideBlock) {
        if (!inp.glide && me.state !== 'bus') g.glideBlock = false;
        inp.glide = false;
    }
    g.seq++;
    g.lastInp = inp;
    net.send({ t: 'input', seq: g.seq, fwd: inp.fwd, side: inp.side, yaw: inp.yaw, pitch: inp.pitch, sprint: inp.sprint, tac: inp.tac, crouch: inp.crouch, glide: inp.glide, jump: inp.jump, ads: inp.ads });
    if (me.pred && PREDICTABLE.has(me.state)) {
        const wasFalling = me.pred.state === 'falling';
        const wasGlide = me.pred.glide;
        const wasGround = me.pred.ground;
        me.prevPos = [...me.pred.pos];
        me.pred.yaw = inp.yaw;
        me.pred.jumpQ = inp.jump;
        S.stepPhysics(store, me.pred, inp, S.DT);
        me.pending.push({ seq: g.seq, inp });
        if (me.pending.length > 150) me.pending.shift();
        if (wasFalling && !wasGlide && me.pred.glide) sfx.deploy();
        if (!wasFalling && me.pred.state === 'falling' && me.pred.vel[1] > 20) { sfx.launch(); ui.toast('Décollage !'); }
        if (!wasGround && me.pred.ground && !wasFalling && me.pred.veh == null) sfx.land(0.5);
    }
    if (!ctl.locked || me.state !== 'alive') {
        ctl.clickQueued = false;
        return;
    }
    const click = ctl.clickQueued;
    ctl.clickQueued = false;
    if (riding() || ui.emoteOpen) return;
    const it = curItem();
    if (!it) return;
    // le clic est aussi mémorisé (clickQueued) : un clic très bref n'est jamais perdu
    if (WEAPONS.includes(it.type)) { if (ctl.mouseL) tryFire(click); }
    else if (click) net.send({ t: 'use' });
}

const clock = { last: performance.now() };
let menuT = 0;

function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - clock.last) / 1000);
    clock.last = now;
    if (!game) {
        renderMenu(dt);
        return;
    }
    const g = game;
    g.time += dt;
    g.acc += dt;
    let steps = 0;
    while (g.acc >= S.DT && steps < 8) {
        simTick();
        g.acc -= S.DT;
        steps++;
    }
    if (steps >= 8) g.acc = 0;
    g.bloom = Math.max(0, g.bloom - dt * 2.2);
    g.recoil = Math.max(0, g.recoil - dt * 6);

    // --- joueur local
    const me = g.me;
    const decay = Math.exp(-dt * 10);
    me.offset = me.offset.map((v) => v * decay);
    const pred = me.pred && PREDICTABLE.has(me.state);
    let base = pred ? me.pred.pos : me.serverPos ?? [0, 30, 0];
    const seatV = me.seat ? world.vehicles.get(me.seat[0]) : null;
    if (seatV) {
        const sp = world.vehicles.seatWorld(seatV, me.seat[1]);
        base = [sp.x, sp.y, sp.z];
        me.offset = [0, 0, 0];
    }
    if (pred && me.prevPos) {
        // rendu lissé entre deux pas de simulation (60 Hz -> fréquence de l'écran)
        const k = Math.min(1, g.acc / S.DT);
        base = [0, 1, 2].map((i) => me.prevPos[i] + (me.pred.pos[i] - me.prevPos[i]) * k);
    }
    const vx = base[0] + me.offset[0];
    let vy = base[1] + me.offset[1];
    const vz = base[2] + me.offset[2];
    // marches (rampes, escaliers, trottoirs) : la montée est lissée à l'écran, le personnage ne
    // « saute » plus d'un cran à l'autre. La simulation, elle, n'est pas touchée.
    if (pred && me.pred.ground && me.stepY != null && Math.abs(vy - me.stepY) <= S.STEP_UP + 0.15) {
        me.stepY += (vy - me.stepY) * (1 - Math.exp(-dt * 16));
        vy = me.stepY;
    } else {
        me.stepY = vy;
    }
    const it = curItem();
    const inp = g.lastInp || {};
    const falling = me.state === 'falling';
    const gliding = falling && !!me.pred?.glide;
    const aiming = ctl.mouseR && me.state === 'alive' && it && WEAPONS.includes(it.type);
    const scoped = aiming && it.type === 'sniper';
    const driving = !!me.pred && me.pred.veh !== null && me.pred.veh !== undefined;
    const zipping = !!me.pred?.zip;
    me.char.root.position.set(vx, vy, vz);
    // au volant : assis à la place du conducteur (à gauche), visible par les vitres
    if (driving) me.char.root.position.add(new THREE.Vector3(-Math.cos(me.pred.cyaw) * DRIVER_SIDE, 0.12, Math.sin(me.pred.cyaw) * DRIVER_SIDE));
    let face = (driving ? me.pred.cyaw : seatV && !aiming && !(g.time - g.lastFire < 0.6) ? seatV.yaw : ctl.yaw) + Math.PI;
    if ((falling || zipping) && me.pred && Math.hypot(me.pred.vel[0], me.pred.vel[2]) > 2.5) face = Math.atan2(me.pred.vel[0], me.pred.vel[2]);
    const prevFace = me.char.root.rotation.y;
    me.char.root.rotation.y = falling || zipping ? dampAngle(prevFace, face, 6, dt) : face;
    const turnRate = falling ? wrapAngle(me.char.root.rotation.y - prevFace) / Math.max(dt, 1e-3) : 0;
    me.char.setWeapon(it?.type ?? null, it?.r ?? 0);
    const speed = me.pred ? Math.hypot(me.pred.vel[0], me.pred.vel[2]) : 0;
    me.char.update(dt, {
        speed, vel: me.pred?.vel, yaw: ctl.yaw, grounded: me.pred ? me.pred.ground : true, crouch: !!inp.crouch, sliding: !!me.pred && me.pred.slide > 0,
        gliding: gliding || zipping, falling: falling && !zipping, diving: falling && !gliding && inp.fwd > 0, swimming: !!me.pred?.swim,
        aiming, shooting: g.time - g.lastFire < 0.35, holding: it?.type ?? null,
        using: !!me.view?.us, reloading: !!me.view?.rl, pitch: ctl.pitch, dead: me.state === 'dead',
        driving: driving || !!seatV, zipping, turn: turnRate,
    });
    me.char.root.visible = me.state !== 'bus' && me.state !== 'dead' && !scoped;
    if (driving) {
        const v = world.vehicles.get(me.pred.veh);
        if (v) {
            world.vehicles.place(v, [vx, vy, vz], me.pred.cyaw, me.pred.cspd, dt);
            if (v.obj) me.char.root.position.y = v.obj.position.y;
        }
    }
    // ramassage automatique des munitions et des billets (réglable)
    if (settings.autoAmmo && me.state === 'alive' && me.pred && !riding() && !seatV) {
        if (g.time - (g.autoPickT ?? -9) > 0.15) {
            const ids = loot.underfoot({ x: vx, y: vy, z: vz }, 1.9);
            if (ids.length) {
                g.autoPickT = g.time;
                net.send({ t: 'pick', id: ids[0] });
            }
        }
    }

    // bruits de pas
    if (me.pred && me.state === 'alive' && me.pred.ground && !me.pred.swim && !driving && !seatV && speed > 1.5) {
        g.stepT += dt * speed / 2.6;
        if (g.stepT >= 1) { g.stepT = 0; sfx.step(inp.crouch ? 0.35 : speed > 7 ? 0.9 : 0.65); }
    }

    // --- autres joueurs
    const renderT = now - RENDER_DELAY;
    for (const [id, r] of g.remotes) {
        const s = r.buf.sample(renderT);
        if (!s) continue;
        const { a, b, k } = s;
        const x = a.p[0] + (b.p[0] - a.p[0]) * k;
        const y = a.p[1] + (b.p[1] - a.p[1]) * k;
        const z = a.p[2] + (b.p[2] - a.p[2]) * k;
        let dyaw = b.y - a.y;
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        r.char.root.position.set(x, y, z);
        const ryaw = a.y + dyaw * k;
        const drv = !!b.vh;
        let cy = ryaw;
        if (drv) {
            let dc = b.vh[1] - (a.vh ? a.vh[1] : b.vh[1]);
            dc = Math.atan2(Math.sin(dc), Math.cos(dc));
            cy = (a.vh ? a.vh[1] : b.vh[1]) + dc * k;
            const v = world.vehicles.get(b.vh[0]);
            if (v) world.vehicles.place(v, [x, y, z], cy, b.vh[2], dt);
            r.char.root.position.add(new THREE.Vector3(-Math.cos(cy) * DRIVER_SIDE, 0.12, Math.sin(cy) * DRIVER_SIDE));
        }
        const rfly = (b.st === 'falling' || !!b.zp) && Math.hypot(b.v[0], b.v[2]) > 2.5;
        const prevR = r.char.root.rotation.y;
        r.char.root.rotation.y = rfly ? dampAngle(prevR, Math.atan2(b.v[0], b.v[2]), 6, dt) : cy + Math.PI;
        const rturn = rfly ? wrapAngle(r.char.root.rotation.y - prevR) / Math.max(dt, 1e-3) : 0;
        r.char.setWeapon(b.w ?? null, b.wr ?? 0);
        const rs = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) / Math.max(0.001, s.dt);
        const rv = [(b.p[0] - a.p[0]) / Math.max(0.001, s.dt), 0, (b.p[2] - a.p[2]) / Math.max(0.001, s.dt)];
        const rf = b.st === 'falling';
        const rz = !!b.zp;
        r.char.update(dt, {
            speed: rs, vel: rv, yaw: ryaw, grounded: b.gr, crouch: b.c, sliding: b.sd, gliding: (rf && b.g) || rz, falling: rf && !rz, diving: rf && !b.g && b.v[1] < -34,
            swimming: b.sw, aiming: b.ad, shooting: false, holding: b.w ?? null, using: b.u, reloading: b.rl,
            pitch: b.pt, dead: b.st === 'dead', driving: drv || !!b.ps, zipping: rz, turn: rturn,
        });
        r.char.root.visible = b.st !== 'bus' && b.st !== 'dead';
        if (b.ps) r.seat = b.ps; else r.seat = null;
        const camD = camera.position.distanceTo(r.char.root.position);
        // bruits de pas des autres joueurs : on les entend approcher (moins fort accroupis)
        if (b.st === 'alive' && b.gr && !b.sw && !drv && !b.ps && !b.zp && rs > 1.5 && camD < 40) {
            r.stepT = (r.stepT ?? 0) + dt * rs / 2.6;
            if (r.stepT >= 1) {
                r.stepT = 0;
                const [sv, pan] = soundAt(r.char.root.position);
                const loud = b.c ? 0.25 : rs > 7 ? 1 : 0.7;
                sfx.enemyStep(loud * Math.max(0, 1 - camD / 40) ** 1.5 * (0.6 + 0.4 * sv), pan);
            }
        }
        r.char.setShadows(camD < 45);
        if (r.char.label) r.char.label.visible = camD < 60;
    }

    // passagers : posés sur leur siège, une fois les véhicules placés
    for (const r of g.remotes.values()) {
        if (!r.seat) continue;
        const v = world.vehicles.get(r.seat[0]);
        if (!v) continue;
        r.char.root.position.copy(world.vehicles.seatWorld(v, r.seat[1]));
        if (!r.last.ad) r.char.root.rotation.y = v.yaw + Math.PI;
    }
    // véhicules abîmés : fumée ; épaves : fumée noire un moment
    g.smokeT += dt;
    if (g.smokeT > 0.12) {
        g.smokeT = 0;
        for (const v of world.vehicles.list.values()) {
            if (!v.obj) continue;
            const burning = v.wreck && g.time - (v.boomAt ?? -99) < 25;
            if ((v.hp < 300 && !v.wreck) || burning) fx.smoke(v.obj.position.clone().add(new THREE.Vector3(0, 1.1, 0)), burning ? 3 : 1);
        }
    }

    // --- caméra : hauteur accroupie lissée, enfoncement à la réception, balancement de
    // marche et champ de vision qui s'ouvre au sprint — c'est ce qui donne le « liant ».
    const feel = g.feel ??= { crouch: 0, dip: 0, dipV: 0, bob: 0, bobA: 0, roll: 0, fovK: 0 };
    const grounded = !!me.pred?.ground;
    const crouching = !!inp.crouch && grounded && !(me.pred?.slide > 0);
    const sliding = (me.pred?.slide ?? 0) > 0;
    feel.crouch = dampTo(feel.crouch, crouching ? 1 : 0, 11, dt);
    // réception : la caméra s'enfonce puis remonte comme un ressort
    const landVy = me.lastVy ?? 0;
    if (grounded && !me.wasGround && landVy < -6) feel.dipV -= Math.min(0.26, (-landVy - 6) * 0.016);
    me.wasGround = grounded;
    me.lastVy = me.pred?.vel[1] ?? 0;
    feel.dipV += (-feel.dip * 90 - feel.dipV * 13) * dt;
    feel.dip += feel.dipV * dt;
    // balancement de marche (coupé en visée pour ne pas gêner le tir)
    const walkK = grounded && !sliding ? Math.min(1, speed / 7.5) : 0;
    feel.bobA = dampTo(feel.bobA, walkK * (aiming ? 0.25 : 1), 8, dt);
    feel.bob += dt * (5.5 + speed * 1.15) * (walkK > 0.05 ? 1 : 0);
    const bobX = Math.sin(feel.bob) * 0.028 * feel.bobA;
    const bobY = Math.abs(Math.cos(feel.bob)) * 0.022 * feel.bobA;
    // léger roulis dans les pas chassés et la glissade
    feel.roll = dampTo(feel.roll, (sliding ? 0.09 : 0) + (grounded ? -(inp.side ?? 0) * 0.018 : 0), 7, dt);
    // champ de vision : s'ouvre au sprint tactique
    feel.fovK = dampTo(feel.fovK, speed > 9.6 ? 1 : speed > 7.6 ? 0.45 : 0, 5, dt);

    let mode = 'normal';
    // tous les skins font la même taille : la caméra est à la même hauteur pour tout le monde
    const eye = 1.62 - feel.crouch * 0.38 - (sliding ? 0.5 : 0) + feel.dip + bobY;
    let pivot = new THREE.Vector3(vx + bobX * Math.cos(ctl.yaw), vy + eye, vz - bobX * Math.sin(ctl.yaw));
    let yaw = ctl.yaw;
    let pitch = ctl.pitch;
    let opts = { crouch: false, roll: feel.roll, fovAdd: feel.fovK * 7 };
    if (me.state === 'bus' && g.bal) {
        mode = 'orbit';
        pivot = world.balloon.position.clone().add(new THREE.Vector3(0, 8, 0));
        opts = { dist: 34 };
    } else if (driving) {
        mode = 'car';
        pivot = new THREE.Vector3(vx, vy + 2.2, vz);
        pitch = Math.min(pitch, 0.5) - 0.12;
    } else if (zipping) {
        mode = 'zip';
    } else if (falling) {
        mode = gliding ? 'glide' : 'sky';
        pivot = new THREE.Vector3(vx, vy + 1.0, vz);
    } else if (me.state === 'dead') {
        if (g.spectate !== null && !g.remotes.has(g.spectate)) g.spectate = nextSpectate(g.spectate);
        const sp = g.spectate !== null ? g.remotes.get(g.spectate) : null;
        if (sp && sp.last.st !== 'dead') {
            mode = 'spec';
            pivot = sp.char.root.position.clone().add(new THREE.Vector3(0, 1.62, 0));
            g.specYaw = dampAngle(g.specYaw ?? sp.last.y, sp.last.y, 10, dt);
            yaw = g.specYaw;
            pitch = sp.last.pt * 0.6;
        } else {
            mode = 'orbit';
            opts = { dist: 10 };
            pivot = new THREE.Vector3(vx, vy + 1.5, vz);
        }
    } else if (aiming) {
        mode = scoped ? 'scope' : 'ads';
    }
    ctl.adsScale = scoped ? 0.32 : aiming ? 0.7 : 1;
    // vue à la première personne : toujours, sauf en voiture, en tyrolienne ou en vol
    const fpv = me.state === 'alive' && !driving && !seatV && !zipping && !falling;
    if (fpv) opts.fpv = true;
    if (aiming && it?.att) opts.zoom = attachMult(it.att).zoom;
    const camPos = rig.update(mode, pivot, yaw, pitch + (mode === 'normal' || mode === 'ads' ? g.recoil * 0.01 : 0), store, dt, opts);
    // caméra collée au personnage (pièce étroite) : on le masque pour voir devant soi
    if (fpv) me.char.root.visible = false;
    else if (mode !== 'orbit' && mode !== 'spec') me.char.setFade((camera.position.distanceTo(new THREE.Vector3(vx, vy + 1.25, vz)) - 0.7) / 1.3);
    // arme en main (vue FPS)
    viewModel.set(fpv ? it?.type ?? null : null, it?.r ?? 0);
    viewModel.update(dt, {
        on: fpv, speed, grounded: !!me.pred?.ground, aiming, scoped, using: !!me.view?.us,
        reloading: !!me.view?.rl, sprinting: !!inp.sprint && speed > 6.5, yaw: ctl.yaw, pitch: ctl.pitch,
    });
    if (g.shake > 0) {
        g.shake = Math.max(0, g.shake - dt * 2.5);
        camera.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(g.shake * 0.35));
    }

    g.prevRight = ctl.mouseR;
    updateGrenadeArc(me.state === 'alive' && it?.type === 'grenade' && ctl.mouseR);
    animateNades(dt);

    // --- monde, effets
    world.setBalloon(g.state === 'bus' ? g.bal : null, dt, (now - (g.balAt ?? now)) / 1000);
    world.update(dt, g.time, { x: vx, y: vy, z: vz }, camPos);
    const rainK = world.rain?.k ?? 0;
    scene.fog.density = 0.0021 * fogK * (1 + rainK * 1.4) * THREE.MathUtils.clamp(1 - (camPos.y - 40) / 160, 0.35, 1);
    world.fogTint(scene.fog.color);
    fx.update(dt);
    animateBullets(dt);
    loot.animate(dt, g.time, { x: vx, z: vz });
    buildings.update(dt);

    // --- interface
    const K = (a) => `<span class="key">${ctl.key(a)}</span>`;
    const target = interactTarget();
    if (target?.kind === 'drop') ui.promptItem(target.d.it);
    else if (target?.kind === 'chest') ui.promptChest(target.c);
    else if (target?.kind === 'car') ui.prompt(`${K('interact')} ${target.v.driver === null ? 'Conduire' : 'Monter (passager)'}`);
    else if (target?.kind === 'exit') ui.prompt(me.seat ? `${K('interact')} Descendre · vous pouvez tirer depuis le véhicule` : `${K('interact')} Descendre · ${K('fwd')}/${K('back')} accélérer / freiner`);
    else if (target?.kind === 'zip') ui.prompt(`${K('interact')} Tyrolienne`);
    else if (target?.kind === 'door') ui.prompt(`${K('interact')} ${target.door.pc.o ? 'Fermer' : 'Ouvrir'} la porte`);
    else if (target?.kind === 'shop') ui.promptShop(target.s, me.view?.cash ?? 0, g.cfg?.loadoutCost ?? 1000, ctl.key('interact'));
    else ui.prompt(null);
    // PV du mur visé : on voit ce qu'il reste à percer
    const hpPc = me.state === 'alive' && !riding() ? aimedPiece() : null;
    ui.pieceHp(hpPc && hpPc.max > 1 ? hpPc : null);
    ui.tickArcs((id) => angleTo(id));
    const myVeh = driving ? world.vehicles.get(me.pred.veh) : seatV;
    ui.vehicle(myVeh && me.state === 'alive' ? myVeh.hp : null);
    if (me.state === 'dead' && g.spectate !== null && !g.ended && g.mode === 'br') {
        const sp = g.remotes.get(g.spectate);
        ui.spectator(sp ? { name: sp.last.n, kills: sp.last.k ?? 0, alive: g.alive, inv: sp.last.inv ?? [],
            sel: sp.last.sel ?? 0, hp: sp.last.hp ?? 0, sh: sp.last.sh ?? 0, cash: sp.last.cash ?? 0 } : null,
        { onAgain: () => replay(), onMenu: () => location.reload() });
    } else ui.spectator(null);
    ui.privBadge(g.priv, g.priv?.host === g.id, g.state === 'lobby');
    g.fpsN++;
    if (now - g.fpsAt > 500) {
        ui.fps(settings.showFps ? Math.round((g.fpsN * 1000) / (now - g.fpsAt)) : null);
        g.fpsN = 0;
        g.fpsAt = now;
    }
    updateCrosshair(it, aiming, scoped);
    ui.water(me.view?.wt ?? null);
    ui.stamina(me.pred ? (me.pred.tac ?? S.TAC_TIME) / S.TAC_TIME : 1);
    ui.scope(scoped);
    const view = me.view;
    if (view?.rl || view?.us) {
        const a = view.rl || view.us;
        const p = a.p + (now - me.viewAt) / 1000 / a.d;
        ui.progress(p, view.rl ? 'Rechargement…' : `${ITEM_NAMES[view.slots[a.s]?.type] ?? 'Soin'}…`);
    } else {
        ui.progress(null);
    }
    const inStorm = world.inStorm(vx, vz) && me.state === 'alive' && g.storm?.ph >= 0;
    ui.stormTint(inStorm);
    centerMessages();
    if (now - g.lastMap > 100) {
        g.lastMap = now;
        const drops = [...(world.specials?.values() ?? [])].filter((c) => c.data.k === 3 && !c.data.open).map((c) => ({ x: c.data.x, z: c.data.z }));
        const mm = { me: { x: vx, z: vz, yaw: ctl.yaw }, storm: g.storm?.ph >= 0 ? g.storm : null, bal: g.state === 'bus' ? g.bal : null, path: g.balPath, drops };
        ui.drawMinimap(mm);
        if (!document.getElementById('bigmap').classList.contains('hidden')) ui.drawBigMap(mm);
        poiBanner(vx, vz);
    }
    // bourdonnement des coffres : seulement de près, à gauche ou à droite (les caisses de munitions sont silencieuses)
    let chestNear = 0;
    let chestPan = 0;
    const hearR = chestHearRange(CHEST_HEAR);
    for (const c of world.chestList()) {
        if (c.open || c.ammo || c.k === 1 || c.k === 3) continue;
        const d = Math.hypot(c.x - vx, c.z - vz, (c.y - vy) * 1.5);
        if (d >= hearR) continue;
        const v = (1 - d / hearR) ** 1.6;
        if (v > chestNear) {
            chestNear = v;
            chestPan = soundAt(new THREE.Vector3(c.x, c.y, c.z))[1];
        }
    }
    const fallSpeed = me.pred && falling ? Math.min(1, Math.abs(me.pred.vel[1]) / 40) : 0;
    setListener(vx, vy, vz, ctl.yaw);
    setAmbience({
        wind: me.state === 'bus' ? 0.25 : zipping ? 0.7 : fallSpeed, chest: chestNear, chestPan, storm: inStorm ? 1 : 0, burner: me.state === 'bus' ? 1 : 0,
        engine: driving ? 0.25 + Math.min(1, Math.abs(me.pred.cspd) / S.CAR_SPEED) * 0.75 : 0, zip: zipping ? 1 : 0,
    });
    if (!ctl.locked && !g.dead && !g.ended && !ui.pauseOpen()) ui.hint(`<b>Cliquez pour jouer</b> · ${K('help')} aide · ${K('map')} carte`);
    else ui.hint('');

    composer.render();
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function dampAngle(cur, target, k, dt) {
    return cur + wrapAngle(target - cur) * (1 - Math.exp(-k * dt));
}

function updateCrosshair(it, aiming, scoped) {
    const g = game;
    if (scoped || g.me.state !== 'alive') { ui.crosshair(true); return; }
    if (!it || !WEAPONS.includes(it.type)) { ui.crosshair(false, 0); return; }
    const w = g.cfg.weapons[it.type];
    const att = attachMult(it.att ?? []);
    let s = (aiming ? w.ads * att.adsSpread : w.spread * att.hipSpread);
    const p = g.me.pred;
    if (p && !p.ground) s *= 2;
    else if (p && Math.hypot(p.vel[0], p.vel[2]) > 1) s *= aiming ? 1.3 : 1.5;
    if (g.lastInp?.crouch) s *= 0.75;
    s += g.bloom * att.bloom * (aiming ? 0.03 : 0.06);
    // 0 = viseur serré, 1 = grande ouverture : le réglage « dynamique » s'en sert
    ui.crosshair(false, Math.min(1, s / 0.16));
}

/** Cumul des accessoires côté client (mêmes facteurs que ATTACHMENTS du serveur). */
function attachMult(list) {
    const k = { adsSpread: 1, hipSpread: 1, bloom: 1, zoom: 1 };
    const F = { holo: { adsSpread: 0.7 }, scope: { adsSpread: 0.5, zoom: 0.62 }, laser: { hipSpread: 0.68 },
        grip: { bloom: 0.72, adsSpread: 0.9 }, heavy: { hipSpread: 0.85 }, stock: { bloom: 1.1 } };
    for (const a of list) for (const [key, v] of Object.entries(F[a] ?? {})) if (k[key] !== undefined) k[key] *= v;
    return k;
}

function centerMessages() {
    const g = game;
    const me = g.me;
    const K = (a) => `<span class="key">${ctl.key(a)}</span>`;
    if (g.state === 'lobby' && g.mode === 'br') {
        const t = Math.ceil(g.cd || 0);
        const n = `${g.remotes.size + 1} joueur(s) sur la plateforme`;
        if (g.priv && !g.priv.go) ui.centerMsg(g.priv.host === g.id ? `<span class="big">${esc(g.priv.code)}</span>Code de votre partie privée · ${n} · <span class="key">Entrée</span> pour lancer`
            : `<span class="big">${esc(g.priv.code)}</span>Partie privée · ${n} · en attente de l'hôte`);
        else ui.centerMsg(`<span class="big">${t > 0 ? t : '…'}</span>Départ de la montgolfière · ${n} · coffres et lance-roquettes en libre service !`);
    } else if (me.state === 'bus') {
        ui.centerMsg(`<span class="big">SAUTEZ !</span>Appuyez sur ${K('jump')} pour sauter de la montgolfière`);
    } else if (me.state === 'falling' && me.pred && !me.pred.glide) {
        const agl = Math.max(0, Math.round(me.pred.pos[1] - S.groundOrWater(me.pred.pos[0], me.pred.pos[2])));
        ui.centerMsg(`${agl} m · ${K('jump')} ouvrir le planeur · ${K('fwd')} piquer`);
    } else {
        ui.centerMsg('');
    }
}

function poiBanner(x, z) {
    const g = game;
    if (g.me.state !== 'alive' && g.me.state !== 'falling') return;
    let cur = null;
    for (const p of map.pois) if (Math.hypot(x - p.x, z - p.z) < p.r + 25) cur = p.name;
    if (cur && cur !== g.poi) ui.banner(cur);
    g.poi = cur;
}

// ------------------------------------------------------------ menu

let orbitA = 0.6;
function renderMenu(dt) {
    menuT += dt;
    orbitA += dt * 0.04;
    const town = map.pois[0];
    const dbg = window.__BI?.menuCam;
    camera.position.set(...(dbg ? dbg.pos : [town.x + Math.cos(orbitA) * 150, 70, town.z + Math.sin(orbitA) * 150]));
    camera.lookAt(...(dbg ? dbg.look : [town.x, 8, town.z]));
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
    world.update(dt, menuT, { x: town.x, y: 0, z: town.z }, camera.position);
    renderer.autoClear = true;
    composer.render();
    if (lobbyChar && !document.getElementById('menu').classList.contains('hidden')) {
        lobbyChar.root.rotation.y = Math.sin(menuT * 0.5) * 0.5;
        lobbyChar.update(dt, { speed: 0, grounded: true, holding: 'ar', aiming: false, pitch: 0 });
        if (menuT - (lobbyChar.lastEmote ?? -10) > 7) { lobbyChar.lastEmote = menuT; lobbyChar.emote(Math.random() < 0.5 ? 0 : 1); }
        podium.rotation.y += dt * 0.3;
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(lobbyScene, lobbyCam);
        renderer.autoClear = true;
    }
}

placeLobbyCam();
initMenu();
document.getElementById('play').addEventListener('click', () => play());
document.getElementById('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
document.getElementById('name').addEventListener('input', (e) => ui.setPlayerName(e.target.value.trim()));
requestAnimationFrame(frame);
window.__BI = { get game() { return game; }, renderer, buildings, ctl, world, store: () => store, loot, camera, sfx, send: (m) => net && net.send(m) };
