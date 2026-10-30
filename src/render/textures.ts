// Tekstury proceduralne (CanvasTexture) – bez zewnętrznych plików.
import * as THREE from 'three';

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Szum wartości z interpolacją, kilka oktaw. */
export function valueNoise(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const fx = x * freq;
    const fy = y * freq;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = hash2(ix, iy, seed + o);
    const b = hash2(ix + 1, iy, seed + o);
    const c = hash2(ix, iy + 1, seed + o);
    const d = hash2(ix + 1, iy + 1, seed + o);
    sum += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/** Kamuflaż z trzech kolorów + zabrudzenia i przetarcia. */
export function camoTexture(colors: [string, string, string], seed: number): THREE.CanvasTexture {
  const size = 256;
  const [c, g] = makeCanvas(size);
  const img = g.createImageData(size, size);
  const cols = colors.map((h) => new THREE.Color(h));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n1 = valueNoise(u * 4, v * 4, seed, 3);
      const n2 = valueNoise(u * 5 + 7, v * 5 + 3, seed + 11, 3);
      let col = cols[0]!;
      if (n1 > 0.58) col = cols[1]!;
      if (n2 > 0.64) col = cols[2]!;
      const grime = valueNoise(u * 24, v * 24, seed + 3, 2);
      const speck = hash2(x, y, seed) > 0.985 ? 0.25 : 0;
      const k = 0.82 + grime * 0.25 + speck;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, col.r * 255 * k);
      img.data[i + 1] = Math.min(255, col.g * 255 * k);
      img.data[i + 2] = Math.min(255, col.b * 255 * k);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c);
}

/** Szorstkość: zabrudzenia i rysy. */
export function grimeTexture(seed: number): THREE.CanvasTexture {
  const size = 128;
  const [c, g] = makeCanvas(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = valueNoise(x / 16, y / 16, seed, 3);
      const v = 150 + n * 100;
      const i = (y * size + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Numer taktyczny na wieżę. */
export function numberTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 128);
  g.font = 'bold 92px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.globalAlpha = 0.9;
  g.fillText(text, 128, 68);
  // Lekkie przetarcia farby.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 140; i++) {
    g.globalAlpha = Math.random() * 0.6;
    g.fillRect(Math.random() * 256, Math.random() * 128, Math.random() * 6, Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Podłoże: ziemia/beton z plamami. */
export function groundTexture(base: string, dark: string, light: string, seed: number): THREE.CanvasTexture {
  const size = 512;
  const [c, g] = makeCanvas(size);
  const img = g.createImageData(size, size);
  const b = new THREE.Color(base);
  const d = new THREE.Color(dark);
  const l = new THREE.Color(light);
  const tmp = new THREE.Color();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = valueNoise(u * 8, v * 8, seed, 5);
      const fine = hash2(x, y, seed);
      tmp.copy(b).lerp(n < 0.5 ? d : l, Math.abs(n - 0.5) * 1.6);
      const k = 0.9 + fine * 0.2;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, tmp.r * 255 * k);
      img.data[i + 1] = Math.min(255, tmp.g * 255 * k);
      img.data[i + 2] = Math.min(255, tmp.b * 255 * k);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, 6);
}

/** Niebo – gradient pionowy. */
export function skyTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  for (const [p, col] of stops) grad.addColorStop(p, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Miękka kropka do cząsteczek. */
export function particleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
