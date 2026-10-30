import { describe, expect, it } from 'vitest';
import { PH_FIGHT, ST_AIRHIT, ST_BLOCKSTUN, ST_KNOCKDOWN } from '../src/sim/constants';
import { IN_BLOCK, IN_DOWN, IN_HK, IN_HP, IN_LEFT, IN_LP, IN_RIGHT, IN_UP } from '../src/sim/input';
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

describe('rozgrywka', () => {
  it('podejście i cios z góry zadaje obrażenia', () => {
    const s = fight();
    run(s, 40, IN_RIGHT);
    run(s, 10, 0);
    step(s, IN_HK, 0);
    run(s, 40, 0);
    expect(s.fighters[1].hp).toBeLessThan(1000);
  });

  it('blok redukuje obrażenia do chipu', () => {
    const s = fight();
    run(s, 40, IN_RIGHT, IN_BLOCK);
    run(s, 10, 0, IN_BLOCK);
    step(s, IN_HP, IN_BLOCK);
    let blocked = false;
    for (let i = 0; i < 40; i++) {
      step(s, 0, IN_BLOCK);
      if (s.fighters[1].state === ST_BLOCKSTUN) blocked = true;
    }
    expect(blocked).toBe(true);
    expect(s.fighters[1].hp).toBeGreaterThan(1000 - 20);
  });

  it('podbicie wyrzuca przeciwnika w powietrze', () => {
    const s = fight();
    run(s, 40, IN_RIGHT);
    run(s, 10, 0);
    step(s, IN_DOWN | IN_HP, 0);
    let air = false;
    for (let i = 0; i < 40; i++) {
      step(s, IN_DOWN, 0);
      if (s.fighters[1].state === ST_AIRHIT) air = true;
    }
    expect(air).toBe(true);
  });

  it('rzut z bliska przewraca przeciwnika', () => {
    const s = fight();
    run(s, 70, IN_RIGHT);
    step(s, IN_RIGHT | IN_LP, 0);
    let down = false;
    for (let i = 0; i < 80; i++) {
      step(s, 0, 0);
      if (s.fighters[1].state === ST_KNOCKDOWN) down = true;
    }
    expect(down).toBe(true);
    expect(s.fighters[1].hp).toBeLessThan(1000);
  });

  it('przeskok nad przeciwnikiem zmienia stronę', () => {
    const s = fight(2, 0);
    run(s, 30, IN_RIGHT);
    run(s, 50, IN_UP | IN_RIGHT);
    run(s, 40, 0);
    expect(s.fighters[0].facingRight).toBe(0);
    run(s, 30, IN_LEFT);
  });

  it('pełny mecz kończy się zwycięzcą', () => {
    const s = createMatch(0, 2, 5);
    for (let i = 0; i < 60 * 60 * 5 && s.phase !== 3; i++) {
      const k = i % 50;
      step(s, k === 0 ? IN_HK : k === 25 ? IN_LP : IN_RIGHT, 0);
    }
    expect(s.phase).toBe(3);
    expect(s.winner).toBe(0);
  });
});
