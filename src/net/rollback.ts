// Netcode w stylu GGPO: lokalna symulacja z przewidywaniem wejść przeciwnika i cofaniem
// (rollback) po przyjściu prawdziwych wejść. Opóźnienie wejścia, limit cofania, wstrzymanie
// klatki przy dużym lagu, synchronizacja tempa i wykrywanie desynchronizacji hashem stanu.
import { hashState, snapshot } from '../sim/snapshot';
import { step } from '../sim/step';
import type { GameState, SimEvent } from '../sim/types';
import type { NetMsg, Transport } from './protocol';

export interface NetStats {
  ping: number;
  rollbacks: number;
  lastRollback: number;
  stalls: number;
  delay: number;
  advantage: number;
  desyncs: number;
  lastDesyncFrame: number;
  remoteFrame: number;
}

const REDUNDANCY = 8;
const HASH_EVERY = 30;

export class RollbackSession {
  state: GameState;
  /** Stan sprzed ostatniego kroku – do interpolacji w rendererze. */
  prev: GameState;
  readonly stats: NetStats;
  private readonly local: 0 | 1;
  private readonly delay: number;
  private readonly maxRollback: number;
  private readonly match: number;
  private localInputs = new Map<number, number>();
  private remoteInputs = new Map<number, number>();
  private predicted = new Map<number, number>();
  private snaps = new Map<number, GameState>();
  /** Najwyższa klatka, do której mamy komplet wejść przeciwnika (bez dziur). */
  private confirmed: number;
  private lastRemote = 0;
  private rollbackFrom = Infinity;
  private localHashes = new Map<number, number>();
  private remoteHashes = new Map<number, number>();
  private ticks = 0;
  /** Zdarzenia z ostatnich kroków (także z resymulacji) – renderer je deduplikuje. */
  events: SimEvent[] = [];

  constructor(
    private transport: Transport,
    state: GameState,
    local: 0 | 1,
    match: number,
    delay = 2,
    maxRollback = 8,
  ) {
    this.state = state;
    this.prev = snapshot(state);
    this.local = local;
    this.match = match;
    this.delay = delay;
    this.maxRollback = maxRollback;
    this.confirmed = state.frame;
    // Pierwsze klatki (przed opóźnieniem wejścia) mają puste wejścia po obu stronach.
    for (let f = state.frame + 1; f <= state.frame + delay; f++) this.localInputs.set(f, 0);
    this.lastLocal = state.frame + delay;
    this.lastHashed = state.frame - (state.frame % HASH_EVERY);
    this.snaps.set(state.frame, snapshot(state));
    this.stats = {
      ping: 0, rollbacks: 0, lastRollback: 0, stalls: 0, delay, advantage: 0, desyncs: 0,
      lastDesyncFrame: -1, remoteFrame: state.frame,
    };
  }

  /** Podmiana kanału po ponownym połączeniu – brakujące wejścia zostaną dosłane (ack). */
  setTransport(t: Transport): void {
    this.transport = t;
  }

  /** Obsługa wiadomości sieciowych dotyczących walki. Zwraca true, jeśli wiadomość była „nasza”. */
  handle(msg: NetMsg): boolean {
    if (msg.t === 'in') {
      if (msg.m !== this.match) return true;
      this.stats.remoteFrame = Math.max(this.stats.remoteFrame, msg.f);
      this.remoteAck = Math.max(this.remoteAck, msg.ack);
      for (let k = 0; k < msg.i.length; k++) {
        const f = msg.f - (msg.i.length - 1) + k;
        if (f <= this.confirmed || this.remoteInputs.has(f)) continue;
        const v = msg.i[k]!;
        this.remoteInputs.set(f, v);
        const p = this.predicted.get(f);
        if (p !== undefined && p !== v) this.rollbackFrom = Math.min(this.rollbackFrom, f);
      }
      while (this.remoteInputs.has(this.confirmed + 1)) this.confirmed++;
      this.lastRemote = Math.max(this.lastRemote, msg.f);
      return true;
    }
    if (msg.t === 'hash') {
      if (msg.m !== this.match) return true;
      this.remoteHashes.set(msg.f, msg.h);
      this.checkHash(msg.f);
      return true;
    }
    return false;
  }

  private checkHash(f: number): void {
    const a = this.localHashes.get(f);
    const b = this.remoteHashes.get(f);
    if (a === undefined || b === undefined) return;
    if (a !== b) {
      this.stats.desyncs++;
      this.stats.lastDesyncFrame = f;
      console.warn(`[net] desynchronizacja w klatce ${f}: ${a} != ${b}`);
    }
    this.localHashes.delete(f);
    this.remoteHashes.delete(f);
  }

  private inputFor(f: number): [number, number] {
    const loc = this.localInputs.get(f) ?? 0;
    let rem = this.remoteInputs.get(f);
    if (rem === undefined) {
      // Przewidywanie: przeciwnik trzyma to, co ostatnio.
      rem = this.remoteInputs.get(this.confirmed) ?? 0;
      this.predicted.set(f, rem);
    } else this.predicted.delete(f);
    return this.local === 0 ? [loc, rem] : [rem, loc];
  }

  private simulate(f: number): void {
    const [a, b] = this.inputFor(f);
    step(this.state, a, b);
    this.events.push(...this.state.events);
    this.snaps.set(f, snapshot(this.state));
  }

  /**
   * Jedna klatka czasu rzeczywistego: zapis lokalnego wejścia (z opóźnieniem), ewentualny
   * rollback i krok symulacji. Zwraca false, gdy klatka została wstrzymana (za duży lag).
   */
  tick(rawInput: number): boolean {
    this.ticks++;
    this.events = [];
    const cur = this.state.frame;
    // Synchronizacja tempa: gdy jesteśmy wyraźnie z przodu, co jakiś czas odpuszczamy klatkę.
    const rttFrames = Math.round(this.stats.ping / 16.67);
    this.stats.advantage = cur - (this.stats.remoteFrame + Math.round(rttFrames / 2));
    if (this.stats.advantage >= 3 && this.ticks % 3 === 0) {
      this.stats.stalls++;
      this.sendInputs();
      return false;
    }
    // Zbyt daleko przed potwierdzonymi wejściami – czekamy zamiast ryzykować.
    if (cur + 1 - this.confirmed > this.maxRollback) {
      this.stats.stalls++;
      this.sendInputs();
      return false;
    }
    const target = cur + 1 + this.delay;
    if (!this.localInputs.has(target)) {
      this.localInputs.set(target, rawInput);
      this.lastLocal = Math.max(this.lastLocal, target);
    }
    this.sendInputs();

    if (this.rollbackFrom <= cur) {
      const from = this.rollbackFrom;
      const base = this.snaps.get(from - 1);
      if (base) {
        Object.assign(this.state, snapshot(base));
        this.stats.rollbacks++;
        this.stats.lastRollback = cur - from + 1;
        for (let f = from; f <= cur; f++) this.simulate(f);
      }
    }
    this.rollbackFrom = Infinity;
    this.prev = this.snaps.get(cur) ?? snapshot(this.state);
    this.simulate(cur + 1);

    // Hash potwierdzonych klatek co HASH_EVERY – porównanie z przeciwnikiem.
    const upTo = Math.min(this.confirmed, this.state.frame);
    for (let f = this.lastHashed + HASH_EVERY; f <= upTo; f += HASH_EVERY) {
      const snap = this.snaps.get(f);
      this.lastHashed = f;
      if (!snap) continue;
      const h = hashState(snap);
      this.localHashes.set(f, h);
      this.transport.send({ t: 'hash', m: this.match, f, h });
      this.checkHash(f);
    }
    this.prune();
    return true;
  }

  private lastHashed = 0;
  /** Ostatnia klatka z zapisanym lokalnym wejściem – wysyłamy tylko te. */
  private lastLocal = 0;
  /** Do której klatki przeciwnik potwierdził nasze wejścia. */
  private remoteAck = 0;

  private sendInputs(): void {
    const last = this.lastLocal;
    // Redundancja: ostatnie wejścia, a po przerwie – wszystko od ostatniego potwierdzenia (max 16).
    const first = Math.max(last - 15, Math.min(this.remoteAck + 1, last - REDUNDANCY + 1));
    const inputs: number[] = [];
    for (let f = first; f <= last; f++) inputs.push(this.localInputs.get(f) ?? 0);
    this.transport.send({ t: 'in', m: this.match, f: last, i: inputs, ack: this.confirmed });
  }

  private prune(): void {
    const keep = Math.min(this.confirmed, this.state.frame, this.remoteAck + 1) - this.maxRollback - HASH_EVERY * 2;
    for (const m of [this.snaps, this.localInputs, this.remoteInputs, this.predicted]) {
      for (const k of m.keys()) if (k < keep) m.delete(k);
    }
  }

  /** Pomiar opóźnienia (wywoływane po otrzymaniu pong). */
  setPing(ms: number): void {
    this.stats.ping = this.stats.ping === 0 ? ms : Math.round(this.stats.ping * 0.8 + ms * 0.2);
  }
}
