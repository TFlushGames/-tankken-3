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
