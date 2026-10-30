// Wejście gracza na klatkę: bitmaska kierunków (absolutnych względem ekranu) i 8 przycisków.
export const IN_UP = 1 << 0;
export const IN_DOWN = 1 << 1;
export const IN_LEFT = 1 << 2;
export const IN_RIGHT = 1 << 3;
export const IN_HP = 1 << 4;
export const IN_LP = 1 << 5;
export const IN_RUN = 1 << 6;
export const IN_LK = 1 << 7;
export const IN_HK = 1 << 8;
export const IN_BLOCK = 1 << 9;
export const IN_SS_IN = 1 << 10;
export const IN_SS_OUT = 1 << 11;

export type Button = 'HP' | 'LP' | 'RUN' | 'LK' | 'HK' | 'BLOCK' | 'SSIN' | 'SSOUT';

export const BUTTON_BITS: Record<Button, number> = {
  HP: IN_HP,
  LP: IN_LP,
  RUN: IN_RUN,
  LK: IN_LK,
  HK: IN_HK,
  BLOCK: IN_BLOCK,
  SSIN: IN_SS_IN,
  SSOUT: IN_SS_OUT,
};

/** Kierunek względny (notacja numeryczna jak w bijatykach: F=przód, B=tył, U, D, UF...). */
export type RelDir = 'N' | 'U' | 'D' | 'F' | 'B' | 'UF' | 'UB' | 'DF' | 'DB';

/** Kierunki względne w bitach: bit0 = U, bit1 = D, bit2 = F, bit3 = B. */
export const REL_U = 1;
export const REL_D = 2;
export const REL_F = 4;
export const REL_B = 8;

export function relDirBits(input: number, facingRight: boolean): number {
  let r = 0;
  if (input & IN_UP) r |= REL_U;
  if (input & IN_DOWN) r |= REL_D;
  const fwd = facingRight ? IN_RIGHT : IN_LEFT;
  const back = facingRight ? IN_LEFT : IN_RIGHT;
  if (input & fwd && !(input & back)) r |= REL_F;
  if (input & back && !(input & fwd)) r |= REL_B;
  if (r & REL_U && r & REL_D) r &= ~(REL_U | REL_D);
  return r;
}

const DIR_MASKS: Record<RelDir, number> = {
  N: 0,
  U: REL_U,
  D: REL_D,
  F: REL_F,
  B: REL_B,
  UF: REL_U | REL_F,
  UB: REL_U | REL_B,
  DF: REL_D | REL_F,
  DB: REL_D | REL_B,
};

/** Czy kierunek względny pasuje do symbolu. „D” pasuje też do DF/DB, by ruchy były wygodne. */
export function dirMatches(rel: number, dir: RelDir, strict: boolean): boolean {
  const m = DIR_MASKS[dir];
  if (strict || m === 0) return rel === m;
  return (rel & m) === m;
}
