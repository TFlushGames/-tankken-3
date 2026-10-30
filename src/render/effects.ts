// Efekty kosmetyczne (poza symulacją): cząsteczki, odłamki, wstrząs kamery.
import * as THREE from 'three';
import { particleTexture } from './textures';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

export interface SpawnOpts {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  grow?: number;
  color: THREE.Color;
  gravity?: number;
  drag?: number;
  fade?: number;
}

/** Prosty system cząsteczek na THREE.Points z własnym shaderem. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly grow: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly baseSize: Float32Array;
  private next = 0;
  density = 1;

  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.baseSize = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: particleTexture() }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  setScale(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms['uScale']!.value = px;
  }

  spawn(o: SpawnOpts): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = o.x;
    this.pos[i * 3 + 1] = o.y;
    this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx;
    this.vel[i * 3 + 1] = o.vy;
    this.vel[i * 3 + 2] = o.vz;
    this.col[i * 3] = o.color.r;
    this.col[i * 3 + 1] = o.color.g;
    this.col[i * 3 + 2] = o.color.b;
    this.baseSize[i] = o.size;
    this.size[i] = o.size;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.grow[i] = o.grow ?? 0;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.alpha[i] = 1;
  }

  /** Wysyła serię cząsteczek z losowym rozrzutem. */
  burst(n: number, base: Omit<SpawnOpts, 'vx' | 'vy' | 'vz'>, speed: number, dir?: THREE.Vector3, spread = 1): void {
    const count = Math.max(1, Math.round(n * this.density));
    for (let k = 0; k < count; k++) {
      let vx = (Math.random() - 0.5) * 2;
      let vy = (Math.random() - 0.5) * 2;
      let vz = (Math.random() - 0.5) * 2;
      if (dir) {
        vx = dir.x + vx * spread;
        vy = dir.y + vy * spread;
        vz = dir.z + vz * spread;
      }
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn({ ...base, vx: vx * s, vy: vy * s, vz: vz * s, life: base.life * (0.6 + Math.random() * 0.7) });
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
      const k = Math.max(0, this.life[i]! / this.maxLife[i]!);
      const d = Math.max(0, 1 - this.drag[i]! * dt);
      this.vel[i * 3]! *= d;
      this.vel[i * 3 + 1]! *= d;
      this.vel[i * 3 + 2]! *= d;
      this.vel[i * 3 + 1]! -= this.grav[i]! * dt;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      if (this.pos[i * 3 + 1]! < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1]! *= -0.3;
      }
      this.size[i] = this.baseSize[i]! * (1 + this.grow[i]! * (1 - k));
      this.alpha[i] = Math.min(1, k * 1.5);
    }
    const g = this.points.geometry;
    g.attributes['position']!.needsUpdate = true;
    g.attributes['aSize']!.needsUpdate = true;
    g.attributes['aAlpha']!.needsUpdate = true;
    g.attributes['aColor']!.needsUpdate = true;
  }
}

/** Odłamek: obiekt fizyczny lecący i obracający się (fartuchy, wieża przy K.O.). */
export interface Debris {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  timeScale: number;
}

export class DebrisSystem {
  private items: Debris[] = [];
  constructor(private readonly scene: THREE.Scene) {}

  add(obj: THREE.Object3D, vel: THREE.Vector3, spin: THREE.Vector3, life = 6, timeScale = 1): void {
    // Przenieś obiekt do sceny z zachowaniem pozycji w świecie.
    obj.updateWorldMatrix(true, false);
    const m = obj.matrixWorld.clone();
    obj.removeFromParent();
    m.decompose(obj.position, obj.quaternion, obj.scale);
    this.scene.add(obj);
    this.items.push({ obj, vel, spin, life, timeScale });
  }

  update(dt: number, slow: number): void {
    for (const d of this.items) {
      const t = dt * d.timeScale * slow;
      d.vel.y -= 9.8 * t;
      d.obj.position.addScaledVector(d.vel, t);
      d.obj.rotation.x += d.spin.x * t;
      d.obj.rotation.y += d.spin.y * t;
      d.obj.rotation.z += d.spin.z * t;
      if (d.obj.position.y < 0.15) {
        d.obj.position.y = 0.15;
        d.vel.y *= -0.3;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.6);
      }
      d.life -= dt;
    }
    this.items = this.items.filter((d) => {
      if (d.life > 0) return true;
      d.obj.removeFromParent();
      return false;
    });
  }

  clear(): void {
    for (const d of this.items) d.obj.removeFromParent();
    this.items = [];
  }
}

/** Wstrząs kamery oparty na „traumie”. */
export class CameraShake {
  trauma = 0;
  readonly offset = new THREE.Vector3();
  private t = 0;
  add(v: number): void {
    this.trauma = Math.min(1, this.trauma + v);
  }
  update(dt: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.trauma * this.trauma * 0.6;
    this.offset.set(
      Math.sin(this.t * 47.3) * s,
      Math.sin(this.t * 53.1 + 1.3) * s * 0.8,
      Math.sin(this.t * 41.7 + 2.1) * s * 0.4,
    );
  }
}

/** Tekstura komiksowej „gwiazdy” uderzenia. */
function starTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.translate(128, 128);
  const spikes = 12;
  g.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? 124 : 52 + Math.random() * 18;
    const a = (i / (spikes * 2)) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 124);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,240,170,1)');
  grad.addColorStop(1, 'rgba(255,150,40,0.9)');
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(20,10,10,0.9)';
  g.stroke();
  return new THREE.CanvasTexture(c);
}

function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  size: number;
  grow: number;
}

/** Błyski uderzeń: gwiazda + rozchodzący się pierścień (billboardy). */
export class ImpactFX {
  readonly group = new THREE.Group();
  private readonly starMat: THREE.SpriteMaterial;
  private readonly ringMat: THREE.SpriteMaterial;
  private items: Flash[] = [];

  constructor() {
    this.starMat = new THREE.SpriteMaterial({ map: starTexture(), depthTest: false, transparent: true });
    this.ringMat = new THREE.SpriteMaterial({ map: ringTexture(), depthTest: false, transparent: true, blending: THREE.AdditiveBlending });
  }

  spawn(p: THREE.Vector3, power: number, color?: THREE.Color): void {
    const star = new THREE.Sprite(this.starMat.clone());
    star.material.rotation = Math.random() * Math.PI;
    if (color) star.material.color.copy(color);
    star.position.copy(p);
    star.renderOrder = 20;
    this.group.add(star);
    const size = 1.2 + power * 2.2;
    this.items.push({ sprite: star, life: 0.16, max: 0.16, size, grow: 0.4 });
    const ring = new THREE.Sprite(this.ringMat.clone());
    if (color) ring.material.color.copy(color);
    ring.position.copy(p);
    ring.renderOrder = 19;
    this.group.add(ring);
    this.items.push({ sprite: ring, life: 0.3, max: 0.3, size: size * 0.6, grow: 3 });
  }

  update(dt: number): void {
    for (const f of this.items) {
      f.life -= dt;
      const k = 1 - Math.max(0, f.life) / f.max;
      const s = f.size * (1 + f.grow * k) * (f.grow < 1 ? Math.min(1, k * 4 + 0.3) : 1);
      f.sprite.scale.set(s, s, 1);
      f.sprite.material.opacity = Math.max(0, 1 - k * k);
    }
    this.items = this.items.filter((f) => {
      if (f.life > 0) return true;
      f.sprite.removeFromParent();
      f.sprite.material.dispose();
      return false;
    });
  }
}

/** Smuga za końcem lufy podczas ciosu (wstęga z ostatnich pozycji). */
export class SwingTrail {
  readonly mesh: THREE.Mesh;
  private readonly n = 12;
  private readonly tips: THREE.Vector3[] = [];
  private readonly mids: THREE.Vector3[] = [];
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private fade = 0;

  constructor(color: THREE.Color) {
    this.pos = new Float32Array(this.n * 2 * 3);
    this.alpha = new Float32Array(this.n * 2);
    const idx: number[] = [];
    for (let i = 0; i < this.n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color } },
      vertexShader: 'attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor, vA); }',
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
  }

  /** Dodaje bieżącą pozycję; `on` – czy cios jest w fazie ruchu. */
  push(tip: THREE.Vector3, mid: THREE.Vector3, on: boolean, dt: number): void {
    this.fade = on ? 1 : Math.max(0, this.fade - dt * 6);
    this.tips.unshift(tip.clone());
    this.mids.unshift(mid.clone());
    if (this.tips.length > this.n) {
      this.tips.pop();
      this.mids.pop();
    }
    for (let i = 0; i < this.n; i++) {
      const t = this.tips[Math.min(i, this.tips.length - 1)]!;
      const m = this.mids[Math.min(i, this.mids.length - 1)]!;
      this.pos.set([t.x, t.y, t.z], i * 6);
      this.pos.set([m.x, m.y, m.z], i * 6 + 3);
      const a = this.fade * (1 - i / this.n) * 0.45;
      this.alpha[i * 2] = a;
      this.alpha[i * 2 + 1] = a * 0.1;
    }
    this.mesh.geometry.attributes['position']!.needsUpdate = true;
    this.mesh.geometry.attributes['aAlpha']!.needsUpdate = true;
    this.mesh.visible = this.fade > 0.01;
  }
}

const WORDS_HEAVY = ['BUM!', 'ŁUP!', 'TRACH!', 'BAM!', 'DZYŃ!'];
const WORDS_LIGHT = ['PAC!', 'STUK!', 'TUP!', 'BRZĘK!'];

/** Komiksowe napisy w miejscu trafień (DOM nad płótnem). */
export class ComicText {
  private readonly layer: HTMLDivElement;
  constructor() {
    this.layer = document.createElement('div');
    this.layer.className = 'comic-layer';
    document.body.appendChild(this.layer);
  }

  show(p: THREE.Vector3, camera: THREE.Camera, power: number, word?: string): void {
    const v = p.clone().project(camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = 'comic-word';
    const list = power > 0.6 ? WORDS_HEAVY : WORDS_LIGHT;
    el.textContent = word ?? list[Math.floor(Math.random() * list.length)]!;
    el.style.left = `${(v.x * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
    el.style.fontSize = `${28 + power * 46}px`;
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 30}deg`);
    this.layer.appendChild(el);
    window.setTimeout(() => el.remove(), 650);
  }

  /** Krótki biały błysk całego ekranu przy najmocniejszych trafieniach. */
  flash(): void {
    const el = document.createElement('div');
    el.className = 'screen-flash';
    this.layer.appendChild(el);
    window.setTimeout(() => el.remove(), 180);
  }

  clear(): void {
    this.layer.replaceChildren();
  }
}

interface Puff {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
}

/** Stylizowane, „puchate” obłoczki kurzu i dymu (instancje brył low-poly z cieniowaniem toon). */
export class PuffSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap = 400;
  private items: Puff[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  density = 1;

  constructor(material: THREE.Material) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), material, this.cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, size: number, life: number, color: THREE.Color): void {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push({ pos: pos.clone(), vel: vel.clone(), life, max: life, size, color: color.clone() });
  }

  /** Pierścień obłoczków rozchodzących się po ziemi (lądowanie, wybuch). */
  ring(center: THREE.Vector3, n: number, radius: number, speed: number, size: number, color: THREE.Color): void {
    const count = Math.max(3, Math.round(n * this.density));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const p = new THREE.Vector3(center.x + Math.cos(a) * radius, Math.max(0.2, center.y), center.z + Math.sin(a) * radius);
      const v = new THREE.Vector3(Math.cos(a) * speed, 0.6 + Math.random(), Math.sin(a) * speed);
      this.spawn(p, v, size * (0.7 + Math.random() * 0.6), 0.55 + Math.random() * 0.35, color);
    }
  }

  update(dt: number): void {
    let n = 0;
    for (const p of this.items) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.multiplyScalar(Math.max(0, 1 - dt * 3.5));
      p.vel.y += dt * 0.6;
      p.pos.addScaledVector(p.vel, dt);
      const k = 1 - p.life / p.max;
      // Szybko rośnie, potem się kurczy – komiksowy obłoczek.
      const sc = p.size * Math.sin(Math.min(1, k * 1.15) * Math.PI) * (0.6 + k * 0.6);
      this.q.setFromAxisAngle(this.s.set(0.3, 1, 0.2).normalize(), p.max * 7 + k * 2);
      this.m.compose(p.pos, this.q, this.s.set(sc, sc * 0.85, sc));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.items = this.items.filter((p) => p.life > 0);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.items = [];
    this.mesh.count = 0;
  }
}

/** Smuga pocisku (wydłużony, świecący prostopadłościan, gaśnie po chwili). */
export class Tracers {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Mesh; life: number }[] = [];
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);

  fire(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, width = 0.12): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.geo, mat);
    const len = from.distanceTo(to);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.lookAt(to);
    mesh.scale.set(width, width, len);
    this.group.add(mesh);
    this.items.push({ mesh, life: 0.14 });
  }

  update(dt: number): void {
    for (const t of this.items) {
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / 0.14);
      t.mesh.scale.x *= 0.9;
      t.mesh.scale.y *= 0.9;
    }
    this.items = this.items.filter((t) => {
      if (t.life > 0) return true;
      t.mesh.removeFromParent();
      (t.mesh.material as THREE.Material).dispose();
      return false;
    });
  }
}
