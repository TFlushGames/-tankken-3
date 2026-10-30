// Muzyka generowana na żywo (WebAudio) w duchu soundtracków bijatyk 3D: orkiestra + rock.
// Walka: epicki hybrydowy utwór (taiko, smyczki staccato, blacha, chór, przesterowana gitara,
// perkusja) w d-moll harmonicznym. Menu: smętne, nostalgiczne – fortepian, smyczki, róg, kotły.
// Bez plików – ale jeśli w /audio/ leżą music-menu.mp3 / music-fight.mp3, zostaną użyte zamiast syntezy.

type TrackName = 'menu' | 'fight';

const _ = null;
type Line = (number | null)[];

interface Chord {
  /** Pryma w półtonach względem toniki utworu. */
  root: number;
  minor: boolean;
}

const D2 = 73.42;
const A2 = 110;
const hz = (semi: number, base: number): number => base * Math.pow(2, semi / 12);
const triad = (c: Chord): number[] => [c.root, c.root + (c.minor ? 3 : 4), c.root + 7];

// ---------------------------------------------------------------- walka: „Iron Will” (d-moll, 150 BPM)

const FIGHT_BPM = 150;
const FIGHT_CHORDS: Chord[] = [
  { root: 0, minor: true }, // Dm
  { root: -4, minor: false }, // B♭
  { root: -2, minor: false }, // C
  { root: -5, minor: false }, // A (dominanta – napięcie)
];
// Melodia refrenu (półtony względem D4), 4 takty × 16 szesnastek.
const FIGHT_LEAD: Line[] = [
  [12, _, _, _, 10, _, 12, _, 15, _, _, _, 14, _, 12, _],
  [10, _, _, _, 8, _, 10, _, 12, _, _, _, 15, _, 17, _],
  [19, _, _, _, 17, _, 15, _, 17, _, _, _, 12, _, 10, _],
  [14, _, _, _, 11, _, 14, _, 19, _, _, _, _, _, _, _],
];
// Kolejność sekcji (po 4 takty): wstęp, zwrotka, refren, przełamanie, zwrotka, refren…
const FIGHT_FORM = ['intro', 'verse', 'chorus', 'break', 'verse', 'chorus', 'chorus', 'break'] as const;
type Section = (typeof FIGHT_FORM)[number];

// ---------------------------------------------------------------- menu: „Old Photographs” (a-moll, 70 BPM)

const MENU_BPM = 70;
const MENU_CHORDS: Chord[] = [
  { root: 0, minor: true }, // Am
  { root: -4, minor: false }, // F
  { root: 3, minor: false }, // C
  { root: -2, minor: false }, // G
  { root: 0, minor: true }, // Am
  { root: 5, minor: true }, // Dm
  { root: 7, minor: false }, // E
  { root: 0, minor: true }, // Am
];
// Melodia rogu (półtony względem A4).
const MENU_LEAD: Line[] = [
  [7, _, _, _, _, _, _, _, 5, _, 3, _, 2, _, _, _],
  [0, _, _, _, _, _, _, _, _, _, _, _, 3, _, 5, _],
  [7, _, _, _, _, _, 3, _, 5, _, _, _, 7, _, 10, _],
  [7, _, _, _, _, _, _, _, 2, _, _, _, _, _, _, _],
  [12, _, _, _, _, _, _, _, 10, _, 8, _, 7, _, _, _],
  [5, _, _, _, _, _, _, _, 8, _, 7, _, 5, _, _, _],
  [2, _, _, _, -1, _, 2, _, 7, _, _, _, 11, _, _, _],
  [12, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
];

export class MusicPlayer {
  private track: TrackName | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private readonly out: GainNode;
  private readonly bus: GainNode;
  private readonly verb: GainNode;
  private readonly delay: DelayNode;
  private readonly dist: WaveShaperNode;
  private readonly comp: DynamicsCompressorNode;
  private files = new Map<TrackName, AudioBuffer>();
  private fileSrc: AudioBufferSourceNode | null = null;
  private intensity = 0;

  constructor(private readonly ctx: AudioContext, destination: AudioNode, private readonly noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.5;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.01;
    this.out.connect(this.comp);
    this.comp.connect(destination);
    // Szyna instrumentów → wyjście, plus wysyłka na pogłos (sala koncertowa).
    this.bus = ctx.createGain();
    this.bus.connect(this.out);
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(2.8);
    this.verb = ctx.createGain();
    this.verb.gain.value = 0.55;
    this.verb.connect(conv);
    conv.connect(this.out);
    // Echo dla solówek.
    this.delay = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2500;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.verb);
    dl.connect(this.bus);
    // Przester gitary + „kolumna” (filtr).
    this.dist = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = ((1 + 40) * x) / (1 + 40 * Math.abs(x));
    }
    this.dist.curve = curve;
    this.dist.oversample = '2x';
    const cab = ctx.createBiquadFilter();
    cab.type = 'lowpass';
    cab.frequency.value = 3200;
    cab.Q.value = 0.9;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 800;
    mid.gain.value = -4;
    const gg = ctx.createGain();
    gg.gain.value = 0.16;
    this.dist.connect(cab).connect(mid).connect(gg);
    gg.connect(this.bus);
    void this.tryLoadFiles();
  }

  private impulse(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
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
    this.nextTime = this.ctx.currentTime + 0.1;
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
    if (!this.track) return;
    const bpm = this.track === 'fight' ? FIGHT_BPM : MENU_BPM;
    const stepDur = 60 / bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      if (this.track === 'fight') this.fightStep(this.step, this.nextTime, stepDur);
      else this.menuStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  // ---------------------------------------------------------------- aranżacje

  private fightStep(n: number, t: number, d: number): void {
    const s = n % 16;
    const bar = Math.floor(n / 16) % 4;
    const block = Math.floor(n / 64);
    // Po pierwszym przejściu formy wstęp już nie wraca.
    const sec: Section = FIGHT_FORM[block === 0 ? 0 : 1 + ((block - 1) % (FIGHT_FORM.length - 1))]!;
    const c = FIGHT_CHORDS[bar]!;
    const tones = triad(c);
    const heavy = sec === 'verse' || sec === 'chorus';
    const hot = this.intensity > 0.6;

    // Perkusja.
    if (sec === 'intro' || sec === 'break') {
      if (s === 0 || s === 6 || s === 10) this.taiko(t, s === 0 ? 1 : 0.7);
      if (sec === 'break' && (s === 4 || s === 12)) this.snare(t, 0.6);
      if (sec === 'break' && bar === 3 && s >= 8) this.snare(t, 0.3 + (s - 8) * 0.08);
      if (s % 4 === 2) this.hat(t, 0.4);
    } else {
      if (s === 0 || s === 3 || s === 8 || s === 10 || (hot && s === 14)) this.kick(t);
      if (s === 4 || s === 12) this.snare(t, 1);
      if (s % 2 === 0 || hot) this.hat(t, s % 4 === 2 ? 0.8 : 0.45);
      if (s === 0 && (bar === 0 || sec === 'chorus')) this.crash(t);
      if (sec === 'chorus' && (s === 0 || s === 8)) this.taiko(t, 0.8);
      if (bar === 3 && s >= 13) this.snare(t, 0.5);
    }

    // Bas i gitara.
    if (sec !== 'intro') this.bass(t, hz(c.root, D2 / 2), d * 0.9, s % 4 === 0 ? 1 : 0.75);
    if (heavy) {
      // Przytłumione „czugi” na zwrotce, rozbrzmiewające akordy kwintowe w refrenie.
      if (sec === 'verse' && s % 2 === 0 && s !== 14) this.guitar(t, c.root, d * 0.8, true);
      if (sec === 'chorus' && (s === 0 || s === 6 || s === 10)) this.guitar(t, c.root, d * (s === 10 ? 6 : 5.5), false);
      if (sec === 'verse' && s === 14) this.guitar(t, c.root + 1, d * 1.6, false);
    }

    // Smyczki: ostinato staccato (wstęp, zwrotka), legato w przełamaniu.
    if (sec === 'intro' || sec === 'verse') {
      const arp = [tones[0]! + 12, tones[2]! + 12, tones[1]! + 24, tones[2]! + 12];
      this.strings(t, [arp[s % 4]!], d * 0.7, 0.05, true);
    }
    if (sec === 'break' && s === 0) {
      this.strings(t, tones.map((x) => x + 12), d * 16, 0.06, false);
      this.choir(t, tones.map((x) => x + 12), d * 16, 0.05);
    }

    // Blacha: uderzenia akordów w zwrotce, melodia w refrenie (z chórem pod spodem).
    if (sec === 'verse' && (s === 0 || s === 3 || s === 6)) this.brass(t, tones.map((x) => x + 12), d * 1.5, 0.045);
    if (sec === 'chorus') {
      if (s === 0) this.choir(t, tones.map((x) => x + 12), d * 16, 0.05);
      const l = FIGHT_LEAD[bar]![s];
      if (l !== null && l !== undefined) {
        let len = 1;
        while (s + len < 16 && FIGHT_LEAD[bar]![s + len] === null) len++;
        this.brass(t, [l + 24], d * len * 0.95, 0.07, true);
        this.lead(t, hz(l + 12, D2 * 2), d * len * 0.9);
      }
    }
    // Wstęp: narastający kocioł.
    if (sec === 'intro' && bar === 3 && s >= 8) this.taiko(t, 0.25 + (s - 8) * 0.1);
  }

  private menuStep(n: number, t: number, d: number): void {
    const s = n % 16;
    const bar = Math.floor(n / 16) % 8;
    const loop = Math.floor(n / 128);
    const c = MENU_CHORDS[bar]!;
    const tones = triad(c);
    if (s === 0) {
      this.strings(t, [tones[0]! - 12, ...tones], d * 16.5, 0.045, false);
      if (bar === 0 || bar === 4) this.timpani(t, hz(c.root, A2 / 2), 0.5);
    }
    // Fortepian: spokojne arpeggio ósemkami.
    if (s % 2 === 0) {
      const pat = [0, 2, 1, 2, 0 + 12, 2, 1, 2];
      const k = pat[(s / 2) % 8]!;
      const semi = k >= 12 ? tones[0]! + 12 : tones[k]!;
      this.piano(t, hz(semi + 12, A2), d * 6, s === 0 ? 0.11 : 0.07);
    }
    // Róg (od drugiego przejścia) i bas smyczkowy.
    if (loop > 0 || bar >= 4) {
      const l = MENU_LEAD[bar]![s];
      if (l !== null && l !== undefined) {
        let len = 1;
        while (s + len < 16 && MENU_LEAD[bar]![s + len] === null) len++;
        this.horn(t, hz(l, A2 * 4), d * len * 0.95);
      }
    }
    if (s === 0 || s === 8) this.cello(t, hz(c.root, A2 / 2), d * 8);
    // Daleki werbel polowy na końcu frazy – wojenne echo.
    if (bar === 7 && s >= 8 && s % 2 === 0) this.snare(t, 0.12 + (s - 8) * 0.02, true);
    // Wiatr.
    if (s === 0 && bar % 4 === 0) this.wind(t, d * 64);
  }

  // ---------------------------------------------------------------- instrumenty

  private env(g: GainNode, t: number, peak: number, attack: number, hold: number, release: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  private osc(type: OscillatorType, f: number, t: number, end: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.start(t);
    o.stop(end);
    return o;
  }

  private send(node: AudioNode, wet: number, pan = 0): void {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    p.connect(this.bus);
    if (wet > 0) {
      const w = this.ctx.createGain();
      w.gain.value = wet;
      p.connect(w).connect(this.verb);
    }
  }

  /** Sekcja smyczkowa: kilka rozstrojonych pił z vibrato, miękki filtr. */
  private strings(t: number, semis: number[], dur: number, vol: number, staccato: boolean): void {
    const base = this.track === 'menu' ? A2 : D2 * 2;
    const atk = staccato ? 0.01 : 0.45;
    const rel = staccato ? 0.12 : 0.9;
    const end = t + atk + dur + rel + 0.05;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = staccato ? 2600 : 1900;
    const g = this.ctx.createGain();
    this.env(g, t, vol, atk, Math.max(0, dur - atk), rel);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = this.ctx.createGain();
    vg.gain.value = 7;
    vib.connect(vg);
    vib.start(t);
    vib.stop(end);
    for (const semi of semis) {
      for (const det of [-11, -4, 3, 10]) {
        const o = this.osc('sawtooth', hz(semi, base), t, end, det);
        vg.connect(o.detune);
        o.connect(lp);
      }
    }
    lp.connect(g);
    this.send(g, staccato ? 0.25 : 0.6, (Math.random() - 0.5) * 0.4);
  }

  /** Blacha: piła + kwadrat, filtr otwierający się z atakiem („bwaa”). */
  private brass(t: number, semis: number[], dur: number, vol: number, solo = false): void {
    const end = t + dur + 0.3;
    for (const semi of semis) {
      const f = hz(semi, D2 * 2) / (solo ? 2 : 1);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(400, t);
      lp.frequency.exponentialRampToValueAtTime(solo ? 3200 : 2600, t + 0.06);
      lp.frequency.exponentialRampToValueAtTime(1200, t + dur);
      const g = this.ctx.createGain();
      this.env(g, t, vol, 0.03, Math.max(0, dur - 0.1), 0.2);
      this.osc('sawtooth', f, t, end, -5).connect(lp);
      this.osc('square', f, t, end, 5).connect(lp);
      lp.connect(g);
      this.send(g, 0.35, solo ? 0 : (Math.random() - 0.5) * 0.6);
    }
  }

  /** Chór „aah”: piły przez filtry formantowe. */
  private choir(t: number, semis: number[], dur: number, vol: number): void {
    const end = t + dur + 1.2;
    const g = this.ctx.createGain();
    this.env(g, t, vol, 0.6, Math.max(0, dur - 0.6), 1.0);
    for (const [f, q, a] of [[730, 8, 1], [1090, 10, 0.6], [2440, 12, 0.3]] as const) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const ga = this.ctx.createGain();
      ga.gain.value = a * 3;
      for (const semi of semis) for (const det of [-8, 8]) this.osc('sawtooth', hz(semi, D2 * 2), t, end, det).connect(bp);
      bp.connect(ga).connect(g);
    }
    this.send(g, 0.8);
  }

  /** Solówka syntezatorowa w unisonie z blachą – z echem. */
  private lead(t: number, f: number, dur: number): void {
    const end = t + dur + 0.2;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3800;
    const g = this.ctx.createGain();
    this.env(g, t, 0.04, 0.01, Math.max(0, dur - 0.05), 0.15);
    this.osc('sawtooth', f, t, end, -7).connect(lp);
    this.osc('sawtooth', f, t, end, 7).connect(lp);
    lp.connect(g);
    this.send(g, 0.3);
    this.delay.delayTime.value = (60 / FIGHT_BPM) * 0.75;
    g.connect(this.delay);
  }

  /** Gitara przesterowana: akord kwintowy (pryma, kwinta, oktawa). */
  private guitar(t: number, root: number, dur: number, muted: boolean): void {
    const end = t + dur + 0.1;
    const g = this.ctx.createGain();
    this.env(g, t, muted ? 0.5 : 0.65, 0.004, Math.max(0, dur - 0.08), muted ? 0.05 : 0.25);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = muted ? 900 : 5000;
    for (const iv of [0, 7, 12]) for (const det of [-9, 9]) this.osc('sawtooth', hz(root + iv, D2), t, end, det).connect(lp);
    lp.connect(g).connect(this.dist);
  }

  private bass(t: number, f: number, dur: number, v: number): void {
    const end = t + dur + 0.05;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(1100, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.3 * v, 0.004, 0, dur);
    this.osc('sawtooth', f, t, end).connect(lp);
    this.osc('square', f / 2, t, end).connect(lp);
    lp.connect(g);
    this.send(g, 0);
  }

  private kick(t: number): void {
    const o = this.osc('sine', 150, t, t + 0.35);
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    const g = this.ctx.createGain();
    this.env(g, t, 0.95, 0.002, 0, 0.3);
    o.connect(g);
    this.send(g, 0.05);
    this.noiseHit(t, 'bandpass', 3500, 0.12, 0.012, 0);
  }

  private snare(t: number, v: number, distant = false): void {
    this.noiseHit(t, 'highpass', distant ? 2200 : 1500, 0.42 * v, distant ? 0.12 : 0.17, distant ? 0.9 : 0.35);
    const o = this.osc('triangle', 230, t, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const g = this.ctx.createGain();
    this.env(g, t, 0.28 * v, 0.001, 0, 0.1);
    o.connect(g);
    this.send(g, distant ? 0.9 : 0.3);
  }

  private hat(t: number, v: number): void {
    this.noiseHit(t, 'highpass', 8000, 0.1 * v, 0.04, 0.05, (Math.random() - 0.5) * 0.5);
  }

  private crash(t: number): void {
    this.noiseHit(t, 'highpass', 5000, 0.16, 1.6, 0.4, 0.3);
  }

  /** Bęben taiko: głęboki spadek wysokości + uderzenie, dużo sali. */
  private taiko(t: number, v: number): void {
    const o = this.osc('sine', 110, t, t + 0.8);
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
    const g = this.ctx.createGain();
    this.env(g, t, 0.9 * v, 0.003, 0, 0.7);
    o.connect(g);
    this.send(g, 0.7);
    this.noiseHit(t, 'lowpass', 600, 0.5 * v, 0.12, 0.6);
  }

  private timpani(t: number, f: number, v: number): void {
    for (const [mul, a] of [[1, 1], [1.5, 0.4], [2, 0.25]] as const) {
      const o = this.osc('sine', f * mul, t, t + 2.4);
      const g = this.ctx.createGain();
      this.env(g, t, 0.35 * v * a, 0.004, 0, 2.2);
      o.connect(g);
      this.send(g, 0.8);
    }
  }

  /** Fortepian: kilka harmonicznych z szybkim zanikiem, lekkie rozstrojenie. */
  private piano(t: number, f: number, dur: number, vol: number): void {
    const end = t + dur + 0.2;
    for (const [mul, a, dec] of [[1, 1, 1], [2, 0.45, 0.6], [3, 0.2, 0.4], [4, 0.1, 0.25]] as const) {
      const g = this.ctx.createGain();
      this.env(g, t, vol * a, 0.003, 0, dur * dec);
      this.osc(mul === 1 ? 'triangle' : 'sine', f * mul, t, end, mul === 2 ? 3 : 0).connect(g);
      this.send(g, 0.55, -0.15);
    }
  }

  /** Róg: miękka piła przez ciemny filtr, powolny atak, vibrato. */
  private horn(t: number, f: number, dur: number): void {
    const end = t + dur + 0.6;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1300, t + 0.3);
    const g = this.ctx.createGain();
    this.env(g, t, 0.06, 0.18, Math.max(0, dur - 0.18), 0.5);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 4.8;
    const vg = this.ctx.createGain();
    vg.gain.value = 6;
    vib.connect(vg);
    vib.start(t + 0.3);
    vib.stop(end);
    const o1 = this.osc('sawtooth', f / 2, t, end, -3);
    const o2 = this.osc('triangle', f / 2, t, end, 4);
    vg.connect(o1.detune);
    vg.connect(o2.detune);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    this.send(g, 0.7, 0.15);
  }

  private cello(t: number, f: number, dur: number): void {
    const end = t + dur + 0.6;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = this.ctx.createGain();
    this.env(g, t, 0.07, 0.25, Math.max(0, dur - 0.25), 0.5);
    for (const det of [-6, 6]) this.osc('sawtooth', f, t, end, det).connect(lp);
    lp.connect(g);
    this.send(g, 0.5, -0.2);
  }

  private wind(t: number, dur: number): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.linearRampToValueAtTime(700, t + dur / 2);
    bp.frequency.linearRampToValueAtTime(300, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.025, t + dur / 2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g);
    this.send(g, 0.3);
    n.start(t);
    n.stop(t + dur);
  }

  private noiseHit(t: number, type: BiquadFilterType, f: number, vol: number, dec: number, wet: number, pan = 0): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    const g = this.ctx.createGain();
    this.env(g, t, vol, 0.001, 0, dec);
    n.connect(flt).connect(g);
    this.send(g, wet, pan);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dec + 0.05);
  }
}
