import { describe, expect, it } from 'vitest';
import { IN_HK, IN_HP, IN_RIGHT, IN_RUN } from '../src/sim/input';
import { createMatch, step } from '../src/sim/step';

/** Najwyższy punkt lotu P1, gdy P2 bez przerwy atakuje HP. */
function maxHeight(t1: number, t2: number, gap: number, p1: (i: number) => number): number {
  const s = createMatch(t1, t2, 1);
  for (let i = 0; i < 101; i++) step(s, 0, 0);
  const f = s.fighters[0];
  s.fighters[1].x = f.x + gap;
  let max = 0;
  for (let i = 0; i < 150; i++) {
    step(s, p1(i), i % 5 === 0 ? IN_HP : 0);
    max = Math.max(max, f.y);
  }
  return max;
}

describe('nic nie wyrzuca czołgu „w kosmos”', () => {
  it('trafienie w trakcie stania na lufie (Barrel Spin) nie wystrzeliwuje czołgu', () => {
    for (let t1 = 0; t1 < 4; t1++)
      for (let t2 = 0; t2 < 4; t2++) {
        expect(maxHeight(t1, t2, 4000, (i) => (i < 30 ? IN_RUN : 0) | (i === 3 ? IN_HP : 0))).toBeLessThan(5500);
      }
  });

  it('żonglerka seriami HP nie sumuje wyrzutu ponad limit', () => {
    for (let t1 = 0; t1 < 4; t1++)
      for (let t2 = 0; t2 < 4; t2++) {
        expect(maxHeight(t1, t2, 8000, (i) => IN_RIGHT | (i === 6 ? IN_HK : 0))).toBeLessThan(5000);
      }
  });
});
