// Stylizacja „komiksowa”: cieniowanie toon z kilkoma progami i czarne kontury (odwrócona skorupa).
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let gradient: THREE.DataTexture | null = null;

/** Mapa progów światła – 4 twarde stopnie. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const steps = new Uint8Array([120, 175, 225, 255]);
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  gradient = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

export function toonMat(p: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...p });
}

/** Wspólne dane „przezroczystego korytarza”: nic z otoczenia nie stoi między kamerą a czołgami. */
export const occlusion = {
  uOccCam: { value: new THREE.Vector3(0, 5, 20) },
  uOccT1: { value: new THREE.Vector3(-3, 1.2, 0) },
  uOccT2: { value: new THREE.Vector3(3, 1.2, 0) },
};

/**
 * Materiał otoczenia, który wycina (z ditheringiem) fragmenty leżące w korytarzu kamera→czołg.
 * Korytarz zwęża się przy czołgu, więc płot i kamienie tuż obok walki zostają.
 */
export function occludable<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, occlusion);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOccW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvOccW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vOccW;
uniform vec3 uOccCam;
uniform vec3 uOccT1;
uniform vec3 uOccT2;
float occCut(vec3 t) {
  vec3 d = t - uOccCam;
  float len = length(d);
  float k = clamp(dot(vOccW - uOccCam, d) / (len * len), 0.0, 1.0);
  if (k * len > len - 3.5) return 0.0;
  float r = 2.0 + 2.5 * (1.0 - k);
  float dist = length(uOccCam + d * k - vOccW);
  return 1.0 - smoothstep(r - 1.2, r, dist);
}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{
  float cut = max(occCut(uOccT1), occCut(uOccT2));
  vec2 p = floor(gl_FragCoord.xy);
  float dither = fract(dot(p, vec2(0.5, 0.25)) + 0.125 * mod(p.y, 2.0));
  if (cut > dither * 0.9 + 0.05) discard;
}`);
  };
  m.customProgramCacheKey = () => 'occludable';
  return m;
}

const outlineMats = new Map<number, THREE.MeshBasicMaterial>();

/** Materiał konturu: wierzchołki wypchnięte wzdłuż normalnej, rysowane tylne ściany. */
export function outlineMaterial(thickness: number): THREE.MeshBasicMaterial {
  const key = Math.round(thickness * 1000);
  const cached = outlineMats.get(key);
  if (cached) return cached;
  const m = new THREE.MeshBasicMaterial({ color: 0x0b0b0e, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\ntransformed += normalize(normal) * ${thickness.toFixed(4)};`,
    );
  };
  m.customProgramCacheKey = () => `outline-${key}`;
  outlineMats.set(key, m);
  return m;
}

const outlineGeoCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** Geometria konturu z wygładzonymi normalnymi (bez dziur na ostrych krawędziach). */
function outlineGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = outlineGeoCache.get(g);
  if (cached) return cached;
  const c = new THREE.BufferGeometry();
  c.setAttribute('position', g.getAttribute('position').clone());
  if (g.index) c.setIndex(g.index.clone());
  const merged = mergeVertices(c, 1e-3);
  merged.computeVertexNormals();
  outlineGeoCache.set(g, merged);
  return merged;
}

/** Dodaje kontury do wszystkich zwykłych siatek w obiekcie (pomija instancje i drobiazgi). */
export function addOutlines(root: THREE.Object3D, thickness: number, minSize = 0.12): void {
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
    if (o.userData['noOutline']) return;
    const m = o.material as THREE.Material;
    if (m.transparent) return;
    o.geometry.computeBoundingSphere();
    if ((o.geometry.boundingSphere?.radius ?? 0) < minSize) return;
    targets.push(o);
  });
  for (const o of targets) {
    const line = new THREE.Mesh(outlineGeometry(o.geometry), outlineMaterial(thickness));
    line.userData['noOutline'] = true;
    line.castShadow = false;
    line.receiveShadow = false;
    o.add(line);
  }
}

/** Zamienia materiały PBR w obiekcie na toon (dla elementów areny). */
export function toonify(root: THREE.Object3D): void {
  const cache = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.Material;
    if (!(m instanceof THREE.MeshStandardMaterial)) return;
    let t = cache.get(m);
    if (!t) {
      t = toonMat({
        color: m.color,
        map: m.map,
        emissive: m.emissive,
        emissiveIntensity: m.emissiveIntensity,
        transparent: m.transparent,
        depthWrite: m.depthWrite,
      });
      cache.set(m, t);
    }
    o.material = t;
  });
}
