// Finishery: krótkie przerywniki po ostatnim K.O. meczu. Czysto wizualne (poza symulacją),
// więc nie wpływają na determinizm gry online. Każdy czołg ma własną akcję.
import * as THREE from 'three';
import type { CameraShake, ImpactFX, ParticleSystem, PuffSystem } from './effects';
import type { TankModel } from './tankModel';

export type Cue = 'whoosh' | 'impact' | 'boom' | 'ping' | 'swing' | 'drill';

export interface CineContext {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  sparks: ParticleSystem;
  puffs: PuffSystem;
  impacts: ImpactFX;
  shake: CameraShake;
  dust: THREE.Color;
  caption: (text: string, big?: boolean) => void;
  cue: (c: Cue) => void;
}

const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeIn = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t);
const easeOut = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));
const seg = (t: number, a: number, b: number): number => Math.min(1, Math.max(0, (t - a) / (b - a)));

/** Reżyser finishera: steruje modelami, kamerą i efektami według osi czasu (sekundy). */
export class FinisherDirector {
  private t = 0;
  private freeze = 0;
  private readonly W: THREE.Vector3;
  private readonly L: THREE.Vector3;
  private readonly u: THREE.Vector3;
  private readonly side: THREE.Vector3;
  private readonly kind: string;
  private fired = new Set<string>();
  private flyPos = new THREE.Vector3();
  private flyVel = new THREE.Vector3();
  private flySpin = new THREE.Vector3();
  private flying = false;
  private star: THREE.Sprite | null = null;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  done = false;

  constructor(
    private readonly ctx: CineContext,
    private readonly winner: TankModel,
    private readonly loser: TankModel,
    winnerPos: THREE.Vector3,
    loserPos: THREE.Vector3,
  ) {
    this.kind = winner.def.id;
    this.W = winnerPos.clone().setY(0);
    this.L = loserPos.clone().setY(0);
    this.u = this.L.clone().sub(this.W).setY(0);
    if (this.u.lengthSq() < 0.01) this.u.set(1, 0, 0);
    this.u.normalize();
    // Odstęp na scenę: nie za blisko (kamera nie wejdzie w pokonanego), nie za daleko.
    const minD = (winner.def.hullLength + loser.def.hullLength) / 2 + 2.5;
    const d = Math.min(Math.max(this.L.distanceTo(this.W), minD), minD + 3);
    this.L.copy(this.W).addScaledVector(this.u, d);
    this.side = new THREE.Vector3(-this.u.z, 0, this.u.x);
    // Ustaw oba czołgi naprzeciw siebie, w pozie wyjściowej.
    const yawW = -Math.atan2(this.u.z, this.u.x);
    winner.root.position.copy(this.W);
    winner.root.rotation.set(0, yawW, 0);
    loser.root.position.copy(this.L);
    loser.root.rotation.set(0, yawW + Math.PI, 0);
    for (const m of [winner, loser]) {
      m.spin.rotation.set(0, 0, 0);
      m.spin.scale.set(1, 1, 1);
      m.turret.rotation.set(0, 0, 0);
      m.mantlet.rotation.set(0, 0, 0);
      m.barrel.position.x = 0;
      m.body.rotation.set(0, 0, 0);
    }
    // Pokonany chwieje się, lufa opadła.
    loser.mantlet.rotation.z = -0.15;
    this.camPos.copy(ctx.camera.position);
    this.camLook.copy(this.W).setY(1.5);
  }

  private once(key: string, at: number, fn: () => void): void {
    if (this.t >= at && !this.fired.has(key)) {
      this.fired.add(key);
      fn();
    }
  }

  private launch(vel: THREE.Vector3, spin: THREE.Vector3): void {
    this.flying = true;
    this.flyPos.copy(this.loser.root.position);
    this.flyVel.copy(vel);
    this.flySpin.copy(spin);
  }

  private twinkle(): void {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.2, '#fff6c0');
    grad.addColorStop(1, 'rgba(255,240,180,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#fff';
    g.fillRect(30, 0, 4, 64);
    g.fillRect(0, 30, 64, 4);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
    sp.position.copy(this.flyPos);
    sp.renderOrder = 30;
    this.ctx.scene.add(sp);
    this.star = sp;
    this.ctx.cue('ping');
  }

  private impactAt(p: THREE.Vector3, power: number): void {
    this.ctx.impacts.spawn(p, power);
    this.ctx.sparks.burst(80 * power, { x: p.x, y: p.y, z: p.z, life: 0.6, size: 0.2, color: new THREE.Color(1, 0.75, 0.3), gravity: 6, drag: 1.2 }, 14);
    this.ctx.puffs.ring(new THREE.Vector3(p.x, 0.3, p.z), 14, 1.2, 7, 1.1, this.ctx.dust);
    this.ctx.shake.add(1);
    this.ctx.cue('impact');
  }

  /** Klatka przerywnika. Zwraca true, gdy akcja się skończyła (zostaje poza spoczynkowa). */
  update(dtRaw: number): boolean {
    const dt = Math.min(dtRaw, 0.05);
    if (this.freeze > 0) {
      this.freeze -= dt;
      this.ctx.shake.update(dt);
      this.applyCamera(dt, true);
      return false;
    }
    this.t += dt;
    const t = this.t;
    const cam = this.ctx.camera;
    const W = this.W;
    const u = this.u;
    const sd = this.side;
    const w = this.winner;
    const l = this.loser;

    // --- wspólny wstęp: zbliżenie „w oczy” zwycięzcy (styl anime)
    if (t < 1.4) {
      // Lufa uniesiona (żeby nie zasłaniała), kamera tuż przed „twarzą” wieży, lekko od dołu.
      w.mantlet.rotation.z = 0.6;
      const head = W.clone().add(new THREE.Vector3(0, w.def.hullHeight + w.def.turretHeight * 0.5, 0)).addScaledVector(u, w.def.turretRadius * 0.5);
      const eye = W.clone().addScaledVector(u, w.def.hullLength / 2 + 2.4 - t * 0.4).addScaledVector(sd, 0.7).setY(head.y + 0.05);
      this.camPos.copy(eye);
      this.camLook.copy(head);
      cam.fov = 24 - t * 5;
      this.once('cap0', 0.05, () => this.ctx.caption('FINISHER', true));
      this.once('whoosh', 0.85, () => {
        this.ctx.cue('whoosh');
        this.ctx.sparks.burst(20, { x: head.x, y: head.y + 0.4, z: head.z, life: 0.2, size: 1.2, color: new THREE.Color(1, 1, 1) }, 0.5);
      });
      // Pokonany poza kadrem zbliżenia; potem się zatacza.
      l.root.visible = false;
      l.body.rotation.x = Math.sin(t * 5) * 0.06;
      this.applyCamera(dt, true);
      return false;
    }
    cam.fov += (36 - cam.fov) * Math.min(1, dt * 6);
    if (!this.done && !this.flying) l.root.visible = true;

    switch (this.kind) {
      case 'mamut':
        this.homeRun(t, dt);
        break;
      case 'grom':
        this.thunderclap(t, dt);
        break;
      case 'osa':
        this.hornetSwarm(t, dt);
        break;
      default:
        this.drill(t, dt);
        break;
    }

    // Lot pokonanego.
    if (this.flying) {
      this.flyVel.y -= 7 * dt;
      this.flyPos.addScaledVector(this.flyVel, dt);
      if (this.flyPos.y < 0 && this.flyVel.y < 0 && this.kind === 'kobra') {
        this.flyPos.y = 0;
        this.flyVel.y *= -0.45;
        this.ctx.puffs.ring(this.flyPos.clone().setY(0.3), 6, 1, 4, 0.8, this.ctx.dust);
      }
      l.root.position.copy(this.flyPos);
      l.spin.rotation.x += this.flySpin.x * dt;
      l.spin.rotation.z += this.flySpin.z * dt;
      l.root.rotation.y += this.flySpin.y * dt;
      if (Math.random() < 0.6) this.ctx.puffs.spawn(this.flyPos, new THREE.Vector3(0, 0.3, 0), 0.6, 0.6, new THREE.Color(0.35, 0.33, 0.3));
    }
    if (this.star) {
      const k = Math.max(0, 1 - (t - this.starAt) / 0.9);
      const s = 2 + Math.sin((t - this.starAt) * 30) * 0.8;
      this.star.scale.set(s * (0.3 + k), s * (0.3 + k), 1);
      this.star.material.opacity = k;
    }

    const endAt = this.kind === 'osa' ? 5.6 : 5.4;
    if (t > endAt) {
      // Poza zwycięzcy i powolny obrót kamery.
      if (!this.done) {
        this.done = true;
        l.root.visible = !this.flying;
      }
      // Niska kamera, zwycięzca w prawej części kadru (menu jest po lewej).
      const a = (t - endAt) * 0.12 + Math.atan2(sd.z, sd.x) - 0.5;
      const center = w.root.position.clone();
      const r = 7 + w.def.hullLength;
      this.camPos.copy(center).add(new THREE.Vector3(Math.cos(a) * r, 1.3, Math.sin(a) * r));
      const right = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
      this.camLook.copy(center).setY(1.5).addScaledVector(right, -r * 0.22);
      w.body.position.y = Math.sin(t * 5) * 0.02;
      w.turret.rotation.y += (Math.sin(t * 0.7) * 0.4 - w.turret.rotation.y) * Math.min(1, dt * 2);
      w.updateTracks(0, 0, t, 0);
    }
    this.applyCamera(dt, false);
    return this.done;
  }

  private starAt = 0;

  private applyCamera(dt: number, snap: boolean): void {
    const cam = this.ctx.camera;
    if (snap) {
      cam.position.copy(this.camPos);
    } else {
      cam.position.lerp(this.camPos, Math.min(1, dt * 5));
    }
    cam.position.add(this.ctx.shake.offset);
    cam.near = 0.1;
    cam.lookAt(this.camLook);
    cam.updateProjectionMatrix();
    this.ctx.shake.update(dt);
  }

  private wide(dist = 15, h = 3.5): void {
    const mid = this.W.clone().add(this.L).multiplyScalar(0.5);
    this.camPos.copy(mid).addScaledVector(this.side, dist).setY(h);
    this.camLook.copy(mid).setY(1.4);
  }

  // ------------------------------------------------------------ MAMMOTH: Home Run

  private homeRun(t: number, dt: number): void {
    const w = this.winner;
    if (!this.flying) this.wide();
    // Zamach: wieża obraca się daleko w tył, czołg odchyla się, potem błyskawiczne uderzenie.
    const wind = ease(seg(t, 1.4, 2.2));
    const hit = easeIn(seg(t, 2.25, 2.4));
    w.turret.rotation.y = -(2.9 * wind) + 5.6 * hit;
    w.body.rotation.z = 0.25 * wind - 0.35 * hit;
    w.body.rotation.x = -0.25 * wind + 0.3 * hit;
    this.once('cap', 1.5, () => this.ctx.caption('HOME RUN!'));
    this.once('swing', 2.25, () => this.ctx.cue('swing'));
    this.once('hit', 2.36, () => {
      const p = this.L.clone().setY(1.6);
      this.impactAt(p, 1.4);
      this.freeze = 0.3;
      this.launch(this.u.clone().multiplyScalar(26).add(new THREE.Vector3(0, 21, 0)), new THREE.Vector3(9, 6, 4));
    });
    if (this.flying) {
      // Kamera odprowadza „piłkę” wzrokiem, aż zniknie za horyzontem.
      this.camPos.lerp(this.W.clone().addScaledVector(this.u, -6).addScaledVector(this.side, 4).setY(2.2), Math.min(1, dt * 3));
      this.camLook.lerp(this.flyPos, Math.min(1, dt * 6));
    }
    this.once('star', 4.3, () => {
      this.starAt = t;
      this.twinkle();
      this.winner.root.visible = true;
    });
    void dt;
  }

  // ------------------------------------------------------------ THUNDER: Thunderclap

  private thunderclap(t: number, dt: number): void {
    const w = this.winner;
    const l = this.loser;
    if (!this.flying) this.wide(16, 4);
    const jump = seg(t, 1.4, 2.15);
    const pos = this.W.clone().lerp(this.L, ease(jump));
    pos.y = Math.sin(jump * Math.PI) * 7 + (jump >= 1 ? l.def.hullHeight * 0.4 : 0);
    if (t < 2.7) {
      w.root.position.copy(pos);
      w.spin.rotation.z = -Math.PI * 2 * easeOut(jump);
    }
    this.once('cap', 1.5, () => this.ctx.caption('THUNDERCLAP!'));
    this.once('jump', 1.4, () => this.ctx.cue('whoosh'));
    this.once('slam', 2.15, () => {
      this.impactAt(this.L.clone().setY(0.6), 1.5);
      this.freeze = 0.25;
    });
    // Pokonany spłaszczony jak naleśnik, potem „wystrzelony” w górę.
    const pancake = seg(t, 2.15, 2.25);
    if (t < 2.75) l.spin.scale.set(1 + 0.4 * pancake, 1 - 0.65 * pancake, 1 + 0.4 * pancake);
    if (t >= 2.7 && t < 3.0) {
      w.root.position.copy(this.L.clone().addScaledVector(this.u, -5 * ease(seg(t, 2.7, 3.0))));
      w.spin.rotation.z = 0;
    }
    this.once('pop', 2.8, () => {
      l.spin.scale.set(0.8, 1.4, 0.8);
      this.ctx.cue('boom');
      this.launch(new THREE.Vector3(0, 30, 0).addScaledVector(this.u, 4), new THREE.Vector3(14, 3, 10));
    });
    if (this.flying) {
      l.spin.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 6));
      this.camLook.lerp(this.flyPos.clone().lerp(this.L, 0.3), Math.min(1, dt * 4));
    }
    this.once('star', 4.4, () => {
      this.starAt = t;
      this.twinkle();
    });
  }

  // ------------------------------------------------------------ WASP: Hornet Swarm

  private hornetSwarm(t: number, dt: number): void {
    const w = this.winner;
    const l = this.loser;
    if (!this.flying) this.wide(13, 3);
    this.once('cap', 1.5, () => this.ctx.caption('HORNET SWARM!'));
    const passes = 7;
    const p = seg(t, 1.5, 3.3) * passes;
    if (t < 3.3 && t > 1.5) {
      const i = Math.floor(p);
      const f = p - i;
      const from = this.L.clone().addScaledVector(this.u, i % 2 ? 6 : -6).addScaledVector(this.side, (i % 3) - 1);
      const to = this.L.clone().addScaledVector(this.u, i % 2 ? -6 : 6).addScaledVector(this.side, ((i + 1) % 3) - 1);
      w.root.position.copy(from.lerp(to, easeOut(f)));
      w.root.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
      w.spin.rotation.z = -0.2;
      this.ctx.puffs.spawn(w.root.position.clone().setY(0.4), new THREE.Vector3(0, 0.5, 0), 0.5, 0.3, this.ctx.dust);
      this.once(`pass${i}`, 1.5 + ((i + 0.5) / passes) * 1.8, () => {
        const hp = this.L.clone().setY(1.2);
        this.ctx.sparks.burst(30, { x: hp.x, y: hp.y, z: hp.z, life: 0.3, size: 0.16, color: new THREE.Color(1, 0.85, 0.35), gravity: 6 }, 10);
        this.ctx.impacts.spawn(hp, 0.5);
        this.ctx.shake.add(0.3);
        this.ctx.cue('swing');
        l.body.rotation.x = (i % 2 ? 1 : -1) * 0.25;
        l.root.rotation.y += 0.4;
      });
    }
    // Ostatni cios od dołu – pokonany leci pionowo w niebo.
    if (t >= 3.3 && t < 3.6) {
      w.root.position.lerp(this.L.clone().addScaledVector(this.u, -3), Math.min(1, dt * 12));
      w.root.rotation.y = -Math.atan2(this.u.z, this.u.x);
      w.spin.rotation.z = 0.5 * ease(seg(t, 3.3, 3.45));
    }
    this.once('up', 3.45, () => {
      this.impactAt(this.L.clone().setY(1), 1.2);
      this.freeze = 0.2;
      this.launch(new THREE.Vector3(0, 34, 0), new THREE.Vector3(18, 12, 2));
    });
    if (t > 3.6) w.spin.rotation.z *= Math.exp(-6 * dt);
    if (this.flying) this.camLook.lerp(this.flyPos.clone().lerp(this.L, 0.4), Math.min(1, dt * 4));
    this.once('star', 4.6, () => {
      this.starAt = t;
      this.twinkle();
    });
  }

  // ------------------------------------------------------------ COBRA: Drilled

  private drill(t: number, dt: number): void {
    const w = this.winner;
    const l = this.loser;
    this.once('cap', 1.5, () => this.ctx.caption('DRILLED!'));
    this.once('rev', 1.4, () => this.ctx.cue('drill'));
    // Rozkręcanie w miejscu, szarża, wiercenie i wyrzut daleko po ziemi.
    const spinUp = seg(t, 1.4, 2.1);
    w.spin.rotation.x += dt * (4 + 26 * spinUp);
    if (t < 2.1) {
      this.wide(14, 3);
      if (Math.random() < 0.7) this.ctx.sparks.spawn({ x: w.root.position.x, y: 0.2, z: w.root.position.z, vx: (Math.random() - 0.5) * 6, vy: 3, vz: (Math.random() - 0.5) * 6, life: 0.3, size: 0.12, color: new THREE.Color(1, 0.8, 0.4), gravity: 10 });
    }
    const charge = seg(t, 2.1, 2.35);
    const contact = this.L.clone().addScaledVector(this.u, -(w.def.hullLength + l.def.hullLength) / 2);
    if (t >= 2.1 && t < 2.35) w.root.position.copy(this.W.clone().lerp(contact, easeIn(charge)));
    this.once('hit', 2.35, () => {
      this.impactAt(this.L.clone().setY(1), 1.1);
      this.freeze = 0.15;
    });
    const push = seg(t, 2.35, 3.4);
    if (t >= 2.35 && t < 3.4) {
      const d = 9 * push;
      w.root.position.copy(contact.clone().addScaledVector(this.u, d));
      l.root.position.copy(this.L.clone().addScaledVector(this.u, d));
      l.root.rotation.y += dt * 2;
      const sp = this.L.clone().addScaledVector(this.u, d - l.def.hullLength / 2).setY(1);
      this.ctx.sparks.burst(4, { x: sp.x, y: sp.y, z: sp.z, life: 0.3, size: 0.15, color: new THREE.Color(1, 0.8, 0.35), gravity: 8 }, 8);
      this.ctx.shake.add(0.05);
      this.camPos.copy(this.L.clone().addScaledVector(this.u, d)).addScaledVector(this.side, 13).setY(3);
      this.camLook.copy(this.L.clone().addScaledVector(this.u, d)).setY(1.2);
    }
    this.once('fling', 3.4, () => {
      this.impactAt(l.root.position.clone().setY(1), 1.3);
      this.launch(this.u.clone().multiplyScalar(32).add(new THREE.Vector3(0, 9, 0)), new THREE.Vector3(3, 10, 14));
    });
    if (t > 3.4) w.spin.rotation.x *= Math.exp(-5 * dt);
    if (this.flying) this.camLook.lerp(this.flyPos, Math.min(1, dt * 4));
    this.once('star', 4.6, () => {
      this.starAt = t;
      this.twinkle();
    });
  }

  dispose(): void {
    this.star?.removeFromParent();
    this.winner.root.visible = true;
    this.loser.root.visible = true;
  }
}
