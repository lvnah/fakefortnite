// Usure visible : fissures qui apparaissent de plus en plus à mesure qu'on abîme un objet
// (constructions, maisons, arbres, rochers, épaves, meubles). Le degré d'usure (0 à 1) est un
// attribut « dmg » par sommet (pièces fusionnées) ou par instance (InstancedMesh).
import * as THREE from 'three';

let crackTex = null;

/**
 * Texture de fissures qui se répète : chaque fissure a un seuil (niveau de gris) ;
 * elle n'apparaît qu'au-delà de ce degré d'usure. Fond blanc = jamais fissuré.
 */
export function crackTexture() {
    if (crackTex) return crackTex;
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, S, S);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const N = 46;
    const cracks = [];
    for (let i = 0; i < N; i++) cracks.push(0.04 + (0.9 * i) / N);
    // les fissures fines d'abord, puis de plus en plus longues et épaisses
    for (const th of cracks.reverse()) {
        const v = Math.round(th * 255);
        g.strokeStyle = `rgb(${v},${v},${v})`;
        g.lineCap = 'round';
        const walk = (x, y, a, len, w, depth) => {
            g.lineWidth = w;
            g.beginPath();
            g.moveTo(x, y);
            for (let s = 0; s < len; s++) {
                a += (rnd() - 0.5) * 0.9;
                x += Math.cos(a) * 7;
                y += Math.sin(a) * 7;
                g.lineTo(x, y);
                if (depth < 2 && rnd() < 0.08) {
                    g.stroke();
                    walk(x, y, a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.6), len * 0.45, w * 0.7, depth + 1);
                    g.lineWidth = w;
                    g.beginPath();
                    g.moveTo(x, y);
                }
            }
            g.stroke();
        };
        const x0 = rnd() * S;
        const y0 = rnd() * S;
        const a0 = rnd() * Math.PI * 2;
        const len = 8 + rnd() * 22 * (1.2 - th);
        const w = 1.6 + (1 - th) * 2.2;
        // dessin répété sur les bords : la texture se raccorde sans couture
        for (const ox of [-S, 0, S]) {
            for (const oy of [-S, 0, S]) {
                const saved = seed;
                walk(x0 + ox, y0 + oy, a0, len, w, 0);
                if (!(ox === S && oy === S)) seed = saved;
            }
        }
    }
    crackTex = new THREE.CanvasTexture(cv);
    crackTex.wrapS = crackTex.wrapT = THREE.RepeatWrapping;
    crackTex.colorSpace = THREE.NoColorSpace;
    crackTex.anisotropy = 4;
    return crackTex;
}

const uniforms = { crackMap: { value: null } };

/** Ajoute l'usure (attribut « dmg ») à un matériau standard ou Lambert. */
export function addDamage(material) {
    if (!material || material.userData.dmg) return material;
    material.userData.dmg = true;
    uniforms.crackMap.value ??= crackTexture();
    const prev = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey?.bind(material);
    material.onBeforeCompile = (shader, r) => {
        prev?.call(material, shader, r);
        shader.uniforms.crackMap = uniforms.crackMap;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float dmg;\nvarying float vDmg;\nvarying vec3 vCrackPos;\nvarying vec3 vCrackN;')
            .replace('#include <project_vertex>', `#include <project_vertex>
    vDmg = dmg;
    vec4 crackW = vec4( transformed, 1.0 );
    vec3 crackN = objectNormal;
    #ifdef USE_INSTANCING
        crackW = instanceMatrix * crackW;
        crackN = mat3( instanceMatrix ) * crackN;
    #endif
    vCrackPos = ( modelMatrix * crackW ).xyz;
    vCrackN = normalize( mat3( modelMatrix ) * crackN );`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform sampler2D crackMap;\nvarying float vDmg;\nvarying vec3 vCrackPos;\nvarying vec3 vCrackN;')
            .replace('#include <map_fragment>', `#include <map_fragment>
    if ( vDmg > 0.01 ) {
        vec3 an = abs( vCrackN );
        vec2 cuv = an.x > an.y && an.x > an.z ? vCrackPos.zy : ( an.y > an.z ? vCrackPos.xz : vCrackPos.xy );
        float cv = texture2D( crackMap, cuv * 0.31 ).r;
        float lim = vDmg * 0.94;
        float crack = 1.0 - smoothstep( lim - 0.03, lim, cv );
        float edge = ( 1.0 - smoothstep( lim - 0.12, lim, cv ) ) * ( 1.0 - crack );
        diffuseColor.rgb *= ( 1.0 - 0.28 * vDmg ) * ( 1.0 - 0.82 * crack ) * ( 1.0 - 0.25 * edge );
    }`);
    };
    material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|dmg`;
    material.needsUpdate = true;
    return material;
}

/** Attribut d'usure à zéro pour une géométrie (sommets). */
export function zeroDamage(geo, value = 0) {
    const n = geo.attributes.position.count;
    const a = new Float32Array(n);
    if (value) a.fill(value);
    geo.setAttribute('dmg', new THREE.BufferAttribute(a, 1));
    return geo;
}

/** Attribut d'usure par instance (copie de la géométrie : chaque groupe d'instances a le sien). */
export function instancedDamage(im) {
    const geo = im.geometry.clone();
    geo.setAttribute('dmg', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, im.count)), 1));
    im.geometry = geo;
    return geo.attributes.dmg;
}
