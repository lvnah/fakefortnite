// Textures procédurales (canvas) : rien à télécharger.
// Une tuile de texture = une face de pièce (4 m x 4 m), donc les cadres tombent pile sur la grille.
import * as THREE from 'three';

const cache = new Map();
const SZ = 512;

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function canvas(w = SZ, h = SZ) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')];
}

function toTexture(c, repeat = 1, srgb = true) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

/** Grain : petites taches pour casser l'aspect « plastique ». */
function grain(g, w, h, amount, seed, dark = true) {
    const r = rng(seed);
    for (let i = 0; i < w * h * 0.02; i++) {
        const a = r() * amount;
        g.fillStyle = dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
        g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2);
    }
}

function shade(hex, f) {
    const c = new THREE.Color(hex);
    c.multiplyScalar(f);
    return `#${c.getHexString()}`;
}

const MAKERS = {
    // ---------- constructions des joueurs (style Fortnite)
    wood(g) {
        const r = rng(3);
        g.fillStyle = '#8a5a30';
        g.fillRect(0, 0, SZ, SZ);
        const rows = 8;
        for (let i = 0; i < rows; i++) {
            const y = (i * SZ) / rows;
            const base = ['#b07a45', '#a56f3c', '#b98552', '#9c6636'][i % 4];
            g.fillStyle = base;
            g.fillRect(0, y + 2, SZ, SZ / rows - 4);
            for (let k = 0; k < 14; k++) {
                g.strokeStyle = `rgba(70,40,15,${0.12 + r() * 0.15})`;
                g.lineWidth = 1 + r() * 1.5;
                g.beginPath();
                const yy = y + 6 + r() * (SZ / rows - 12);
                g.moveTo(0, yy);
                g.bezierCurveTo(SZ * 0.3, yy + (r() - 0.5) * 6, SZ * 0.6, yy + (r() - 0.5) * 6, SZ, yy);
                g.stroke();
            }
            g.fillStyle = 'rgba(40,22,8,0.55)';
            g.fillRect(0, y, SZ, 3);
        }
        // cadre et croisillon
        g.fillStyle = '#6b4222';
        const f = 34;
        g.fillRect(0, 0, SZ, f); g.fillRect(0, SZ - f, SZ, f); g.fillRect(0, 0, f, SZ); g.fillRect(SZ - f, 0, f, SZ);
        g.save();
        g.translate(SZ / 2, SZ / 2);
        g.rotate(Math.atan2(SZ - 2 * f, SZ - 2 * f));
        g.fillRect(-SZ * 0.62, -f / 2.4, SZ * 1.24, f / 1.2);
        g.restore();
        g.strokeStyle = 'rgba(30,15,5,0.6)';
        g.lineWidth = 3;
        g.strokeRect(f, f, SZ - 2 * f, SZ - 2 * f);
        g.fillStyle = '#d9d2c4';
        for (const [x, y] of [[f / 2, f / 2], [SZ - f / 2, f / 2], [f / 2, SZ - f / 2], [SZ - f / 2, SZ - f / 2], [SZ / 2, f / 2], [SZ / 2, SZ - f / 2]]) {
            g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
        }
        grain(g, SZ, SZ, 0.15, 5);
    },
    stone(g) {
        const r = rng(11);
        g.fillStyle = '#5c5a57';
        g.fillRect(0, 0, SZ, SZ);
        const rows = 8;
        const bh = SZ / rows;
        for (let i = 0; i < rows; i++) {
            const off = (i % 2) * 0.5;
            for (let k = -1; k < 4; k++) {
                const x = (k + off) * (SZ / 3.5);
                const v = 0.8 + r() * 0.35;
                g.fillStyle = shade(0x9d9a94, v);
                g.fillRect(x + 4, i * bh + 4, SZ / 3.5 - 8, bh - 8);
                g.fillStyle = 'rgba(255,255,255,0.12)';
                g.fillRect(x + 4, i * bh + 4, SZ / 3.5 - 8, 4);
                g.fillStyle = 'rgba(0,0,0,0.18)';
                g.fillRect(x + 4, i * bh + bh - 8, SZ / 3.5 - 8, 4);
            }
        }
        g.strokeStyle = '#46443f';
        g.lineWidth = 16;
        g.strokeRect(0, 0, SZ, SZ);
        grain(g, SZ, SZ, 0.25, 7);
        grain(g, SZ, SZ, 0.12, 8, false);
    },
    metal(g) {
        const r = rng(17);
        const grd = g.createLinearGradient(0, 0, SZ, 0);
        for (let i = 0; i <= 16; i++) grd.addColorStop(i / 16, i % 2 ? '#7d8894' : '#a8b3bf');
        g.fillStyle = grd;
        g.fillRect(0, 0, SZ, SZ);
        g.fillStyle = 'rgba(0,0,0,0.15)';
        for (let i = 0; i < 3; i++) g.fillRect(0, (SZ / 3) * i, SZ, 6);
        // bandes jaunes et noires en bas
        for (let i = 0; i < 12; i++) {
            g.fillStyle = i % 2 ? '#2a2a2a' : '#e6b422';
            g.beginPath();
            const x = i * (SZ / 10);
            g.moveTo(x, SZ - 40); g.lineTo(x + SZ / 10, SZ - 40); g.lineTo(x + SZ / 20, SZ); g.lineTo(x - SZ / 20, SZ); g.fill();
        }
        g.strokeStyle = '#4b535c';
        g.lineWidth = 20;
        g.strokeRect(0, 0, SZ, SZ);
        g.fillStyle = '#cfd6dd';
        for (let i = 0; i < 9; i++) {
            for (const y of [14, SZ - 54]) { g.beginPath(); g.arc(14 + i * ((SZ - 28) / 8), y, 5, 0, 7); g.fill(); }
        }
        for (let i = 0; i < 40; i++) {
            g.fillStyle = `rgba(120,70,30,${r() * 0.25})`;
            g.beginPath(); g.arc(r() * SZ, r() * SZ, 2 + r() * 10, 0, 7); g.fill();
        }
        grain(g, SZ, SZ, 0.12, 9);
    },
    // ---------- façades (en niveaux de gris : la couleur vient du matériau)
    siding(g) {
        g.fillStyle = '#e8e8e8';
        g.fillRect(0, 0, SZ, SZ);
        const rows = 14;
        for (let i = 0; i < rows; i++) {
            const y = (i * SZ) / rows;
            const grd = g.createLinearGradient(0, y, 0, y + SZ / rows);
            grd.addColorStop(0, '#ffffff');
            grd.addColorStop(0.85, '#d9d9d9');
            grd.addColorStop(1, '#9a9a9a');
            g.fillStyle = grd;
            g.fillRect(0, y, SZ, SZ / rows);
        }
        g.fillStyle = '#f7f7f7';
        g.fillRect(0, 0, 18, SZ); g.fillRect(SZ - 18, 0, 18, SZ);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(18, 0, 3, SZ); g.fillRect(SZ - 21, 0, 3, SZ);
        grain(g, SZ, SZ, 0.08, 21);
    },
    brick(g) {
        const r = rng(23);
        g.fillStyle = '#d8d0c4';
        g.fillRect(0, 0, SZ, SZ);
        const rows = 22;
        const bh = SZ / rows;
        for (let i = 0; i < rows; i++) {
            const off = (i % 2) * 0.5;
            for (let k = -1; k < 9; k++) {
                const x = (k + off) * (SZ / 8);
                g.fillStyle = shade(0xa8442f, 0.75 + r() * 0.4);
                g.fillRect(x + 2, i * bh + 2, SZ / 8 - 4, bh - 4);
            }
        }
        grain(g, SZ, SZ, 0.2, 25);
    },
    plaster(g) {
        g.fillStyle = '#efe9dd';
        g.fillRect(0, 0, SZ, SZ);
        grain(g, SZ, SZ, 0.12, 31);
        grain(g, SZ, SZ, 0.2, 32, false);
        // colombages
        g.fillStyle = '#5a3a22';
        g.fillRect(0, 0, SZ, 22); g.fillRect(0, SZ - 22, SZ, 22); g.fillRect(0, 0, 22, SZ); g.fillRect(SZ - 22, 0, 22, SZ);
        g.fillRect(SZ / 2 - 10, 0, 20, SZ);
    },
    barn(g) {
        const r = rng(41);
        for (let i = 0; i < 12; i++) {
            g.fillStyle = shade(0xa52a22, 0.8 + r() * 0.3);
            g.fillRect((i * SZ) / 12, 0, SZ / 12, SZ);
            g.fillStyle = 'rgba(0,0,0,0.35)';
            g.fillRect((i * SZ) / 12, 0, 3, SZ);
        }
        g.fillStyle = '#f4efe6';
        g.fillRect(0, 0, SZ, 18); g.fillRect(0, SZ - 18, SZ, 18); g.fillRect(0, 0, 18, SZ); g.fillRect(SZ - 18, 0, 18, SZ);
        grain(g, SZ, SZ, 0.2, 43);
    },
    logs(g) {
        const r = rng(47);
        const rows = 9;
        for (let i = 0; i < rows; i++) {
            const y = (i * SZ) / rows;
            const grd = g.createLinearGradient(0, y, 0, y + SZ / rows);
            const c = shade(0x8b5a2b, 0.85 + r() * 0.3);
            grd.addColorStop(0, shade(0x8b5a2b, 0.5));
            grd.addColorStop(0.3, c);
            grd.addColorStop(0.7, c);
            grd.addColorStop(1, shade(0x8b5a2b, 0.45));
            g.fillStyle = grd;
            g.fillRect(0, y, SZ, SZ / rows);
        }
        grain(g, SZ, SZ, 0.25, 49);
    },
    corrugated(g) {
        const grd = g.createLinearGradient(0, 0, SZ, 0);
        for (let i = 0; i <= 24; i++) grd.addColorStop(i / 24, i % 2 ? '#c9c9c9' : '#f2f2f2');
        g.fillStyle = grd;
        g.fillRect(0, 0, SZ, SZ);
        const r = rng(53);
        for (let i = 0; i < 60; i++) {
            g.fillStyle = `rgba(140,80,30,${r() * 0.3})`;
            g.beginPath(); g.arc(r() * SZ, r() * SZ, 2 + r() * 14, 0, 7); g.fill();
        }
    },
    shingles(g) {
        const r = rng(59);
        g.fillStyle = '#7a7a7a';
        g.fillRect(0, 0, SZ, SZ);
        const rows = 12;
        const h = SZ / rows;
        for (let i = 0; i < rows; i++) {
            const off = (i % 2) * 0.5;
            for (let k = -1; k < 9; k++) {
                const x = (k + off) * (SZ / 8);
                const v = 0.8 + r() * 0.3;
                g.fillStyle = shade(0xd0d0d0, v);
                g.beginPath();
                g.moveTo(x + 2, i * h);
                g.lineTo(x + SZ / 8 - 2, i * h);
                g.lineTo(x + SZ / 8 - 2, i * h + h * 0.8);
                g.quadraticCurveTo(x + SZ / 16, i * h + h * 1.05, x + 2, i * h + h * 0.8);
                g.fill();
            }
            g.fillStyle = 'rgba(0,0,0,0.3)';
            g.fillRect(0, i * h, SZ, 3);
        }
    },
    parquet(g) {
        const r = rng(61);
        g.fillStyle = '#8a5a30';
        g.fillRect(0, 0, SZ, SZ);
        const rows = 10;
        const h = SZ / rows;
        for (let i = 0; i < rows; i++) {
            const off = (i % 2) * (SZ / 6);
            for (let k = -1; k < 4; k++) {
                const x = k * (SZ / 3) + off;
                g.fillStyle = shade(0xb8854e, 0.8 + r() * 0.35);
                g.fillRect(x + 1, i * h + 1, SZ / 3 - 2, h - 2);
                g.fillStyle = 'rgba(255,255,255,0.08)';
                g.fillRect(x + 1, i * h + 1, SZ / 3 - 2, 3);
            }
        }
        grain(g, SZ, SZ, 0.15, 63);
    },
    concrete(g) {
        g.fillStyle = '#a9a9a4';
        g.fillRect(0, 0, SZ, SZ);
        grain(g, SZ, SZ, 0.18, 67);
        grain(g, SZ, SZ, 0.12, 68, false);
        g.strokeStyle = 'rgba(0,0,0,0.25)';
        g.lineWidth = 3;
        g.strokeRect(0, 0, SZ, SZ);
    },
    // ---------- porte : planches verticales, cadre, poignée à droite
    door(g) {
        const r = rng(81);
        g.fillStyle = '#6b4424';
        g.fillRect(0, 0, SZ, SZ);
        const n = 5;
        for (let i = 0; i < n; i++) {
            g.fillStyle = shade(0x9a6436, 0.82 + r() * 0.3);
            g.fillRect((i * SZ) / n + 3, 0, SZ / n - 6, SZ);
        }
        g.fillStyle = '#4e2f16';
        g.fillRect(0, 0, SZ, 22);
        g.fillRect(0, SZ - 22, SZ, 22);
        g.fillRect(0, SZ * 0.47, SZ, 18);
        g.fillRect(0, 0, 18, SZ);
        g.fillRect(SZ - 18, 0, 18, SZ);
        grain(g, SZ, SZ, 0.18, 83);
        g.fillStyle = '#e0b030';
        g.beginPath(); g.arc(SZ * 0.86, SZ * 0.5, 14, 0, 7); g.fill();
        g.fillStyle = '#8a6a10';
        g.beginPath(); g.arc(SZ * 0.86, SZ * 0.5, 6, 0, 7); g.fill();
    },
    // ---------- planches claires et neutres (multipliées par la couleur : coffres, caisses)
    planks(g) {
        const r = rng(91);
        g.fillStyle = '#d8d8d8';
        g.fillRect(0, 0, SZ, SZ);
        const rows = 6;
        for (let i = 0; i < rows; i++) {
            const v = 200 + Math.floor(r() * 55);
            g.fillStyle = `rgb(${v},${v},${v})`;
            g.fillRect(0, (i * SZ) / rows + 3, SZ, SZ / rows - 6);
            g.fillStyle = 'rgba(0,0,0,0.35)';
            g.fillRect(0, (i * SZ) / rows, SZ, 3);
            for (let k = 0; k < 3; k++) {
                g.fillStyle = 'rgba(0,0,0,0.5)';
                g.beginPath(); g.arc(20 + r() * (SZ - 40), (i + 0.5) * (SZ / rows), 3, 0, 7); g.fill();
            }
        }
        grain(g, SZ, SZ, 0.2, 93);
    },
    // ---------- terrain : détail en niveaux de gris, très répété
    ground(g) {
        const r = rng(71);
        g.fillStyle = '#c8c8c8';
        g.fillRect(0, 0, SZ, SZ);
        for (let i = 0; i < 9000; i++) {
            const v = 150 + r() * 105;
            g.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.4})`;
            const x = r() * SZ;
            const y = r() * SZ;
            g.fillRect(x, y, 1 + r() * 2, 2 + r() * 5);
        }
        for (let i = 0; i < 160; i++) {
            const v = 120 + r() * 60;
            g.fillStyle = `rgba(${v},${v},${v},0.18)`;
            g.beginPath(); g.arc(r() * SZ, r() * SZ, 6 + r() * 26, 0, 7); g.fill();
        }
    },
};

/** Texture nommée (créée une seule fois). */
export function tex(name) {
    if (cache.has(name)) return cache.get(name);
    const [c, g] = canvas();
    MAKERS[name](g);
    const t = toTexture(c);
    cache.set(name, t);
    return t;
}

/** Visage dessiné sur une tête sphérique (u = 0.25 = avant). */
export function faceTexture(skinHex, kind = 'normal') {
    const key = `face:${skinHex}:${kind}`;
    if (cache.has(key)) return cache.get(key);
    const [c, g] = canvas(512, 256);
    g.fillStyle = `#${new THREE.Color(skinHex).getHexString()}`;
    g.fillRect(0, 0, 512, 256);
    const cx = 128;
    const eyeY = 118;
    if (kind !== 'none') {
        const eye = (x) => {
            g.fillStyle = kind === 'zombie' ? '#f4f0a0' : '#ffffff';
            g.beginPath(); g.ellipse(x, eyeY, 15, 18, 0, 0, 7); g.fill();
            g.fillStyle = kind === 'zombie' ? '#b01818' : '#2b2b2b';
            g.beginPath(); g.ellipse(x + 2, eyeY + 3, 8, 10, 0, 0, 7); g.fill();
            g.fillStyle = '#ffffff';
            g.beginPath(); g.arc(x + 5, eyeY - 2, 3, 0, 7); g.fill();
        };
        if (kind !== 'patch') eye(cx - 30); else {
            g.fillStyle = '#111';
            g.beginPath(); g.ellipse(cx - 30, eyeY, 18, 16, 0, 0, 7); g.fill();
            g.fillRect(cx - 150, eyeY - 30, 260, 6);
        }
        eye(cx + 30);
        g.strokeStyle = kind === 'zombie' ? '#3a4a2a' : '#4a2e1a';
        g.lineWidth = 6;
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(cx - 46, eyeY - 30); g.lineTo(cx - 16, eyeY - 26); g.stroke();
        g.beginPath(); g.moveTo(cx + 16, eyeY - 26); g.lineTo(cx + 46, eyeY - 30); g.stroke();
        g.strokeStyle = kind === 'zombie' ? '#3d1b1b' : '#8a3c2c';
        g.lineWidth = 5;
        g.beginPath();
        if (kind === 'zombie') { g.moveTo(cx - 22, eyeY + 52); g.lineTo(cx - 8, eyeY + 46); g.lineTo(cx + 6, eyeY + 54); g.lineTo(cx + 22, eyeY + 46); }
        else g.arc(cx, eyeY + 32, 20, 0.25 * Math.PI, 0.75 * Math.PI);
        g.stroke();
        if (kind === 'zombie') {
            g.strokeStyle = '#2d3a20';
            g.lineWidth = 3;
            g.beginPath(); g.moveTo(cx + 40, eyeY - 60); g.lineTo(cx + 60, eyeY + 10);
            for (let i = 0; i < 4; i++) { g.moveTo(cx + 44 + i * 5, eyeY - 48 + i * 16); g.lineTo(cx + 58 + i * 5, eyeY - 52 + i * 16); }
            g.stroke();
        }
        g.fillStyle = 'rgba(255,120,120,0.25)';
        g.beginPath(); g.arc(cx - 50, eyeY + 28, 14, 0, 7); g.arc(cx + 50, eyeY + 28, 14, 0, 7); g.fill();
    }
    const t = toTexture(c);
    t.wrapS = THREE.ClampToEdgeWrapping;
    cache.set(key, t);
    return t;
}

/** Bandes verticales colorées (montgolfière, planeurs). */
export function stripes(colors, n = 12, w = 512, h = 256) {
    const key = `stripes:${colors.join(',')}:${n}`;
    if (cache.has(key)) return cache.get(key);
    const [c, g] = canvas(w, h);
    for (let i = 0; i < n; i++) {
        g.fillStyle = colors[i % colors.length];
        g.fillRect((i * w) / n, 0, w / n + 1, h);
    }
    g.fillStyle = 'rgba(255,255,255,0.15)';
    for (let i = 0; i < n; i++) g.fillRect((i * w) / n, 0, 3, h);
    const t = toTexture(c);
    cache.set(key, t);
    return t;
}

/** Halo radial (lueurs, rayons de loot). */
export function glowTexture() {
    if (cache.has('glow')) return cache.get('glow');
    const [c, g] = canvas(128, 128);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    cache.set('glow', t);
    return t;
}

/** Dégradé vertical pour les rayons lumineux. */
export function beamTexture() {
    if (cache.has('beam')) return cache.get('beam');
    const [c, g] = canvas(16, 128);
    const grd = g.createLinearGradient(0, 128, 0, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 16, 128);
    const t = new THREE.CanvasTexture(c);
    cache.set('beam', t);
    return t;
}

export function sprayTexture(text, color = '#ffffff', font = 'bold 64px system-ui') {
    const [c, g] = canvas(512, 128);
    g.font = font;
    g.textAlign = 'center';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(text, 256, 88);
    g.fillStyle = color;
    g.fillText(text, 256, 88);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
