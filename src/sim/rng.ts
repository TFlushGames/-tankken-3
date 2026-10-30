// Seedowany PRNG (xorshift32). Stan trzymany w stanie gry.
export function nextRandom(seed: number): [number, number] {
  let x = seed | 0 || 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  const s = x >>> 0;
  return [s, s];
}
