import { describe, expect, it } from 'vitest';
import { nextRandom } from '../src/sim/rng';
import { hashState, restore, snapshot } from '../src/sim/snapshot';
import { createMatch, step } from '../src/sim/step';

/** Pseudolosowe, ale powtarzalne wejścia: przytrzymywane przez kilka klatek jak u człowieka. */
function makeInputs(seed: number, frames: number): [number, number][] {
  const out: [number, number][] = [];
  let s = seed;
  let a = 0;
  let b = 0;
  for (let i = 0; i < frames; i++) {
    let r: number;
    [s, r] = nextRandom(s);
    if (r % 6 === 0) a = r & 0xfff;
    [s, r] = nextRandom(s);
    if (r % 6 === 0) b = r & 0xfff;
    out.push([a, b]);
  }
  return out;
}

function run(tank1: number, tank2: number, inputs: [number, number][]): number {
  const s = createMatch(tank1, tank2, 12345);
  for (const [a, b] of inputs) step(s, a, b);
  return hashState(s);
}

describe('determinizm symulacji', () => {
  it('ta sama sekwencja 3000 klatek daje identyczny hash', () => {
    for (const [t1, t2] of [[0, 1], [1, 2], [2, 0], [1, 1]] as const) {
      const inputs = makeInputs(t1 * 7 + t2 + 1, 3000);
      const h1 = run(t1, t2, inputs);
      const h2 = run(t1, t2, inputs);
      expect(h1).toBe(h2);
    }
  });

  it('snapshot → 100 klatek → przywrócenie → te same 100 klatek daje ten sam hash', () => {
    const inputs = makeInputs(99, 700);
    const s = createMatch(0, 2, 777);
    for (let i = 0; i < 500; i++) step(s, inputs[i]![0], inputs[i]![1]);
    const snap = snapshot(s);
    for (let i = 500; i < 600; i++) step(s, inputs[i]![0], inputs[i]![1]);
    const h1 = hashState(s);
    restore(s, snap);
    for (let i = 500; i < 600; i++) step(s, inputs[i]![0], inputs[i]![1]);
    expect(hashState(s)).toBe(h1);
  });

  it('stan zawiera wyłącznie liczby całkowite', () => {
    const inputs = makeInputs(5, 2000);
    const s = createMatch(1, 2, 3);
    const bad: string[] = [];
    const check = (v: unknown, path: string): void => {
      if (typeof v === 'number') {
        if (!Number.isInteger(v)) bad.push(path);
      } else if (Array.isArray(v)) v.forEach((x, i) => check(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) check(x, `${path}.${k}`);
    };
    for (const [a, b] of inputs) {
      step(s, a, b);
      check(s, 'state');
      if (bad.length) break;
    }
    expect(bad).toEqual([]);
  });

  it('losowa walka prowadzi do trafień i obrażeń', () => {
    const inputs = makeInputs(42, 3000);
    const s = createMatch(1, 1, 9);
    let hits = 0;
    for (const [a, b] of inputs) {
      step(s, a, b);
      hits += s.events.filter((e) => e.type === 1 || e.type === 2).length;
    }
    expect(hits).toBeGreaterThan(5);
  });
});
