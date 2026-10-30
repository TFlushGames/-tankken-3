// Areny proceduralne: zrujnowana fabryka o zachodzie słońca i zimowy poligon.
import * as THREE from 'three';
import { ARENA_RADIUS } from '../sim/constants';
import { groundTexture, skyTexture, valueNoise } from './textures';

export interface ArenaDef {
  id: string;
  name: string;
  sky: [number, string][];
  fog: number;
  fogNear: number;
  fogFar: number;
  ground: [string, string, string];
  sun: number;
  sunIntensity: number;
  sunDir: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  dust: number;
}

export const ARENAS: ArenaDef[] = [
  {
    id: 'factory',
    name: 'Zrujnowana fabryka',
    sky: [
      [0, '#3b2a7a'],
      [0.35, '#c04a7a'],
      [0.6, '#ff8a4a'],
      [0.78, '#ffd27a'],
      [1, '#ffb070'],
    ],
    fog: 0xf0a070,
    fogNear: 30,
    fogFar: 120,
    ground: ['#8a7660', '#5e5142', '#a8957a'],
    sun: 0xffc08a,
    sunIntensity: 3.6,
    sunDir: [-0.75, 0.45, 0.5],
    hemiSky: 0xffd2b0,
    hemiGround: 0x5a4a40,
    dust: 0x8a7458,
  },
  {
    id: 'winter',
    name: 'Zimowy poligon',
    sky: [
      [0, '#3a7ad8'],
      [0.5, '#7ab8f0'],
      [0.8, '#d4ecff'],
      [1, '#eef6ff'],
    ],
    fog: 0xc8d2dc,
    fogNear: 25,
    fogFar: 100,
    ground: ['#d6dde3', '#9aa4ad', '#f2f5f7'],
    sun: 0xf2f4ff,
    sunIntensity: 2.6,
    sunDir: [0.5, 0.65, 0.55],
    hemiSky: 0xdfe8f5,
    hemiGround: 0x7d8790,
    dust: 0xe6ecf2,
  },
];

/** Warstwa śladów gąsienic malowana na teksturze nałożonej na podłoże. */
export class TrackMarks {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly size = 1024;
  private readonly extent = (ARENA_RADIUS / 1000) * 2 + 4;
  private dirty = false;

  constructor(color: string) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.g = this.canvas.getContext('2d')!;
    this.g.fillStyle = color;
    this.tex = new THREE.CanvasTexture(this.canvas);
    const mat = new THREE.MeshStandardMaterial({ map: this.tex, transparent: true, depthWrite: false, roughness: 1 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.extent, this.extent), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.01;
    this.mesh.receiveShadow = true;
  }

  stamp(x: number, z: number, yaw: number, width: number, len: number, alpha: number): void {
    const s = this.size / this.extent;
    const px = (x + this.extent / 2) * s;
    const py = (z + this.extent / 2) * s;
    this.g.save();
    this.g.globalAlpha = alpha;
    this.g.translate(px, py);
    this.g.rotate(yaw);
    this.g.fillRect((-len / 2) * s, (-width / 2) * s, len * s, width * s);
    this.g.restore();
    this.dirty = true;
  }

  clear(): void {
    this.g.clearRect(0, 0, this.size, this.size);
    this.dirty = true;
  }

  flush(): void {
    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }
}

export class Arena {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly marks: TrackMarks;
  readonly def: ArenaDef;

  constructor(def: ArenaDef, scene: THREE.Scene) {
    this.def = def;
    scene.fog = new THREE.Fog(def.fog, def.fogNear, def.fogFar);
    scene.background = skyTexture(def.sky);

    const hemi = new THREE.HemisphereLight(def.hemiSky, def.hemiGround, 1.9);
    this.group.add(hemi);
    this.sun = new THREE.DirectionalLight(def.sun, def.sunIntensity);
    const [sx, sy, sz] = def.sunDir;
    this.sun.position.set(sx * 40, sy * 40, sz * 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22;
    sc.right = 22;
    sc.top = 22;
    sc.bottom = -22;
    sc.near = 1;
    sc.far = 100;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    // Podłoże.
    const [b, d, l] = def.ground;
    const gtex = groundTexture(b, d, l, def.id === 'winter' ? 21 : 4);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(160, 64),
      new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.95, metalness: 0.05 }),
    );
    gtex.repeat.set(30, 30);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    this.marks = new TrackMarks(def.id === 'winter' ? 'rgba(90,100,110,1)' : 'rgba(30,24,18,1)');
    this.group.add(this.marks.mesh);

    if (def.id === 'factory') this.buildFactory();
    else this.buildWinter();
    this.buildBoundary();
    scene.add(this.group);
  }

  private buildBoundary(): void {
    // Krąg betonowych zapór wyznacza granicę areny.
    const R = ARENA_RADIUS / 1000 + 0.9;
    const mat = new THREE.MeshStandardMaterial({ color: this.def.id === 'winter' ? 0xa8b0b6 : 0x7a7368, roughness: 0.9 });
    const geo = new THREE.BoxGeometry(1.6, 1.0, 0.7);
    const n = 64;
    for (let i = 0; i < n; i++) {
      if (i % 9 === 4) continue;
      const a = (i / n) * Math.PI * 2;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * R, 0.5, Math.sin(a) * R);
      m.rotation.y = -a + Math.PI / 2 + (Math.random() - 0.5) * 0.15;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  private buildFactory(): void {
    const brick = new THREE.MeshStandardMaterial({ color: 0xb0654a, roughness: 0.95 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9184, roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.6, metalness: 0.7 });
    const glowWin = new THREE.MeshStandardMaterial({ color: 0x221a18, emissive: 0xff9a50, emissiveIntensity: 0.5 });
    const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
    // Warstwy tła: ruiny hal, kominy, dźwigary.
    for (let layer = 0; layer < 3; layer++) {
      const dist = 26 + layer * 18;
      const count = 9 + layer * 4;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + layer * 0.3;
        const w = rnd(6, 14);
        const h = rnd(5, 12) + layer * 3;
        const hall = new THREE.Group();
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.0), brick);
        wall.position.y = h / 2;
        hall.add(wall);
        // Zrujnowana krawędź.
        for (let k = 0; k < 4; k++) {
          const chunk = new THREE.Mesh(new THREE.BoxGeometry(rnd(1, 3), rnd(1, 3), 1.05), brick);
          chunk.position.set(rnd(-w / 2, w / 2), h + rnd(-0.5, 1.2), 0);
          chunk.rotation.z = rnd(-0.3, 0.3);
          hall.add(chunk);
        }
        for (let k = 0; k < 3; k++) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.2), glowWin);
          win.position.set(-w / 3 + k * (w / 3), h * 0.55, 0.52);
          hall.add(win);
        }
        hall.position.set(Math.cos(a) * dist, 0, Math.sin(a) * dist);
        hall.lookAt(0, 0, 0);
        this.group.add(hall);
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = rnd(0, Math.PI * 2);
      const d = rnd(40, 70);
      const h = rnd(22, 38);
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, h, 12), brick);
      ch.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d);
      this.group.add(ch);
    }
    // Dźwigary i gruz bliżej areny.
    for (let i = 0; i < 14; i++) {
      const a = rnd(0, Math.PI * 2);
      const d = rnd(17.5, 23);
      const g = new THREE.Mesh(new THREE.BoxGeometry(rnd(4, 9), 0.4, 0.4), steel);
      g.position.set(Math.cos(a) * d, rnd(0.2, 3), Math.sin(a) * d);
      g.rotation.set(rnd(-0.4, 0.4), rnd(0, Math.PI), rnd(-0.6, 0.6));
      g.castShadow = true;
      this.group.add(g);
      const rub = new THREE.Mesh(new THREE.DodecahedronGeometry(rnd(0.6, 1.6), 0), concrete);
      rub.position.set(Math.cos(a + 0.3) * d, 0.3, Math.sin(a + 0.3) * d);
      rub.castShadow = true;
      this.group.add(rub);
    }
    // Wielkie słońce nisko nad horyzontem.
    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(9, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd2a0, fog: false }),
    );
    // Tarcza słońca w tle (światło pada z boku, by czołgi były czytelne).
    sunDisc.position.set(-90, 16, -110);
    sunDisc.lookAt(0, 0, 0);
    this.group.add(sunDisc);
  }

  private buildWinter(): void {
    const snow = new THREE.MeshStandardMaterial({ color: 0xeef2f5, roughness: 1 });
    const pine = new THREE.MeshStandardMaterial({ color: 0x2c3f33, roughness: 0.9 });
    const trunk = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.9 });
    const conc = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.9 });
    const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
    // Pagórki w kilku warstwach.
    for (let layer = 0; layer < 3; layer++) {
      const dist = 35 + layer * 25;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + layer;
        const r = rnd(10, 20) + layer * 6;
        const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), snow);
        hill.scale.y = rnd(0.25, 0.5);
        hill.position.set(Math.cos(a) * dist, -1, Math.sin(a) * dist);
        this.group.add(hill);
      }
    }
    // Lasek świerków.
    for (let i = 0; i < 70; i++) {
      const a = rnd(0, Math.PI * 2);
      const d = rnd(22, 55);
      const h = rnd(4, 9);
      const t = new THREE.Group();
      const c = new THREE.Mesh(new THREE.ConeGeometry(h * 0.3, h, 8), pine);
      c.position.y = h / 2 + 0.6;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6), trunk);
      tr.position.y = 0.6;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(h * 0.18, h * 0.35, 8), snow);
      cap.position.y = h * 0.9 + 0.6;
      t.add(c, tr, cap);
      t.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      t.castShadow = true;
      this.group.add(t);
    }
    // Zapory przeciwpancerne („jeże”) i bunkier.
    const beam = new THREE.BoxGeometry(2.2, 0.2, 0.2);
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.7, metalness: 0.6 });
    for (let i = 0; i < 12; i++) {
      const a = rnd(0, Math.PI * 2);
      const d = rnd(17.5, 21);
      const h = new THREE.Group();
      for (const rot of [
        [0, 0, Math.PI / 4],
        [0, Math.PI / 2, -Math.PI / 4],
        [Math.PI / 4, 0, Math.PI / 2],
      ] as const) {
        const m = new THREE.Mesh(beam, steel);
        m.rotation.set(rot[0], rot[1], rot[2]);
        m.castShadow = true;
        h.add(m);
      }
      h.position.set(Math.cos(a) * d, 0.7, Math.sin(a) * d);
      this.group.add(h);
    }
    const bunker = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), conc);
    bunker.position.set(-30, 1.5, -25);
    this.group.add(bunker);
    // Lekki szum wysokości zasp wokół areny.
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const d = 16.8 + valueNoise(i, 0, 3) * 2;
      const drift = new THREE.Mesh(new THREE.SphereGeometry(rnd(1, 2.2), 10, 6), snow);
      drift.scale.y = 0.35;
      drift.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      this.group.add(drift);
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}
