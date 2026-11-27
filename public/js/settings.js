// Paramètres du joueur (enregistrés dans le navigateur) : souris, champ de vision, touches,
// volumes, qualité graphique. Le panneau s'ouvre depuis le menu ou avec Échap en jeu.

import { initAudio, onPersoReady, persoStatus } from './audio.js';

/** [action, libellé, touche par défaut (position physique : W = Z en AZERTY)] */
export const ACTIONS = [
    ['fwd', 'Avancer', 'KeyW'], ['back', 'Reculer', 'KeyS'], ['left', 'Aller à gauche', 'KeyA'], ['right', 'Aller à droite', 'KeyD'],
    ['jump', 'Sauter / parachute', 'Space'], ['sprint', 'Sprinter', 'ShiftLeft'], ['crouch', "S'accroupir / glisser", 'ControlLeft'],
    ['interact', 'Interagir (ramasser, ouvrir, conduire, acheter…)', 'KeyE'],
    ['melee', 'Coup de crosse', 'KeyV'], ['reload', 'Recharger', 'KeyR'],
    ['plate', 'Mettre une plaque de gilet', 'KeyG'],
    ['lethal', 'Létal (grenade, fumigène)', 'KeyF'],
    ['tactical', 'Tactique (soins)', 'KeyX'],
    ['util', 'Utilitaire (plateforme)', 'KeyT'],
    ['drop', "Jeter l'arme tenue", 'KeyJ'], ['emote', 'Danses', 'KeyB'], ['map', 'Carte', 'KeyM'], ['help', 'Aide', 'KeyH'],
];

/** Touches réécrites par une mise à jour du jeu (les réglages déjà enregistrés sont migrés). */
const KEYS_VERSION = 4;
const KEYS_V2 = ['crouch', 'melee', 'interact', 'reload', 'plate', 'lethal', 'tactical', 'util', 'drop'];

/** Viseur personnalisable : forme, couleur, taille, écart, point et contour. */
export const CROSSHAIR_DEFAULT = {
    color: '#00ff88', dot: true, dotSize: 2, len: 9, gap: 5, thick: 2,
    outline: true, opacity: 0.95, dynamic: true, top: true,
};

/** Préréglages graphiques. */
export const QUALITY = {
    bas:   { label: 'Bas', ratio: 0.6, shadows: 0, bloom: false, decor: 0, treeNear: 60, far: 900, propsK: 0.6 },
    moyen: { label: 'Moyen', ratio: 0.85, shadows: 1024, bloom: false, decor: 0.5, treeNear: 110, far: 1400, propsK: 0.8 },
    haut:  { label: 'Haut', ratio: 1, shadows: 2048, bloom: true, decor: 1, treeNear: 180, far: 2200, propsK: 1 },
    ultra: { label: 'Ultra', ratio: 2, shadows: 4096, bloom: true, decor: 1, treeNear: 320, far: 3000, propsK: 1.4 },
};

const DEFAULTS = {
    kv: KEYS_VERSION,
    sens: 1, adsSens: 0.75, fov: 80, invertY: false, rawMouse: true,
    autoAmmo: true,                  // ramassage automatique des munitions
    crosshair: { ...CROSSHAIR_DEFAULT },
    vol: { master: 0.8, sfx: 1, music: 0.5 },
    quality: 'haut', showFps: false,
    keys: Object.fromEntries(ACTIONS.map(([a, , k]) => [a, k])),
};

function load() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('bi_settings') || '{}'); } catch { s = {}; }
    // anciens réglages (curseur du menu)
    const oldSens = Number(localStorage.getItem('bi_sens'));
    const out = { ...DEFAULTS, ...s, vol: { ...DEFAULTS.vol, ...(s.vol ?? {}) }, keys: { ...DEFAULTS.keys, ...(s.keys ?? {}) },
        crosshair: { ...CROSSHAIR_DEFAULT, ...(s.crosshair ?? {}) } };
    if (!s.sens && oldSens) out.sens = oldSens;
    if (!QUALITY[out.quality]) out.quality = 'haut';
    // construction rapide : les anciennes touches (F1…F4, C accroupi, X effacer) passent aux nouvelles
    if ((s.kv ?? 0) < KEYS_VERSION) {
        for (const a of KEYS_V2) out.keys[a] = DEFAULTS.keys[a];
        out.kv = KEYS_VERSION;
    }
    return out;
}

export const settings = load();
const listeners = new Set();

export function saveSettings() {
    try { localStorage.setItem('bi_settings', JSON.stringify(settings)); } catch { /* navigation privée */ }
    for (const f of listeners) f(settings);
}

export function onSettings(f) {
    listeners.add(f);
    f(settings);
}

/** Action associée à une touche physique (ou null). */
export function actionOf(code) {
    for (const [a] of ACTIONS) if (settings.keys[a] === code) return a;
    return null;
}

/**
 * Viseur en HTML : quatre branches, un point et un contour. `spread` (0..1) écarte les
 * branches quand le réglage « dynamique » est actif.
 */
export function crosshairHtml(xh, spread = 0) {
    const gap = xh.gap + (xh.dynamic ? spread * 22 : 0);
    const sh = xh.outline ? '0 0 0 1px rgba(0,0,0,0.85), 0 0 3px rgba(0,0,0,0.6)' : 'none';
    const bar = (x, y, w, h) => `<i style="left:calc(50% + ${x}px);top:calc(50% + ${y}px);width:${w}px;height:${h}px;`
        + `background:${xh.color};opacity:${xh.opacity};box-shadow:${sh}"></i>`;
    const t = xh.thick;
    const l = xh.len;
    let out = '';
    if (l > 0) {
        out += bar(-t / 2, gap, t, l);                    // bas
        out += bar(-t / 2 - gap - l, -t / 2, l, t);        // gauche
        out += bar(gap, -t / 2, l, t);                    // droite
        if (xh.top) out += bar(-t / 2, -gap - l, t, l);   // haut
    }
    if (xh.dot) out += bar(-xh.dotSize / 2, -xh.dotSize / 2, xh.dotSize, xh.dotSize);
    return out;
}

// ------------------------------------------------------------ panneau

let panel = null;
let labelFn = (c) => c;


export function setKeyLabeler(f) {
    labelFn = f;
}

export function openSettings(onClose) {
    panel?.remove();
    panel = document.createElement('div');
    panel.id = 'settings';
    panel.innerHTML = `
      <div class="box">
        <h2>Paramètres</h2>
        <div class="tabs"><button data-t="ctl" class="on">Contrôles</button><button data-t="keys">Touches</button><button data-t="xh">Viseur</button><button data-t="snd">Son</button><button data-t="gfx">Graphismes</button></div>
        <section data-t="ctl">
          <label>Sensibilité de la souris <input type="range" id="st-sens" min="0.2" max="4" step="0.05"><b></b></label>
          <label>Sensibilité en visée <input type="range" id="st-ads" min="0.2" max="1.5" step="0.05"><b></b></label>
          <label>Champ de vision <input type="range" id="st-fov" min="60" max="110" step="1"><b></b></label>
          <label class="ck"><input type="checkbox" id="st-inv"> Inverser la souris (haut / bas)</label>
          <label class="ck"><input type="checkbox" id="st-raw"> Souris brute (sans accélération du système)</label>
          <label class="ck"><input type="checkbox" id="st-autoammo"> Ramasser les munitions automatiquement</label>
        </section>
        <section data-t="keys" class="hidden"><div id="st-keys"></div><button id="st-keys-reset" class="small">Touches par défaut</button></section>
        <section data-t="xh" class="hidden">
          <div class="xh-prev"><div id="st-xh-prev"></div></div>
          <label>Couleur <input type="color" id="xh-color"></label>
          <label>Longueur des branches <input type="range" id="xh-len" min="0" max="24" step="1"><b></b></label>
          <label>Écart au centre <input type="range" id="xh-gap" min="0" max="24" step="1"><b></b></label>
          <label>Épaisseur <input type="range" id="xh-thick" min="1" max="8" step="1"><b></b></label>
          <label>Opacité <input type="range" id="xh-op" min="0.2" max="1" step="0.05"><b></b></label>
          <label>Taille du point <input type="range" id="xh-dotsize" min="1" max="8" step="1"><b></b></label>
          <label class="ck"><input type="checkbox" id="xh-dot"> Point central</label>
          <label class="ck"><input type="checkbox" id="xh-top"> Branche du haut</label>
          <label class="ck"><input type="checkbox" id="xh-outline"> Contour noir</label>
          <label class="ck"><input type="checkbox" id="xh-dyn"> S'ouvre avec la dispersion</label>
          <button id="xh-reset" class="small">Viseur par défaut</button>
        </section>
        <section data-t="snd" class="hidden">
          <label>Volume général <input type="range" id="st-vm" min="0" max="1" step="0.05"><b></b></label>
          <label>Effets sonores <input type="range" id="st-vs" min="0" max="1.5" step="0.05"><b></b></label>
          <label>Musique du lobby <input type="range" id="st-vmu" min="0" max="1" step="0.05"><b></b></label>
          <p class="note">Vos propres sons et votre musique : voir <code>public/sfx/sons-perso.json</code> (LISEZMOI).</p>
          <div id="st-perso" class="perso"></div>
        </section>
        <section data-t="gfx" class="hidden">
          <div id="st-q" class="q"></div>
          <label class="ck"><input type="checkbox" id="st-fps"> Afficher les images par seconde</label>
          <p class="note">Bas / Moyen : pour les ordinateurs portables. Ultra : grosses cartes graphiques.</p>
        </section>
        <button id="st-close" class="play">Fermer</button>
      </div>`;
    document.body.appendChild(panel);
    const $ = (id) => panel.querySelector(`#${id}`);
    const range = (id, get, set, fmt) => {
        const el = $(id);
        el.value = get();
        const show = () => { el.nextElementSibling.textContent = fmt(Number(el.value)); };
        show();
        el.addEventListener('input', () => { set(Number(el.value)); show(); saveSettings(); });
    };
    // état de vos sons personnalisés
    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const drawPerso = () => {
        const el = panel?.querySelector('#st-perso');
        if (!el) return;
        const P = persoStatus();
        if (P.etat !== 'pret') { el.innerHTML = '<p class="note">Sons personnalisés : chargement…</p>'; return; }
        if (!P.present) { el.innerHTML = '<p class="note">Aucun son personnalisé : <code>sons-perso.json</code> absent ou vide.</p>'; return; }
        let h = '<p class="note"><b>Vos sons (sons-perso.json)</b></p>';
        if (P.erreur) {
            h += `<p class="warn">⚠ ${esc(P.erreur)}${P.repare ? '<br>Le fichier a quand même été lu (réparé automatiquement), mais corrigez-le.' : ''}</p>`;
        }
        h += '<ul>' + P.items.map((it) => `<li class="${it.ok ? 'ok' : 'ko'}">${it.ok ? '✔' : '✘'} <b>${esc(it.cle)}</b> → ${esc(it.fichier || '?')} `
            + (it.ok ? `<span>(${it.duree.toFixed(1)} s)</span>` : `<span>— ${esc(it.info)}</span>`)
            + (it.inconnu ? ' <i>— ce nom n\'existe pas dans le jeu (voir la liste dans LISEZMOI)</i>' : '') + '</li>').join('') + '</ul>';
        el.innerHTML = h;
    };
    initAudio();
    drawPerso();
    onPersoReady(drawPerso);
    range('st-sens', () => settings.sens, (v) => { settings.sens = v; }, (v) => v.toFixed(2));
    range('st-ads', () => settings.adsSens, (v) => { settings.adsSens = v; }, (v) => `× ${v.toFixed(2)}`);
    range('st-fov', () => settings.fov, (v) => { settings.fov = v; }, (v) => `${v}°`);
    range('st-vm', () => settings.vol.master, (v) => { settings.vol.master = v; }, (v) => `${Math.round(v * 100)} %`);
    range('st-vs', () => settings.vol.sfx, (v) => { settings.vol.sfx = v; }, (v) => `${Math.round(v * 100)} %`);
    range('st-vmu', () => settings.vol.music, (v) => { settings.vol.music = v; }, (v) => `${Math.round(v * 100)} %`);
    const ck = (id, key) => {
        const el = $(id);
        el.checked = !!settings[key];
        el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); });
    };
    ck('st-inv', 'invertY');
    ck('st-raw', 'rawMouse');
    ck('st-fps', 'showFps');
    ck('st-autoammo', 'autoAmmo');
    // --- viseur personnalisable, avec aperçu en direct
    const xh = settings.crosshair;
    const drawPrev = () => { $('st-xh-prev').innerHTML = crosshairHtml(xh, 0); };
    const xhRange = (id, key, fmt) => {
        const el = $(id);
        el.value = xh[key];
        const show = () => { el.nextElementSibling.textContent = fmt(Number(el.value)); };
        show();
        el.addEventListener('input', () => { xh[key] = Number(el.value); show(); saveSettings(); drawPrev(); });
    };
    const xhCk = (id, key) => {
        const el = $(id);
        el.checked = !!xh[key];
        el.addEventListener('change', () => { xh[key] = el.checked; saveSettings(); drawPrev(); });
    };
    $('xh-color').value = xh.color;
    $('xh-color').addEventListener('input', () => { xh.color = $('xh-color').value; saveSettings(); drawPrev(); });
    xhRange('xh-len', 'len', (v) => `${v} px`);
    xhRange('xh-gap', 'gap', (v) => `${v} px`);
    xhRange('xh-thick', 'thick', (v) => `${v} px`);
    xhRange('xh-op', 'opacity', (v) => `${Math.round(v * 100)} %`);
    xhRange('xh-dotsize', 'dotSize', (v) => `${v} px`);
    xhCk('xh-dot', 'dot');
    xhCk('xh-top', 'top');
    xhCk('xh-outline', 'outline');
    xhCk('xh-dyn', 'dynamic');
    drawPrev();
    $('xh-reset').addEventListener('click', () => {
        Object.assign(xh, CROSSHAIR_DEFAULT);
        saveSettings();
        openSettings(onClose);   // on redessine le panneau avec les valeurs par défaut
    });
    const q = $('st-q');
    const drawQ = () => {
        q.innerHTML = Object.entries(QUALITY).map(([k, v]) => `<button data-q="${k}" class="${settings.quality === k ? 'on' : ''}">${v.label}</button>`).join('');
    };
    drawQ();
    q.addEventListener('click', (e) => {
        const k = e.target.dataset?.q;
        if (!k) return;
        settings.quality = k;
        saveSettings();
        drawQ();
    });
    // touches
    let waiting = null;
    const drawKeys = () => {
        $('st-keys').innerHTML = ACTIONS.map(([a, lbl]) => `<div class="krow"><span>${lbl}</span><button data-a="${a}" class="${waiting === a ? 'wait' : ''}">${waiting === a ? 'appuyez…' : labelFn(settings.keys[a])}</button></div>`).join('');
    };
    drawKeys();
    $('st-keys').addEventListener('click', (e) => {
        const a = e.target.dataset?.a;
        if (!a) return;
        waiting = a;
        drawKeys();
    });
    const onKey = (e) => {
        if (!waiting) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.code !== 'Escape') {
            // une touche ne sert qu'à une action : on échange si elle était déjà prise
            for (const [a] of ACTIONS) if (settings.keys[a] === e.code && a !== waiting) settings.keys[a] = settings.keys[waiting];
            settings.keys[waiting] = e.code;
            saveSettings();
        }
        waiting = null;
        drawKeys();
    };
    addEventListener('keydown', onKey, true);
    $('st-keys-reset').addEventListener('click', () => { settings.keys = { ...DEFAULTS.keys }; saveSettings(); drawKeys(); });
    panel.querySelector('.tabs').addEventListener('click', (e) => {
        const t = e.target.dataset?.t;
        if (!t) return;
        panel.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
        panel.querySelectorAll('section').forEach((s) => s.classList.toggle('hidden', s.dataset.t !== t));
    });
    const close = () => {
        removeEventListener('keydown', onKey, true);
        panel.remove();
        panel = null;
        onClose?.();
    };
    $('st-close').addEventListener('click', close);
    panel.addEventListener('mousedown', (e) => { if (e.target === panel) close(); });
}

export function settingsOpen() {
    return !!panel;
}
