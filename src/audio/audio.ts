// Dźwięk proceduralny (WebAudio): silniki, gąsienice, zgrzyt wieży, uderzenia, wybuchy, gong.
import {
  EV_BLOCK, EV_FIGHT, EV_HIT, EV_JUMP, EV_KO, EV_LAND, EV_ROUND, EV_SHOT, EV_TECH, EV_THROW, EV_TIMEUP,
  EV_WALL, EV_WHOOSH,
} from '../sim/constants';
import type { GameState, SimEvent } from '../sim/types';
import { TANK_PARAMS } from '../sim/params';

interface EngineVoice {
  osc: OscillatorNode;
  osc2: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  whine: OscillatorNode;
  whineGain: GainNode;
  rattle: AudioBufferSourceNode;
  rattleGain: GainNode;
  rattleFilter: BiquadFilterNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engines: EngineVoice[] = [];
  private volume = 0.7;

  /** Kontekst audio można utworzyć dopiero po geście użytkownika. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private noiseSrc(): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noise) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  startEngines(tanks: number[]): void {
    this.stopEngines();
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    for (const t of tanks) {
      const mass = TANK_PARAMS[t]!.mass;
      const base = 34 - mass / 3000;
      const gain = ctx.createGain();
      gain.gain.value = 0.0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = base;
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = base * 1.5;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      const whine = ctx.createOscillator();
      whine.type = 'triangle';
      whine.frequency.value = 300;
      const whineGain = ctx.createGain();
      whineGain.gain.value = 0;
      whine.connect(whineGain);
      whineGain.connect(this.master);
      const rattle = this.noiseSrc()!;
      const rattleFilter = ctx.createBiquadFilter();
      rattleFilter.type = 'bandpass';
      rattleFilter.frequency.value = 900;
      rattleFilter.Q.value = 2;
      const rattleGain = ctx.createGain();
      rattleGain.gain.value = 0;
      rattle.connect(rattleFilter);
      rattleFilter.connect(rattleGain);
      rattleGain.connect(this.master);
      osc.start();
      osc2.start();
      whine.start();
      rattle.start();
      this.engines.push({ osc, osc2, gain, filter, whine, whineGain, rattle, rattleGain, rattleFilter });
    }
  }

  stopEngines(): void {
    for (const e of this.engines) {
      e.osc.stop();
      e.osc2.stop();
      e.whine.stop();
      e.rattle.stop();
      e.gain.disconnect();
      e.whineGain.disconnect();
      e.rattleGain.disconnect();
    }
    this.engines = [];
  }

  /** Ciągłe dźwięki zależne od stanu: obroty silnika, stukot gąsienic, zgrzyt wieży. */
  updateContinuous(s: GameState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i]!;
      const f = s.fighters[i]!;
      const t = TANK_PARAMS[f.tank]!;
      const speed = Math.hypot(f.vx, f.vz) / t.run;
      const base = 34 - t.mass / 3000;
      e.osc.frequency.setTargetAtTime(base * (1 + speed * 1.4), now, 0.08);
      e.osc2.frequency.setTargetAtTime(base * 1.5 * (1 + speed * 1.4), now, 0.08);
      e.filter.frequency.setTargetAtTime(300 + speed * 900, now, 0.1);
      e.gain.gain.setTargetAtTime(f.hp > 0 ? 0.05 + speed * 0.06 : 0, now, 0.1);
      const tv = Math.abs(f.turretVel) / t.turretMaxVel;
      e.whine.frequency.setTargetAtTime(180 + tv * 900, now, 0.03);
      e.whineGain.gain.setTargetAtTime(Math.min(0.06, tv * 0.07), now, 0.03);
      e.rattleGain.gain.setTargetAtTime(Math.min(0.12, speed * 0.14), now, 0.05);
      e.rattleFilter.frequency.setTargetAtTime(500 + speed * 1200, now, 0.05);
    }
  }

  private env(node: AudioNode, vol: number, attack: number, decay: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    node.connect(g);
    g.connect(this.master!);
    return g;
  }

  /** Metaliczne uderzenie – cięższe = niższe i dłuższe. */
  clang(power: number, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const p = Math.min(1.5, power);
    const n = this.noiseSrc()!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 * pitch;
    bp.Q.value = 1.2;
    n.connect(bp);
    this.env(bp, 0.5 * p + 0.1, 0.002, 0.12 + p * 0.1);
    n.start(now);
    n.stop(now + 0.5);
    for (const [f, v] of [[220, 0.25], [523, 0.15], [811, 0.1], [1290, 0.06]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = (f * pitch) / (0.7 + p * 0.5);
      this.env(o, v * (0.5 + p), 0.002, 0.25 + p * 0.5);
      o.start(now);
      o.stop(now + 1.2);
    }
    this.thump(p * 0.8);
  }

  thump(power: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, now);
    o.frequency.exponentialRampToValueAtTime(35, now + 0.25);
    this.env(o, Math.min(0.9, 0.2 + power * 0.5), 0.004, 0.3);
    o.start(now);
    o.stop(now + 0.5);
  }

  explosion(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const n = this.noiseSrc()!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2500, now);
    lp.frequency.exponentialRampToValueAtTime(120, now + 2);
    n.connect(lp);
    this.env(lp, 1.0, 0.01, 2.4);
    n.start(now);
    n.stop(now + 3);
    this.thump(1.5);
  }

  whoosh(power: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const n = this.noiseSrc()!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(400, now);
    bp.frequency.exponentialRampToValueAtTime(1600, now + 0.15);
    n.connect(bp);
    this.env(bp, 0.08 + Math.min(0.15, power / 900), 0.03, 0.15);
    n.start(now);
    n.stop(now + 0.3);
  }

  shot(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const n = this.noiseSrc()!;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    n.connect(hp);
    this.env(hp, 0.35, 0.001, 0.06);
    n.start(now);
    n.stop(now + 0.15);
  }

  gong(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [f, v] of [[98, 0.3], [196.5, 0.2], [262, 0.12], [393, 0.08], [587, 0.05]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      this.env(o, v, 0.01, 2.5);
      o.start(now);
      o.stop(now + 3);
    }
  }

  horn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const f of [220, 277, 330]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      o.connect(lp);
      this.env(lp, 0.08, 0.02, 0.5);
      o.start(now);
      o.stop(now + 0.7);
    }
  }

  handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case EV_HIT:
          this.clang(e.power / 100, 0.8 + Math.random() * 0.15);
          break;
        case EV_BLOCK:
          this.clang(0.35, 1.5);
          break;
        case EV_LAND:
        case EV_WALL:
          this.thump(Math.min(1.2, e.power / 50000));
          break;
        case EV_THROW:
          this.clang(0.4, 0.6);
          break;
        case EV_TECH:
          this.clang(0.3, 1.8);
          break;
        case EV_KO:
          this.explosion();
          break;
        case EV_ROUND:
        case EV_TIMEUP:
          this.gong();
          break;
        case EV_FIGHT:
          this.horn();
          break;
        case EV_WHOOSH:
          this.whoosh(e.power);
          break;
        case EV_SHOT:
          this.shot();
          break;
        case EV_JUMP:
          this.thump(0.2);
          break;
        default:
          break;
      }
    }
  }
}
