// Test de parité JS (shared.js) / PHP (engine.php) : mêmes entrées => mêmes positions.
// Usage : node tools/parity.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as S from '../public/js/shared.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/map/island.json'), 'utf8'));
S.setMap(map);

// pièces de la carte + quelques constructions de joueur (rampes 4 sens, cônes, murs)
const pieces = [];
const cols = map.cols;
for (const [type, gx, gy, gz, rot, v, mat, st] of map.pieces) {
    const col = cols[`${gx}:${gz}`] ?? S.snapColumn((gx + 0.5) * S.CELL, (gz + 0.5) * S.CELL);
    pieces.push({ type, gx, gy, gz, rot, v, mat, st, base: col + gy * S.CELL });
}
const extra = [
    ['stairs', 10, 0, 10, 0], ['stairs', 11, 1, 10, 0], ['stairs', 12, 2, 10, 1], ['floor', 12, 3, 11, 0],
    ['roof', 13, 3, 11, 0], ['wall', 12, 3, 11, 0], ['stairs', 9, 0, 11, 2], ['stairs', 10, 0, 12, 3],
];
for (const [type, gx, gy, gz, rot] of extra) {
    pieces.push({ type, gx, gy, gz, rot, v: 0, mat: 'wood', st: 0, base: S.snapColumn((gx + 0.5) * 4, (gz + 0.5) * 4) + gy * 4 });
}

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function inputs(n, opts = {}) {
    const out = [];
    let yaw = rnd() * 6;
    for (let i = 0; i < n; i++) {
        if (i % 25 === 0) yaw += (rnd() - 0.5) * 2;
        out.push({
            yaw, fwd: rnd() < 0.8 ? 1 : (rnd() < 0.5 ? -1 : 0), side: rnd() < 0.2 ? (rnd() < 0.5 ? 1 : -1) : 0,
            sprint: rnd() < 0.6, tac: rnd() < 0.25, crouch: rnd() < 0.08, jump: rnd() < 0.06, glide: !!opts.glide && i > 40, ads: rnd() < 0.2,
        });
    }
    return out;
}

const town = map.pois.find((p) => p.name.startsWith('Pignons'));
const lake = map.pois.find((p) => p.name.startsWith('Lac'));
const motel = map.pois.find((p) => p.name.startsWith('Motel'));
const pad = map.pads[0];
const zip = map.zips[0];
const car = map.vehicles[0];
const runs = [
    { state: 'alive', pos: [town.x, S.terrainHeight(town.x, town.z) + 0.1, town.z], inputs: inputs(900) },
    { state: 'alive', pos: [42, S.terrainHeight(42, 42) + 0.1, 42], inputs: inputs(600) },
    { state: 'alive', pos: [lake.x + 5, S.terrainHeight(lake.x + 5, lake.z + 70) + 0.1, lake.z + 70], inputs: inputs(600) },
    { state: 'falling', pos: [town.x + 10, 140, town.z - 20], inputs: inputs(700) },
    { state: 'falling', pos: [-200, 130, -150], inputs: inputs(500, { glide: true }) },
    { state: 'alive', pos: [motel.x, S.terrainHeight(motel.x, motel.z) + 0.1, motel.z - 8], inputs: inputs(700) },
    { state: 'alive', pos: [pad[0] + 3, pad[1] + 0.5, pad[2]], inputs: inputs(400).map((i, k) => ({ ...i, yaw: Math.PI / 2, fwd: k < 30 ? 1 : i.fwd, jump: false })) },
    { state: 'alive', pos: [0, 0, 0], zip: { id: 0, t: 0.05, dir: 1 }, inputs: inputs(300).map((i) => ({ ...i, jump: false })) },
    { state: 'alive', pos: [car[1], S.terrainHeight(car[1], car[2]), car[2]], veh: 0, cyaw: car[3], inputs: inputs(900).map((i, k) => ({ ...i, fwd: k % 200 < 160 ? 1 : -1, side: Math.sin(k / 40) > 0.4 ? 1 : Math.sin(k / 40) < -0.4 ? -1 : 0 })) },
];
for (const r of runs) r.pos = r.pos.map(Number);

// --- JS
// pièces éditées par un joueur (murs troués, sols percés, porte fermée / ouverte) sur le parcours 1
{
    const bx = Math.floor(42 / S.CELL), bz = Math.floor(42 / S.CELL);
    const base = S.snapColumn(42, 42);
    const extra = [
        ['wall', bx + 1, 0, bz, 1, 0b000010010, 0], ['wall', bx + 2, 0, bz + 1, 0, 0b111000101, 0], ['wall', bx - 1, 0, bz - 1, 1, 18, 1],
        ['wall', bx, 0, bz + 2, 0, 18, 0], ['floor', bx + 1, 1, bz, 0, 0b0110, 0], ['floor', bx, 1, bz + 1, 0, 0b1001, 0], ['floor', bx - 1, 0, bz, 0, 0b0011, 0],
    ];
    for (const [type, gx, gy, gz, rot, e, o] of extra) {
        pieces.push({ type, gx, gy, gz, rot, v: 0, e, o, mat: 'wood', st: 0, base: base + gy * S.CELL, key: S.PieceStore.key(type, gx, gy, gz, rot) });
    }
}
const store = new S.PieceStore();
store.load([], cols);
for (const pc of pieces) store.add({ ...pc });
map.nodes.forEach(([k, x, z, s, v, y], id) => store.addNode({ id, k, x, z, s, v, y }));
map.pads.forEach(([x, y, z], id) => store.addPad(id, x, y, z));
map.zips.forEach(([a, b], id) => store.addZip(id, a, b));
// cratères de grenade sur les parcours (relief modifié identiquement des deux côtés)
const r2 = (v) => Math.round(v * 100) / 100;
const craters = runs.filter((r) => r.state === 'alive').map((r) => [r2(r.pos[0] + 5.3), r2(r.pos[2] - 3.7), r2(S.terrainHeight(r.pos[0] + 5.3, r.pos[2] - 3.7) + 0.3)]);
let carved = 0;
for (const [x, z, y] of craters) carved += S.applyCrater(x, z, y).length;
console.log(`${craters.length} cratères (${carved} points du relief abaissés)`);
const js = runs.map((run) => {
    const p = { pos: [...run.pos], vel: [0, 0, 0], yaw: 0, ground: false, glide: false, slide: 0, slideDir: [0, 0], state: run.state, jumpQ: false, swim: false,
        zip: run.zip ? { ...run.zip } : null, veh: run.veh ?? null, cyaw: run.cyaw ?? 0, cspd: 0 };
    return run.inputs.map((inp) => {
        p.yaw = inp.yaw;
        if (inp.jump) p.jumpQ = true;
        S.stepPhysics(store, p, inp, S.DT);
        return [p.pos[0], p.pos[1], p.pos[2], p.state, p.glide, p.swim, !!p.zip, p.cyaw];
    });
});

// --- PHP
const file = '/tmp/parity-scenario.json';
fs.writeFileSync(file, JSON.stringify({ pieces, runs, craters }));
const php = JSON.parse(execFileSync('php', [path.join(ROOT, 'tools/parity.php'), file], { maxBuffer: 1 << 28 }).toString());

let worst = 0;
let firstDiff = null;
js.forEach((trace, r) => trace.forEach((s, i) => {
    const q = php[r][i];
    const d = Math.max(Math.abs(s[0] - q[0]), Math.abs(s[1] - q[1]), Math.abs(s[2] - q[2]));
    const flags = s[3] !== q[3] || s[4] !== q[4] || s[5] !== q[5] || s[6] !== q[6] || Math.abs(s[7] - q[7]) > 1e-9;
    if ((d > 1e-9 || flags) && !firstDiff) firstDiff = { run: r, tick: i, js: s, php: q };
    worst = Math.max(worst, d);
}));
const summary = runs.map((run, r) => {
    const last = js[r][js[r].length - 1];
    const states = new Set(js[r].map((s) => `${s[3]}${s[4] ? '+planeur' : ''}${s[5] ? '+nage' : ''}${s[6] ? '+tyrolienne' : ''}${run.veh !== undefined ? '+voiture' : ''}`));
    return `parcours ${r}: ${run.state} -> fin (${last[0].toFixed(1)}, ${last[1].toFixed(1)}, ${last[2].toFixed(1)}) états: ${[...states].join(', ')}`;
});
console.log(summary.join('\n'));
console.log(`écart max JS/PHP : ${worst}`);
if (firstDiff) {
    console.log('PREMIÈRE DIFFÉRENCE', JSON.stringify(firstDiff));
    process.exit(1);
}
console.log('PARITÉ OK');
