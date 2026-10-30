import { describe, expect, it } from 'vitest';
import { MOVE_INDEX } from '../src/sim/params';
import { IN_HP, IN_LK, IN_RIGHT } from '../src/sim/input';
import { createMatch, step } from '../src/sim/step';

describe('łańcuchy kombo', () => {
  it('powtarzanie HP przechodzi przez zamach → zamach zwrotny → młot', () => {
    const s = createMatch(1, 1, 3);
    for (let i = 0; i < 101; i++) step(s, 0, 0);
    for (let i = 0; i < 30; i++) step(s, IN_RIGHT, 0);
    const seen = new Set<number>();
    for (let i = 0; i < 90; i++) {
      step(s, i % 6 < 2 ? IN_HP : 0, 0);
      seen.add(s.fighters[0].move);
    }
    expect(seen.has(MOVE_INDEX['hp']!)).toBe(true);
    expect(seen.has(MOVE_INDEX['hp2']!)).toBe(true);
    expect(seen.has(MOVE_INDEX['hp3']!)).toBe(true);
    expect(s.fighters[1].hp).toBeLessThan(900);
  });

  it('LK, LK, LK kończy się wyrzutem', () => {
    const s = createMatch(1, 1, 3);
    for (let i = 0; i < 101; i++) step(s, 0, 0);
    for (let i = 0; i < 35; i++) step(s, IN_RIGHT, 0);
    let launched = false;
    for (let i = 0; i < 90; i++) {
      step(s, i % 6 < 2 ? IN_LK : 0, 0);
      if (s.fighters[1].y > 1500) launched = true;
    }
    expect(launched).toBe(true);
  });
});
