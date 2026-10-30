// Renderer three.js: tylko CZYTA stan symulacji i interpoluje między klatkami.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { PROJECTILES } from '../data/projectiles';
import { TANKS } from '../data/tanks';
import {
  EV_BLAST, EV_BLOCK, EV_CLASH, EV_DASH, EV_FIRE, EV_HOOK, EV_PROJ_END, EV_SPAWN, EV_TELEPORT, EV_HIT, EV_JUMP, EV_KO, EV_LAND, EV_PLANT, EV_SHOT, EV_TECH, EV_THROW, EV_WALL, ST_AIR, ST_AIRHIT, ST_ATTACK, ST_KNOCKDOWN,
  ST_KO, ST_RUN,
} from '../sim/constants';
import { icos, isin } from '../sim/fixed';
import { barrelPoints, hullFrontPoints, hullTop } from '../sim/geometry';
import { TANK_PARAMS } from '../sim/params';
import { isMoveActive } from '../sim/step';
import type { FighterState, GameState, SimEvent } from '../sim/types';
import { ARENAS, Arena } from './arena';
import { CameraShake, ComicText, DebrisSystem, ImpactFX, ParticleSystem, PuffSystem, SwingTrail, Tracers } from './effects';
import { toonMat } from './toon';
import { TankModel } from './tankModel';

export interface Quality {
  shadows: boolean;
  post: boolean;
  particles: number;
}

const DEG = Math.PI / 18000;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % 36000;
  if (d > 18000) d -= 36000;
  if (d < -18000) d += 36000;
  return a + d * t;
}

/** Stan wizualny jednego czołgu (wyłącznie po stronie renderera). */
interface TankView {
  model: TankModel;
  sway: number;
  swayVel: number;
  roll: number;
  rollVel: number;
  prevAlong: number;
  prevYaw: number;
  prevX: number;
  prevZ: number;
  flash: number;
  destroyed: boolean;
  decals: THREE.Mesh[];
  smokeTimer: number;
  markTimer: number;
  tumble: number;
  squash: number;
  lean: number;
  prevY: number;
  trail: SwingTrail;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private fxaa: ShaderPass;
  private arena: Arena | null = null;
  private views: TankView[] = [];
  private readonly sparks = new ParticleSystem(1500, true);
  private readonly smoke = new ParticleSystem(1500, false);
  private readonly debris: DebrisSystem;
  private readonly shake = new CameraShake();
  private readonly impacts = new ImpactFX();
  private readonly puffs = new PuffSystem(toonMat({ color: 0xffffff }));
  private readonly tracers = new Tracers();
  private vignette: ShaderPass;
  /** Światło wypełniające od strony kamery – czołgi czytelne nawet pod słońce. */
  private readonly fill = new THREE.DirectionalLight(0xffe2c4, 2.3);
  private readonly comic = new ComicText();
  private fovKick = 0;
  private readonly camPos = new THREE.Vector3(0, 5, 20);
  private readonly camLook = new THREE.Vector3(0, 1, 0);
  private camAngle = 0;
  private seen = new Map<string, number>();
  private debugGroup = new THREE.Group();
  private debugHit: THREE.Mesh[] = [];
  private debugBoxes: THREE.LineSegments[] = [];
  private decalGeo = new THREE.CircleGeometry(0.16, 10);
  private decalMat = new THREE.MeshBasicMaterial({
    color: 0x111111, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -4,
  });
  private time = 0;
  private dustColor = new THREE.Color(0x8a7458);
  quality: Quality = { shadows: true, post: true, particles: 1 };
  showDebug = false;
  showroom = false;
  private roundSeen = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.debris = new DebrisSystem(this.scene);
    this.scene.add(this.sparks.points, this.smoke.points, this.debugGroup, this.impacts.group, this.puffs.mesh, this.tracers.group);
    this.scene.add(this.fill, this.fill.target);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.28, 0.6, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // Winieta i lekkie ocieplenie – wieczorny, nieco mroczniejszy nastrój.
    this.vignette = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uStrength: { value: 0.55 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uStrength; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.25, length(d * vec2(1.25, 1.0)));
        c.rgb *= mix(1.0 - uStrength, 1.0, v); c.rgb = mix(c.rgb, c.rgb * vec3(1.04, 1.0, 0.94), 0.6); gl_FragColor = c; }`,
    });
    this.composer.addPass(this.vignette);
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.buildDebug();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.renderer.shadowMap.enabled = q.shadows;
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.Material;
        m.needsUpdate = true;
      }
    });
    this.sparks.density = q.particles;
    this.smoke.density = q.particles;
    this.puffs.density = q.particles;
    if (this.arenaIndex >= 0) this.setArena(this.arenaIndex);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.fxaa.material.uniforms['resolution']!.value.set(1 / (w * pr), 1 / (h * pr));
    this.sparks.setScale(h * pr * 1.2);
    this.smoke.setScale(h * pr * 1.2);
  }

  private arenaIndex = -1;

  setArena(index: number): void {
    if (this.arena) this.arena.dispose(this.scene);
    this.arenaIndex = index % ARENAS.length;
    const def = ARENAS[this.arenaIndex]!;
    this.arena = new Arena(def, this.scene, this.quality.particles);
    this.dustColor.set(def.dust);
  }

  /** Tworzy modele dla meczu. Lustrzany pojedynek → wariant kolorystyczny gracza 2. */
  setTanks(t1: number, t2: number): void {
    for (const v of this.views) {
      this.scene.remove(v.model.root);
      this.scene.remove(v.trail.mesh);
    }
    this.comic.clear();
    this.debris.clear();
    this.views = [t1, t2].map((t, i) => {
      const model = new TankModel(TANKS[t]!, i === 1 && t1 === t2);
      this.scene.add(model.root);
      return {
        model, sway: 0, swayVel: 0, roll: 0, rollVel: 0, prevAlong: 0, prevYaw: 0, prevX: 0, prevZ: 0,
        flash: 0, destroyed: false, decals: [], smokeTimer: 0, markTimer: 0, tumble: 0, squash: 0, lean: 0, prevY: 0,
        trail: this.makeTrail(i),
      };
    });
    this.arena?.marks.clear();
    this.roundSeen = -1;
  }

  private buildDebug(): void {
    const hitGeo = new THREE.SphereGeometry(1, 10, 6);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ color: 0xff3030, wireframe: true, depthTest: false }));
      m.renderOrder = 10;
      this.debugHit.push(m);
      this.debugGroup.add(m);
    }
    const boxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    for (let i = 0; i < 4; i++) {
      const b = new THREE.LineSegments(boxGeo, new THREE.LineBasicMaterial({ color: 0x30ff60, depthTest: false }));
      b.renderOrder = 10;
      this.debugBoxes.push(b);
      this.debugGroup.add(b);
    }
    this.debugGroup.visible = false;
  }

  private updateDebug(s: GameState): void {
    this.debugGroup.visible = this.showDebug;
    if (!this.showDebug) return;
    let hi = 0;
    for (let i = 0; i < 2; i++) {
      const f = s.fighters[i]!;
      const t = TANK_PARAMS[f.tank]!;
      const active = isMoveActive(f);
      const pts = [...barrelPoints(f, t), ...hullFrontPoints(f, t)];
      for (let k = 0; k < pts.length && hi < this.debugHit.length; k++) {
        const p = pts[k]!;
        const m = this.debugHit[hi++]!;
        const isBarrel = k < 6;
        m.position.set(p.x / 1000, p.y / 1000, p.z / 1000);
        m.scale.setScalar((isBarrel ? t.barrelRadius : 350) / 1000);
        (m.material as THREE.MeshBasicMaterial).color.set(active ? 0xff2020 : 0x777777);
        m.visible = true;
      }
      const yaw = -(f.hullYaw + f.pivot) * DEG;
      const top = hullTop(f, t);
      const hull = this.debugBoxes[i * 2]!;
      hull.position.set(f.x / 1000, (f.y + 100 + top) / 2000, f.z / 1000);
      hull.scale.set((t.halfLen * 2) / 1000, (top - f.y - 100) / 1000, (t.halfWid * 2) / 1000);
      hull.rotation.set(0, yaw, 0);
      const tur = this.debugBoxes[i * 2 + 1]!;
      const ox = (t.turretOffset * icos(f.hullYaw + f.pivot)) / 16384;
      const oz = (t.turretOffset * isin(f.hullYaw + f.pivot)) / 16384;
      tur.position.set((f.x + ox) / 1000, (top + t.turretHeight / 2) / 1000, (f.z + oz) / 1000);
      tur.scale.set((t.turretRadius * 2) / 1000, t.turretHeight / 1000, (t.turretRadius * 2) / 1000);
      tur.rotation.set(0, yaw, 0);
      const col = f.invuln > 0 ? 0x4080ff : f.linearInvuln > 0 ? 0xffe040 : 0x30ff60;
      (hull.material as THREE.LineBasicMaterial).color.set(col);
    }
  }

  // ------------------------------------------------------------ zdarzenia

  /** Obsługa zdarzeń z symulacji – odporna na rollback (każde zdarzenie tylko raz). */
  handleEvents(events: SimEvent[], s: GameState): SimEvent[] {
    const fresh: SimEvent[] = [];
    for (const e of events) {
      const key = `${e.frame}|${e.type}|${e.actor}|${e.x}|${e.z}`;
      if (this.seen.has(key)) continue;
      this.seen.set(key, e.frame);
      fresh.push(e);
      this.effectFor(e, s);
    }
    if (this.seen.size > 400) {
      for (const [k, f] of this.seen) if (f < s.frame - 240) this.seen.delete(k);
    }
    return fresh;
  }

  private effectFor(e: SimEvent, s: GameState): void {
    const p = new THREE.Vector3(e.x / 1000, e.y / 1000, e.z / 1000);
    switch (e.type) {
      case EV_HIT: {
        const power = Math.min(1, e.power / 140);
        this.sparks.burst(18 + power * 40, { x: p.x, y: p.y, z: p.z, life: 0.35, size: 0.12, color: new THREE.Color(1.0, 0.75, 0.35), gravity: 9, drag: 2 }, 9 + power * 8);
        this.sparks.burst(6, { x: p.x, y: p.y, z: p.z, life: 0.12, size: 0.9 + power, color: new THREE.Color(1, 0.9, 0.7) }, 0.5);
        this.smoke.burst(6, { x: p.x, y: p.y, z: p.z, life: 0.9, size: 0.5, grow: 2, color: new THREE.Color(0.3, 0.28, 0.25), gravity: -0.6, drag: 2 }, 1.5);
        // Wstrząs zależny od masy atakującego – ciężki cios czuć mocniej.
        const am = e.actor >= 0 ? TANK_PARAMS[s.fighters[e.actor]!.tank]!.mass : 35000;
        this.shake.add((0.25 + power * 0.55) * (0.6 + am / 75000));
        this.impacts.spawn(p, power);
        this.fovKick = Math.max(this.fovKick, 1.5 + power * 4);
        if (power > 0.3 || Math.random() < 0.35) this.comic.show(p, this.camera, power);
        if (power > 0.75) this.comic.flash();
        const defender = e.actor >= 0 ? this.views[1 - e.actor] : undefined;
        if (defender) {
          defender.flash = 1;
          this.addDecal(defender, p);
          defender.roll += (Math.random() < 0.5 ? -1 : 1) * 0.12 * power;
          defender.squash = -0.12 - power * 0.12;
          const df = s.fighters[1 - e.actor]!;
          if (df.hp < 250) this.dropSkirt(defender);
        }
        break;
      }
      case EV_BLOCK:
        this.sparks.burst(14, { x: p.x, y: p.y, z: p.z, life: 0.25, size: 0.1, color: new THREE.Color(0.6, 0.8, 1.0), gravity: 6, drag: 3 }, 7);
        this.sparks.burst(3, { x: p.x, y: p.y, z: p.z, life: 0.1, size: 0.7, color: new THREE.Color(0.7, 0.85, 1) }, 0.3);
        this.impacts.spawn(p, 0.15, new THREE.Color(0.6, 0.85, 1));
        this.shake.add(0.15);
        break;
      case EV_SHOT: {
        // Smugacze OSY: jasne punkty wzdłuż linii strzału.
        const a = s.fighters[e.actor]!;
        const from = new THREE.Vector3(a.tipX / 1000, a.tipY / 1000, a.tipZ / 1000);
        const dir = p.clone().sub(from).normalize();
        for (let k = 0; k < 4; k++) {
          this.sparks.spawn({ x: from.x, y: from.y, z: from.z, vx: dir.x * 40, vy: dir.y * 40, vz: dir.z * 40, life: 0.08 + k * 0.02, size: 0.2, color: new THREE.Color(1, 0.9, 0.4) });
        }
        this.sparks.burst(3, { x: from.x, y: from.y, z: from.z, life: 0.06, size: 0.6, color: new THREE.Color(1, 0.8, 0.4) }, 0.2);
        break;
      }
      case EV_DASH: {
        const f = s.fighters[e.actor]!;
        const v = this.views[e.actor];
        if (v) {
          const back = new THREE.Vector3(-v.model.def.hullLength / 2 * Math.sign(e.power || 1), 0.4, 0);
          const p0 = v.model.root.localToWorld(back);
          const dir = p0.clone().sub(new THREE.Vector3(f.x / 1000, 0.4, f.z / 1000)).setY(0).normalize();
          for (let k = 0; k < 6; k++) this.puffs.spawn(p0.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 0.4, (Math.random() - 0.5) * 1.2)), dir.clone().multiplyScalar(3 + Math.random() * 3), 0.55, 0.5, this.dustColor);
        }
        this.shake.add(0.08);
        break;
      }
      case EV_JUMP:
        this.puffs.ring(p, 8, 1.6, 4, 0.5, this.dustColor);
        break;
      case EV_PLANT:
        this.puffs.ring(p, 7, 0.4, 3, 0.45, this.dustColor);
        this.sparks.burst(16, { x: p.x, y: p.y + 0.1, z: p.z, life: 0.3, size: 0.1, color: new THREE.Color(1, 0.8, 0.4), gravity: 9, drag: 2 }, 6);
        this.shake.add(0.15);
        break;
      case EV_FIRE: {
        const a = s.fighters[e.actor]!;
        const t = TANK_PARAMS[a.tank]!;
        const dir = new THREE.Vector3(a.tipX - a.x, a.tipY - a.y - t.hullHeight / 2, a.tipZ - a.z).normalize();
        this.tracers.fire(p, p.clone().addScaledVector(dir, 16), new THREE.Color(1, 0.75, 0.35));
        this.sparks.burst(8, { x: p.x, y: p.y, z: p.z, life: 0.1, size: 0.9, color: new THREE.Color(1, 0.8, 0.4) }, 1);
        this.puffs.spawn(p, dir.clone().multiplyScalar(2), 0.9, 0.6, new THREE.Color(0.85, 0.82, 0.78));
        this.shake.add(0.3);
        this.fovKick = Math.max(this.fovKick, 2);
        break;
      }
      case EV_BLAST:
        this.sparks.burst(50, { x: p.x, y: p.y, z: p.z, life: 0.5, size: 0.2, color: new THREE.Color(1, 0.6, 0.2), gravity: 8, drag: 1.5 }, 10);
        this.sparks.burst(10, { x: p.x, y: p.y + 0.4, z: p.z, life: 0.3, size: 2.0, grow: 1, color: new THREE.Color(1, 0.6, 0.25), drag: 3 }, 2);
        this.puffs.ring(p, 14, 1.0, 7, 1.0, new THREE.Color(0.75, 0.7, 0.62));
        this.impacts.spawn(p, 0.9);
        this.shake.add(0.7);
        this.fovKick = Math.max(this.fovKick, 5);
        break;
      case EV_LAND:
      case EV_WALL:
      case EV_THROW:
      case EV_TECH: {
        const power = Math.min(1.5, e.power / 40000);
        this.puffs.ring(new THREE.Vector3(p.x, 0.2, p.z), 6 + power * 8, 1.8, 3 + power * 4, 0.5 + power * 0.4, this.dustColor);
        const n = 4 + power * 8;
        for (let k = 0; k < n * this.quality.particles; k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 2 + Math.random() * 3 * (0.5 + power);
          this.smoke.spawn({
            x: p.x + Math.cos(a) * 1.5, y: 0.2, z: p.z + Math.sin(a) * 1.5,
            vx: Math.cos(a) * sp, vy: 0.4 + Math.random(), vz: Math.sin(a) * sp,
            life: 1.0 + Math.random() * 0.6, size: 0.8, grow: 2.5, color: this.dustColor, drag: 2.5,
          });
        }
        if (e.type !== EV_THROW) this.shake.add(Math.min(0.7, 0.1 + power * 0.4));
        break;
      }
      case EV_SPAWN:
        this.sparks.burst(10, { x: p.x, y: p.y, z: p.z, life: 0.12, size: 1.1, color: new THREE.Color(1, 0.8, 0.45) }, 1.5);
        this.puffs.spawn(p, new THREE.Vector3(0, 1, 0), 0.9, 0.7, new THREE.Color(0.85, 0.82, 0.78));
        this.shake.add(PROJECTILES[e.power]?.id === 'bertha' ? 0.5 : 0.25);
        this.fovKick = Math.max(this.fovKick, 2.5);
        break;
      case EV_CLASH:
        this.sparks.burst(60, { x: p.x, y: p.y, z: p.z, life: 0.5, size: 0.2, color: new THREE.Color(1, 0.75, 0.3), gravity: 6, drag: 1.5 }, 12);
        this.impacts.spawn(p, 1);
        this.puffs.ring(p, 10, 0.5, 6, 0.9, new THREE.Color(0.8, 0.76, 0.7));
        this.shake.add(0.6);
        break;
      case EV_PROJ_END:
        this.puffs.spawn(p, new THREE.Vector3(0, 1, 0), 0.6, 0.4, new THREE.Color(0.8, 0.76, 0.7));
        break;
      case EV_TELEPORT:
        // Zniknięcie/pojawienie się: kłąb dymu i iskry.
        this.puffs.ring(new THREE.Vector3(p.x, Math.max(0.3, p.y), p.z), 14, 1.2, 6, 1.0, e.power ? new THREE.Color(0.95, 0.75, 0.4) : this.dustColor);
        this.sparks.burst(30, { x: p.x, y: Math.max(0.5, p.y), z: p.z, life: 0.4, size: 0.15, color: new THREE.Color(1, 0.8, 0.35), drag: 2 }, 9);
        break;
      case EV_HOOK: {
        const a = s.fighters[e.actor]!;
        const o = s.fighters[1 - e.actor]!;
        const to = new THREE.Vector3(o.x / 1000, p.y, o.z / 1000);
        void a;
        this.tracers.fire(p, to, new THREE.Color(0.55, 0.95, 1), 0.07);
        this.tracers.fire(p, to, new THREE.Color(0.2, 0.5, 0.6), 0.16);
        this.shake.add(0.2);
        break;
      }
      case EV_KO:
        this.explode(e.actor, s);
        break;
      default:
        break;
    }
  }

  private addDecal(v: TankView, worldP: THREE.Vector3): void {
    const local = v.model.body.worldToLocal(worldP.clone());
    const d = new THREE.Mesh(this.decalGeo, this.decalMat);
    const def = v.model.def;
    // Przyklej na najbliższą ścianę kadłuba (przybliżenie).
    const hx = def.hullLength / 2;
    const hz = def.hullWidth / 2;
    if (Math.abs(local.z) / hz > Math.abs(local.x) / hx) {
      local.z = Math.sign(local.z) * (hz + 0.06);
      d.rotation.y = local.z > 0 ? 0 : Math.PI;
    } else {
      local.x = Math.sign(local.x) * (hx + 0.06);
      d.rotation.y = local.x > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    local.y = THREE.MathUtils.clamp(local.y, 0.3, def.hullHeight + def.turretHeight);
    d.position.copy(local);
    d.scale.setScalar(0.6 + Math.random() * 0.8);
    v.model.body.add(d);
    v.decals.push(d);
    if (v.decals.length > 24) v.decals.shift()!.removeFromParent();
  }

  private dropSkirt(v: TankView): void {
    const sk = v.model.skirts.filter((x) => x.parent === v.model.body);
    if (!sk.length || Math.random() < 0.4) return;
    const piece = sk[Math.floor(Math.random() * sk.length)]!;
    this.debris.add(piece, new THREE.Vector3((Math.random() - 0.5) * 3, 3, (Math.random() - 0.5) * 3), new THREE.Vector3(Math.random() * 5, Math.random() * 5, Math.random() * 5), 8);
  }

  private explode(i: number, s: GameState): void {
    const v = this.views[i];
    if (!v || v.destroyed) return;
    v.destroyed = true;
    const f = s.fighters[i]!;
    const p = new THREE.Vector3(f.x / 1000, 1.5, f.z / 1000);
    this.sparks.burst(120, { x: p.x, y: p.y, z: p.z, life: 0.9, size: 0.25, color: new THREE.Color(1, 0.6, 0.2), gravity: 6, drag: 1.2 }, 14);
    this.sparks.burst(30, { x: p.x, y: p.y + 0.5, z: p.z, life: 0.6, size: 2.2, grow: 1.5, color: new THREE.Color(1, 0.55, 0.2), drag: 3 }, 4);
    this.smoke.burst(60, { x: p.x, y: p.y, z: p.z, life: 3.0, size: 1.2, grow: 3, color: new THREE.Color(0.12, 0.11, 0.1), gravity: -1.2, drag: 1.2 }, 4);
    this.shake.add(1);
    // Wieża odlatuje w zwolnionym tempie.
    this.debris.add(v.model.turret, new THREE.Vector3((Math.random() - 0.5) * 3, 11, (Math.random() - 0.5) * 3), new THREE.Vector3(2 + Math.random() * 2, Math.random() * 3, 1.5), 12, 0.45);
    v.model.char();
    this.comic.show(p.clone().setY(3), this.camera, 1.2, 'KA-BOOM!');
  }

  // ------------------------------------------------------------ klatka

  render(prev: GameState, curr: GameState, alpha: number, dtRaw: number): void {
    // Po powrocie do karty przeglądarki dt bywa ogromne – efekty liczymy z ograniczonym krokiem.
    const dt = Math.min(dtRaw, 0.05);
    this.time += dt;
    if (curr.round !== this.roundSeen && this.views.length) {
      if (this.roundSeen !== -1) {
        // Nowa runda – świeże modele.
        this.setTanks(curr.fighters[0].tank, curr.fighters[1].tank);
      }
      this.roundSeen = curr.round;
    }
    for (let i = 0; i < this.views.length; i++) {
      this.updateTank(this.views[i]!, prev.fighters[i]!, curr.fighters[i]!, alpha, dt);
    }
    const slow = curr.slowmo > 0 ? 0.4 : 1;
    this.sparks.update(dt * slow);
    this.smoke.update(dt * slow);
    this.puffs.update(dt * slow);
    this.tracers.update(dt * slow);
    if (this.arena) {
      const tanks = curr.fighters.map((f) => new THREE.Vector3(f.x / 1000, f.z / 1000, f.y < 500 ? TANK_PARAMS[f.tank]!.halfLen / 1000 + 0.6 : 0.01));
      this.arena.update(this.time, tanks);
    }
    this.debris.update(dt, slow);
    this.impacts.update(dt * slow);
    this.shake.update(dt);
    this.fovKick = Math.max(0, this.fovKick - dt * 25);
    this.camera.fov = 35 - this.fovKick;
    this.camera.updateProjectionMatrix();
    this.arena?.marks.flush();
    this.updateProjectiles(prev, curr, alpha, dt);
    this.updateCamera(prev, curr, alpha, dt);
    this.updateDebug(curr);
    this.draw();
  }

  private draw(): void {
    if (this.quality.post) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private updateTank(v: TankView, a: FighterState, b: FighterState, t: number, dt: number): void {
    const m = v.model;
    const x = lerp(a.x, b.x, t) / 1000;
    const y = lerp(a.y, b.y, t) / 1000;
    const z = lerp(a.z, b.z, t) / 1000;
    const yawCd = lerpAngle(a.hullYaw + a.pivot, b.hullYaw + b.pivot, t);
    m.root.position.set(x, y, z);
    m.root.rotation.y = -yawCd * DEG;
    m.body.position.y = -lerp(a.susp, b.susp, t) / 1000;
    m.turret.rotation.y = -lerp(a.turretYaw, b.turretYaw, t) * DEG;
    m.mantlet.rotation.z = lerp(a.pitch, b.pitch, t) * DEG;
    m.barrel.position.x = lerp(a.ext, b.ext, t) / 1000;

    // Prędkość wzdłuż kadłuba i obrót → przesuw gąsienic.
    const yawRad = yawCd * DEG;
    const dx = x - v.prevX;
    const dz = z - v.prevZ;
    const along = dx * Math.cos(yawRad) + dz * Math.sin(yawRad);
    let dyaw = yawCd - v.prevYaw;
    if (dyaw > 18000) dyaw -= 36000;
    if (dyaw < -18000) dyaw += 36000;
    const turn = Math.abs(dyaw) > 9000 ? 0 : dyaw * DEG * (m.def.hullWidth / 2);
    const grounded = y < 0.05;
    if (grounded && dt > 0) m.updateTracks(along - turn, along + turn, this.time, Math.min(1, Math.abs(along) * 20));
    else m.updateTracks(0, 0, this.time, 0);
    v.prevX = x;
    v.prevZ = z;
    v.prevYaw = yawCd;

    // Przechył od przyspieszania/hamowania: tłumienie wykładnicze (stabilne przy każdym FPS,
    // bez sprężyn, które przy nierównych klatkach „galaretowały”).
    const dtc = Math.min(dt, 1 / 30);
    if (dtc > 0) {
      const vel = along / Math.max(dt, 1e-3);
      const acc = (vel - v.prevAlong) / Math.max(dt, 1e-3);
      v.prevAlong = vel;
      const target = THREE.MathUtils.clamp(-acc * 0.003, -0.07, 0.07);
      v.sway += (target - v.sway) * (1 - Math.exp(-8 * dtc));
      v.roll *= Math.exp(-7 * dtc);
    }
    // Spokojny „oddech” na zawieszeniu w postawie bojowej.
    const idle = b.state === 0 && b.y <= 0 ? Math.sin(this.time * 5 + m.def.mass) * 0.012 : 0;
    m.body.position.y += idle;
    m.body.rotation.z = lerp(a.lift, b.lift, t) * DEG + v.sway;
    m.body.rotation.x = v.roll;
    if (b.state === ST_KO && !v.destroyed) m.body.rotation.x = 0.05;

    // Salto po wyrzucie (do tyłu) i pochylenie w locie – czysto wizualne.
    const TWO_PI = Math.PI * 2;
    if (b.state === ST_AIRHIT && dt > 0) {
      v.tumble += dt * (b.vy > 0 ? 11 : 7);
    } else {
      const target = Math.round(v.tumble / TWO_PI) * TWO_PI;
      v.tumble += (target - v.tumble) * Math.min(1, dt * 14);
    }
    let tilt = 0;
    if (b.state === ST_AIR || (b.state === ST_ATTACK && b.y > 0)) tilt = THREE.MathUtils.clamp(b.vy * 0.0009, -0.45, 0.45);
    if (b.state === ST_KNOCKDOWN && b.y <= 0) tilt = -0.12 + Math.sin(this.time * 18) * 0.03 * Math.max(0, 1 - b.stateFrame / 20);
    m.spin.rotation.z = v.tumble + tilt + lerp(a.bodyPitch, b.bodyPitch, t) * DEG;

    // Kreskówkowa „waga”: zgniecenie przy lądowaniu, rozciągnięcie w wyskoku,
    // przechył na bok przy zamachu wieży (jak boksera przenoszącego ciężar).
    if (dtc > 0) {
      if (v.prevY > 0.08 && y <= 0.001) v.squash = Math.min(v.squash, -0.08 - Math.min(0.2, v.prevY * 0.1));
      v.prevY = y;
      const stretch = y > 0.05 ? THREE.MathUtils.clamp(b.vy / 2200, -0.1, 0.16) : 0;
      v.squash += (stretch - v.squash) * (1 - Math.exp(-(v.squash < stretch ? 10 : 7) * dtc));
      const tp = TANK_PARAMS[b.tank]!;
      const swing = (b.turretVel / tp.turretMaxVel) * 0.22 + (b.pivotVel / Math.max(1, tp.spinMaxVel)) * 0.35;
      v.lean += (THREE.MathUtils.clamp(swing, -0.32, 0.32) - v.lean) * (1 - Math.exp(-9 * dtc));
    }
    const sq = v.squash;
    m.spin.scale.set(1 - sq * 0.55, 1 + sq, 1 - sq * 0.55);
    m.body.rotation.x = v.roll + v.lean;

    // Smuga ciosu za końcem lufy.
    m.root.updateMatrixWorld(true);
    const tip = m.barrel.localToWorld(m.tipLocal.clone());
    const mid = m.barrel.localToWorld(m.midLocal.clone());
    v.trail.push(tip, mid, b.state === ST_ATTACK && !v.destroyed, dt);

    // Błysk trafienia.
    v.flash = Math.max(0, v.flash - dt * 6);
    if (!v.destroyed) m.setFlash(v.flash * 0.8);

    // Dym, ogień, wydech, kurz spod gąsienic, ślady.
    v.smokeTimer -= dt;
    const world = m.root.localToWorld(m.exhaust.clone());
    const deck = m.root.localToWorld(m.engineDeck.clone());
    if (v.smokeTimer <= 0) {
      v.smokeTimer = 0.05;
      const running = b.state === ST_RUN;
      if (running || Math.random() < 0.3) {
        this.smoke.spawn({ x: world.x, y: world.y, z: world.z, vx: (Math.random() - 0.5) * 0.4, vy: 0.8, vz: (Math.random() - 0.5) * 0.4, life: running ? 1.2 : 0.8, size: running ? 0.45 : 0.25, grow: 3, color: new THREE.Color(0.18, 0.18, 0.18), drag: 1 });
      }
      if (running && grounded) {
        for (let k = 0; k < 2; k++) {
          const back = new THREE.Vector3(-m.def.hullLength / 2, 0.2, (k ? 1 : -1) * m.def.hullWidth * 0.4);
          const p = m.root.localToWorld(back);
          this.smoke.spawn({ x: p.x, y: p.y, z: p.z, vx: -Math.cos(yawRad) * 2 + (Math.random() - 0.5), vy: 1.5 + Math.random() * 2, vz: -Math.sin(yawRad) * 2 + (Math.random() - 0.5), life: 0.6, size: 0.18, color: this.dustColor, gravity: 9 });
          this.smoke.spawn({ x: p.x, y: p.y, z: p.z, vx: -Math.cos(yawRad), vy: 0.6, vz: -Math.sin(yawRad), life: 1.0, size: 0.7, grow: 2, color: this.dustColor, drag: 2 });
        }
      }
      if (b.hp < 500 || v.destroyed) {
        this.smoke.spawn({ x: deck.x + (Math.random() - 0.5) * 0.6, y: deck.y, z: deck.z + (Math.random() - 0.5) * 0.6, vx: 0, vy: 1.4, vz: 0, life: 2.2, size: 0.5, grow: 4, color: new THREE.Color(0.1, 0.1, 0.1), drag: 0.8, gravity: -0.3 });
      }
      if (b.hp < 250 || v.destroyed) {
        this.sparks.spawn({ x: deck.x + (Math.random() - 0.5) * 0.5, y: deck.y, z: deck.z + (Math.random() - 0.5) * 0.5, vx: 0, vy: 2, vz: 0, life: 0.5, size: 0.6, grow: -0.5, color: new THREE.Color(1, 0.45, 0.12), drag: 1 });
      }
    }
    if (grounded && this.arena && Math.abs(along) > 0.002) {
      v.markTimer -= dt;
      if (v.markTimer <= 0) {
        v.markTimer = 0.04;
        for (const side of [-1, 1]) {
          const off = side * (m.def.hullWidth / 2 - 0.3);
          this.arena.marks.stamp(x - Math.sin(yawRad) * off, z + Math.cos(yawRad) * off, yawRad, 0.45, 0.35, 0.08);
        }
      }
    }
  }

  private updateCamera(prev: GameState, curr: GameState, t: number, dt: number): void {
    const [a0, b0] = prev.fighters;
    const [a1, b1] = curr.fighters;
    const ax = lerp(a0.x, a1.x, t) / 1000;
    const az = lerp(a0.z, a1.z, t) / 1000;
    const bx = lerp(b0.x, b1.x, t) / 1000;
    const bz = lerp(b0.z, b1.z, t) / 1000;
    // Kamera nie leci za czołgiem wyskakującym poza arenę.
    const ay = Math.min(2.5, lerp(a0.y, a1.y, t) / 1000);
    const by = Math.min(2.5, lerp(b0.y, b1.y, t) / 1000);
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;
    const sep = Math.hypot(bx - ax, bz - az);
    // Kąt kamery płynnie dąży do osi walki z symulacji.
    let target = curr.camRight;
    let d = (target - this.camAngle) % 36000;
    if (d > 18000) d -= 36000;
    if (d < -18000) d += 36000;
    this.camAngle += d * Math.min(1, dt * 5);
    target = this.camAngle * DEG;
    const intoX = Math.sin(target);
    const intoZ = -Math.cos(target);
    const dist = this.showroom ? 14 : THREE.MathUtils.clamp(sep * 1.15 + 10, 15, 27);
    const height = 2.4 + dist * 0.16 + Math.max(ay, by) * 0.3;
    // Płaszczyzna bliska rośnie z odległością kamery: nic między kamerą a walką jej nie zasłania
    // (dolna krawędź kadru wciąż trafia w podłoże – sprawdzone dla zakresu 15–27 m).
    this.camera.near = this.showroom ? 0.1 : dist * 0.45;
    const desired = new THREE.Vector3(midX - intoX * dist, height, midZ - intoZ * dist);
    const look = new THREE.Vector3(midX, 1.3 + Math.max(ay, by) * 0.4, midZ);
    const k = Math.min(1, dt * 6);
    this.camPos.lerp(desired, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos).add(this.shake.offset);
    this.camera.lookAt(this.camLook);
    this.fill.position.copy(this.camPos).setY(this.camPos.y + 6);
    this.fill.target.position.copy(this.camLook);
    if (this.arena) {
      // Cień podąża za walką.
      this.arena.sun.target.position.set(midX, 0, midZ);
      const [sx, sy, sz] = this.arena.def.sunDir;
      this.arena.sun.position.set(midX + sx * 40, sy * 40, midZ + sz * 40);
    }
  }

  private projMeshes = new Map<number, THREE.Object3D>();

  private makeProjectile(kind: string): THREE.Object3D {
    const g = new THREE.Group();
    const glow = (r: number, c: number, o: number): THREE.Mesh => new THREE.Mesh(
      new THREE.SphereGeometry(r, 12, 8),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false }));
    if (kind === 'shell') {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff0b0 })), glow(0.5, 0xff9a30, 0.55));
    } else if (kind === 'bertha') {
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), toonMat({ color: 0x3a3430, emissive: 0x401a08 })), glow(0.9, 0xff5a1a, 0.45));
    } else if (kind === 'rail') {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: 0xc8f6ff }));
      beam.position.x = -1.4;
      const halo = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0x3ad0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.position.x = -1.5;
      g.add(beam, halo);
    }
    this.scene.add(g);
    return g;
  }

  /** Pociski: interpolacja pozycji po id, smugi i kurz fali. */
  private updateProjectiles(prev: GameState, curr: GameState, t: number, dt: number): void {
    const seen = new Set<number>();
    for (const p of curr.projectiles) {
      seen.add(p.id);
      const kind = PROJECTILES[p.kind]!.id;
      let mesh = this.projMeshes.get(p.id);
      if (!mesh) {
        mesh = this.makeProjectile(kind);
        this.projMeshes.set(p.id, mesh);
      }
      const q = prev.projectiles.find((x) => x.id === p.id) ?? p;
      const pos = new THREE.Vector3(lerp(q.x, p.x, t) / 1000, lerp(q.y, p.y, t) / 1000, lerp(q.z, p.z, t) / 1000);
      mesh.position.copy(pos);
      mesh.rotation.y = -Math.atan2(p.vz, p.vx);
      mesh.rotation.x += dt * 8;
      if (dt > 0) {
        if (kind === 'wave') {
          // Fala: wybrzuszenie ziemi – obłoczki kurzu i grudy.
          this.puffs.ring(pos.clone().setY(0.2), 2, 0.6, 2.5, 0.55, this.dustColor);
          this.sparks.spawn({ x: pos.x, y: 0.2, z: pos.z, vx: (Math.random() - 0.5) * 2, vy: 4 + Math.random() * 3, vz: (Math.random() - 0.5) * 2, life: 0.4, size: 0.12, color: new THREE.Color(0.5, 0.4, 0.3), gravity: 14 });
        } else if (kind === 'bertha') {
          this.puffs.spawn(pos, new THREE.Vector3(0, 0.5, 0), 0.5, 0.6, new THREE.Color(0.35, 0.32, 0.3));
          this.sparks.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 0.5, vz: 0, life: 0.25, size: 0.7, color: new THREE.Color(1, 0.45, 0.15) });
        } else if (kind === 'shell') {
          this.sparks.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 0, vz: 0, life: 0.18, size: 0.4, color: new THREE.Color(1, 0.7, 0.3) });
        }
      }
    }
    for (const [id, mesh] of this.projMeshes) {
      if (seen.has(id)) continue;
      mesh.removeFromParent();
      this.projMeshes.delete(id);
    }
  }

  private makeTrail(i: number): SwingTrail {
    const trail = new SwingTrail(i === 0 ? new THREE.Color(1, 0.75, 0.25) : new THREE.Color(0.35, 0.8, 1));
    this.scene.add(trail.mesh);
    return trail;
  }

  /** Pokaz modeli na ekranie wyboru: czołgi obracają się na „podestach”. */
  renderShowroom(t1: number, t2: number, dt: number): void {
    this.time += dt;
    if (this.camera.near !== 0.1 || this.camera.fov !== 35) {
      this.camera.near = 0.1;
      this.camera.fov = 35;
      this.camera.updateProjectionMatrix();
    }
    if (!this.views.length || this.views[0]!.model.def !== TANKS[t1] || this.views[1]!.model.def !== TANKS[t2]) {
      this.setTanks(t1, t2);
    }
    const spin = this.time * 0.5;
    for (let i = 0; i < 2; i++) {
      const v = this.views[i]!;
      const m = v.model;
      m.root.position.set(i === 0 ? -2.7 : 2.7, 0, i === 0 ? 0.6 : -0.6);
      m.root.rotation.y = spin * (i === 0 ? 1 : -1) + (i === 0 ? 0.6 : Math.PI - 0.6);
      m.turret.rotation.y = Math.sin(this.time * 0.9 + i) * 0.5;
      m.mantlet.rotation.z = (Math.sin(this.time * 1.3 + i) * 0.5 + 0.5) * 0.25;
      m.body.position.y = 0;
      m.body.rotation.set(0, 0, 0);
      m.updateTracks(0.01, 0.01, this.time, 0.3);
    }
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.puffs.update(dt);
    this.arena?.update(this.time, [new THREE.Vector3(-3.4, 0, 3.2), new THREE.Vector3(3.4, 0, 3.2)]);
    this.fill.position.set(0, 10, 18);
    this.fill.target.position.set(0, 1, 0);
    // Kamera patrzy nad czołgi, by stały w dolnej części ekranu – pod panelami wyboru.
    const desired = new THREE.Vector3(0, 3.0, 14);
    this.camPos.lerp(desired, Math.min(1, dt * 3));
    this.camLook.lerp(new THREE.Vector3(0, 3.3, 0), Math.min(1, dt * 3));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (this.arena) {
      this.arena.sun.target.position.set(0, 0, 0);
      const [sx, sy, sz] = this.arena.def.sunDir;
      this.arena.sun.position.set(sx * 40, sy * 40, sz * 40);
    }
    this.draw();
  }
}
