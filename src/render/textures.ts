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

/** Kamuflaż komiksowy: dwie barwy, duże plamy o ostrych krawędziach, jasne krawędzie paneli. */
export function toonCamoTexture(base: string, patch: string, seed: number): THREE.CanvasTexture {
  const size = 256;
  const [c, g] = makeCanvas(size);
  const img = g.createImageData(size, size);
  const b = new THREE.Color(base);
  const p = new THREE.Color(patch);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = valueNoise(u * 3, v * 3, seed, 2);
      const col = n > 0.56 ? p : b;
      const i = (y * size + x) * 4;
      img.data[i] = col.r * 255;
      img.data[i + 1] = col.g * 255;
      img.data[i + 2] = col.b * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export type CamoKind = 'stripes' | 'solid' | 'splinter' | 'tiger';

/**
 * Pancerz: kamuflaż o ostrych (komiksowych) krawędziach + zużycie – plamy kurzu,
 * odpryski farby, rysy. Tekstura obejmuje 4 m pancerza (UV w metrach × 0,25).
 */
export function armorTexture(kind: CamoKind, colors: string[], seed: number): THREE.CanvasTexture {
  const size = 512;
  const [c, g] = makeCanvas(size);
  const img = g.createImageData(size, size);
  const cols = colors.map((h) => new THREE.Color(h));
  const base = cols[0]!;
  // Komórki „splinter” – punkty Woronoja z przypisanym kolorem.
  const cells: [number, number, number][] = [];
  for (let i = 0; i < 26; i++) cells.push([hash2(i, 1, seed), hash2(i, 2, seed), Math.floor(hash2(i, 3, seed) * 3)]);
  const pick = (u: number, v: number): THREE.Color => {
    const w1 = valueNoise(u * 6, v * 6, seed + 40, 2) - 0.5;
    const w2 = valueNoise(u * 6 + 9, v * 6 + 4, seed + 41, 2) - 0.5;
    if (kind === 'stripes') {
      // Szerokie, faliste pasy po skosie (trzy kolory).
      const t = (u + v * 0.55 + w1 * 0.22) * 3.2;
      const k = t - Math.floor(t);
      const n = valueNoise(u * 2.5, v * 2.5, seed + 5, 2);
      if (k < 0.3) return cols[1]!;
      if (k > 0.62 && n > 0.42) return cols[2]!;
      return base;
    }
    if (kind === 'splinter') {
      let best = 9;
      let second = 9;
      let id = 0;
      for (const [cx, cy, ci] of cells) {
        for (const ox of [-1, 0, 1]) for (const oy of [-1, 0, 1]) {
          const dx = u - cx - ox;
          const dy = v - cy - oy;
          // Metryka „rombowa” – kanciaste odłamki.
          const d = Math.abs(dx * 0.8 + dy * 0.6) + Math.abs(dx * -0.6 + dy * 0.8) * 1.6;
          if (d < best) {
            second = best;
            best = d;
            id = ci;
          } else if (d < second) second = d;
        }
      }
      void second;
      return cols[id % cols.length]!;
    }
    if (kind === 'tiger') {
      // Pionowe, poszarpane pasy jak w kamuflażu „zasadzka”, plus kropki.
      const t = (u * 7 + w1 * 0.9 + valueNoise(v * 9, u * 2, seed + 7, 2) * 0.8) % 1;
      if (t < 0.16 && valueNoise(u * 3, v * 1.5, seed + 8, 2) > 0.45) return cols[1]!;
      // Okrągłe kropki „zasadzki”.
      const cu = u * 22;
      const cv = v * 22;
      const fx = cu - Math.floor(cu) - 0.5;
      const fy = cv - Math.floor(cv) - 0.5;
      if (hash2(Math.floor(cu), Math.floor(cv), seed + 9) > 0.8 && fx * fx + fy * fy < 0.06) return cols[2]!;
      return base;
    }
    // Jednolity: tylko delikatne, jaśniejsze przetarcia.
    return valueNoise(u * 5 + w2, v * 5, seed + 3, 3) > 0.66 ? cols[1]! : base;
  };
  const tmp = new THREE.Color();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      tmp.copy(pick(u, v));
      // Zużycie: duże plamy jaśniejszego kurzu, drobne ciemne zabrudzenia, odpryski farby.
      const dust = valueNoise(u * 3, v * 3, seed + 20, 3);
      const fine = valueNoise(u * 40, v * 40, seed + 21, 2);
      let k = 0.93 + (fine - 0.5) * 0.1;
      if (dust > 0.6) tmp.lerp(new THREE.Color('#c8b48a'), Math.min(0.28, (dust - 0.6) * 1.2));
      const chip = hash2(x >> 1, y >> 1, seed + 22);
      if (chip > 0.9965) tmp.setRGB(0.42, 0.4, 0.37);
      else if (chip > 0.993) k *= 1.18;
      // Rysy: krótkie ukośne linie.
      const sc = valueNoise(u * 90, v * 4, seed + 23, 1);
      if (sc > 0.86 && fine > 0.55) k *= 0.82;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, tmp.r * 255 * k);
      img.data[i + 1] = Math.min(255, tmp.g * 255 * k);
      img.data[i + 2] = Math.min(255, tmp.b * 255 * k);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c);
  t.repeat.set(0.25, 0.25);
  return t;
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
