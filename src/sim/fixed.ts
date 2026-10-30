// Arytmetyka stałoprzecinkowa symulacji.
// Długości: 1 jednostka = 1 mm. Kąty: setne stopnia (36000 = pełny obrót).
// Sinus/cosinus z tablicy przeskalowane przez TRIG_ONE.

export const TRIG_ONE = 16384;
export const FULL_TURN = 36000;
export const HALF_TURN = 18000;

const SIN_TABLE = new Int32Array(FULL_TURN);
for (let i = 0; i < FULL_TURN; i++) {
  // Zaokrąglenie do liczby całkowitej usuwa różnice ostatniego bitu między silnikami JS.
  SIN_TABLE[i] = Math.round(Math.sin((i * Math.PI) / HALF_TURN) * TRIG_ONE);
}

export function wrapAngle(a: number): number {
  const m = a % FULL_TURN;
  return m < 0 ? m + FULL_TURN : m;
}

/** Kąt sprowadzony do zakresu (-18000, 18000]. */
export function signedAngle(a: number): number {
  const w = wrapAngle(a);
  return w > HALF_TURN ? w - FULL_TURN : w;
}

export function isin(a: number): number {
  return SIN_TABLE[wrapAngle(a)]!;
}

export function icos(a: number): number {
  return SIN_TABLE[wrapAngle(a + 9000)]!;
}

/** Mnożenie wartości przez współczynnik trygonometryczny. */
export function trigMul(v: number, t: number): number {
  return Math.trunc((v * t) / TRIG_ONE);
}

/** Całkowity pierwiastek (podłoga), deterministyczny. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

// atan2: tablica atan dla stosunku 0..1 w 1024 krokach, wynik w setnych stopnia.
const ATAN_STEPS = 1024;
const ATAN_TABLE = new Int32Array(ATAN_STEPS + 1);
for (let i = 0; i <= ATAN_STEPS; i++) {
  ATAN_TABLE[i] = Math.round((Math.atan(i / ATAN_STEPS) * HALF_TURN) / Math.PI);
}

/** atan2(y, x) w setnych stopnia, zakres [0, 36000). 0 = oś +X, 9000 = oś +Z. */
export function iatan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let a: number;
  if (ax >= ay) {
    a = ATAN_TABLE[Math.trunc((ay * ATAN_STEPS) / ax)]!;
  } else {
    a = 9000 - ATAN_TABLE[Math.trunc((ax * ATAN_STEPS) / ay)]!;
  }
  if (x < 0) a = HALF_TURN - a;
  if (y < 0) a = FULL_TURN - a;
  return wrapAngle(a);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Zbliża wartość do celu o maksymalnie `step`. */
export function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

/** Konwersje jednostek (tylko przy wczytywaniu danych, wyniki zaokrąglane). */
export const perSecToPerFrame = (v: number): number => Math.round(v / 60);
export const perSec2ToPerFrame2 = (v: number): number => Math.round(v / 3600);
