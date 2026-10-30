// Proceduralne modele czołgów, każdy wzorowany na innej klasie prawdziwych pojazdów:
// MAMUT – ciężki o długim kadłubie i kanciastej wieży, GROM – średni z kopułową wieżą,
// OSA – lekki z wieżą przesuniętą do tyłu i dwiema lufami, KOBRA – niszczyciel bez wieży (kazamata).
// Hierarchia: korzeń → salto (obrót wokół środka) → podwozie (gąsienice, koła) + kadłub
// (zawieszenie, uniesienie) → wieża (yaw) → jarzmo na czopach (pitch) → lufa w kołysce (wysunięcie).
import * as THREE from 'three';
import type { TankDef } from '../sim/types';
import { box, loft } from './loft';
import { numberTexture, toonCamoTexture } from './textures';
import { addOutlines, toonMat } from './toon';

interface WheelStyle {
  count: number;
  /** Promień kół względem połowy wysokości gąsienicy. */
  size: number;
  /** Koła zachodzące na siebie w dwóch rzędach (ciężkie niemieckie). */
  interleave: boolean;
  /** Rolki podtrzymujące górny bieg gąsienicy. */
  returnRollers: number;
}

export interface TankStyle {
  base: string;
  patch: string;
  accent: string;
  alt: [string, string, string];
  number: string;
  numberColor: string;
  wheels: WheelStyle;
  skirts: boolean;
}

export const TANK_STYLES: Record<string, TankStyle> = {
  mamut: {
    base: '#7a8364',
    patch: '#a69466',
    accent: '#b0402a',
    alt: ['#7a6248', '#4e3d2c', '#d9c38a'],
    number: '701',
    numberColor: '#e9e2c6',
    wheels: { count: 9, size: 0.95, interleave: true, returnRollers: 0 },
    skirts: true,
  },
  grom: {
    base: '#7f8f4a',
    patch: '#5a6a38',
    accent: '#e8e2c4',
    alt: ['#5d6b78', '#3e4a55', '#e8c25a'],
    number: '214',
    numberColor: '#f2f0e0',
    wheels: { count: 5, size: 0.98, interleave: false, returnRollers: 0 },
    skirts: false,
  },
  osa: {
    base: '#8aa0b4',
    patch: '#64788c',
    accent: '#e3b23c',
    alt: ['#9a7a4c', '#6e5432', '#e8e2c4'],
    number: '07',
    numberColor: '#ffe08a',
    wheels: { count: 5, size: 0.7, interleave: false, returnRollers: 2 },
    skirts: false,
  },
  kobra: {
    base: '#ccb072',
    patch: '#8a5c3c',
    accent: '#4c6a3a',
    alt: ['#6a7a8c', '#3e4a58', '#c0c8d0'],
    number: '33',
    numberColor: '#2a2a2a',
    wheels: { count: 8, size: 0.95, interleave: true, returnRollers: 0 },
    skirts: true,
  },
};

const LINK_PITCH = 0.17;
const OUTLINE = 0.022;

interface Track {
  mesh: THREE.InstancedMesh;
  side: number;
  offset: number;
  count: number;
}

interface Mats {
  armor: THREE.MeshToonMaterial;
  accent: THREE.MeshToonMaterial;
  dark: THREE.MeshToonMaterial;
  steel: THREE.MeshToonMaterial;
  rubber: THREE.MeshToonMaterial;
  track: THREE.MeshToonMaterial;
  glass: THREE.MeshToonMaterial;
  wood: THREE.MeshToonMaterial;
}

export class TankModel {
  readonly root = new THREE.Group();
  /** Grupa obracana przy saltach – oś obrotu w połowie wysokości kadłuba (jak w symulacji). */
  readonly spin = new THREE.Group();
  private readonly inner = new THREE.Group();
  readonly chassis = new THREE.Group();
  readonly body = new THREE.Group();
  readonly turret = new THREE.Group();
  readonly mantlet = new THREE.Group();
  readonly barrel = new THREE.Group();
  readonly def: TankDef;
  readonly skirts: THREE.Mesh[] = [];
  readonly materials: THREE.MeshToonMaterial[] = [];
  readonly tipLocal: THREE.Vector3;
  readonly midLocal: THREE.Vector3;
  private tracks: Track[] = [];
  private wheels: { mesh: THREE.Object3D; side: number; radius: number; baseY: number; phase: number }[] = [];
  private readonly trackR: number;
  private readonly trackA: number;
  private readonly trackLen: number;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3(1, 1, 1);
  private readonly axisZ = new THREE.Vector3(0, 0, 1);
  readonly trackH: number;
  readonly trackW: number;
  readonly exhaust = new THREE.Vector3();
  readonly engineDeck = new THREE.Vector3();
  private readonly m: Mats;

  constructor(def: TankDef, alt: boolean) {
    this.def = def;
    const st = TANK_STYLES[def.id]!;
    const L = def.hullLength;
    const W = def.hullWidth;
    const H = def.hullHeight;
    this.trackW = Math.max(0.45, W * 0.22);
    this.trackH = H * 0.55;
    this.trackR = this.trackH / 2;
    this.trackA = L / 2 - this.trackR - 0.05;
    this.trackLen = 4 * this.trackA + 2 * Math.PI * this.trackR;

    const [base, patch, accentCol] = alt ? st.alt : [st.base, st.patch, st.accent];
    this.m = {
      armor: this.mat({ map: toonCamoTexture(base, patch, def.id.length * 13 + (alt ? 5 : 0)) }),
      accent: this.mat({ color: accentCol }),
      dark: this.mat({ color: 0x34322e }),
      steel: this.mat({ color: 0x6e6c66 }),
      rubber: this.mat({ color: 0x25231f }),
      track: this.mat({ color: 0x45413b }),
      glass: this.mat({ color: 0x9fd0e0, emissive: 0x1d3a44 }),
      wood: this.mat({ color: 0x8a5f3a }),
    };

    this.root.add(this.spin);
    this.spin.position.y = H / 2;
    this.spin.add(this.inner);
    this.inner.position.y = -H / 2;
    this.inner.add(this.chassis);
    this.inner.add(this.body);

    this.buildRunningGear(st.wheels);
    if (st.skirts) this.buildSkirts();
    this.turret.position.set(def.turretOffset, H, 0);
    this.body.add(this.turret);
    this.mantlet.position.set(def.turretRadius * 0.8, def.turretHeight / 2, 0);
    this.turret.add(this.mantlet);
    this.mantlet.add(this.barrel);

    switch (def.id) {
      case 'mamut':
        this.buildMamut();
        break;
      case 'grom':
        this.buildGrom();
        break;
      case 'osa':
        this.buildOsa();
        break;
      default:
        this.buildKobra();
        break;
    }
    this.tipLocal = new THREE.Vector3(def.turretRadius * 0.2 + def.barrelLength, 0, 0);
    this.midLocal = new THREE.Vector3(def.turretRadius * 0.2 + def.barrelLength * 0.35, 0, 0);
    this.addNumbers(st);

    addOutlines(this.inner, OUTLINE, 0.14);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData['noOutline']) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
      if (o instanceof THREE.InstancedMesh) o.castShadow = true;
    });
  }

  private mat(p: THREE.MeshToonMaterialParameters): THREE.MeshToonMaterial {
    const m = toonMat(p);
    this.materials.push(m);
    return m;
  }

  private add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, noOutline = false): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (noOutline) mesh.userData['noOutline'] = true;
    parent.add(mesh);
    return mesh;
  }

  private cyl(r0: number, r1: number, len: number, seg = 12, axis: 'x' | 'y' | 'z' = 'y'): THREE.BufferGeometry {
    const g = new THREE.CylinderGeometry(r1, r0, len, seg);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    return g;
  }

  // ------------------------------------------------------------ wspólne elementy

  /** Dolny kadłub między gąsienicami (wanna). */
  private lowerHull(noseLen: number): void {
    const L = this.def.hullLength;
    const w = this.def.hullWidth / 2 - this.trackW + 0.02;
    const th = this.trackH;
    this.add(this.body, loft([
      { x: -L / 2 + 0.1, y0: th * 0.45, y1: th, w0: w, w1: w },
      { x: L / 2 - noseLen, y0: th * 0.3, y1: th, w0: w, w1: w },
      { x: L / 2 - 0.05, y0: th * 0.85, y1: th, w0: w, w1: w },
    ]), this.m.dark);
  }

  private buildRunningGear(ws: WheelStyle): void {
    const W = this.def.hullWidth;
    const linkGeo = new THREE.BoxGeometry(LINK_PITCH * 0.86, 0.07, this.trackW);
    const count = Math.floor(this.trackLen / LINK_PITCH);
    const wr = this.trackR * 0.8 * ws.size;
    for (const side of [-1, 1]) {
      const z = side * (W / 2 - this.trackW / 2);
      const mesh = new THREE.InstancedMesh(linkGeo, this.m.track, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.position.z = z;
      this.chassis.add(mesh);
      this.tracks.push({ mesh, side, offset: 0, count });
      const span = 2 * this.trackA - 0.25;
      for (let i = 0; i < ws.count; i++) {
        const x = -this.trackA + 0.12 + (span * i) / (ws.count - 1);
        // Zachodzące koła: co drugie bliżej burty.
        const dz = ws.interleave ? (i % 2 ? -0.12 : 0.12) * side : 0;
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.cyl(wr, wr, this.trackW * (ws.interleave ? 0.38 : 0.78), 16, 'z'), this.m.rubber));
        const hub = new THREE.Mesh(this.cyl(wr * 0.62, wr * 0.62, this.trackW * (ws.interleave ? 0.42 : 0.82), 10, 'z'), this.m.armor);
        hub.userData['noOutline'] = true;
        g.add(hub);
        const cap = new THREE.Mesh(this.cyl(wr * 0.22, wr * 0.22, this.trackW * 0.9, 6, 'z'), this.m.steel);
        cap.userData['noOutline'] = true;
        g.add(cap);
        g.position.set(x, wr + 0.04, z + dz);
        this.chassis.add(g);
        this.wheels.push({ mesh: g, side, radius: wr, baseY: wr + 0.04, phase: i * 1.7 });
      }
      for (let i = 0; i < ws.returnRollers; i++) {
        const rr = this.trackR * 0.25;
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.cyl(rr, rr, this.trackW * 0.6, 8, 'z'), this.m.steel));
        g.position.set(-this.trackA * 0.5 + i * this.trackA, this.trackR * 2 - rr - 0.05, z);
        this.chassis.add(g);
        this.wheels.push({ mesh: g, side, radius: rr, baseY: g.position.y, phase: 0 });
      }
      // Koło napędowe z zębami (tył) i napinające (przód).
      const sr = this.trackR * 0.85;
      for (const [x, teeth] of [[-this.trackA, true], [this.trackA, false]] as const) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.cyl(sr, sr, this.trackW * 0.7, 14, 'z'), this.m.steel));
        if (teeth) {
          for (let k = 0; k < 10; k++) {
            const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, this.trackW * 0.5), this.m.dark);
            const a = (k / 10) * Math.PI * 2;
            tooth.position.set(Math.cos(a) * sr, Math.sin(a) * sr, 0);
            tooth.rotation.z = a;
            tooth.userData['noOutline'] = true;
            g.add(tooth);
          }
        }
        g.position.set(x, this.trackR, z);
        this.chassis.add(g);
        this.wheels.push({ mesh: g, side, radius: sr, baseY: this.trackR, phase: 0 });
      }
    }
  }

  /** Fartuchy (ekrany) nad gąsienicami – odpadają przy dużych uszkodzeniach. */
  private buildSkirts(): void {
    const L = this.def.hullLength;
    const W = this.def.hullWidth;
    const segs = Math.round(L / 0.95);
    const segL = (L - 0.4) / segs;
    const sh = this.trackH * 0.7;
    for (const side of [-1, 1]) {
      for (let i = 0; i < segs; i++) {
        const sk = new THREE.Mesh(new THREE.BoxGeometry(segL - 0.05, sh, 0.05), this.m.armor);
        sk.position.set(-L / 2 + 0.2 + segL * (i + 0.5), this.trackH - sh / 2 + 0.05, side * (W / 2 + 0.06));
        sk.rotation.x = side * 0.06;
        this.body.add(sk);
        this.skirts.push(sk);
      }
    }
  }

  /** Lufa w kołysce: kołyska jest stała względem jarzma, lufa wysuwa się z niej teleskopowo. */
  private buildGun(opts: { z: number; br: number; brake: 'double' | 'single' | 'none'; evacuator: number | null; jacket?: boolean }): void {
    const def = this.def;
    const len = def.barrelLength;
    const start = def.turretRadius * 0.2;
    const cradleLen = start + def.extRange + 0.35;
    const { z, br } = opts;
    this.add(this.mantlet, this.cyl(br * 1.85, br * 1.6, cradleLen, 12, 'x'), this.m.armor, cradleLen / 2, 0, z);
    this.add(this.mantlet, this.cyl(br * 1.95, br * 1.95, 0.1, 12, 'x'), this.m.dark, cradleLen - 0.05, 0, z, true);
    const tubeLen = len + 0.3;
    this.add(this.barrel, this.cyl(br, br * 0.85, tubeLen, 12, 'x'), this.m.steel, start + len - tubeLen / 2, 0, z);
    if (opts.evacuator !== null) {
      this.add(this.barrel, this.cyl(br * 1.55, br * 1.55, len * 0.12, 12, 'x'), this.m.armor, start + len * opts.evacuator, 0, z);
    }
    if (opts.jacket) {
      this.add(this.barrel, this.cyl(br * 1.5, br * 1.5, len * 0.5, 8, 'x'), this.m.dark, start + len * 0.42, 0, z);
    }
    if (opts.brake === 'double') {
      this.add(this.barrel, this.cyl(br * 1.6, br * 1.6, len * 0.05, 10, 'x'), this.m.dark, start + len - len * 0.025, 0, z);
      this.add(this.barrel, this.cyl(br * 1.6, br * 1.6, len * 0.05, 10, 'x'), this.m.dark, start + len - len * 0.1, 0, z);
      this.add(this.barrel, this.cyl(br * 1.15, br * 1.15, len * 0.08, 10, 'x'), this.m.steel, start + len - len * 0.065, 0, z, true);
    } else if (opts.brake === 'single') {
      this.add(this.barrel, new THREE.BoxGeometry(len * 0.07, br * 2.4, br * 3), this.m.dark, start + len - len * 0.035, 0, z);
    }
  }

  private cupola(parent: THREE.Object3D, x: number, y: number, z: number, r: number): void {
    this.add(parent, this.cyl(r, r * 0.9, 0.22, 10), this.m.armor, x, y + 0.11, z);
    this.add(parent, this.cyl(r * 0.85, r * 0.6, 0.08, 10), this.m.armor, x, y + 0.26, z);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.add(parent, new THREE.BoxGeometry(0.06, 0.06, 0.07), this.m.glass, x + Math.cos(a) * r * 0.95, y + 0.14, z + Math.sin(a) * r * 0.95, true);
    }
  }

  private exhausts(x: number, y: number, spread: number, vertical: boolean): void {
    for (const s of [-1, 1]) {
      if (vertical) this.add(this.body, this.cyl(0.09, 0.11, 0.45, 8), this.m.dark, x, y + 0.2, s * spread);
      else this.add(this.body, this.cyl(0.08, 0.1, 0.35, 8, 'x'), this.m.dark, x, y, s * spread);
    }
    this.exhaust.set(x - 0.15, y + (vertical ? 0.45 : 0), 0);
  }

  private addNumbers(st: TankStyle): void {
    const tex = numberTexture(st.number, st.numberColor);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const def = this.def;
    const casemate = def.casemate === true;
    for (const side of [-1, 1]) {
      const w = casemate ? 0.9 : def.turretRadius * 0.9;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.5), mat);
      plane.userData['noOutline'] = true;
      if (casemate) {
        plane.position.set(-0.6, def.hullHeight + 0.25, side * (def.hullWidth / 2 - 0.32));
        plane.rotation.set(-side * 0.5, side > 0 ? 0 : Math.PI, 0);
        this.body.add(plane);
      } else {
        plane.position.set(-def.turretRadius * 0.35, def.turretHeight * 0.55, side * (def.turretRadius * 0.86 + 0.06));
        plane.rotation.y = side > 0 ? 0 : Math.PI;
        this.turret.add(plane);
      }
    }
  }

  // ------------------------------------------------------------ MAMUT – ciężki, kanciasty

  private buildMamut(): void {
    const d = this.def;
    const L = d.hullLength;
    const W = d.hullWidth;
    const H = d.hullHeight;
    const th = this.trackH;
    this.lowerHull(1.3);
    // Górny kadłub: długa, mocno pochylona płyta czołowa i burty pochylone do środka.
    this.add(this.body, loft([
      { x: -L / 2, y0: th, y1: H - 0.18, w0: W / 2, w1: W / 2 - 0.22 },
      { x: -L / 2 + 0.25, y0: th, y1: H, w0: W / 2, w1: W / 2 - 0.28 },
      { x: L / 2 - 1.75, y0: th, y1: H, w0: W / 2, w1: W / 2 - 0.28 },
      { x: L / 2 + 0.05, y0: th - 0.12, y1: th + 0.12, w0: W / 2 - 0.12, w1: W / 2 - 0.2 },
    ]), this.m.armor);
    // Płyta silnika, wloty powietrza, wydechy pionowe, zapasowe ogniwa na płycie czołowej.
    this.add(this.body, box(-L / 2 + 0.35, -L / 2 + 1.6, H - 0.02, H + 0.06, W / 2 - 0.55), this.m.dark);
    for (let i = 0; i < 4; i++) this.add(this.body, new THREE.BoxGeometry(0.06, 0.05, W * 0.45), this.m.steel, -L / 2 + 0.5 + i * 0.3, H + 0.08, 0, true);
    this.exhausts(-L / 2 + 0.05, H - 0.2, 0.55, true);
    for (let i = 0; i < 3; i++) {
      const link = this.add(this.body, new THREE.BoxGeometry(0.2, 0.05, W * 0.55), this.m.track, L / 2 - 1.1 + i * 0.28, th + 0.62 - i * 0.18, 0, true);
      link.rotation.z = -0.55;
    }
    this.engineDeck.set(-L / 2 + 1.0, H + 0.1, 0);
    // Wieża: długa, z pochylonymi policzkami i płaskimi burtami (styl ciężkich czołgów z lat 40.).
    const r = d.turretRadius;
    const tt = d.turretHeight;
    this.add(this.turret, loft([
      { x: -r * 1.5, y0: 0.08, y1: tt * 0.92, w0: r * 0.78, w1: r * 0.62 },
      { x: -r * 1.25, y0: 0, y1: tt, w0: r * 0.92, w1: r * 0.7 },
      { x: r * 0.3, y0: 0, y1: tt, w0: r * 0.95, w1: r * 0.72 },
      { x: r * 0.78, y0: 0.06, y1: tt * 0.82, w0: r * 0.52, w1: r * 0.38 },
    ]), this.m.armor);
    this.add(this.turret, this.cyl(r * 0.9, r * 0.92, 0.1, 16), this.m.dark, 0, 0.03, 0);
    this.cupola(this.turret, -r * 0.55, tt, r * 0.4, r * 0.24);
    this.add(this.turret, new THREE.BoxGeometry(r * 0.5, 0.06, r * 0.4), this.m.armor, -r * 0.4, tt + 0.03, -r * 0.35);
    // Zapasowe ogniwa gąsienic na burtach wieży.
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        this.add(this.turret, new THREE.BoxGeometry(0.17, 0.07, 0.42), this.m.track, -r * 0.8 + i * 0.22, tt * 0.45, s * r * 0.9, true).rotation.x = Math.PI / 2;
      }
    }
    // Jarzmo „świński łeb” – zaokrąglony stożek.
    this.add(this.mantlet, this.cyl(tt * 0.42, tt * 0.22, 0.55, 12, 'x'), this.m.armor, 0.05, 0, 0);
    this.buildGun({ z: 0, br: d.barrelRadius * 0.55, brake: 'double', evacuator: null });
  }

  // ------------------------------------------------------------ GROM – średni z kopułą

  private buildGrom(): void {
    const d = this.def;
    const L = d.hullLength;
    const W = d.hullWidth;
    const H = d.hullHeight;
    const th = this.trackH;
    this.lowerHull(1.0);
    this.add(this.body, loft([
      { x: -L / 2, y0: th, y1: H - 0.22, w0: W / 2, w1: W / 2 - 0.08 },
      { x: -L / 2 + 0.35, y0: th, y1: H, w0: W / 2, w1: W / 2 - 0.1 },
      { x: L / 2 - 1.15, y0: th, y1: H, w0: W / 2, w1: W / 2 - 0.1 },
      { x: L / 2 + 0.05, y0: th - 0.15, y1: th + 0.08, w0: W / 2 - 0.1, w1: W / 2 - 0.15 },
    ]), this.m.armor);
    // Beczki z paliwem na tylnych błotnikach, bal do wyciągania z błota, reflektor.
    for (const x of [-L / 2 + 0.55, -L / 2 + 1.3]) {
      this.add(this.body, this.cyl(0.22, 0.22, 0.65, 10, 'x'), this.m.dark, x, H + 0.05, -(W / 2 - 0.25));
    }
    this.add(this.body, this.cyl(0.13, 0.13, W * 0.9, 8, 'z'), this.m.wood, -L / 2 + 0.05, H + 0.05, 0);
    this.add(this.body, this.cyl(0.11, 0.11, 0.12, 10, 'x'), this.m.glass, L / 2 - 0.85, H + 0.05, -W / 2 + 0.35, true);
    for (let i = 0; i < 5; i++) this.add(this.body, new THREE.BoxGeometry(0.05, 0.04, W * 0.5), this.m.steel, -L / 2 + 0.6 + i * 0.22, H + 0.03, 0.15, true);
    this.exhausts(-L / 2 - 0.02, H - 0.35, 0.65, false);
    this.engineDeck.set(-L / 2 + 0.9, H + 0.1, 0);
    // Kopułowa, odlewana wieża.
    const r = d.turretRadius;
    const tt = d.turretHeight;
    const dome = new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1.08, (tt * 1.25) / r, 0.98);
    this.add(this.turret, dome, this.m.armor, -r * 0.08, 0, 0);
    this.add(this.turret, this.cyl(r * 0.98, r * 1.02, 0.12, 16), this.m.armor, -r * 0.08, 0.04, 0);
    this.cupola(this.turret, -r * 0.3, tt * 1.05, -r * 0.35, r * 0.22);
    this.add(this.turret, this.cyl(r * 0.18, r * 0.2, 0.08, 10), this.m.armor, -r * 0.25, tt * 1.15, r * 0.35);
    this.add(this.turret, this.cyl(0.015, 0.02, 2.0, 4), this.m.dark, -r * 0.7, tt + 1.0, r * 0.6, true);
    // Odlewane jarzmo i lufa z eżektorem przy wylocie.
    this.add(this.mantlet, new THREE.SphereGeometry(tt * 0.42, 8, 6), this.m.armor, -0.02, 0, 0);
    this.buildGun({ z: 0, br: d.barrelRadius * 0.55, brake: 'none', evacuator: 0.82 });
  }

  // ------------------------------------------------------------ OSA – lekki, wieża z tyłu

  private buildOsa(): void {
    const d = this.def;
    const L = d.hullLength;
    const W = d.hullWidth;
    const H = d.hullHeight;
    const th = this.trackH;
    this.lowerHull(0.9);
    // Klinowy przód (silnik z przodu, wieża z tyłu).
    this.add(this.body, loft([
      { x: -L / 2, y0: th, y1: H, w0: W / 2, w1: W / 2 - 0.08 },
      { x: L / 2 - 1.1, y0: th, y1: H, w0: W / 2, w1: W / 2 - 0.08 },
      { x: L / 2 - 0.55, y0: th, y1: H - 0.12, w0: W / 2, w1: W / 2 - 0.15 },
      { x: L / 2 + 0.08, y0: th * 0.6, y1: th + 0.05, w0: W / 2 - 0.2, w1: W / 2 - 0.3 },
    ]), this.m.armor);
    // Kratka silnika z przodu, właz kierowcy, reflektory na klinie.
    this.add(this.body, box(L / 2 - 1.5, L / 2 - 0.75, H - 0.02, H + 0.03, W / 2 - 0.45), this.m.dark);
    for (let i = 0; i < 4; i++) this.add(this.body, new THREE.BoxGeometry(0.05, 0.04, W * 0.4), this.m.steel, L / 2 - 1.4 + i * 0.18, H + 0.05, 0, true);
    for (const s of [-1, 1]) this.add(this.body, this.cyl(0.08, 0.08, 0.1, 10, 'x'), this.m.glass, L / 2 - 0.3, th + 0.18, s * (W / 2 - 0.4), true);
    this.exhausts(L / 2 - 1.3, H - 0.2, W / 2 - 0.05, false);
    this.engineDeck.set(L / 2 - 1.1, H + 0.1, 0);
    // Wieża oscylacyjna: niski kołnierz + górna część z długim koszem z tyłu.
    const r = d.turretRadius;
    const tt = d.turretHeight;
    this.add(this.turret, this.cyl(r * 0.85, r * 0.92, tt * 0.35, 12), this.m.armor, 0, tt * 0.17, 0);
    this.add(this.turret, loft([
      { x: -r * 2.0, y0: tt * 0.4, y1: tt * 0.95, w0: r * 0.55, w1: r * 0.45 },
      { x: -r * 0.6, y0: tt * 0.25, y1: tt * 1.05, w0: r * 0.88, w1: r * 0.7 },
      { x: r * 0.55, y0: tt * 0.25, y1: tt * 0.95, w0: r * 0.85, w1: r * 0.55 },
      { x: r * 0.85, y0: tt * 0.35, y1: tt * 0.75, w0: r * 0.6, w1: r * 0.4 },
    ]), this.m.armor);
    this.cupola(this.turret, -r * 0.3, tt * 1.05, r * 0.35, r * 0.2);
    this.add(this.turret, this.cyl(0.012, 0.016, 1.6, 4), this.m.dark, -r * 1.7, tt + 0.8, -r * 0.3, true);
    // Bliźniacze karabiny z perforowanymi osłonami.
    this.add(this.mantlet, new THREE.BoxGeometry(0.35, tt * 0.55, r * 1.25), this.m.armor, 0.05, 0, 0);
    for (const z of [-r * 0.35, r * 0.35]) this.buildGun({ z, br: d.barrelRadius * 0.6, brake: 'none', evacuator: null, jacket: true });
  }

  // ------------------------------------------------------------ KOBRA – niszczyciel bez wieży

  private buildKobra(): void {
    const d = this.def;
    const L = d.hullLength;
    const W = d.hullWidth;
    const H = d.hullHeight;
    const th = this.trackH;
    const roof = H + d.turretHeight;
    this.lowerHull(1.2);
    // Kazamata: jedna bryła od nosa po dach, mocno pochylone burty i długa płyta czołowa.
    this.add(this.body, loft([
      { x: -L / 2, y0: th, y1: roof - 0.35, w0: W / 2, w1: W / 2 - 0.42 },
      { x: -L / 2 + 0.45, y0: th, y1: roof, w0: W / 2, w1: W / 2 - 0.5 },
      { x: 0.55, y0: th, y1: roof, w0: W / 2, w1: W / 2 - 0.5 },
      { x: L / 2 + 0.05, y0: th - 0.12, y1: th + 0.1, w0: W / 2 - 0.12, w1: W / 2 - 0.3 },
    ]), this.m.armor);
    // Pasy kamuflażu „zasadzka”, peryskopy, właz, wydechy, lina, skrzynka.
    for (const s of [-1, 1]) this.add(this.body, new THREE.BoxGeometry(L * 0.5, 0.05, 0.06), this.m.accent, -0.6, H + 0.25, s * (W / 2 - 0.28), true).rotation.x = s * 0.5;
    this.cupola(this.body, -0.9, roof - 0.04, 0.5, 0.22);
    this.add(this.body, box(-1.6, -1.0, roof - 0.04, roof + 0.04, 0.35), this.m.armor);
    for (let i = 0; i < 3; i++) this.add(this.body, new THREE.BoxGeometry(0.08, 0.07, 0.14), this.m.glass, 0.35, roof + 0.02, -0.45 + i * 0.3, true);
    this.exhausts(-L / 2 - 0.02, H - 0.25, 0.6, true);
    this.add(this.body, new THREE.BoxGeometry(0.9, 0.22, 0.3), this.m.wood, -L / 2 + 0.9, roof - 0.15, -W / 2 + 0.45);
    this.engineDeck.set(-L / 2 + 0.8, roof, 0);
    // Jarzmo osadzone w płycie czołowej – „świński łeb”.
    const tt = d.turretHeight;
    this.add(this.mantlet, this.cyl(tt * 0.5, tt * 0.26, 0.6, 12, 'x'), this.m.armor, 0.0, 0, 0);
    this.buildGun({ z: 0, br: d.barrelRadius * 0.55, brake: 'double', evacuator: null });
  }

  // ------------------------------------------------------------ animacja

  /** Pozycja ogniwa na ścieżce gąsienicy (stadion w przekroju bocznym). */
  private trackPoint(s: number, out: THREE.Vector3): number {
    const a = this.trackA;
    const r = this.trackR;
    const straight = 2 * a;
    const arc = Math.PI * r;
    s = ((s % this.trackLen) + this.trackLen) % this.trackLen;
    if (s < straight) {
      out.set(-a + s, 0.035, 0);
      return 0;
    }
    s -= straight;
    if (s < arc) {
      const ang = -Math.PI / 2 + (s / arc) * Math.PI;
      out.set(a + Math.cos(ang) * (r - 0.035), r + Math.sin(ang) * (r - 0.035), 0);
      return ang + Math.PI / 2;
    }
    s -= arc;
    if (s < straight) {
      out.set(a - s, 2 * r - 0.035, 0);
      return Math.PI;
    }
    s -= straight;
    const ang = Math.PI / 2 + (s / arc) * Math.PI;
    out.set(-a + Math.cos(ang) * (r - 0.035), r + Math.sin(ang) * (r - 0.035), 0);
    return ang + Math.PI / 2;
  }

  /** Przesuwa gąsienice i obraca koła. `dl`/`dr` – przebyta droga lewej/prawej gąsienicy (m). */
  updateTracks(dl: number, dr: number, time: number, bounce: number): void {
    for (const tr of this.tracks) {
      tr.offset += tr.side < 0 ? dl : dr;
      for (let i = 0; i < tr.count; i++) {
        const ang = this.trackPoint(i * LINK_PITCH - tr.offset, this.tmpP);
        this.tmpQ.setFromAxisAngle(this.axisZ, ang);
        this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
        tr.mesh.setMatrixAt(i, this.tmpM);
      }
      tr.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const w of this.wheels) {
      const d = w.side < 0 ? dl : dr;
      w.mesh.rotation.z -= d / w.radius;
      w.mesh.position.y = w.baseY + Math.sin(time * 9 + w.phase) * 0.012 * bounce;
    }
  }

  setFlash(v: number): void {
    for (const m of this.materials) {
      if (m.userData['baseEmissive'] === undefined) m.userData['baseEmissive'] = m.emissive.getHex();
      if (v > 0.01) m.emissive.setRGB(v, v * 0.9, v * 0.8);
      else m.emissive.setHex(m.userData['baseEmissive'] as number);
    }
  }

  /** Przyciemnienie wraku po K.O. */
  char(): void {
    for (const m of this.materials) {
      m.color.multiplyScalar(0.3);
      if (m.map) m.color.setRGB(0.3, 0.3, 0.3);
    }
  }
}
