// Shaders : eau animée et ciel procédural (soleil + nuages fbm).
import * as THREE from 'three';

const NOISE = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
}`;

export function createWaterMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        fog: true,
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uTime: { value: 0 },
                uDeep: { value: new THREE.Color(0x0a4f7a) },
                uShallow: { value: new THREE.Color(0x3fd0e0) },
            },
        ]),
        vertexShader: `
            uniform float uTime;
            varying vec3 vWorld;
            #include <fog_pars_vertex>
            void main() {
                vec3 p = position;
                p.y += sin(p.x * 0.045 + uTime * 1.1) * 0.22
                     + cos(p.z * 0.06 - uTime * 0.9) * 0.18
                     + sin((p.x + p.z) * 0.12 + uTime * 2.0) * 0.05;
                vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
                vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }`,
        fragmentShader: `
            uniform vec3 uDeep;
            uniform vec3 uShallow;
            uniform float uTime;
            varying vec3 vWorld;
            #include <fog_pars_fragment>
            void main() {
                float s = sin(vWorld.x * 0.9 + uTime * 1.7) * sin(vWorld.z * 0.8 - uTime * 1.3);
                vec3 col = mix(uDeep, uShallow, 0.35 + 0.25 * s);
                col += pow(max(s, 0.0), 6.0) * 0.25;
                gl_FragColor = vec4(col, 0.9);
                #include <fog_fragment>
            }`,
    });
}

export function createSkyMaterial(sunDir) {
    return new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
            uTime: { value: 0 },
            uSun: { value: sunDir.clone() },
        },
        vertexShader: `
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: NOISE + `
            uniform float uTime;
            uniform vec3 uSun;
            varying vec3 vDir;
            void main() {
                vec3 d = normalize(vDir);
                float h = clamp(d.y, 0.0, 1.0);
                vec3 zenith = vec3(0.23, 0.52, 0.92);
                vec3 horizon = vec3(0.78, 0.92, 1.0);
                vec3 col = mix(horizon, zenith, pow(h, 0.55));
                float sun = dot(d, normalize(uSun));
                col += vec3(1.0, 0.92, 0.7) * smoothstep(0.9965, 0.999, sun) * 1.2;
                col += vec3(1.0, 0.85, 0.55) * pow(max(sun, 0.0), 8.0) * 0.25;
                if (d.y > 0.02) {
                    vec2 uv = d.xz / (d.y + 0.15) * 1.6 + vec2(uTime * 0.01, uTime * 0.004);
                    float c = smoothstep(0.52, 0.8, fbm(uv * 1.3));
                    col = mix(col, vec3(1.0), c * 0.75 * smoothstep(0.02, 0.25, d.y));
                }
                gl_FragColor = vec4(col, 1.0);
            }`,
    });
}

/** Mur de la tempête : voile violet animé, plus dense près du sol. */
export function createStormMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uRadius: { value: 500 } },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vWorld;
            void main() {
                vUv = uv;
                vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: NOISE + `
            uniform float uTime;
            uniform float uRadius;
            varying vec2 vUv;
            varying vec3 vWorld;
            void main() {
                float around = vUv.x * uRadius * 0.05;
                vec2 p = vec2(around + uTime * 0.6, vWorld.y * 0.03 - uTime * 0.25);
                float n = fbm(p) * 0.7 + fbm(p * 3.1 + 4.0) * 0.3;
                float streak = smoothstep(0.55, 0.9, fbm(vec2(around * 0.5, vWorld.y * 0.08 + uTime * 1.5)));
                vec3 col = mix(vec3(0.38, 0.12, 0.62), vec3(0.75, 0.45, 1.0), n);
                col += vec3(0.9, 0.7, 1.0) * streak * 0.35;
                float a = 0.28 + n * 0.25 + streak * 0.15;
                a *= smoothstep(400.0, 60.0, vWorld.y);
                gl_FragColor = vec4(col, a);
            }`,
    });
}
