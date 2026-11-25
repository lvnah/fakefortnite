// Interface : menu, HUD (vie, bouclier, inventaire, matériaux, munitions), minimap, grande carte, messages.
import { mapInfo, WATER_Y, CELL } from './shared.js';
import { iconSvg, ITEM_NAMES, ITEM_INFO, RARITY_COLORS, RARITY_NAMES, AMMO_SHORT, WEAPON_AMMO, LOADOUT_WEAPONS, LOADOUT_GEAR, itemName } from './items.js';
import { SKINS, EMOTES } from './character.js';

const $ = (id) => document.getElementById(id);
const PIECE_NAMES = { wall: 'Mur', floor: 'Sol', stairs: 'Rampe', roof: 'Cône' };
const SPLAT_RGB = [[110, 178, 76], [74, 148, 58], [232, 212, 156], [140, 136, 130], [244, 247, 251], [168, 130, 86], [205, 186, 92], [176, 172, 162]];

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class UI {
    constructor(controls, map) {
        this.ctl = controls;
        this.map = map;
        this.mm = $('minimap').getContext('2d');
        this.big = document.querySelector('#bigmap canvas').getContext('2d');
        this.bg = this.renderMapBackground(1200);
        this.toastTimer = null;
        this.lastInv = '';
        this.lastBuild = '';
        this.skin = 'knight';
        this.onSkin = null;
        this.onEmote = null;
        this.emoteOpen = false;
        this.arcs = new Map();
        this.lastSpec = '';
        this.lastVeh = '';
    }

    hideLoading() { $('loading').classList.add('hidden'); }
    showMenu() { $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); }
    showGame() { $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); }

    // ------------------------------------------------------------ menu

    menuStatus(text) { $('menu-status').textContent = text; }

    menuForm() {
        let mode = document.querySelector('.mode.active')?.dataset.mode ?? 'br';
        let priv = null;
        if (mode === 'priv') {
            mode = 'br';
            const join = document.querySelector('#priv-panel .ptab.on')?.dataset.p === 'join';
            priv = join ? { code: $('priv-code').value.trim().toUpperCase() }
                : { create: true, bots: Number($('priv-bots').value), lvl: $('priv-lvl').value };
        }
        return { name: $('name').value.trim(), skin: this.skin, mode, priv };
    }

    /** Menu : panneau des parties privées (créer / rejoindre avec un code). */
    initPrivatePanel() {
        const panel = $('priv-panel');
        const sync = () => {
            const on = document.querySelector('.mode.active')?.dataset.mode === 'priv';
            panel.classList.toggle('hidden', !on);
        };
        document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => setTimeout(sync, 0)));
        panel.querySelectorAll('.ptab').forEach((t) => t.addEventListener('click', () => {
            panel.querySelectorAll('.ptab').forEach((x) => x.classList.toggle('on', x === t));
            panel.querySelectorAll('[data-pp]').forEach((x) => x.classList.toggle('hidden', x.dataset.pp !== t.dataset.p));
        }));
        const bots = $('priv-bots');
        const out = $('priv-bots-n');
        bots.addEventListener('input', () => { out.textContent = bots.value; });
        out.textContent = bots.value;
        $('priv-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
        sync();
    }

    setFormValues({ name, skin }) {
        if (name) $('name').value = name;
        if (skin) this.selectSkin(skin);
    }

    populateSkins(names) {
        const box = $('skins');
        box.innerHTML = '';
        for (const [id, label] of Object.entries(names)) {
            const st = SKINS[id] ?? SKINS.knight;
            const g = st.glider;
            const d = document.createElement('div');
            d.className = 'skin';
            d.dataset.skin = id;
            d.innerHTML = `<div class="sw" style="background:url('img/skins/${id}.png') center/cover, linear-gradient(160deg, ${g[0]} 0 45%, ${g[1]} 45% 55%, ${g[2] ?? g[0]} 55% 100%)"></div><span>${esc(label)}</span>`;
            d.onclick = () => this.selectSkin(id);
            box.appendChild(d);
        }
        this.selectSkin(this.skin);
    }

    /**
     * « Créer une classe » : 2 armes et 1 équipement, largués aux points d'achat pour
     * LOADOUT_COST dollars. Le choix est enregistré dans le navigateur.
     */
    populateLoadout(lo) {
        const box = $('loadout');
        if (!box) return;
        this.loadout = { ...lo };
        const rows = [
            ['primary', 'Arme principale', LOADOUT_WEAPONS],
            ['secondary', 'Arme secondaire', LOADOUT_WEAPONS],
            ['tactical', 'Équipement', LOADOUT_GEAR],
        ];
        box.innerHTML = rows.map(([slot, label, list]) => `<div class="lrow"><span>${label}</span><div class="lopts">`
            + list.map((id) => `<button data-slot="${slot}" data-id="${id}" title="${esc(ITEM_NAMES[id] ?? id)}"`
                + ` class="${this.loadout[slot] === id ? 'sel' : ''}">${iconSvg(id, 26)}</button>`).join('')
            + '</div></div>').join('');
        box.onclick = (e) => {
            const b = e.target.closest('button[data-slot]');
            if (!b) return;
            this.loadout[b.dataset.slot] = b.dataset.id;
            this.populateLoadout(this.loadout);
            if (this.onLoadout) this.onLoadout({ ...this.loadout });
        };
    }

    selectSkin(id) {
        this.skin = id;
        document.querySelectorAll('.skin').forEach((el) => el.classList.toggle('sel', el.dataset.skin === id));
        if (this.onSkin) this.onSkin(id);
    }

    populateLeaderboard(list) {
        const ol = $('leaderboard');
        ol.innerHTML = '';
        if (!list.length) {
            ol.innerHTML = '<li>Personne encore : à vous de jouer !</li>';
            return;
        }
        for (const p of list.slice(0, 10)) {
            const li = document.createElement('li');
            li.textContent = `${p.name} — ${p.wins} victoire(s), ${p.kills} élimination(s)`;
            ol.appendChild(li);
        }
    }

    // ------------------------------------------------------------ HUD

    setVitals(hp, sh) {
        const set = (sel, v) => {
            const el = document.querySelector(`#vitals ${sel}`);
            el.querySelector('.fill').style.width = `${Math.max(0, Math.min(100, v))}%`;
            el.querySelector('.num').textContent = v;
        };
        set('.hp', hp);
        set('.sh', sh);
    }

    /** Barre d'objets (6 emplacements), nom de l'objet, argent, munitions. */
    setInventory(me, mode) {
        const unlimited = mode === 'train';
        const key = JSON.stringify([me.slots, me.sel, me.ammo, me.cash, unlimited]);
        if (key === this.lastInv) return;
        this.lastInv = key;
        const slots = $('slots');
        slots.innerHTML = '';
        me.slots.forEach((it, i) => {
            const d = document.createElement('div');
            d.className = `slot${i === me.sel ? ' sel' : ''}`;
            const r = it?.r ?? 0;
            if (it) {
                const c = RARITY_COLORS[r];
                d.style.background = `linear-gradient(160deg, ${c}ee, ${c}55)`;
                d.style.borderColor = i === me.sel ? '#fff' : `${c}`;
            }
            let n = '';
            if (it && it.mag !== undefined) n = it.mag;
            else if (it && it.n > 1) n = it.n;
            d.innerHTML = `<span class="k">${i + 1}</span>${it ? iconSvg(it.type) : ''}<span class="n">${n}</span>`;
            slots.appendChild(d);
        });
        const cur = me.slots[me.sel];
        const name = $('item-name');
        if (cur && cur.mag !== undefined) {
            const reserve = unlimited ? '∞' : me.ammo[WEAPON_AMMO[cur.type]];
            name.innerHTML = `<small style="color:${RARITY_COLORS[cur.r]}">${RARITY_NAMES[cur.r]}</small>${esc(ITEM_NAMES[cur.type])} <span class="ammo-count">${cur.mag}</span> / ${reserve}`;
        } else if (cur) {
            const info = ITEM_INFO[cur.type] ? ` <i class="info">${esc(ITEM_INFO[cur.type])}</i>` : '';
            name.innerHTML = `<small style="color:${RARITY_COLORS[cur.r]}">${RARITY_NAMES[cur.r]}</small>${esc(itemName(cur))}${info}`;
        } else {
            name.innerHTML = '';
        }
        this.cash(me.cash ?? 0);
        $('ammo').innerHTML = unlimited ? '' : ['light', 'medium', 'shells', 'heavy', 'rockets'].map((a) => `<div class="res${me.ammo[a] === 0 ? ' zero' : ''}" title="${AMMO_SHORT[a]}">${iconSvg(a, 24)}${me.ammo[a]}</div>`).join('');
    }

    /** PV du mur visé (barre sous le viseur), ou null pour la masquer. */
    pieceHp(pc) {
        const el = $('piecehp');
        if (!pc) {
            if (!el.classList.contains('hidden')) el.classList.add('hidden');
            this.lastPieceHp = null;
            return;
        }
        const hp = Math.max(0, Math.ceil(pc.hp));
        const k = Math.max(0, Math.min(1, hp / Math.max(1, pc.max)));
        const key = `${pc.key}:${hp}`;
        el.classList.remove('hidden');
        if (key === this.lastPieceHp) return;
        this.lastPieceHp = key;
        el.querySelector('.n').textContent = `${hp} / ${pc.max}`;
        el.querySelector('.bar i').style.width = `${k * 100}%`;
        el.classList.toggle('mid', k <= 0.6 && k > 0.3);
        el.classList.toggle('low', k <= 0.3);
    }

    setStatus({ alive, storm, kills, state }) {
        $('alive-count').textContent = alive;
        $('kill-count').textContent = kills;
        if (storm && storm.ph >= 0) {
            $('storm-time').textContent = fmtTime(storm.t);
            $('storm-msg').textContent = storm.ph >= 6 ? 'La tempête a tout recouvert' : storm.sh ? 'La tempête se rétrécit !' : 'La tempête va se rétrécir';
        } else {
            $('storm-time').textContent = '--:--';
            $('storm-msg').textContent = state === 'bus' ? 'Montgolfière en vol' : '';
        }
    }

    stormTint(on) { $('storm-tint').classList.toggle('on', on); }

    centerMsg(html) {
        const el = $('center-msg');
        if (el.innerHTML !== html) el.innerHTML = html;
    }

    /** Argent du joueur ; `delta` fait apparaître un « + 250 $ » flottant. */
    cash(total, delta = 0) {
        const el = $('cash');
        if (el) el.innerHTML = `<b>${(total ?? 0).toLocaleString('fr-FR')}</b> $`;
        if (!delta) return;
        const d = document.createElement('div');
        d.className = `gain${delta < 0 ? ' neg' : ''}`;
        d.style.top = `${($('gains').children.length % 3) * 22}px`;
        d.textContent = `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('fr-FR')} $`;
        $('gains').appendChild(d);
        setTimeout(() => d.remove(), 1200);
    }

    /** Message au-dessus d'un point d'achat. */
    promptShop(shop, cash, cost, key) {
        const ok = cash >= cost;
        this.prompt(`<span class="key">${esc(key)}</span> <b>${esc(shop.name)}</b> · Largage de votre classe `
            + `<span class="${ok ? 'ok' : 'ko'}">${cost.toLocaleString('fr-FR')} $</span>`
            + (ok ? '' : ` <i class="info">il vous manque ${(cost - cash).toLocaleString('fr-FR')} $</i>`));
    }

    /** Avertissement de noyade. */
    water(left) {
        const el = $('water');
        if (left === null || left > 6) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        el.textContent = left > 0 ? `Sortez de l'eau ! ${Math.ceil(left)} s` : 'Vous vous noyez !';
    }

    banner(text) {
        const el = $('banner');
        el.textContent = text;
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
    }

    prompt(html) {
        const el = $('prompt');
        if (!html) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
    }

    promptItem(it) {
        const plain = it.type === 'ammo' || it.type === 'cash';
        const color = plain ? '#ffffff' : RARITY_COLORS[it.r ?? 0];
        const r = plain ? '' : ` <small style="color:${color}">${RARITY_NAMES[it.r ?? 0]}</small>`;
        const icon = iconSvg(it.type === 'ammo' ? it.a : it.type, 28);
        this.prompt(`<span class="key">${this.ctl.key('interact')}</span>${icon} Ramasser <b>${esc(itemName(it))}</b>${r}`);
        $('prompt').style.borderLeftColor = color;
    }

    promptChest(c) {
        const k = c.k ?? (c.ammo ? 1 : 0);
        const txt = ['Ouvrir le coffre', 'Ouvrir la caisse de munitions', 'Ouvrir le lama', 'Ouvrir le largage'][k] ?? 'Ouvrir';
        this.prompt(`<span class="key">${this.ctl.key('interact')}</span> ${txt}`);
        $('prompt').style.borderLeftColor = ['#ffd23f', '#9bb36a', '#b88cff', '#5fb2ff'][k] ?? '#ffd23f';
    }

    toast(text) {
        const el = $('toast');
        el.textContent = text;
        el.classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
    }

    hint(text) { $('hint').innerHTML = text; }

    killfeed(html) {
        const el = $('killfeed');
        const d = document.createElement('div');
        d.innerHTML = html;
        el.appendChild(d);
        setTimeout(() => d.remove(), 5000);
        while (el.children.length > 6) el.firstChild.remove();
    }

    hitmarker(kind) {
        const el = $('hitmarker');
        el.className = kind;
        void el.offsetWidth;
        el.classList.add('hit');
    }

    flash() {
        const el = $('damage-vignette');
        el.classList.remove('on');
        void el.offsetWidth;
        el.classList.add('on');
    }

    /** Indicateur de direction des dégâts : un arc par attaquant, qui suit sa position. */
    damageFrom(angle, key = 'x') {
        let a = this.arcs.get(key);
        if (!a) {
            const el = document.createElement('div');
            el.className = 'arc';
            $('dmg-arcs').appendChild(el);
            a = { el };
            this.arcs.set(key, a);
        }
        a.t0 = performance.now();
        a.ang = angle;
        a.el.style.transform = `rotate(${angle}rad)`;
        a.el.style.opacity = '1';
    }

    /** angleOf(key) : angle actuel vers l'attaquant (ou null s'il n'est plus visible). */
    tickArcs(angleOf) {
        const now = performance.now();
        for (const [key, a] of this.arcs) {
            const age = now - a.t0;
            if (age > 1800) { a.el.remove(); this.arcs.delete(key); continue; }
            const ang = angleOf(key);
            if (ang !== null && ang !== undefined) a.ang = ang;
            a.el.style.transform = `rotate(${a.ang}rad)`;
            a.el.style.opacity = String(Math.min(1, 1.6 * (1 - age / 1800)));
        }
    }

    // ------------------------------------------------------------ danses

    emoteMenu(open) {
        const el = $('emotes');
        this.emoteOpen = open;
        if (!open) { el.classList.add('hidden'); return; }
        el.innerHTML = `<h3>Danses</h3>${EMOTES.map((e, i) => {
            const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
            return `<button data-e="${i}" style="left:${50 + Math.cos(a) * 38}%;top:${50 + Math.sin(a) * 38}%"><span class="key">${i + 1}</span>${esc(e[1])}</button>`;
        }).join('')}<p>Touches 1 à ${EMOTES.length} · ${esc(this.ctl.key('emote'))} : fermer</p>`;
        el.onclick = (ev) => {
            const b = ev.target.closest('button');
            if (b) this.onEmote?.(Number(b.dataset.e));
        };
        el.classList.remove('hidden');
    }

    // ------------------------------------------------------------ spectateur, pause, véhicule, FPS

    spectator(info, btns) {
        const el = $('spectate');
        if (!info) { el.classList.add('hidden'); this.lastSpec = ''; return; }
        const key = JSON.stringify(info);
        if (key !== this.lastSpec) {
            this.lastSpec = key;
            el.innerHTML = `<div class="who"><small>SPECTATEUR</small><b>${esc(info.name)}</b><span>${info.kills} élimination(s) · ${info.alive} en vie</span></div>
                <div class="tip"><span class="key">Clic</span> joueur suivant</div>
                <div class="btns"><button data-b="again">Rejouer</button><button data-b="menu" class="alt">Menu</button></div>`;
            el.querySelector('[data-b=again]').onclick = btns.onAgain;
            el.querySelector('[data-b=menu]').onclick = btns.onMenu;
        }
        el.classList.remove('hidden');
    }

    pause(open, opts = {}) {
        const el = $('pause');
        if (!open) { el.classList.add('hidden'); return; }
        const pv = opts.priv;
        const host = pv && opts.isHost && opts.lobby;
        el.innerHTML = `<div class="box"><h2>Pause</h2>
            ${pv ? `<div class="pcode">Partie privée · code <b>${esc(pv.code)}</b> <button data-b="copy" class="small">Copier</button></div>` : ''}
            ${host ? `<div class="host"><label>Bots <input type="range" id="pz-bots" min="0" max="29" value="${pv.bots}"><b>${pv.bots}</b></label>
                <label>Niveau <select id="pz-lvl">${['facile', 'normal', 'difficile'].map((l) => `<option${l === pv.lvl ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
                ${pv.go ? '<p>Départ en cours…</p>' : '<button data-b="start" class="play">LANCER LA PARTIE</button>'}</div>` : ''}
            <button data-b="resume" class="play">Reprendre</button>
            <button data-b="settings">Paramètres</button>
            <button data-b="quit" class="alt">Quitter la partie</button></div>`;
        const on = (b, f) => { const x = el.querySelector(`[data-b=${b}]`); if (x) x.onclick = f; };
        on('resume', opts.onResume);
        on('settings', opts.onSettings);
        on('quit', opts.onQuit);
        on('start', opts.onStart);
        on('copy', () => { navigator.clipboard?.writeText(pv.code); this.toast('Code copié !'); });
        const bots = el.querySelector('#pz-bots');
        if (bots) bots.oninput = () => { bots.nextElementSibling.textContent = bots.value; opts.onCfg?.({ bots: Number(bots.value) }); };
        const lvl = el.querySelector('#pz-lvl');
        if (lvl) lvl.onchange = () => opts.onCfg?.({ lvl: lvl.value });
        el.classList.remove('hidden');
    }

    pauseOpen() { return !$('pause').classList.contains('hidden'); }

    vehicle(hp, max = 800) {
        const el = $('veh-hp');
        if (hp === null || hp === undefined) { el.classList.add('hidden'); return; }
        const key = `${hp}`;
        if (key !== this.lastVeh) {
            this.lastVeh = key;
            el.innerHTML = `<span>Véhicule</span><div class="bar"><i style="width:${Math.max(0, Math.min(100, (hp / max) * 100))}%"></i></div><b>${hp}</b>`;
            el.classList.toggle('low', hp < max * 0.3);
        }
        el.classList.remove('hidden');
    }

    fps(v) {
        const el = $('fps');
        if (v === null) { el.classList.add('hidden'); return; }
        el.textContent = `${v} i/s`;
        el.classList.remove('hidden');
    }

    privBadge(pv, isHost, lobby) {
        const el = $('priv-badge');
        if (!pv || !lobby) { el.classList.add('hidden'); return; }
        const html = `Partie privée · code <b>${esc(pv.code)}</b> · ${pv.bots} bot(s) ${esc(pv.lvl)}${isHost && !pv.go ? ` · <span class="key">Entrée</span> lancer · <span class="key">Échap</span> réglages` : pv.go ? ' · départ imminent' : ' · en attente de l\'hôte'}`;
        if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
        el.classList.remove('hidden');
    }

    progress(frac, label) {
        const el = $('progress');
        if (frac === null) {
            el.classList.remove('on');
            $('progress-label').textContent = '';
            return;
        }
        el.classList.add('on');
        el.querySelector('.fg').style.strokeDashoffset = String(151 * (1 - Math.min(1, frac)));
        $('progress-label').textContent = label;
    }

    crosshair(kind, spreadPx) {
        const el = $('crosshair');
        el.className = kind;
        el.style.setProperty('--s', `${Math.round(spreadPx)}px`);
    }

    scope(on) { $('scope').classList.toggle('on', on); }

    setPing(ms) { $('ping').textContent = `${ms} ms`; }

    // ------------------------------------------------------------ cartes

    renderMapBackground(S) {
        const info = mapInfo();
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        const img = g.createImageData(S, S);
        const n = info.n;
        const hAt = (fx, fz) => {
            const i = Math.max(0, Math.min(n - 1, Math.round(fx)));
            const j = Math.max(0, Math.min(n - 1, Math.round(fz)));
            return [info.h[j * n + i], info.splat[j * n + i]];
        };
        for (let py = 0; py < S; py++) {
            for (let px = 0; px < S; px++) {
                const fx = (px / S) * (n - 1);
                const fz = (py / S) * (n - 1);
                const [h, s] = hAt(fx, fz);
                const [h2] = hAt(fx + 1, fz + 1);
                let rgb;
                if (h < WATER_Y) {
                    const d = Math.max(0, Math.min(1, (WATER_Y - h) / 10));
                    rgb = [60 - d * 30, 170 - d * 70, 210 - d * 40];
                } else {
                    rgb = SPLAT_RGB[s];
                }
                const shade = Math.max(0.65, Math.min(1.3, 1 - (h2 - h) * 0.12));
                const k = (py * S + px) * 4;
                img.data[k] = rgb[0] * shade;
                img.data[k + 1] = rgb[1] * shade;
                img.data[k + 2] = rgb[2] * shade;
                img.data[k + 3] = 255;
            }
        }
        g.putImageData(img, 0, 0);
        const toPx = (x) => ((x + info.half) / (2 * info.half)) * S;
        // bâtiments
        g.fillStyle = 'rgba(120,70,55,0.9)';
        for (const [type, gx, gy, gz] of this.map.pieces) {
            if (type === 'floor' && gy === 0) g.fillRect(toPx(gx * CELL), toPx(gz * CELL), (CELL / 1000) * S + 0.5, (CELL / 1000) * S + 0.5);
        }
        this.toPx = toPx;
        return c;
    }

    /** Minimap : zoom autour du joueur, nord en haut. */
    drawMinimap({ me, storm, bal, path, drops }) {
        const g = this.mm;
        const W = g.canvas.width;
        const S = this.bg.width;
        const view = 260;   // mètres affichés
        const k = S / 1000;
        const sx = (me.x + 500) * k - (view * k) / 2;
        const sy = (me.z + 500) * k - (view * k) / 2;
        g.fillStyle = '#1d5f80';
        g.fillRect(0, 0, W, W);
        g.drawImage(this.bg, sx, sy, view * k, view * k, 0, 0, W, W);
        const toMini = (x, z) => [((x - me.x) / view + 0.5) * W, ((z - me.z) / view + 0.5) * W];
        this.drawStorm(g, storm, toMini, W / view, W);
        if (path) this.drawPath(g, path, toMini);
        if (bal) {
            const [bx, by] = toMini(bal.p[0], bal.p[2]);
            g.fillStyle = '#ffd23f';
            g.beginPath(); g.arc(bx, by, 9, 0, 7); g.fill();
        }
        g.font = 'bold 18px system-ui';
        g.textAlign = 'center';
        for (const p of this.map.pois) {
            const [x, y] = toMini(p.x, p.z);
            if (x < -60 || y < -20 || x > W + 60 || y > W + 20) continue;
            g.lineWidth = 4;
            g.strokeStyle = 'rgba(0,0,0,0.7)';
            g.strokeText(p.name.toUpperCase(), x, y);
            g.fillStyle = '#fff';
            g.fillText(p.name.toUpperCase(), x, y);
        }
        for (const d of drops ?? []) {
            const [x, y] = toMini(d.x, d.z);
            this.drawDrop(g, Math.max(10, Math.min(W - 10, x)), Math.max(10, Math.min(W - 10, y)), 11);
        }
        this.drawMe(g, W / 2, W / 2, me.yaw, 13);
    }

    drawDrop(g, x, y, s) {
        g.fillStyle = '#2f6fd8';
        g.strokeStyle = '#fff';
        g.lineWidth = 3;
        g.beginPath();
        g.rect(x - s, y - s * 0.8, s * 2, s * 1.6);
        g.fill();
        g.stroke();
        g.fillStyle = '#ffd34f';
        g.fillRect(x - 2, y - s * 0.8, 4, s * 1.6);
    }

    drawStorm(g, storm, toPx, scale, W) {
        if (!storm) return;
        const [cx, cy] = toPx(storm.x, storm.z);
        g.save();
        g.beginPath();
        g.rect(0, 0, W, W);
        g.arc(cx, cy, Math.max(0, storm.r * scale), 0, Math.PI * 2, true);
        g.fillStyle = 'rgba(130, 50, 210, 0.42)';
        g.fill('evenodd');
        g.strokeStyle = '#c38bff';
        g.lineWidth = 3;
        g.beginPath(); g.arc(cx, cy, Math.max(0, storm.r * scale), 0, 7); g.stroke();
        if (storm.ph >= 0 && storm.nr < storm.r - 1) {
            const [nx, ny] = toPx(storm.nx, storm.nz);
            g.strokeStyle = '#ffffff';
            g.setLineDash([8, 6]);
            g.beginPath(); g.arc(nx, ny, Math.max(0, storm.nr * scale), 0, 7); g.stroke();
            g.setLineDash([]);
        }
        g.restore();
    }

    drawPath(g, path, toPx) {
        const [ax, ay] = toPx(path.a[0], path.a[1]);
        const [bx, by] = toPx(path.b[0], path.b[1]);
        g.save();
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 3;
        g.setLineDash([10, 8]);
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
        g.restore();
    }

    drawMe(g, x, y, yaw, size) {
        g.save();
        g.translate(x, y);
        g.rotate(-yaw);
        g.fillStyle = '#ffd23f';
        g.strokeStyle = '#000';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, -size);
        g.lineTo(size * 0.7, size * 0.7);
        g.lineTo(0, size * 0.35);
        g.lineTo(-size * 0.7, size * 0.7);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
    }

    toggleBigMap(force) {
        const el = $('bigmap');
        const show = force ?? el.classList.contains('hidden');
        el.classList.toggle('hidden', !show);
        return show;
    }

    drawBigMap({ me, storm, bal, path, drops }) {
        const g = this.big;
        const W = g.canvas.width;
        g.drawImage(this.bg, 0, 0, W, W);
        const toPx = (x, z) => [((x + 500) / 1000) * W, ((z + 500) / 1000) * W];
        this.drawStorm(g, storm, toPx, W / 1000, W);
        if (path) this.drawPath(g, path, toPx);
        if (bal) {
            const [bx, by] = toPx(bal.p[0], bal.p[2]);
            g.fillStyle = '#ffd23f';
            g.beginPath(); g.arc(bx, by, 10, 0, 7); g.fill();
        }
        g.font = 'bold 20px system-ui';
        g.textAlign = 'center';
        for (const p of this.map.pois) {
            const [x, y] = toPx(p.x, p.z);
            g.lineWidth = 5;
            g.strokeStyle = 'rgba(0,0,0,0.75)';
            g.strokeText(p.name.toUpperCase(), x, y - 12);
            g.fillStyle = '#fff';
            g.fillText(p.name.toUpperCase(), x, y - 12);
        }
        for (const d of drops ?? []) {
            const [x, y] = toPx(d.x, d.z);
            this.drawDrop(g, x, y, 12);
        }
        if (me) {
            const [x, y] = toPx(me.x, me.z);
            this.drawMe(g, x, y, me.yaw, 16);
        }
    }

    toggleHelp() {
        const el = $('help');
        const K = (a) => `<span class="key">${esc(this.ctl.key(a))}</span>`;
        el.innerHTML = `<h2>Commandes</h2><div class="grid">
            <div>${K('fwd')}${K('left')}${K('back')}${K('right')} se déplacer</div><div>${K('jump')} sauter / planeur</div>
            <div>${K('sprint')} sprinter</div><div>${K('crouch')} s'accroupir (en courant : glissade)</div>
            <div><span class="key">Clic gauche</span> tirer / frapper / lancer</div><div><span class="key">Clic droit</span> viser</div>
            <div><span class="key">1</span>…<span class="key">6</span> / molette : objets</div><div>${K('reload')} recharger</div>
            <div>${K('interact')} ramasser, ouvrir, conduire, porte</div><div>${K('drop')} jeter l'objet tenu</div>
            <div>${K('melee')} coup de crosse (10 PV)</div><div>${K('fpv')} vue 1ʳᵉ / 3ᵉ personne</div>
            <div>${K('interact')} point d'achat : largage de votre classe</div><div>${K('emote')} danses</div>
            <div>${K('map')} carte · ${K('help')} aide</div><div><span class="key">Échap</span> pause et paramètres</div>
        </div><p class="note">Les touches se changent dans Paramètres → Touches.</p>`;
        el.classList.toggle('hidden');
    }

    endscreen({ title, place, sub, win, onAgain, onMenu, onSpectate }) {
        const el = $('endscreen');
        el.innerHTML = '';
        const h = document.createElement('h2');
        h.textContent = title;
        if (!win) h.className = 'lose';
        el.appendChild(h);
        if (place) {
            const p = document.createElement('div');
            p.className = 'place';
            p.textContent = place;
            el.appendChild(p);
        }
        const s = document.createElement('p');
        s.textContent = sub;
        el.appendChild(s);
        const btns = document.createElement('div');
        btns.className = 'btns';
        const mk = (txt, fn, alt) => {
            const b = document.createElement('button');
            b.textContent = txt;
            if (alt) b.className = 'alt';
            b.onclick = fn;
            btns.appendChild(b);
        };
        if (onAgain) mk('Rejouer', onAgain);
        if (onSpectate) mk('Regarder la partie', onSpectate, true);
        if (onMenu) mk('Menu', onMenu, true);
        el.appendChild(btns);
        el.classList.remove('hidden');
    }

    hideEnd() { $('endscreen').classList.add('hidden'); }
}

export { PIECE_NAMES };
