// Areny proceduralne w stylu stylizowanego low-poly: złota łąka o zachodzie i wyspa w zatoce.
// Ciepłe światło, falująca trawa, mgiełka, puchate chmury – ale z ciemniejszym, wieczornym nastrojem.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA_RADIUS } from '../sim/constants';
import { groundTexture } from './textures';
import { toonMat } from './toon';

export interface ArenaDef {
  id: string;
  name: string;
  skyTop: string;
  skyHorizon: string;
  skyBottom: string;
  fog: number;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunIntensity: number;
  sunDir: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  dust: number;
  ground: [string, string, string];
  grassBase: string;
  grassTip: string;
}

export const ARENAS: ArenaDef[] = [
  {
    id: 'meadow',
    name: 'Golden Meadow',
    skyTop: '#2b3770',
    skyHorizon: '#f2a35e',
    skyBottom: '#c98a5a',
    fog: 0xc99a74,
    fogNear: 35,
    fogFar: 150,
    sun: 0xffc488,
    sunIntensity: 3.0,
    sunDir: [-0.8, 0.38, 0.45],
    hemiSky: 0x8fa0d8,
    hemiGround: 0x5a4a2e,
    hemi: 1.5,
    dust: 0xd8c39a,
    ground: ['#5d7a34', '#46602a', '#7a8f3e'],
    grassBase: '#2f4a1e',
    grassTip: '#a8b84a',
  },
  {
    id: 'island',
    name: 'Island Cove',
    skyTop: '#33507a',
    skyHorizon: '#e8b48a',
    skyBottom: '#7aa0a8',
    fog: 0x9fb4b8,
    fogNear: 40,
    fogFar: 170,
    sun: 0xffd2a0,
    sunIntensity: 2.8,
    sunDir: [0.7, 0.45, 0.55],
    hemiSky: 0x9ec4dc,
    hemiGround: 0x8a7656,
    hemi: 1.6,
    dust: 0xe6d3a8,
    ground: ['#d9c08a', '#c4a46c', '#ead7a4'],
    grassBase: '#3e5a26',
    grassTip: '#b2b85a',
  },
];

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** Warstwa śladów gąsienic: tekstura canvas na podłożu, czytana też przez trawę (przygniecenie). */
export class TrackMarks {
  readonly mesh: THREE.Mesh;
  readonly texture: THREE.CanvasTexture;
  readonly extent = (ARENA_RADIUS / 1000) * 2 + 4;
  private readonly g: CanvasRenderingContext2D;
  private readonly size = 1024;
  private dirty = false;

  constructor(color: string) {
    const canvas = document.createElement('canvas');
    canvas.width = this.size;
    canvas.height = this.size;
    this.g = canvas.getContext('2d')!;
    this.g.fillStyle = color;
    this.texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshLambertMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.extent, this.extent), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.012;
    this.mesh.receiveShadow = true;
  }

  stamp(x: number, z: number, yaw: number, width: number, len: number, alpha: number): void {
    const s = this.size / this.extent;
    this.g.save();
    this.g.globalAlpha = alpha;
    this.g.translate((x + this.extent / 2) * s, (z + this.extent / 2) * s);
    this.g.rotate(yaw);
    this.g.fillRect((-len / 2) * s, (-width / 2) * s, len * s, width * s);
    this.g.restore();
    this.dirty = true;
  }

  clear(): void {
    this.g.clearRect(0, 0, this.size, this.size);
    this.dirty = true;
  }

  flush(): void {
    if (this.dirty) {
      this.texture.needsUpdate = true;
      this.dirty = false;
    }
  }
}

const GRASS_VERT = /* glsl */ `
uniform float uTime;
uniform sampler2D uTrample;
uniform float uExtent;
uniform vec3 uTanks[2];
varying float vH;
varying float vFog;
varying float vShade;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 root = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float h = position.y;
  vec2 uv = (root.xz + uExtent * 0.5) / uExtent;
  float trample = texture2D(uTrample, vec2(uv.x, 1.0 - uv.y)).a;
  float press = trample * 0.75;
  vec2 push = vec2(0.0);
  for (int i = 0; i < 2; i++) {
    vec2 d = root.xz - uTanks[i].xy;
    float dist = length(d);
    float f = 1.0 - smoothstep(uTanks[i].z * 0.55, uTanks[i].z, dist);
    press = max(press, f * 0.85);
    push += normalize(d + 0.0001) * f * 0.6;
  }
  float scale = 1.0 - press;
  wp.y = root.y + (wp.y - root.y) * scale;
  float sway = sin(uTime * 1.6 + root.x * 0.32 + root.z * 0.21) + 0.5 * sin(uTime * 2.7 + root.z * 0.5);
  wp.x += (sway * 0.09 + push.x) * h * h;
  wp.z += (sway * 0.05 + push.y) * h * h;
  vH = h * (0.6 + 0.4 * scale);
  vShade = 0.85 + 0.15 * sin(root.x * 1.7 + root.z * 2.3);
  vec4 mv = viewMatrix * wp;
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const GRASS_FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uTip;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uLight;
varying float vH;
varying float vFog;
varying float vShade;
void main() {
  vec3 c = mix(uBase, uTip, smoothstep(0.0, 1.0, vH)) * vShade * uLight;
  float f = smoothstep(uFogNear, uFogFar, vFog);
  gl_FragColor = vec4(mix(c, uFogColor, f), 1.0);
  #include <colorspace_fragment>
}`;

/** Gęsta, falująca trawa (instancje) – przygniatana przez czołgi i ślady gąsienic. */
class Grass {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor(def: ArenaDef, marks: TrackMarks, count: number, inner: number, outer: number, height: number) {
    // Źdźbło: zwężający się pasek w 3 segmentach (y od 0 do 1).
    const pos: number[] = [];
    const segs = 3;
    for (let i = 0; i < segs; i++) {
      const y0 = i / segs;
      const y1 = (i + 1) / segs;
      const w0 = 0.05 * (1 - y0);
      const w1 = 0.05 * (1 - y1);
      pos.push(-w0, y0, 0, w0, y0, 0, w1, y1, 0, -w0, y0, 0, w1, y1, 0, -w1, y1, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const fog = new THREE.Color(def.fog);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERT,
      fragmentShader: GRASS_FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uTrample: { value: marks.texture },
        uExtent: { value: marks.extent },
        uTanks: { value: [new THREE.Vector3(999, 999, 1), new THREE.Vector3(999, 999, 1)] },
        uBase: { value: new THREE.Color(def.grassBase) },
        uTip: { value: new THREE.Color(def.grassTip) },
        uFogColor: { value: fog },
        uFogNear: { value: def.fogNear },
        uFogFar: { value: def.fogFar },
        uLight: { value: 1.0 },
      },
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // Więcej źdźbeł bliżej środka (tam patrzy kamera).
      const r = inner + (outer - inner) * Math.pow(Math.random(), 1.4);
      const a = Math.random() * Math.PI * 2;
      p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      q.setFromAxisAngle(up, Math.random() * Math.PI);
      const h = height * rnd(0.6, 1.3) * (r > 17 ? 1.5 : 1);
      s.set(rnd(0.8, 1.4), h, 1);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
    }
  }

  update(time: number, tanks: THREE.Vector3[]): void {
    this.mat.uniforms['uTime']!.value = time;
    const t = this.mat.uniforms['uTanks']!.value as THREE.Vector3[];
    for (let i = 0; i < 2; i++) if (tanks[i]) t[i]!.copy(tanks[i]!);
  }
}

/** Zbiera geometrie wg materiału i scala je w jedną siatkę na materiał (mniej wywołań rysowania). */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0): void {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    g.deleteAttribute('uv');
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(this.m);
    g.computeVertexNormals();
    const list = this.parts.get(mat) ?? [];
    list.push(g);
    this.parts.set(mat, list);
  }

  build(parent: THREE.Object3D, shadows: boolean): void {
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.6, h), 0.8)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.2, h));
  float s = max(0.0, dot(normalize(vDir), normalize(uSunDir)));
  c += uSunColor * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.35);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const WATER_VERT = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying float vFog;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y += sin(wp.x * 0.25 + uTime * 1.2) * 0.08 + sin(wp.z * 0.31 + uTime * 0.9) * 0.08;
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uShore;
varying vec3 vWorld;
varying float vFog;
void main() {
  float r = length(vWorld.xz);
  float depth = smoothstep(uShore, uShore + 18.0, r);
  vec3 c = mix(uShallow, uDeep, depth);
  // Pas piany przy brzegu i stylizowane błyski.
  float foam = smoothstep(1.4, 0.0, abs(r - uShore - 0.6 - sin(uTime * 1.5 + vWorld.x * 0.3) * 0.35));
  float sparkle = step(0.985, sin(vWorld.x * 2.1 + uTime) * sin(vWorld.z * 1.7 - uTime * 0.8));
  c = mix(c, vec3(0.95, 0.97, 0.95), max(foam * 0.85, sparkle * 0.6 * (1.0 - depth * 0.5)));
  float f = smoothstep(uFogNear, uFogFar, vFog);
  gl_FragColor = vec4(mix(c, uFogColor, f), 1.0);
  #include <colorspace_fragment>
}`;

export class Arena {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly marks: TrackMarks;
  readonly def: ArenaDef;
  private grass: Grass | null = null;
  private water: THREE.ShaderMaterial | null = null;
  private clouds: THREE.Object3D[] = [];
  private readonly mats = new Map<string, THREE.MeshToonMaterial>();

  constructor(def: ArenaDef, scene: THREE.Scene, grassDensity: number) {
    this.def = def;
    scene.fog = new THREE.Fog(def.fog, def.fogNear, def.fogFar);
    scene.background = new THREE.Color(def.fog);

    const hemi = new THREE.HemisphereLight(def.hemiSky, def.hemiGround, def.hemi);
    this.group.add(hemi);
    this.sun = new THREE.DirectionalLight(def.sun, def.sunIntensity);
    const [sx, sy, sz] = def.sunDir;
    this.sun.position.set(sx * 40, sy * 40, sz * 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    sc.near = 1;
    sc.far = 110;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.group.add(this.sun, this.sun.target);

    this.buildSky();
    this.marks = new TrackMarks(def.id === 'island' ? 'rgba(120,96,60,1)' : 'rgba(70,52,30,1)');
    this.group.add(this.marks.mesh);
    if (def.id === 'island') this.buildIsland(grassDensity);
    else this.buildMeadow(grassDensity);
    this.buildClouds();
    scene.add(this.group);
  }

  private toon(color: string | number): THREE.MeshToonMaterial {
    const key = String(color);
    let m = this.mats.get(key);
    if (!m) {
      m = toonMat({ color });
      this.mats.set(key, m);
    }
    return m;
  }

  private buildSky(): void {
    const d = this.def;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(d.skyTop) },
          uHorizon: { value: new THREE.Color(d.skyHorizon) },
          uBottom: { value: new THREE.Color(d.skyBottom) },
          uSunDir: { value: new THREE.Vector3(...d.sunDir).normalize().setY(0.12) },
          uSunColor: { value: new THREE.Color(d.sun) },
        },
      }),
    );
    sky.renderOrder = -10;
    this.group.add(sky);
  }

  private ground(radius: number, y: number): THREE.Mesh {
    const [b, dk, l] = this.def.ground;
    const tex = groundTexture(b, dk, l, this.def.id === 'island' ? 21 : 4);
    tex.repeat.set(radius / 3, radius / 3);
    const g = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), toonMat({ map: tex }));
    g.rotation.x = -Math.PI / 2;
    g.position.y = y;
    g.receiveShadow = true;
    this.group.add(g);
    return g;
  }

  // --------------------------------------------------------------- roślinność

  private pine(b: Batch, x: number, z: number, s: number): void {
    const trunk = this.toon('#6b4528');
    const leaves = this.toon(Math.random() < 0.5 ? '#2f5530' : '#38603a');
    b.add(new THREE.CylinderGeometry(0.15, 0.22, 2, 6), trunk, x, s, z, s, s, s);
    for (let i = 0; i < 3; i++) {
      b.add(new THREE.ConeGeometry(1.5 - i * 0.35, 2.0, 7), leaves, x, s * (2.0 + i * 1.15), z, s, s, s, Math.random() * 3);
    }
  }

  private broadleaf(b: Batch, x: number, z: number, s: number, autumn: boolean): void {
    const trunk = this.toon('#5e3e26');
    const cols = autumn ? ['#d8893a', '#e8a64a', '#c26a2c'] : ['#5f8a36', '#4f7a2e', '#77a044'];
    b.add(new THREE.CylinderGeometry(0.16, 0.28, 3, 6), trunk, x, s * 1.5, z, s, s, s, 0, rnd(-0.1, 0.1), rnd(-0.1, 0.1));
    for (let i = 0; i < 3; i++) {
      const c = this.toon(cols[i % cols.length]!);
      b.add(new THREE.IcosahedronGeometry(1.2, 0), c, x + rnd(-0.8, 0.8) * s, s * (3.4 + rnd(-0.3, 0.7)), z + rnd(-0.8, 0.8) * s, s * rnd(0.9, 1.3), s * rnd(0.8, 1.1), s * rnd(0.9, 1.3), rnd(0, 3));
    }
  }

  private birch(b: Batch, x: number, z: number, s: number): void {
    b.add(new THREE.CylinderGeometry(0.1, 0.14, 5, 6), this.toon('#e8e2d4'), x, s * 2.5, z, s, s, s);
    b.add(new THREE.IcosahedronGeometry(1.0, 0), this.toon('#e0a040'), x, s * 5, z, s, s * 1.3, s, rnd(0, 3));
  }

  private rock(b: Batch, x: number, z: number, s: number, color = '#7d7a72'): void {
    b.add(new THREE.DodecahedronGeometry(1, 0), this.toon(color), x, s * 0.35, z, s * rnd(0.8, 1.4), s * rnd(0.5, 0.9), s * rnd(0.8, 1.3), rnd(0, 3), rnd(-0.3, 0.3));
  }

  private hills(b: Batch, color: string, dist: number, count: number, size: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd(-0.1, 0.1);
      const r = size * rnd(0.7, 1.3);
      b.add(new THREE.IcosahedronGeometry(1, 1), this.toon(color), Math.cos(a) * dist, -r * 0.15, Math.sin(a) * dist, r, r * rnd(0.25, 0.45), r, rnd(0, 3));
    }
  }

  private buildMeadow(density: number): void {
    this.ground(220, 0);
    const near = new Batch();
    const far = new Batch();
    // Ogrodzenie z pali i bele siana – granica areny.
    const R = ARENA_RADIUS / 1000 + 1.2;
    const wood = this.toon('#7a5434');
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      near.add(new THREE.CylinderGeometry(0.1, 0.12, 1.3, 6), wood, Math.cos(a) * R, 0.65, Math.sin(a) * R);
      const a2 = ((i + 0.5) / 48) * Math.PI * 2;
      near.add(new THREE.BoxGeometry(0.08, 0.1, (2 * Math.PI * R) / 48 + 0.1), wood, Math.cos(a2) * R, 0.9, Math.sin(a2) * R, 1, 1, 1, -a2);
      if (i % 7 === 3) near.add(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 10), this.toon('#d6b05a'), Math.cos(a) * (R + 1.5), 0.7, Math.sin(a) * (R + 1.5), 1, 1, 1, 0, Math.PI / 2, a);
    }
    // Las w kilku warstwach: świerki, liściaste (część jesiennych), brzozy, kamienie.
    for (let i = 0; i < 110; i++) {
      const a = rnd(0, Math.PI * 2);
      const d = rnd(21, 60);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const s = rnd(0.9, 1.6);
      const k = Math.random();
      const b = d < 35 ? near : far;
      if (k < 0.4) this.pine(b, x, z, s);
      else if (k < 0.8) this.broadleaf(b, x, z, s, Math.random() < 0.35);
      else this.birch(b, x, z, s);
    }
    for (let i = 0; i < 26; i++) {
      const a = rnd(0, Math.PI * 2);
      this.rock(near, Math.cos(a) * rnd(17.5, 28), Math.sin(a) * rnd(17.5, 28), rnd(0.5, 1.4));
    }
    this.hills(far, '#5c7a3a', 85, 14, 26);
    this.hills(far, '#4a6844', 130, 12, 40);
    // Odległe góry z ośnieżonymi szczytami.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const h = rnd(35, 60);
      far.add(new THREE.ConeGeometry(h * 0.9, h, 6), this.toon('#5e6a86'), Math.cos(a) * 190, h / 2 - 4, Math.sin(a) * 190, 1, 1, 1, rnd(0, 3));
      far.add(new THREE.ConeGeometry(h * 0.27, h * 0.3, 6), this.toon('#e8e4ec'), Math.cos(a) * 190, h * 0.85 - 4, Math.sin(a) * 190, 1, 1, 1, rnd(0, 3));
    }
    near.build(this.group, true);
    far.build(this.group, false);
    this.grass = new Grass(this.def, this.marks, Math.round(55000 * density), 0, 24, 0.42);
    this.group.add(this.grass.mesh);
  }

  private buildIsland(density: number): void {
    this.ground(26, 0.0);
    // Woda dookoła wyspy.
    this.water = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color('#3fb6b0') },
        uDeep: { value: new THREE.Color('#1d5a7a') },
        uFogColor: { value: new THREE.Color(this.def.fog) },
        uFogNear: { value: this.def.fogNear },
        uFogFar: { value: this.def.fogFar },
        uShore: { value: 26 },
      },
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(500, 500, 80, 80), this.water);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.25;
    this.group.add(water);
    const near = new Batch();
    const far = new Batch();
    // Granica: kamienie i wyrzucone drewno.
    const R = ARENA_RADIUS / 1000 + 1.4;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + rnd(-0.05, 0.05);
      if (i % 3 === 0) near.add(new THREE.CylinderGeometry(0.2, 0.25, 2.4, 6), this.toon('#9a8466'), Math.cos(a) * R, 0.2, Math.sin(a) * R, 1, 1, 1, -a, Math.PI / 2, 0);
      else this.rock(near, Math.cos(a) * R, Math.sin(a) * R, rnd(0.5, 0.9), '#8a8478');
    }
    // Palmy.
    const trunk = this.toon('#8a6a46');
    const frond = this.toon('#4f8a3a');
    for (let i = 0; i < 16; i++) {
      const a = rnd(0, Math.PI * 2);
      const d = rnd(18.5, 24);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const lean = rnd(-0.3, 0.3);
      for (let k = 0; k < 5; k++) near.add(new THREE.CylinderGeometry(0.18, 0.22, 1.3, 6), trunk, x + lean * k * 1.1, 0.65 + k * 1.2, z, 1, 1, 1, 0, 0, -lean * 0.8);
      const tx = x + lean * 5.5;
      for (let k = 0; k < 7; k++) {
        const fa = (k / 7) * Math.PI * 2;
        near.add(new THREE.BoxGeometry(2.6, 0.06, 0.6), frond, tx + Math.cos(fa) * 1.2, 6.2, z + Math.sin(fa) * 1.2, 1, 1, 1, -fa, 0, -0.45);
      }
    }
    // Pomost, łódka, skrzynie.
    const plank = this.toon('#8c6a48');
    for (let i = 0; i < 8; i++) near.add(new THREE.BoxGeometry(0.5, 0.1, 2.4), plank, 24 + i * 0.55, 0.4, -6, 1, 1, 1, 0);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) near.add(new THREE.CylinderGeometry(0.1, 0.1, 1.4, 6), this.toon('#5e4630'), 24.2 + i * 1.3, -0.2, -6 + s * 1.1);
    near.add(new THREE.BoxGeometry(3, 0.5, 1.2), this.toon('#a0622e'), 29, -0.05, -2.5, 1, 1, 1, 0.4);
    for (let i = 0; i < 3; i++) near.add(new THREE.BoxGeometry(0.8, 0.8, 0.8), plank, -21 + i * 0.9, 0.4, 13 + (i % 2) * 0.8, 1, 1, 1, rnd(0, 1));
    // Odległe wyspy z klifami i drzewami.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const d = rnd(95, 160);
      const s = rnd(14, 28);
      far.add(new THREE.CylinderGeometry(s * 0.8, s, s * 0.5, 7), this.toon('#8a7e6a'), Math.cos(a) * d, s * 0.15, Math.sin(a) * d, 1, 1, 1, rnd(0, 3));
      far.add(new THREE.IcosahedronGeometry(s * 0.75, 1), this.toon('#4c7a3c'), Math.cos(a) * d, s * 0.45, Math.sin(a) * d, 1, 0.35, 1);
    }
    near.build(this.group, true);
    far.build(this.group, false);
    // Kępy trawy tylko na obrzeżach wyspy.
    this.grass = new Grass(this.def, this.marks, Math.round(16000 * density), 15.5, 25, 0.5);
    this.group.add(this.grass.mesh);
  }

  private buildClouds(): void {
    const mat = this.toon('#fff4e8');
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Group();
      const n = 4 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const s = rnd(4, 9);
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat);
        puff.scale.set(s * 1.3, s * 0.8, s);
        puff.position.set(k * rnd(4, 7) - n * 2.5, rnd(-1, 2), rnd(-3, 3));
        c.add(puff);
      }
      const a = rnd(0, Math.PI * 2);
      const d = rnd(110, 200);
      c.position.set(Math.cos(a) * d, rnd(40, 75), Math.sin(a) * d);
      c.lookAt(0, c.position.y, 0);
      c.userData['speed'] = rnd(0.004, 0.01);
      this.clouds.push(c);
      this.group.add(c);
    }
  }

  /** Animacja otoczenia: trawa (wiatr, przygniatanie przez czołgi), woda, chmury. */
  update(time: number, tanks: THREE.Vector3[]): void {
    this.grass?.update(time, tanks);
    if (this.water) this.water.uniforms['uTime']!.value = time;
    for (const c of this.clouds) {
      const sp = c.userData['speed'] as number;
      const a = Math.atan2(c.position.z, c.position.x) + sp * 0.016;
      const d = Math.hypot(c.position.x, c.position.z);
      c.position.x = Math.cos(a) * d;
      c.position.z = Math.sin(a) * d;
      c.lookAt(0, c.position.y, 0);
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}
