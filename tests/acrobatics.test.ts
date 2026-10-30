import { describe, expect, it } from 'vitest';
import { PH_FIGHT, ST_DASH } from '../src/sim/constants';
import { IN_HK, IN_HP, IN_LK, IN_RIGHT, IN_RUN, IN_UP } from '../src/sim/input';
import { createMatch, step } from '../src/sim/step';
import type { GameState } from '../src/sim/types';

function run(s: GameState, frames: number, a: number, b = 0): void {
  for (let i = 0; i < frames; i++) step(s, a, b);
}

function fight(t1 = 1, t2 = 1): GameState {
  const s = createMatch(t1, t2, 1);
  run(s, 101, 0);
  expect(s.phase).toBe(PH_FIGHT);
  return s;
}

describe('akrobacje i mobilność', () => {
  it('podwójne stuknięcie przodu daje doskok, który przenosi czołg dalej niż chód', () => {
    const s = fight();
    const x0 = s.fighters[0].x;
    step(s, IN_RIGHT, 0);
    step(s, 0, 0);
    step(s, IN_RIGHT, 0);
    expect(s.fighters[0].state).toBe(ST_DASH);
    run(s, 12, 0);
    expect(s.fighters[0].x - x0).toBeGreaterThan(2500);
  });

  it('podwójny skok wznosi czołg wyżej niż pojedynczy', () => {
    const one = fight();
    const two = fight();
    let max1 = 0;
    let max2 = 0;
    for (let i = 0; i < 70; i++) {
      step(one, i < 3 ? IN_UP : 0, 0);
      step(two, i < 3 || (i >= 18 && i < 21) ? IN_UP : 0, 0);
      max1 = Math.max(max1, one.fighters[0].y);
      max2 = Math.max(max2, two.fighters[0].y);
    }
    expect(max2).toBeGreaterThan(max1 + 800);
  });

  it('wysoki cios MAMUTA trafia niską OSĘ', () => {
    const s = fight(0, 2);
    run(s, 40, IN_RIGHT);
    run(s, 6, 0);
    step(s, IN_HP, 0);
    run(s, 30, 0);
    expect(s.fighters[1].hp).toBeLessThan(1000);
  });

  for (const [name, btn] of [['skok o lufie', IN_HK], ['młynek na lufie', IN_HP], ['wybicie wystrzałem', IN_LK]] as const) {
    it(`${name} trafia przeciwnika z bliska (każdy czołg)`, () => {
      for (let t = 0; t < 4; t++) {
        const s = fight(t, 1);
        run(s, 60, IN_RIGHT);
        step(s, IN_RUN | btn, 0);
        run(s, 110, 0);
        expect(s.fighters[1].hp, `czołg ${t}`).toBeLessThan(1000);
      }
    });
  }

  it('wybicie wystrzałem wyrzuca czołg w powietrze', () => {
    const s = fight();
    step(s, IN_RUN | IN_LK, 0);
    let maxY = 0;
    for (let i = 0; i < 50; i++) {
      step(s, 0, 0);
      maxY = Math.max(maxY, s.fighters[0].y);
    }
    expect(maxY).toBeGreaterThan(1500);
  });
});
