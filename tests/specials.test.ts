import { describe, expect, it } from 'vitest';
import { PH_FIGHT } from '../src/sim/constants';
import { IN_DOWN, IN_HK, IN_HP, IN_LEFT, IN_LK, IN_LP, IN_RIGHT } from '../src/sim/input';
import { MOVE_INDEX } from '../src/sim/params';
import { createMatch, step } from '../src/sim/step';
import type { GameState } from '../src/sim/types';

const run = (s: GameState, n: number, a: number, b = 0): void => {
  for (let i = 0; i < n; i++) step(s, a, b);
};

function fight(t1: number, t2 = 1): GameState {
  const s = createMatch(t1, t2, 3);
  run(s, 101, 0);
  expect(s.phase).toBe(PH_FIGHT);
  return s;
}

/** Wykonuje sekwencję kierunków (P1 patrzy w prawo: F = prawo, B = lewo) i przycisk. */
function motion(s: GameState, dirs: number[], button: number): void {
  for (const d of dirs) {
    run(s, 2, d);
    run(s, 1, 0);
  }
  step(s, dirs[dirs.length - 1]! | button, 0);
}

const F = IN_RIGHT;
const B = IN_LEFT;
const D = IN_DOWN;

describe('ataki specjalne', () => {
  it('THUNDER: B, F + HP wystrzeliwuje pocisk, który trafia z daleka', () => {
    const s = fight(1, 1);
    motion(s, [B, F], IN_HP);
    let spawned = false;
    for (let i = 0; i < 80; i++) {
      step(s, 0, 0);
      if (s.projectiles.length) spawned = true;
    }
    expect(spawned).toBe(true);
    expect(s.fighters[1].hp).toBeLessThan(1000);
  });

  it('pocisk wysoki przechodzi nad kucającym', () => {
    const s = fight(1, 1);
    motion(s, [B, F], IN_HP);
    run(s, 80, 0, IN_DOWN);
    expect(s.fighters[1].hp).toBe(1000);
  });

  it('dwa pociski znoszą się nawzajem', () => {
    const s = fight(1, 1);
    run(s, 40, B, F);
    for (const d of [B, F]) {
      run(s, 2, d, d === B ? F : B);
      run(s, 1, 0);
    }
    step(s, F | IN_HP, B | IN_HP);
    run(s, 80, 0, 0);
    expect(s.fighters[0].hp).toBe(1000);
    expect(s.fighters[1].hp).toBe(1000);
  });

  it('WASP: D, B + HP – znika i pojawia się za plecami przeciwnika', () => {
    const s = fight(2, 1);
    const side0 = Math.sign(s.fighters[1].x - s.fighters[0].x);
    motion(s, [D, B], IN_HP);
    let maxY = 0;
    for (let i = 0; i < 90; i++) {
      step(s, 0, 0);
      maxY = Math.max(maxY, s.fighters[0].y);
    }
    expect(maxY).toBeGreaterThan(7000);
    expect(Math.sign(s.fighters[1].x - s.fighters[0].x)).toBe(-side0);
    expect(s.fighters[1].hp).toBeLessThan(1000);
  });

  it('WASP: B, F + LP – harpun przyciąga przeciwnika', () => {
    const s = fight(2, 1);
    const d0 = s.fighters[1].x - s.fighters[0].x;
    motion(s, [B, F], IN_LP);
    run(s, 30, 0);
    expect(s.fighters[1].hp).toBeLessThan(1000);
    expect(s.fighters[1].x - s.fighters[0].x).toBeLessThan(d0 - 1500);
  });

  it('MAMMOTH: D, D + HK – trzęsienie ziemi trafia z bliska; kucanie go nie blokuje górą', () => {
    const s = fight(0, 1);
    run(s, 50, F);
    motion(s, [D, D], IN_HK);
    run(s, 60, 0);
    expect(s.fighters[1].hp).toBeLessThan(1000);
  });

  it('samo trzymanie dołu + HK to zwykły niski cios, nie trzęsienie ziemi', () => {
    const s = fight(0, 1);
    run(s, 10, D);
    step(s, D | IN_HK, 0);
    run(s, 3, D);
    expect(s.fighters[0].move).toBe(MOVE_INDEX['d_hk']);
  });

  it('COBRA: B, F + HP – railgun trafia przez całą arenę', () => {
    const s = fight(3, 1);
    run(s, 30, B);
    motion(s, [B, F], IN_HP);
    run(s, 70, 0);
    expect(s.fighters[1].hp).toBeLessThan(1000);
  });

  it('specjalne innego czołgu nie działają', () => {
    const s = fight(1, 1);
    motion(s, [D, B], IN_HP);
    run(s, 40, 0);
    expect(s.fighters[0].y).toBeLessThan(3000);
    void IN_LK;
  });
});
