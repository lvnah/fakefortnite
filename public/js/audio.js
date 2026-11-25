// Sons : vrais bruitages enregistrés (CC0 : armes et explosions de freesound.org via GunLib,
// pas, impacts et interface de Kenney) + quelques sons de synthèse (ambiances, moteur).
let ctx = null;
const buffers = new Map();   // fichier -> AudioBuffer
const SFX_BASE = new URL('../sfx/', import.meta.url).href;
/** Événement sonore -> { fichier, volume, vitesse } ; remplacé par public/sfx/sons.json (sons personnalisés). */
let SONS = {};

// ------------------------------------------------------------ sons personnalisés (sons-perso.json)
// Le fichier est lu avec indulgence : virgules en trop, accolade en trop, commentaires, guillemets
// typographiques… Un son perso ne remplace celui du jeu qu'une fois son fichier chargé : s'il est
// introuvable, le son d'origine reste. L'état est affiché dans Paramètres → Son.
const EXTRA_KEYS = ['coffre_ambiance', 'musique_lobby'];
const PERSO = { etat: 'attente', present: false, repare: false, erreur: null, items: [] };
const persoWaiters = [];
/** État du fichier sons-perso.json (pour l'affichage dans les paramètres). */
export function persoStatus() { return PERSO; }
/** Appelle `cb` quand les sons perso ont fini de charger (tout de suite si c'est déjà fait). */
export function onPersoReady(cb) { if (PERSO.etat === 'pret') cb(PERSO); else persoWaiters.push(cb); }

/** Analyse tolérante d'un JSON écrit à la main ; renvoie { data, repare, erreur }. */
function parseLenient(txt) {
    txt = txt.replace(/^\uFEFF/, '');
    let erreur = null;
    try { return { data: JSON.parse(txt), repare: false, erreur }; } catch (e) { erreur = jsonErrorText(txt, e); }
    const t = txt
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:"\\])\/\/.*$/gm, '$1')
        .replace(/[\u201C\u201D\u00AB\u00BB\u2033]/g, '"')
        .replace(/,(\s*[}\]])/g, '$1');
    try { return { data: JSON.parse(t), repare: true, erreur }; } catch { /* on récupère son par son */ }
    // dernier recours : chaque son est un petit bloc "nom": { ... } (sans accolades à l'intérieur)
    const sons = {};
    for (const m of t.matchAll(/"([^"]+)"\s*:\s*\{([^{}]*)\}/g)) {
        try { sons[m[1]] = JSON.parse(`{${m[2].replace(/,\s*$/, '')}}`); } catch { /* bloc illisible */ }
    }
    // forme courte « "coffre": "perso/x.mp3" » (hors des blocs)
    const outside = t.replace(/\{[^{}]*\}/g, '{}');
    for (const m of outside.matchAll(/"([a-z_]+)"\s*:\s*"([^"]+\.(?:mp3|ogg|wav|m4a|aac|flac|opus|webm))"/gi)) {
        if (!['fichier', 'file', 'son'].includes(m[1])) sons[m[1]] ??= m[2];
    }
    return { data: { sons }, repare: true, erreur };
}

/** Message d'erreur JSON lisible : numéro de ligne et la ligne fautive. */
function jsonErrorText(txt, e) {
    const msg = String(e?.message ?? e);
    let pos = /position (\d+)/.exec(msg)?.[1];
    let line = /line (\d+)/.exec(msg)?.[1];
    if (pos != null && line == null) line = txt.slice(0, Number(pos)).split('\n').length;
    if (line == null) return 'syntaxe JSON incorrecte';
    const l = Number(line);
    const near = txt.split('\n').slice(Math.max(0, l - 2), l).map((x) => x.trim()).filter(Boolean).join('  ⏎  ');
    return `syntaxe incorrecte vers la ligne ${l} (${near}) : une virgule ou une accolade en trop / en moins ?`;
}

/** Nettoie le chemin donné dans "fichier" (antislash, sfx/ en trop…). */
function cleanPath(f) {
    return String(f).trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^(public\/)?sfx\//i, '');
}

async function fetchBuffer(path) {
    const r = await fetch(`${SFX_BASE}${encodeURI(path)}`);
    if (!r.ok) { const e = new Error('introuvable'); e.code = 404; throw e; }
    const ab = await r.arrayBuffer();
    try { return await ctx.decodeAudioData(ab); } catch { const e = new Error('illisible'); e.code = 415; throw e; }
}

async function loadSamples() {
    try {
        const r = await fetch(`${SFX_BASE}sons.json`, { cache: 'no-cache' });
        const j = await r.json();
        SONS = j.sons ?? j;
    } catch (e) {
        console.warn('sons.json illisible', e);
    }
    // sons du jeu
    const files = new Set(Object.values(SONS).map((e) => e && e.fichier).filter(Boolean));
    for (const f of files) {
        fetchBuffer(f).then((buf) => buffers.set(f, buf)).catch(() => console.warn(`son introuvable : sfx/${f}`));
    }
    // vos sons : sons-perso.json (jamais écrasé par une mise à jour)
    PERSO.etat = 'chargement';
    let entries = [];
    try {
        const r = await fetch(`${SFX_BASE}sons-perso.json`, { cache: 'no-cache' });
        const txt = r.ok ? await r.text() : '';
        if (txt.trim() && !/^\s*\{\s*"sons"\s*:\s*\{\s*\}\s*\}\s*$/.test(txt)) {
            PERSO.present = true;
            const { data, repare, erreur } = parseLenient(txt);
            PERSO.repare = repare;
            PERSO.erreur = erreur;
            if (erreur) console.warn(`sons-perso.json : ${erreur}${repare ? ' — réparé automatiquement' : ''}`);
            entries = Object.entries(data?.sons ?? data ?? {}).filter(([k]) => !k.startsWith('_'));
        }
    } catch (e) {
        console.warn('sons-perso.json illisible', e);
    }
    const known = new Set([...Object.keys(SONS), ...EXTRA_KEYS]);
    await Promise.all(entries.map(async ([k, v]) => {
        if (typeof v === 'string') v = { fichier: v };
        const f = v && (v.fichier ?? v.file ?? v.son);
        const item = { cle: k, fichier: f ? cleanPath(f) : '', ok: false, info: '' };
        PERSO.items.push(item);
        if (!known.has(k)) item.inconnu = true;
        if (!f) { item.info = 'pas de "fichier"'; return; }
        // chemin tel quel, sinon dans perso/
        const tries = [item.fichier];
        if (!item.fichier.startsWith('perso/')) tries.push(`perso/${item.fichier.split('/').pop()}`);
        for (const path of tries) {
            try {
                const buf = await fetchBuffer(path);
                buffers.set(path, buf);
                item.fichier = path;
                item.ok = true;
                item.duree = buf.duration;
                SONS[k] = { ...(SONS[k] ?? {}), ...v, fichier: path };
                // musique déjà lancée avec le son d'origine : on la remplace
                if (music && music.name === k) { music.name = '#'; playMusic(k); }
                return;
            } catch (e) {
                item.info = e.code === 415 ? 'format illisible (mp3, ogg ou wav)' : 'fichier introuvable';
            }
        }
    }));
    PERSO.items.sort((a, b) => a.cle.localeCompare(b.cle));
    PERSO.etat = 'pret';
    for (const it of PERSO.items) {
        if (!it.ok) console.warn(`son perso « ${it.cle} » : ${it.info} (sfx/${it.fichier})`);
        else if (it.inconnu) console.warn(`son perso « ${it.cle} » : ce nom n'existe pas dans le jeu`);
    }
    for (const cb of persoWaiters.splice(0)) cb(PERSO);
}

/**
 * Joue l'événement sonore `name` (clé de sons.json) ; renvoie la source, ou false si le son
 * n'est pas défini / pas encore chargé (on retombe alors sur un son de synthèse).
 */
function play(name, vol = 1, pan = 0, rate = 1, offset = 0) {
    if (!ctx || vol < 0.01) return !!ctx;
    const e = SONS[name];
    const buf = e && buffers.get(e.fichier);
    if (!buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (e.vitesse ?? 1);
    src.connect(out(vol * (e.volume ?? 1), pan));
    src.start(ctx.currentTime, offset);
    return src;
}
const vary = (a = 0.06) => 1 + (Math.random() - 0.5) * 2 * a;

// ------------------------------------------------------------ sons « posés » dans le monde
// Un son de coffre (même long) reste attaché au coffre : plus on s'éloigne, moins on l'entend,
// et il s'éteint en fondu quand on sort de sa portée (« portee » en mètres dans sons-perso.json).
const spatial = new Set();
const ear = { x: 0, y: 0, z: 0, yaw: 0 };
/** Position de l'auditeur (le joueur) et orientation de la caméra : appelée à chaque image. */
export function setListener(x, y, z, yaw) { ear.x = x; ear.y = y; ear.z = z; ear.yaw = yaw; }

function hearing(pos, range) {
    const dx = pos.x - ear.x;
    const dy = (pos.y - ear.y) * 1.3;
    const dz = pos.z - ear.z;
    const d = Math.hypot(dx, dy, dz);
    const k = d >= range ? 0 : (1 - d / range) ** 1.6;
    // côté gauche / droit (droite de la caméra = (cos yaw, 0, -sin yaw))
    const pan = d > 0.5 ? Math.max(-0.85, Math.min(0.85, ((dx * Math.cos(ear.yaw) - dz * Math.sin(ear.yaw)) / d) * 0.8)) : 0;
    return [k, pan];
}

/** Joue `name` à l'endroit `pos` ; renvoie false si le son n'est pas défini / chargé. */
function playAt(name, pos, range = 25, vol = 1, rate = 1) {
    if (!ctx) return false;
    const e = SONS[name];
    const buf = e && buffers.get(e.fichier);
    if (!buf) return false;
    const R = e.portee ?? range;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (e.vitesse ?? 1);
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const h = { src, g, p, pos: { x: pos.x, y: pos.y, z: pos.z }, range: R, base: vol * (e.volume ?? 1), silent: 0, t0: ctx.currentTime };
    const [k, pan] = hearing(h.pos, R);
    if (k <= 0.005) return src;   // trop loin : on ne l'entend pas du tout
    g.gain.value = h.base * k;
    if (p) { p.pan.value = pan; src.connect(g).connect(p).connect(sfxBus); } else src.connect(g).connect(sfxBus);
    // « duree » (s) : coupe en fondu un son trop long
    if (e.duree && e.duree > 0) h.end = ctx.currentTime + e.duree / src.playbackRate.value;
    src.onended = () => spatial.delete(h);
    src.start();
    spatial.add(h);
    return src;
}

/** Distance (m) à laquelle on entend un coffre fermé : "portee" de coffre_ambiance, sinon `def`. */
export function chestHearRange(def) { return SONS.coffre_ambiance && buffers.get(SONS.coffre_ambiance.fichier) ? (SONS.coffre_ambiance.portee ?? def) : def; }

/** Sons posés en cours (tests automatiques) : volume actuel et portée. */
export function spatialInfo() { return [...spatial].map((h) => ({ gain: +h.g.gain.value.toFixed(3), range: h.range })); }

/** Met à jour le volume des sons posés (fondu quand on s'éloigne) ; arrête ceux devenus inaudibles. */
function updateSpatial() {
    if (!ctx || !spatial.size) return;
    const t = ctx.currentTime;
    for (const h of spatial) {
        let [k, pan] = hearing(h.pos, h.range);
        if (h.end) {
            const left = h.end - t;
            if (left <= 0) k = 0;
            else if (left < 0.8) k *= left / 0.8;
        }
        h.g.gain.setTargetAtTime(h.base * k, t, 0.18);
        if (h.p) h.p.pan.setTargetAtTime(pan, t, 0.15);
        // inaudible pendant ~1 s (fondu terminé) : on l'arrête pour de bon
        if (k <= 0.003) {
            if (!h.silent) h.silent = t;
            else if (t - h.silent > 1.0) {
                try { h.src.stop(); } catch { /* déjà fini */ }
                spatial.delete(h);
            }
        } else h.silent = 0;
    }
}
let master = null;
let sfxBus = null;
let musicBus = null;
let music = null;
let noise = null;
const loops = {};

export function initAudio() {
    if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus.connect(master);
    applyVolumes();
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 1.0, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    loadSamples();
    if (wantMusic) setTimeout(() => playMusic(wantMusic), 400);
}

let VOL = { master: 0.8, sfx: 1, music: 0.5 };
/** Volumes : général, effets, musique (réglages). */
export function setVolumes(v) {
    VOL = { ...VOL, ...v };
    applyVolumes();
}
function applyVolumes() {
    if (!master) return;
    master.gain.value = VOL.master;
    sfxBus.gain.value = VOL.sfx;
    musicBus.gain.value = VOL.music;
}

/** Musique en boucle (clé de sons.json / sons-perso.json, ex. « musique_lobby ») ; null pour l'arrêter. */
export function playMusic(name) {
    if (!ctx) return;
    if (music && music.name === name) return;
    if (music) {
        const m = music;
        m.g.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
        setTimeout(() => { try { m.src.stop(); } catch { /* fini */ } }, 3000);
        music = null;
    }
    if (!name) return;
    const e = SONS[name];
    const buf = e && buffers.get(e.fichier);
    if (!buf) {
        // pas encore chargé : on réessaie un peu plus tard
        setTimeout(() => { if (!music && wantMusic === name) playMusic(name); }, 800);
        return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(e.volume ?? 0.6, ctx.currentTime, 0.8);
    src.connect(g).connect(musicBus);
    src.start();
    music = { name, src, g };
}
let wantMusic = null;
export function music_(name) {
    wantMusic = name;
    playMusic(name);
}

function out(vol, pan = 0) {
    const g = ctx.createGain();
    g.gain.value = vol;
    if (pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p).connect(sfxBus);
    } else {
        g.connect(sfxBus);
    }
    return g;
}

function bruit(dur, type, freq, vol, q = 1, pan = 0, attack = 0.002, sweepTo = null) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(out(1, pan));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t, Math.random() * 0.4, dur + 0.05);
}

function ton(f0, f1, dur, vol, type = 'sine', delay = 0, pan = 0) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out(1, pan));
    o.start(t);
    o.stop(t + dur + 0.05);
}

/** Volume selon la distance (sons des autres joueurs). */
export function distVol(d) {
    return Math.max(0, Math.min(1, 1 - d / 160)) ** 1.6;
}

const SHOT = { pistol: 'tir_pistolet', smg: 'tir_mitraillette', ar: 'tir_fusil', pump: 'tir_pompe', sniper: 'tir_sniper', rocket: 'tir_roquette' };
const RELOAD = { pistol: 'recharge_pistolet', smg: 'recharge_pistolet', ar: 'recharge_fusil', pump: 'recharge_pompe', sniper: 'recharge_sniper', rocket: 'recharge_roquette' };
const HIT_NODE = { tree: 'arbre', rock: 'rocher', car: 'metal', prop: 'meuble', veh: 'metal' };
let reloadSrc = null;

export const sfx = {
    shot(kind, v = 1, pan = 0) {
        if (v < 0.02) return;
        if (play(SHOT[kind] ?? 'tir_fusil', v, pan, vary(0.04))) return;
        bruit(0.11, 'bandpass', 1300, 0.7 * v, 1, pan);
        ton(240, 90, 0.09, 0.32 * v, 'sawtooth', 0, pan);
    },
    reload(kind = 'ar') {
        try { reloadSrc?.stop?.(); } catch { /* déjà fini */ }
        reloadSrc = play(RELOAD[kind] ?? 'recharge_fusil');
        if (!reloadSrc) { bruit(0.05, 'highpass', 3000, 0.25); setTimeout(() => bruit(0.07, 'bandpass', 1800, 0.35), 260); }
    },
    stopReload() {
        try { reloadSrc?.stop?.(); } catch { /* déjà fini */ }
        reloadSrc = null;
    },
    empty() { if (!play('chargeur_vide')) ton(900, 850, 0.04, 0.15, 'square'); },
    build(mat = 'wood') {
        if (play({ wood: 'construction_bois', stone: 'construction_pierre', metal: 'construction_metal' }[mat] ?? 'construction_bois')) return;
        bruit(0.08, 'bandpass', 900, 0.3, 2);
    },
    /** Coup de pioche : arbre, rocher, épave, meuble (ou construction : wood / stone / metal). */
    harvest(kind, v = 1, pan = 0) {
        const name = HIT_NODE[kind] ?? 'construction_coup';
        if (play(name, v, pan, vary(0.05))) return;
        bruit(0.09, 'bandpass', 700, 0.55 * v, 2, pan);
    },
    /** Arbre / rocher / meuble détruit. */
    breakNode(kind, v = 1, pan = 0) {
        const name = `${HIT_NODE[kind] ?? 'meuble'}${kind === 'tree' ? '_tombe' : '_casse'}`;
        if (!play(name, v, pan, vary(0.04))) bruit(0.4, 'lowpass', 500, 0.6 * v, 1, pan, 0.002, 120);
    },
    breakBuild(v = 1, pan = 0) {
        if (!play('construction_cassee', v, pan, vary(0.05))) bruit(0.3, 'lowpass', 600, 0.5 * v, 1, pan);
    },
    swing() { bruit(0.18, 'bandpass', 900, 0.18, 1, 0, 0.05, 2400); },
    hit(head, shield) {
        if (play(head ? 'touche_tete' : shield ? 'touche_bouclier' : 'touche')) return;
        ton(900, 700, 0.07, 0.22, 'sine');
    },
    hurt() { if (!play('degats', 1, 0, vary())) bruit(0.15, 'lowpass', 500, 0.5); },
    pick() { if (!play('ramasser', 1, 0, vary())) ton(660, 990, 0.08, 0.2, 'triangle'); },
    /** Billets ramassés. */
    coin() { if (!play('argent', 1, 0, vary(0.06))) ton(880, 1320, 0.09, 0.18, 'triangle'); },
    /** Achat validé à un point d'achat. */
    buy() { if (!play('achat')) { ton(520, 780, 0.09, 0.22, 'square'); setTimeout(() => ton(780, 1040, 0.1, 0.2, 'square'), 90); } },
    /** Ouverture d'un coffre à l'endroit `pos` (le son suit la distance tant qu'il dure). */
    chest(ammo = false, pos = null) {
        if (!pos) { play(ammo ? 'caisse_munitions' : 'coffre'); if (!ammo) play('coffre_eclat'); return; }
        playAt(ammo ? 'caisse_munitions' : 'coffre', pos, ammo ? 16 : 25);
        if (!ammo) playAt('coffre_eclat', pos, 25);
    },
    door(open, v = 1, pan = 0) {
        if (!play(open ? 'porte_ouvre' : 'porte_ferme', v, pan, vary(0.05))) bruit(0.2, 'lowpass', 700, 0.4 * v, 1, pan);
    },
    heal() { if (!play('soin')) ton(500, 900, 0.3, 0.15, 'sine'); },
    elim() { if (!play('elimine')) ton(300, 80, 0.5, 0.25, 'sawtooth'); },
    kill() { if (!play('elimination')) [660, 880, 1100].forEach((f, i) => ton(f, f, 0.18, 0.2, 'square', i * 0.06)); },
    explosion(v = 1, pan = 0) {
        if (v < 0.02) return;
        if (!play('explosion', v, pan, vary(0.05))) bruit(0.6, 'lowpass', 400, 1.0 * v, 1, pan, 0.002, 60);
    },
    boom() { sfx.explosion(1, 0); },
    step(v = 0.6) { play('pas', v, 0, vary(0.12)); },
    land(v = 1) { if (!play('atterrissage', v, 0, vary())) bruit(0.18, 'lowpass', 400, 0.4 * v); },
    jump() { bruit(0.5, 'bandpass', 600, 0.2, 1, 0, 0.1, 2000); },
    deploy() { if (!play('planeur')) bruit(0.25, 'bandpass', 1200, 0.3, 1, 0, 0.01, 300); },
    launch() { play('plateforme_saut'); },
    place() { play('pose'); },
    edit() { play('edition', 1, 0, vary()); },
    zip() { play('tyrolienne'); },
    car(on) { play(on ? 'voiture_monte' : 'voiture_descend'); if (on) ton(60, 120, 0.5, 0.25, 'sawtooth'); },
    drown() { play('noyade', 1, 0, vary()); },
    click() { if (!play('clic')) ton(1200, 1200, 0.03, 0.12, 'square'); },
    countdown() { if (!play('compte_a_rebours')) ton(880, 880, 0.12, 0.2, 'triangle'); },
    victory() { play('victoire'); [523, 659, 784, 1047, 1319].forEach((f, i) => ton(f, f * 1.01, 0.5, 0.15, 'triangle', i * 0.12)); },
    throwNade(v = 1, pan = 0) { if (!play('grenade_lancer', v, pan, vary())) bruit(0.2, 'bandpass', 1400, 0.25 * v, 1, pan, 0.02, 600); },
    bounce(v = 1, pan = 0) { if (v > 0.03 && !play('grenade_rebond', v, pan, vary(0.15))) ton(1800, 1500, 0.05, 0.12 * v, 'triangle', 0, pan); },
    grenade(v = 1, pan = 0) {
        if (v < 0.02) return;
        if (!play('explosion_grenade', v, pan, vary(0.06) * 0.92)) sfx.explosion(v, pan);
    },
    airdrop() { if (!play('largage', 0.9)) ton(220, 220, 0.6, 0.2, 'triangle'); },
    llama(v = 1, pan = 0, pos = null) {
        if (pos ? playAt('lama', pos, 40, 1, vary()) : play('lama', v, pan, vary())) return;
        [880, 1175, 1568].forEach((f, i) => ton(f, f, 0.2, 0.12 * v, 'sine', i * 0.07, pan));
    },
    vehHit(v = 1, pan = 0) { if (v > 0.05) play('vehicule_degats', v, pan, vary(0.1)); },
    vehBoom(v = 1, pan = 0) { if (v > 0.02 && !play('vehicule_explosion', v, pan, vary(0.04) * 0.85)) sfx.explosion(v, pan); },
    /** Pas des autres joueurs (spatialisés : volume selon la distance, côté gauche / droit). */
    enemyStep(v = 0.5, pan = 0) { if (v > 0.02) play('pas_ennemi', v, pan, vary(0.15)); },
};

/** Boucles continues (vent en chute libre, ronronnement des coffres, tempête, brûleur). */
function loop(name, build) {
    if (!ctx) return null;
    if (!loops[name]) loops[name] = build();
    return loops[name];
}

function noiseLoop(type, freq, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(sfxBus);
    src.start();
    return { g, f };
}

export function setAmbience({ wind = 0, chest = 0, chestPan = 0, storm = 0, burner = 0, engine = 0, zip = 0 }) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const w = loop('wind', () => noiseLoop('bandpass', 500, 0.6));
    w.g.gain.setTargetAtTime(0.35 * wind, t, 0.3);
    w.f.frequency.setTargetAtTime(400 + wind * 900, t, 0.3);
    const c = loop('chest', () => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = 660;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5;
        const lg = ctx.createGain();
        lg.gain.value = 14;
        lfo.connect(lg).connect(o.frequency);
        const g = ctx.createGain();
        g.gain.value = 0;
        const o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = 990;
        o.connect(g);
        o2.connect(g);
        const p = ctx.createStereoPanner();
        g.connect(p).connect(sfxBus);
        o.start(); o2.start(); lfo.start();
        return { g, p };
    });
    // votre propre son (clé « coffre_ambiance ») remplace le bourdonnement de synthèse, en boucle
    const amb = SONS.coffre_ambiance;
    const ambBuf = amb && buffers.get(amb.fichier);
    const cs = ambBuf ? loop('chestS', () => {
        const src = ctx.createBufferSource();
        src.buffer = ambBuf;
        src.loop = true;
        src.playbackRate.value = amb.vitesse ?? 1;
        const g = ctx.createGain();
        g.gain.value = 0;
        const p = ctx.createStereoPanner();
        src.connect(g).connect(p).connect(sfxBus);
        src.start();
        return { g, p };
    }) : null;
    c.g.gain.setTargetAtTime(cs ? 0 : 0.07 * chest, t, 0.2);
    c.p.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, chestPan)), t, 0.15);
    if (cs) {
        cs.g.gain.setTargetAtTime((amb.volume ?? 0.6) * chest, t, 0.25);
        cs.p.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, chestPan)), t, 0.15);
    }
    updateSpatial();
    const s = loop('storm', () => noiseLoop('lowpass', 220, 0.8));
    s.g.gain.setTargetAtTime(0.5 * storm, t, 0.5);
    const b = loop('burner', () => noiseLoop('lowpass', 300, 0.5));
    b.g.gain.setTargetAtTime(0.25 * burner, t, 0.3);
    // moteur de voiture : deux dents de scie filtrées dont la hauteur suit la vitesse
    const e = loop('engine', () => {
        const o1 = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        o1.type = 'sawtooth';
        o2.type = 'square';
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 420;
        const g = ctx.createGain();
        g.gain.value = 0;
        o1.connect(f);
        o2.connect(f);
        f.connect(g).connect(sfxBus);
        o1.start();
        o2.start();
        return { g, o1, o2 };
    });
    e.g.gain.setTargetAtTime(engine > 0 ? 0.07 + 0.05 * engine : 0, t, 0.15);
    e.o1.frequency.setTargetAtTime(38 + engine * 70, t, 0.2);
    e.o2.frequency.setTargetAtTime(19 + engine * 35, t, 0.2);
    const z = loop('zip', () => noiseLoop('highpass', 2500, 1.5));
    z.g.gain.setTargetAtTime(0.12 * zip, t, 0.15);
}
