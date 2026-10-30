// Muzyka generowana na żywo (WebAudio): sekwencer 16 kroków z perkusją, basem, akordami i melodią.
// Bez plików – ale jeśli w /audio/ leżą music-menu.mp3 / music-fight.mp3, zostaną użyte zamiast syntezy.

type TrackName = 'menu' | 'fight';

interface Pattern {
  bpm: number;
  /** Akordy (półtony względem A2) na kolejne takty. */
  chords: number[][];
  kick: string;
  snare: string;
  hat: string;
  /** Bas: półton względem pierwszego dźwięku akordu albo '.' (pauza). */
  bass: (number | null)[];
  /** Melodia (półtony względem A4) na 4 takty po 16 kroków; null = pauza. */
  lead: (number | null)[][];
  stab: string;
  pad: boolean;
}

const _ = null;

const TRACKS: Record<TrackName, Pattern> = {
  fight: {
    bpm: 148,
    // Am – F – C – G (ciemny, napędzający rock/elektro)
    chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]],
    kick: 'x..x..x.x..x..x.',
    snare: '....x.......x..x',
    hat: 'x.x.x.x.x.x.x.xx',
    bass: [0, 0, 12, 0, _, 0, 12, 0, 0, 0, 12, 0, 7, _, 10, 12],
    lead: [
      [12, _, 15, _, 17, _, 15, 12, _, 10, 12, _, _, _, 7, _],
      [8, _, 12, _, 15, _, 12, 8, _, 7, 8, _, _, _, 3, _],
      [15, _, 19, _, 22, _, 19, 15, _, 14, 15, _, 19, _, 22, 24],
      [14, _, 17, _, 19, _, 17, 14, _, 12, 10, _, 12, _, _, _],
    ],
    stab: 'x.....x...x.....',
    pad: false,
  },
  menu: {
    bpm: 104,
    chords: [[0, 3, 7], [-4, 0, 3], [-7, -3, 0], [-2, 2, 5]],
    kick: 'x.......x.......',
    snare: '........x.......',
    hat: '..x...x...x...x.',
    bass: [0, _, _, 0, _, _, 12, _, 0, _, _, 0, _, 7, _, _],
    lead: [
      [12, _, _, 15, _, _, 19, _, 17, _, 15, _, 12, _, _, _],
      [12, _, _, 15, _, _, 20, _, 19, _, 15, _, 8, _, _, _],
      [12, _, _, 17, _, _, 19, _, 17, _, 12, _, 9, _, _, _],
      [14, _, _, 17, _, _, 21, _, 19, _, 17, _, 14, _, _, _],
    ],
    stab: '................',
    pad: true,
  },
};

const A2 = 110;
const freq = (semi: number, base = A2): number => base * Math.pow(2, semi / 12);

export class MusicPlayer {
  private track: TrackName | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private readonly out: GainNode;
  private readonly comp: DynamicsCompressorNode;
  private files = new Map<TrackName, AudioBuffer>();
  private fileSrc: AudioBufferSourceNode | null = null;
  private intensity = 1;

  constructor(private readonly ctx: AudioContext, destination: AudioNode, private readonly noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.5;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 3;
    this.out.connect(this.comp);
    this.comp.connect(destination);
    void this.tryLoadFiles();
  }

  /** Opcjonalne pliki muzyki (np. darmowe utwory CC0) – jeśli ich nie ma, gra syntezator. */
  private async tryLoadFiles(): Promise<void> {
    for (const name of ['menu', 'fight'] as TrackName[]) {
      try {
        const res = await fetch(`audio/music-${name}.mp3`);
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('audio')) continue;
        this.files.set(name, await this.ctx.decodeAudioData(await res.arrayBuffer()));
        if (this.track === name) this.play(name, true);
      } catch {
        /* brak pliku – zostaje synteza */
      }
    }
  }

  setVolume(v: number): void {
    this.out.gain.setTargetAtTime(v * 0.6, this.ctx.currentTime, 0.05);
  }

  /** 0..1 – w walce przy niskim HP lub w kombo muzyka gęstnieje. */
  setIntensity(v: number): void {
    this.intensity = v;
  }

  play(name: TrackName, force = false): void {
    if (this.track === name && !force) return;
    this.stop();
    this.track = name;
    const buf = this.files.get(name);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.out);
      src.start();
      this.fileSrc = src;
      return;
    }
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.fileSrc?.stop();
    this.fileSrc = null;
    this.track = null;
  }

  private schedule(): void {
    const p = this.track ? TRACKS[this.track] : null;
    if (!p) return;
    const stepDur = 60 / p.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(p, this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private playStep(p: Pattern, n: number, t: number, dur: number): void {
    const s = n % 16;
    const bar = Math.floor(n / 16) % 4;
    const section = Math.floor(n / 64) % 4;
    const chord = p.chords[bar]!;
    const root = chord[0]!;
    // Pierwsze 4 takty utworu walki to wstęp bez melodii.
    const full = p.pad || section > 0;
    if (p.kick[s] === 'x') this.kick(t);
    if (p.snare[s] === 'x') this.snare(t, s === 15 ? 0.5 : 1);
    if (p.hat[s] === 'x' && (full || s % 4 === 0)) this.hat(t, s % 4 === 2 ? 0.9 : 0.5);
    if (this.intensity > 0.6 && s % 2 === 1 && p.bpm > 120) this.hat(t, 0.35);
    const b = p.bass[s];
    if (b !== null && b !== undefined) this.bass(t, freq(root + b - 12), dur * (p.bpm > 120 ? 0.9 : 2.5));
    if (p.stab[s] === 'x') this.stab(t, chord, dur * 2);
    if (p.pad && s === 0) this.pad(t, chord, dur * 16);
    const l = p.lead[bar]![s];
    if (full && l !== null && l !== undefined && section !== 2) this.lead(t, freq(l, 220), dur * 1.8, p.pad);
    // Przejście perkusyjne na końcu każdej czwórki taktów.
    if (bar === 3 && s >= 12 && p.bpm > 120) this.snare(t + dur / 2, 0.45);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.9, 0.002, 0.28);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.32);
  }

  private snare(t: number, v: number): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1400;
    const g = this.ctx.createGain();
    this.env(g, t, 0.45 * v, 0.001, 0.16);
    n.connect(f).connect(g).connect(this.out);
    n.start(t, Math.random());
    n.stop(t + 0.2);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g2 = this.ctx.createGain();
    this.env(g2, t, 0.3 * v, 0.001, 0.1);
    o.connect(g2).connect(this.out);
    o.start(t);
    o.stop(t + 0.14);
  }

  private hat(t: number, v: number): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    this.env(g, t, 0.12 * v, 0.001, 0.045);
    n.connect(f).connect(g).connect(this.out);
    n.start(t, Math.random());
    n.stop(t + 0.07);
  }

  private bass(t: number, f: number, dur: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const o2 = this.ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = f / 2;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.32, 0.004, dur);
    o.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(this.out);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  private stab(t: number, chord: number[], dur: number): void {
    for (const c of chord) {
      for (const det of [-6, 6]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq(c + 12);
        o.detune.value = det;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(3000, t);
        lp.frequency.exponentialRampToValueAtTime(500, t + dur);
        const g = this.ctx.createGain();
        this.env(g, t, 0.05, 0.004, dur);
        o.connect(lp).connect(g).connect(this.out);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  private pad(t: number, chord: number[], dur: number): void {
    for (const c of chord) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq(c + 12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private lead(t: number, f: number, dur: number, soft: boolean): void {
    const o = this.ctx.createOscillator();
    o.type = soft ? 'triangle' : 'square';
    o.frequency.value = f;
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vg = this.ctx.createGain();
    vg.gain.value = 4;
    vib.connect(vg).connect(o.detune);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = soft ? 2500 : 3200;
    const g = this.ctx.createGain();
    this.env(g, t, soft ? 0.09 : 0.07, 0.01, dur);
    o.connect(lp).connect(g).connect(this.out);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }
}
