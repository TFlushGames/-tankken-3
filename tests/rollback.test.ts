import { describe, expect, it } from 'vitest';
import { RollbackSession } from '../src/net/rollback';
import type { NetMsg, Transport } from '../src/net/protocol';
import { nextRandom } from '../src/sim/rng';
import { hashState } from '../src/sim/snapshot';
import { createMatch, step } from '../src/sim/step';

/** Para kanałów w pamięci z opóźnieniem (w tikach), wahaniami i utratą wejść. */
class FakeLink {
  queue: { at: number; to: 0 | 1; msg: NetMsg }[] = [];
  now = 0;
  seed = 7;
  readonly ends: [Transport, Transport];
  constructor(private lag: number, private jitter: number, private loss: number) {
    const mk = (me: 0 | 1): Transport => ({
      send: (msg) => {
        let r: number;
        [this.seed, r] = nextRandom(this.seed);
        if (msg.t === 'in' && r % 100 < this.loss) return;
        const j = this.jitter ? (r >>> 8) % (this.jitter + 1) : 0;
        this.queue.push({ at: this.now + this.lag + j, to: me === 0 ? 1 : 0, msg: JSON.parse(JSON.stringify(msg)) });
      },
      onMessage: null,
      onClose: null,
      close: () => undefined,
    });
    this.ends = [mk(0), mk(1)];
  }
  pump(): void {
    const due = this.queue.filter((q) => q.at <= this.now);
    this.queue = this.queue.filter((q) => q.at > this.now);
    for (const q of due) this.ends[q.to].onMessage?.(q.msg);
  }
}

function inputs(seed: number, n: number): number[] {
  const out: number[] = [];
  let s = seed;
  let cur = 0;
  for (let i = 0; i < n; i++) {
    let r: number;
    [s, r] = nextRandom(s);
    if (r % 7 === 0) cur = r & 0xfff;
    out.push(cur);
  }
  return out;
}

function runOnline(lag: number, jitter: number, loss: number): { a: RollbackSession; b: RollbackSession; ref: number } {
  const link = new FakeLink(lag, jitter, loss);
  const a = new RollbackSession(link.ends[0], createMatch(1, 2, 99), 0, 1, 2, 8);
  const b = new RollbackSession(link.ends[1], createMatch(1, 2, 99), 1, 1, 2, 8);
  link.ends[0].onMessage = (m) => a.handle(m);
  link.ends[1].onMessage = (m) => b.handle(m);
  const ia = inputs(11, 4000);
  const ib = inputs(22, 4000);
  // Klient wysyła wejście i_k w swoim k-tym udanym kroku (z opóźnieniem `delay`).
  let ka = 0;
  let kb = 0;
  for (let t = 0; t < 2600; t++) {
    link.now = t;
    link.pump();
    if (a.state.frame < 1500 && a.tick(ia[ka] ?? 0)) ka++;
    if (b.state.frame < 1500 && b.tick(ib[kb] ?? 0)) kb++;
  }
  // Wyrównanie: dopuszczamy dotarcie ostatnich pakietów i resymulację.
  for (let t = 2600; t < 2700; t++) {
    link.now = t;
    link.pump();
  }
  // Wzorzec: lokalna symulacja tej samej sekwencji wejść (z opóźnieniem 2 klatek).
  const ref = createMatch(1, 2, 99);
  for (let f = 1; f <= 1500; f++) step(ref, f > 2 ? ia[f - 3]! : 0, f > 2 ? ib[f - 3]! : 0);
  return { a, b, ref: hashState(ref) };
}

describe('rollback', () => {
  it('przy idealnym łączu obaj klienci liczą to samo co symulacja lokalna', () => {
    const { a, b, ref } = runOnline(0, 0, 0);
    expect(a.state.frame).toBe(1500);
    expect(hashState(a.state)).toBe(ref);
    expect(hashState(b.state)).toBe(ref);
  });

  it('przy lagu, wahaniach i utracie pakietów stany się zgadzają, a desynchronizacji brak', () => {
    const { a, b, ref } = runOnline(5, 3, 10);
    // Ostatnie klatki mogą jeszcze nie być potwierdzone – porównujemy przez dosymulowanie.
    expect(a.stats.rollbacks).toBeGreaterThan(0);
    expect(a.stats.desyncs).toBe(0);
    expect(b.stats.desyncs).toBe(0);
    expect(hashState(a.state)).toBe(ref);
    expect(hashState(b.state)).toBe(ref);
  });
});
