// Proceduralne modele czołgów, każdy wzorowany na innej klasie prawdziwych pojazdów:
// MAMUT – ciężki o długim kadłubie i kanciastej wieży, GROM – średni z kopułową wieżą,
// OSA – lekki z wieżą przesuniętą do tyłu i dwiema lufami, KOBRA – niszczyciel bez wieży (kazamata).
// Hierarchia: korzeń → salto (obrót wokół środka) → podwozie (gąsienice, koła) + kadłub
// (zawieszenie, uniesienie) → wieża (yaw) → jarzmo na czopach (pitch) → lufa w kołysce (wysunięcie).
//
// Styl: wspólna, przygaszona paleta (ciepłe światło późnego popołudnia), kamuflaż o ostrych
// krawędziach leżący równo na płytach, przyciemnione dolne partie (ciężar) i dużo drobnych
// detali – nity, spawy, narzędzia, kanistry, liny, wyrzutnie dymu. Drobiazgi są scalane
// w kilka siatek na materiał, więc model zostaje lekki.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TankDef } from '../sim/types';
import { box, loft } from './loft';
import { armorTexture, numberTexture, type CamoKind } from './textures';
import { addOutlines, toonMat } from './toon';

interface WheelStyle {
  count: number;
  /** Promień kół względem połowy wysokości gąsienicy. */
  size: number;
  /** Koła zachodzące na siebie w dwóch rzędach (ciężkie niemieckie). */
  interleave: boolean;
  /** Rolki podtrzymujące górny bieg gąsienicy. */
  returnRollers: number;
  /** Koła szprychowe (zamiast pełnych tarcz). */
  spoked: boolean;
}

interface Paint {
  camo: CamoKind;
  colors: string[];
  /** Kolor akcentów (pasy rozpoznawcze, proporczyk, kanistry). */
  accent: string;
}

export interface TankStyle {
  paint: Paint;
  /** Wariant gracza 2 w lustrzanym pojedynku. */
  alt: Paint;
  number: string;
  numberColor: string;
  wheels: WheelStyle;
  skirts: boolean;
}

// Wspólna paleta: wszystkie kolory przygaszone i lekko ciepłe, żeby czołgi pasowały do siebie
// i do sceny. Każdy czołg ma własną rodzinę barw i własny wzór kamuflażu.
export const TANK_STYLES: Record<string, TankStyle> = {
  mamut: {
    paint: { camo: 'stripes', colors: ['#b8a676', '#7a5440', '#5f6a46'], accent: '#e7dfc4' },
    alt: { camo: 'stripes', colors: ['#a7aeb0', '#5d666d', '#e2e2dc'], accent: '#d9443a' },
    number: '701',
    numberColor: '#f1ead2',
    wheels: { count: 9, size: 0.95, interleave: true, returnRollers: 0, spoked: false },
    skirts: true,
  },
  grom: {
    paint: { camo: 'solid', colors: ['#7a8550', '#8c9762'], accent: '#ebe6cf' },
    alt: { camo: 'solid', colors: ['#b5a072', '#c4b184'], accent: '#c8463a' },
    number: '214',
    numberColor: '#f1eedf',
    wheels: { count: 5, size: 0.98, interleave: false, returnRollers: 0, spoked: true },
    skirts: false,
  },
  osa: {
    paint: { camo: 'splinter', colors: ['#7f93a3', '#56697a', '#a3b0b8'], accent: '#e6b43e' },
    alt: { camo: 'splinter', colors: ['#b9a47a', '#86704c', '#d3c49c'], accent: '#3f8fc9' },
    number: '07',
    numberColor: '#ffdf8a',
    wheels: { count: 5, size: 0.72, interleave: false, returnRollers: 2, spoked: false },
    skirts: false,
  },
  kobra: {
    paint: { camo: 'tiger', colors: ['#9a9566', '#5a4a36', '#d3c391'], accent: '#d3c391' },
    alt: { camo: 'tiger', colors: ['#8a9096', '#43494f', '#d0d4d6'], accent: '#e0a33c' },
    number: '33',
    numberColor: '#f1ead2',
    wheels: { count: 8, size: 0.95, interleave: true, returnRollers: 0, spoked: false },
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
  canvas: THREE.MeshToonMaterial;
  can: THREE.MeshToonMaterial;
}

type V3 = [number, number, number];

interface DetailOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  /** Czarny kontur (dla większych elementów). */
  outline?: boolean;
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
  /** Drobne detale czekające na scalenie: klucz = rodzic + materiał + kontur. */
  private kit = new Map<string, { parent: THREE.Object3D; mat: THREE.Material; outline: boolean; geos: THREE.BufferGeometry[] }>();
  private readonly paint: Paint;

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

    const paint = alt ? st.alt : st.paint;
    this.paint = paint;
    this.m = {
      armor: this.mat({ map: armorTexture(paint.camo, paint.colors, def.id.length * 13 + (alt ? 5 : 0)) }),
      accent: this.mat({ color: paint.accent }),
      dark: this.mat({ color: 0x2f2c28 }),
      steel: this.mat({ color: 0x7c776d }),
      rubber: this.mat({ color: 0x272420 }),
      track: this.mat({ color: 0x5a534a }),
      glass: this.mat({ color: 0x9fd0dc, emissive: 0x24424c }),
      wood: this.mat({ color: 0x8e6440 }),
      canvas: this.mat({ color: 0x8c7f5c }),
      can: this.mat({ color: new THREE.Color(paint.colors[0]!).multiplyScalar(0.72) }),
    };

    this.root.add(this.spin);
    this.spin.position.y = H / 2;
    this.spin.add(this.inner);
    this.inner.position.y = -H / 2;
    this.inner.add(this.chassis);
    this.inner.add(this.body);

    this.buildRunningGear(st.wheels);
    if (st.skirts) this.buildSkirts();
    else this.buildFenders();
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
    this.flushKit();

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
    const m = toonMat({ vertexColors: true, ...p });
    this.materials.push(m);
    return m;
  }

  /** Wysokość początku układu danej części nad ziemią (do cieniowania „od ziemi”). */
  private baseY(parent: THREE.Object3D): number {
    const d = this.def;
    if (parent === this.turret) return d.hullHeight;
    if (parent === this.mantlet || parent === this.barrel) return d.hullHeight + d.turretHeight / 2;
    return 0;
  }

  /**
   * Kolory wierzchołków: dół ciemniejszy (kurz, cień od ziemi), góra jaśniejsza.
   * Daje modelom ciężar i oddziela je od trawy.
   */
  private shade(g: THREE.BufferGeometry, base: number): THREE.BufferGeometry {
    const pos = g.getAttribute('position');
    const top = this.def.hullHeight + this.def.turretHeight * 0.9;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = THREE.MathUtils.clamp((pos.getY(i) + base) / top, 0, 1);
      const k = 0.6 + 0.4 * (y * y * (3 - 2 * y));
      col[i * 3] = k;
      col[i * 3 + 1] = k * 0.985;
      col[i * 3 + 2] = k * 0.96;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }

  private add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, noOutline = false): THREE.Mesh {
    const mesh = new THREE.Mesh(this.shade(geo, this.baseY(parent) + y), mat);
    mesh.position.set(x, y, z);
    if (noOutline) mesh.userData['noOutline'] = true;
    parent.add(mesh);
    return mesh;
  }

  /** Drobny element do scalenia (nity, uchwyty, narzędzia…). */
  private detail(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: V3, o: DetailOpts = {}): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    this.tmpQ.setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0));
    this.tmpM.compose(new THREE.Vector3(...p), this.tmpQ, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.tmpM);
    const outline = o.outline ?? false;
    const key = `${parent.uuid}|${mat.uuid}|${outline}`;
    let b = this.kit.get(key);
    if (!b) {
      b = { parent, mat, outline, geos: [] };
      this.kit.set(key, b);
    }
    b.geos.push(g);
  }

  private flushKit(): void {
    for (const b of this.kit.values()) {
      const merged = mergeGeometries(b.geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(this.shade(merged, this.baseY(b.parent)), b.mat);
      if (!b.outline) mesh.userData['noOutline'] = true;
      b.parent.add(mesh);
    }
    this.kit.clear();
  }

  private cyl(r0: number, r1: number, len: number, seg = 12, axis: 'x' | 'y' | 'z' = 'y'): THREE.BufferGeometry {
    const g = new THREE.CylinderGeometry(r1, r0, len, seg);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    return g;
  }

  // ------------------------------------------------------------ zestaw detali

  /** Rząd nitów między dwoma punktami. */
  private rivets(parent: THREE.Object3D, a: V3, b: V3, n: number, r = 0.028, mat: THREE.Material = this.m.armor): void {
    const g = new THREE.SphereGeometry(r, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.detail(parent, g, mat, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }

  /** Spoina / łączenie płyt – cienki wałek wzdłuż krawędzi. */
  private weld(parent: THREE.Object3D, a: V3, b: V3, r = 0.022): void {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(r, r, len, 5);
    const dir = vb.clone().sub(va).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const e = new THREE.Euler().setFromQuaternion(q);
    const mid = va.add(vb).multiplyScalar(0.5);
    this.detail(parent, g, this.m.armor, [mid.x, mid.y, mid.z], { rx: e.x, ry: e.y, rz: e.z });
  }

  /** Reflektor z osłoną (kratką). `dir` = +1 przód, −1 tył. */
  private headlight(parent: THREE.Object3D, x: number, y: number, z: number, dir = 1): void {
    this.detail(parent, this.cyl(0.1, 0.12, 0.16, 10, 'x'), this.m.dark, [x, y, z], { outline: true });
    this.detail(parent, this.cyl(0.085, 0.085, 0.02, 10, 'x'), this.m.glass, [x + dir * 0.085, y, z]);
    this.detail(parent, new THREE.TorusGeometry(0.13, 0.014, 4, 10, Math.PI), this.m.dark, [x + dir * 0.06, y, z], { ry: Math.PI / 2 });
    this.detail(parent, new THREE.BoxGeometry(0.06, 0.12, 0.05), this.m.dark, [x - dir * 0.02, y - 0.12, z]);
  }

  /** Hak holowniczy. */
  private towHook(parent: THREE.Object3D, x: number, y: number, z: number): void {
    this.detail(parent, new THREE.TorusGeometry(0.075, 0.025, 5, 10), this.m.steel, [x, y, z], { outline: true });
    this.detail(parent, new THREE.BoxGeometry(0.12, 0.1, 0.1), this.m.armor, [x - 0.06, y + 0.06, z]);
  }

  /** Kanister (z uchwytami) – stojący, wzdłuż osi x. */
  private jerrycan(parent: THREE.Object3D, x: number, y: number, z: number, ry = 0): void {
    this.detail(parent, new THREE.BoxGeometry(0.36, 0.42, 0.17), this.m.can, [x, y + 0.21, z], { ry, outline: true });
    for (const dx of [-0.08, 0, 0.08]) this.detail(parent, new THREE.BoxGeometry(0.03, 0.05, 0.12), this.m.can, [x + dx * Math.cos(ry), y + 0.45, z - dx * Math.sin(ry)], { ry });
    this.detail(parent, this.cyl(0.03, 0.03, 0.06, 6), this.m.dark, [x + 0.12 * Math.cos(ry), y + 0.45, z - 0.12 * Math.sin(ry)]);
  }

  /** Łopata leżąca wzdłuż osi x (na płaszczyźnie y = const albo na burcie). */
  private shovel(parent: THREE.Object3D, x: number, y: number, z: number, onSide = 0): void {
    const o: DetailOpts = onSide ? { rx: Math.PI / 2 } : {};
    this.detail(parent, this.cyl(0.025, 0.025, 0.95, 6, 'x'), this.m.wood, [x, y, z], { ...o, outline: true });
    this.detail(parent, new THREE.BoxGeometry(0.26, 0.02, 0.2), this.m.steel, [x + 0.58, y, z], o);
    for (const dx of [-0.3, 0.3]) this.detail(parent, new THREE.BoxGeometry(0.04, onSide ? 0.06 : 0.04, onSide ? 0.04 : 0.06), this.m.dark, [x + dx, y, z]);
  }

  /** Siekiera / łom – trzonek wzdłuż osi x. */
  private axe(parent: THREE.Object3D, x: number, y: number, z: number): void {
    this.detail(parent, this.cyl(0.022, 0.022, 0.75, 6, 'x'), this.m.wood, [x, y, z], { outline: true });
    this.detail(parent, new THREE.BoxGeometry(0.06, 0.03, 0.2), this.m.steel, [x + 0.36, y, z + 0.06]);
    this.detail(parent, this.cyl(0.018, 0.018, 1.1, 6, 'x'), this.m.dark, [x, y, z + 0.14]);
  }

  /** Lina holownicza – rura po krzywej. */
  private cable(parent: THREE.Object3D, pts: V3[]): void {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    this.detail(parent, new THREE.TubeGeometry(curve, pts.length * 8, 0.028, 5, false), this.m.dark, [0, 0, 0], { outline: true });
    for (const p of [pts[0]!, pts[pts.length - 1]!]) this.detail(parent, new THREE.TorusGeometry(0.06, 0.02, 4, 8), this.m.steel, p, { rx: Math.PI / 2 });
  }

  /** Trzy wyrzutnie granatów dymnych na burcie wieży, skierowane do przodu i w górę. */
  private smokeLaunchers(parent: THREE.Object3D, x: number, y: number, z: number): void {
    const side = Math.sign(z);
    this.detail(parent, new THREE.BoxGeometry(0.22, 0.08, 0.3), this.m.armor, [x, y - 0.06, z]);
    for (let i = 0; i < 3; i++) {
      this.detail(parent, this.cyl(0.045, 0.045, 0.24, 8), this.m.dark, [x + 0.04, y + 0.06, z + side * (i - 1) * 0.1], { rz: -0.7, rx: side * 0.25, outline: true });
    }
  }

  /** Ucho do podnoszenia. */
  private liftEye(parent: THREE.Object3D, x: number, y: number, z: number, ry = 0): void {
    this.detail(parent, new THREE.TorusGeometry(0.05, 0.018, 4, 8, Math.PI), this.m.armor, [x, y, z], { ry });
  }

  /** Antena z podstawą i proporczykiem w kolorze akcentu. */
  private antenna(parent: THREE.Object3D, x: number, y: number, z: number, len: number): void {
    this.detail(parent, this.cyl(0.05, 0.06, 0.12, 8), this.m.dark, [x, y + 0.06, z], { outline: true });
    const rod = new THREE.Mesh(this.shade(this.cyl(0.008, 0.014, len, 4), this.baseY(parent) + y), this.m.dark);
    rod.position.set(x, y + 0.12 + len / 2, z);
    rod.userData['noOutline'] = true;
    parent.add(rod);
    const flag = new THREE.Shape();
    flag.moveTo(0, 0);
    flag.lineTo(-0.34, -0.07);
    flag.lineTo(0, -0.14);
    const fm = new THREE.Mesh(this.shade(new THREE.ShapeGeometry(flag), 2), toonMat({ color: this.paint.accent, side: THREE.DoubleSide, vertexColors: true }));
    this.materials.push(fm.material as THREE.MeshToonMaterial);
    fm.position.set(x, y + 0.1 + len, z);
    fm.userData['noOutline'] = true;
    parent.add(fm);
  }

  /** Skrzynia na bagaż z pokrywą i zamkami. */
  private stowBin(parent: THREE.Object3D, x0: number, x1: number, y0: number, y1: number, w: number): void {
    this.add(parent, box(x0, x1, y0, y1, w), this.m.armor);
    this.detail(parent, box(x0 - 0.02, x1 + 0.02, y1, y1 + 0.03, w + 0.02), this.m.armor, [0, 0, 0]);
    for (const z of [-w * 0.5, w * 0.5]) this.detail(parent, new THREE.BoxGeometry(0.03, 0.08, 0.06), this.m.dark, [x0 - 0.015, y1 - 0.06, z]);
  }

  /** Właz: płaska klapa z zawiasem i uchwytem. */
  private hatch(parent: THREE.Object3D, x: number, y: number, z: number, r: number): void {
    this.detail(parent, this.cyl(r, r, 0.05, 12), this.m.armor, [x, y + 0.025, z], { outline: true });
    this.detail(parent, this.cyl(0.03, 0.03, r * 0.9, 6, 'z'), this.m.dark, [x - r * 0.9, y + 0.05, z]);
    this.detail(parent, new THREE.TorusGeometry(0.06, 0.012, 4, 8, Math.PI), this.m.steel, [x + r * 0.4, y + 0.05, z], { ry: Math.PI / 2 });
  }

  /** Peryskop w pancernej osłonie, skierowany wg `ry`. */
  private periscope(parent: THREE.Object3D, x: number, y: number, z: number, ry = 0): void {
    this.detail(parent, new THREE.BoxGeometry(0.12, 0.09, 0.16), this.m.armor, [x, y + 0.045, z], { ry, outline: true });
    this.detail(parent, new THREE.BoxGeometry(0.02, 0.05, 0.12), this.m.glass, [x + 0.062 * Math.cos(ry), y + 0.05, z - 0.062 * Math.sin(ry)], { ry });
  }

  /** Kratka wlotu powietrza: wgłębienie z listwami. */
  private grille(parent: THREE.Object3D, x: number, y: number, z: number, lx: number, lz: number, n: number): void {
    this.detail(parent, new THREE.BoxGeometry(lx, 0.03, lz), this.m.dark, [x, y, z]);
    for (let i = 0; i < n; i++) this.detail(parent, new THREE.BoxGeometry(0.035, 0.04, lz * 0.96), this.m.armor, [x - lx / 2 + (lx * (i + 0.5)) / n, y + 0.015, z]);
    this.rivets(parent, [x - lx / 2 - 0.03, y + 0.02, z - lz / 2 - 0.03], [x + lx / 2 + 0.03, y + 0.02, z - lz / 2 - 0.03], Math.max(2, Math.round(lx / 0.18)), 0.022);
    this.rivets(parent, [x - lx / 2 - 0.03, y + 0.02, z + lz / 2 + 0.03], [x + lx / 2 + 0.03, y + 0.02, z + lz / 2 + 0.03], Math.max(2, Math.round(lx / 0.18)), 0.022);
  }

  /** Zapasowe ogniwa gąsienicy (pionowo na płycie). */
  private spareLinks(parent: THREE.Object3D, x: number, y: number, z: number, n: number, rz = 0, rx = 0): void {
    for (let i = 0; i < n; i++) {
      const k = i - (n - 1) / 2;
      this.detail(parent, new THREE.BoxGeometry(0.16, 0.05, 0.42), this.m.track, [x + k * 0.19 * Math.cos(rz), y + k * 0.19 * Math.sin(rz), z], { rz, rx, outline: true });
      this.detail(parent, new THREE.BoxGeometry(0.05, 0.07, 0.36), this.m.dark, [x + k * 0.19 * Math.cos(rz), y + k * 0.19 * Math.sin(rz), z], { rz, rx });
    }
  }

  /** Karabin maszynowy (na kopule albo w jarzmie kulistym). */
  private mg(parent: THREE.Object3D, x: number, y: number, z: number, ball = false): void {
    if (ball) this.detail(parent, new THREE.SphereGeometry(0.11, 8, 6), this.m.armor, [x, y, z], { outline: true });
    this.detail(parent, this.cyl(0.025, 0.02, 0.6, 6, 'x'), this.m.dark, [x + 0.3, y, z], { outline: true });
    if (!ball) this.detail(parent, new THREE.BoxGeometry(0.22, 0.08, 0.08), this.m.dark, [x, y, z]);
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
    // Haki holownicze z przodu i z tyłu.
    for (const s of [-1, 1]) {
      this.towHook(this.body, L / 2 - 0.05, th * 0.85, s * (w - 0.25));
      this.towHook(this.body, -L / 2 + 0.05, th * 0.6, s * (w - 0.25));
    }
  }

  private buildRunningGear(ws: WheelStyle): void {
    const W = this.def.hullWidth;
    const tw = this.trackW;
    // Ogniwo: płytka + ostroga od strony gruntu + prowadnica od środka.
    const linkGeo = mergeGeometries([
      new THREE.BoxGeometry(LINK_PITCH * 0.86, 0.06, tw).toNonIndexed(),
      new THREE.BoxGeometry(LINK_PITCH * 0.22, 0.035, tw * 0.96).translate(0, -0.04, 0).toNonIndexed(),
      new THREE.BoxGeometry(LINK_PITCH * 0.4, 0.07, 0.06).translate(0, 0.06, 0).toNonIndexed(),
    ])!;
    this.shade(linkGeo, 0.25);
    const count = Math.floor(this.trackLen / LINK_PITCH);
    const wr = this.trackR * 0.8 * ws.size;
    // Koło jezdne scalone w jedną bryłę na materiał: opona, tarcza, piasta ze śrubami.
    const ww = tw * (ws.interleave ? 0.38 : 0.78);
    const tyre = this.shade(this.cyl(wr, wr, ww, 18, 'z'), wr);
    const discParts: THREE.BufferGeometry[] = [this.cyl(wr * 0.8, wr * 0.8, ww + 0.03, 14, 'z').toNonIndexed()];
    if (ws.spoked) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        discParts.push(new THREE.BoxGeometry(wr * 0.12, wr * 0.75, 0.03).rotateZ(a).translate(Math.sin(-a) * wr * 0.35, Math.cos(a) * wr * 0.35, ww / 2 + 0.03).toNonIndexed());
      }
    }
    const disc = this.shade(mergeGeometries(discParts)!, wr);
    const hubParts: THREE.BufferGeometry[] = [this.cyl(wr * 0.3, wr * 0.26, ww + 0.1, 10, 'z').toNonIndexed()];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      hubParts.push(this.cyl(0.022, 0.022, ww + 0.14, 6, 'z').translate(Math.cos(a) * wr * 0.2, Math.sin(a) * wr * 0.2, 0).toNonIndexed());
    }
    const hub = this.shade(mergeGeometries(hubParts)!, wr);
    for (const side of [-1, 1]) {
      const z = side * (W / 2 - tw / 2);
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
        g.add(new THREE.Mesh(tyre, this.m.rubber));
        const d = new THREE.Mesh(disc, this.m.armor);
        d.userData['noOutline'] = true;
        g.add(d);
        const hb = new THREE.Mesh(hub, this.m.steel);
        hb.userData['noOutline'] = true;
        g.add(hb);
        g.position.set(x, wr + 0.04, z + dz);
        this.chassis.add(g);
        this.wheels.push({ mesh: g, side, radius: wr, baseY: wr + 0.04, phase: i * 1.7 });
        // Wahacz zawieszenia (ramię od kadłuba do piasty).
        const arm = this.add(this.chassis, new THREE.BoxGeometry(0.42, 0.08, 0.08), this.m.dark, x + 0.16, wr + 0.12, side * (W / 2 - tw - 0.02), true);
        arm.rotation.z = 0.45;
      }
      for (let i = 0; i < ws.returnRollers; i++) {
        const rr = this.trackR * 0.25;
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.shade(this.cyl(rr, rr, tw * 0.6, 8, 'z'), this.trackH), this.m.steel));
        g.position.set(-this.trackA * 0.5 + i * this.trackA, this.trackR * 2 - rr - 0.05, z);
        this.chassis.add(g);
        this.wheels.push({ mesh: g, side, radius: rr, baseY: g.position.y, phase: 0 });
      }
      // Koło napędowe z zębami (tył) i napinające ze szprychami (przód).
      const sr = this.trackR * 0.85;
      for (const [x, teeth] of [[-this.trackA, true], [this.trackA, false]] as const) {
        const parts: THREE.BufferGeometry[] = [this.cyl(sr * 0.9, sr * 0.9, tw * 0.7, 14, 'z').toNonIndexed()];
        if (teeth) {
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            parts.push(new THREE.BoxGeometry(0.09, 0.13, tw * 0.5).rotateZ(a).translate(Math.cos(a) * sr, Math.sin(a) * sr, 0).toNonIndexed());
          }
        } else {
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            parts.push(this.cyl(sr * 0.14, sr * 0.14, tw * 0.74, 6, 'z').translate(Math.cos(a) * sr * 0.55, Math.sin(a) * sr * 0.55, 0).toNonIndexed());
          }
        }
        parts.push(this.cyl(sr * 0.28, sr * 0.28, tw * 0.85, 8, 'z').toNonIndexed());
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.shade(mergeGeometries(parts)!, this.trackR), this.m.steel));
        g.position.set(x, this.trackR, z);
        this.chassis.add(g);
        this.wheels.push({ mesh: g, side, radius: sr, baseY: this.trackR, phase: 0 });
      }
    }
  }

  /** Błotniki: półka nad gąsienicą, osłony przednia i tylna, wsporniki. */
  private buildFenders(): void {
    const L = this.def.hullLength;
    const W = this.def.hullWidth;
    const th = this.trackH;
    const tw = this.trackW;
    for (const side of [-1, 1]) {
      const z = side * (W / 2 - tw / 2 + 0.02);
      this.add(this.body, new THREE.BoxGeometry(L - 0.3, 0.04, tw + 0.08), this.m.armor, -0.05, th + 0.02, z);
      // Pochylone osłony na końcach.
      const front = this.add(this.body, new THREE.BoxGeometry(0.45, 0.035, tw + 0.08), this.m.armor, L / 2 - 0.08, th - 0.08, z);
      front.rotation.z = -0.45;
      const rear = this.add(this.body, new THREE.BoxGeometry(0.3, 0.035, tw + 0.08), this.m.armor, -L / 2 + 0.05, th - 0.05, z);
      rear.rotation.z = 0.5;
      for (let i = 0; i < 4; i++) this.detail(this.body, new THREE.BoxGeometry(0.04, 0.12, 0.04), this.m.dark, [-L / 2 + 0.6 + i * ((L - 1.2) / 3), th - 0.05, side * (W / 2 - 0.04)]);
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
      // Szyna, na której wiszą fartuchy.
      this.add(this.body, new THREE.BoxGeometry(L - 0.3, 0.05, 0.08), this.m.armor, -0.05, this.trackH + 0.04, side * (W / 2 + 0.02));
      for (let i = 0; i < segs; i++) {
        const sk = this.add(this.body, new THREE.BoxGeometry(segL - 0.05, sh, 0.05), this.m.armor, -L / 2 + 0.2 + segL * (i + 0.5), this.trackH - sh / 2 + 0.05, side * (W / 2 + 0.06));
        sk.rotation.x = side * 0.06;
        // Śruby mocujące (dzieci fartucha – odpadają razem z nim).
        const bolts: THREE.BufferGeometry[] = [];
        for (const dx of [-0.32, 0.32]) bolts.push(this.cyl(0.03, 0.03, 0.03, 6, 'z').translate(dx * segL, sh / 2 - 0.08, side * 0.035).toNonIndexed());
        const bm = new THREE.Mesh(this.shade(mergeGeometries(bolts)!, this.trackH), this.m.steel);
        bm.userData['noOutline'] = true;
        sk.add(bm);
        this.skirts.push(sk);
      }
    }
  }

  /** Lufa w kołysce: kołyska jest stała względem jarzma, lufa wysuwa się z niej teleskopowo. */
  private buildGun(opts: { z: number; br: number; brake: 'double' | 'single' | 'flash' | 'none'; evacuator: number | null; jacket?: boolean }): void {
    const def = this.def;
    const len = def.barrelLength;
    const start = def.turretRadius * 0.2;
    const cradleLen = start + def.extRange + 0.35;
    const { z, br } = opts;
    this.add(this.mantlet, this.cyl(br * 1.85, br * 1.6, cradleLen, 12, 'x'), this.m.armor, cradleLen / 2, 0, z);
    this.add(this.mantlet, this.cyl(br * 1.95, br * 1.95, 0.1, 12, 'x'), this.m.dark, cradleLen - 0.05, 0, z, true);
    this.rivets(this.mantlet, [cradleLen - 0.12, br * 1.85, z], [cradleLen - 0.12, -br * 1.85, z], 2, 0.022);
    // Lufa malowana jak kadłub, okopcony wylot, pierścienie łączeń.
    const tubeLen = len + 0.3;
    this.add(this.barrel, this.cyl(br, br * 0.82, tubeLen, 12, 'x'), this.m.armor, start + len - tubeLen / 2, 0, z);
    this.add(this.barrel, this.cyl(br * 1.12, br * 1.12, 0.06, 12, 'x'), this.m.armor, start + len * 0.45, 0, z, true);
    this.add(this.barrel, this.cyl(br * 0.88, br * 0.84, len * 0.18, 12, 'x'), this.m.dark, start + len * 0.9, 0, z, true);
    if (opts.evacuator !== null) {
      this.add(this.barrel, this.cyl(br * 1.55, br * 1.55, len * 0.12, 12, 'x'), this.m.armor, start + len * opts.evacuator, 0, z);
    }
    if (opts.jacket) {
      this.add(this.barrel, this.cyl(br * 1.5, br * 1.5, len * 0.5, 10, 'x'), this.m.armor, start + len * 0.42, 0, z);
      // Otwory chłodzące osłony.
      for (let i = 0; i < 6; i++) for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        this.detail(this.barrel, this.cyl(0.025, 0.025, 0.02, 6, 'x'), this.m.dark, [start + len * (0.22 + i * 0.075), Math.sin(a) * br * 1.5, z + Math.cos(a) * br * 1.5], { rx: a, rz: Math.PI / 2 });
      }
    }
    if (opts.brake === 'double') {
      this.add(this.barrel, this.cyl(br * 1.6, br * 1.6, len * 0.05, 10, 'x'), this.m.dark, start + len - len * 0.025, 0, z);
      this.add(this.barrel, this.cyl(br * 1.6, br * 1.6, len * 0.05, 10, 'x'), this.m.dark, start + len - len * 0.1, 0, z);
      this.add(this.barrel, this.cyl(br * 1.15, br * 1.15, len * 0.08, 10, 'x'), this.m.steel, start + len - len * 0.065, 0, z, true);
    } else if (opts.brake === 'single') {
      this.add(this.barrel, new THREE.BoxGeometry(len * 0.07, br * 2.4, br * 3), this.m.dark, start + len - len * 0.035, 0, z);
    } else if (opts.brake === 'flash') {
      this.add(this.barrel, this.cyl(br * 1.2, br * 1.0, len * 0.08, 8, 'x'), this.m.dark, start + len - len * 0.04, 0, z);
    }
  }

  private cupola(parent: THREE.Object3D, x: number, y: number, z: number, r: number, withMg = false): void {
    this.add(parent, this.cyl(r, r * 0.9, 0.22, 12), this.m.armor, x, y + 0.11, z);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.detail(parent, new THREE.BoxGeometry(0.07, 0.06, 0.08), this.m.glass, [x + Math.cos(a) * r * 0.95, y + 0.14, z + Math.sin(a) * r * 0.95], { ry: -a });
    }
    this.hatch(parent, x, y + 0.22, z, r * 0.78);
    if (withMg) this.mg(parent, x + r * 0.4, y + 0.36, z + r * 0.5);
  }

  private exhausts(x: number, y: number, spread: number, vertical: boolean): void {
    for (const s of [-1, 1]) {
      if (vertical) {
        this.add(this.body, this.cyl(0.09, 0.11, 0.45, 8), this.m.dark, x, y + 0.2, s * spread);
        // Perforowana osłona termiczna.
        this.detail(this.body, this.cyl(0.14, 0.14, 0.3, 8, 'y'), this.m.armor, [x - 0.02, y + 0.15, s * spread], { outline: true });
      } else {
        this.add(this.body, this.cyl(0.08, 0.1, 0.35, 8, 'x'), this.m.dark, x, y, s * spread);
        this.detail(this.body, new THREE.BoxGeometry(0.3, 0.22, 0.28), this.m.armor, [x + 0.08, y, s * spread], { outline: true });
      }
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

  /** Pierścień śrub na czołowej płaszczyźnie jarzma (oś x). */
  private boltRing(parent: THREE.Object3D, x: number, r: number, n: number, z = 0): void {
    const g = new THREE.SphereGeometry(0.03, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.detail(parent, g, this.m.armor, [x, Math.sin(a) * r, z + Math.cos(a) * r], { rz: -Math.PI / 2 });
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
    const glacis = L / 2 - 1.75;
    this.add(this.body, loft([
      { x: -L / 2, y0: th, y1: H - 0.18, w0: W / 2, w1: W / 2 - 0.22 },
      { x: -L / 2 + 0.25, y0: th, y1: H, w0: W / 2, w1: W / 2 - 0.28 },
      { x: glacis, y0: th, y1: H, w0: W / 2, w1: W / 2 - 0.28 },
      { x: L / 2 + 0.05, y0: th - 0.12, y1: th + 0.12, w0: W / 2 - 0.12, w1: W / 2 - 0.2 },
    ]), this.m.armor);
    const ew = W / 2 - 0.28;
    for (const s of [-1, 1]) {
      this.weld(this.body, [-L / 2 + 0.25, H, s * ew], [glacis, H, s * ew]);
      this.rivets(this.body, [-L / 2 + 0.45, H + 0.005, s * (ew - 0.08)], [glacis - 0.15, H + 0.005, s * (ew - 0.08)], 13);
      this.headlight(this.body, glacis + 0.12, H + 0.06, s * (ew - 0.18));
      this.jerrycan(this.body, -L / 2 + 0.38, H, s * (ew - 0.15), Math.PI / 2);
    }
    this.weld(this.body, [glacis, H, -ew], [glacis, H, ew]);
    // Płyta czołowa: kulisty karabin, zapasowe ogniwa, peryskopy kierowcy.
    this.mg(this.body, glacis + 0.65, H - 0.32, -0.62, true);
    this.spareLinks(this.body, L / 2 - 0.85, th + 0.48, 0.35, 3, -0.55 + Math.PI, 0);
    for (const z of [-0.85, -0.45]) this.periscope(this.body, glacis - 0.18, H, z);
    this.hatch(this.body, glacis - 0.55, H, -0.65, 0.26);
    this.hatch(this.body, glacis - 0.55, H, 0.65, 0.26);
    // Płyta silnika: kratki wlotów, wydechy z osłonami, narzędzia, lina.
    for (const s of [-1, 1]) this.grille(this.body, -L / 2 + 1.0, H + 0.01, s * 0.48, 0.95, 0.5, 6);
    this.exhausts(-L / 2 + 0.05, H - 0.2, 0.55, true);
    this.shovel(this.body, -0.2, H + 0.035, ew - 0.18);
    this.axe(this.body, 0.9, H + 0.03, ew - 0.32);
    this.cable(this.body, [[glacis - 0.3, H + 0.04, -ew + 0.14], [-0.4, H + 0.06, -ew + 0.12], [-L / 2 + 1.8, H + 0.04, -ew + 0.16], [-L / 2 + 1.6, H + 0.04, -ew + 0.4]]);
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
    for (const s of [-1, 1]) {
      this.weld(this.turret, [-r * 1.25, tt, s * r * 0.7], [r * 0.3, tt, s * r * 0.72]);
      this.weld(this.turret, [r * 0.3, tt, s * r * 0.72], [r * 0.78, tt * 0.82, s * r * 0.38]);
      this.rivets(this.turret, [-r * 1.1, tt + 0.005, s * r * 0.6], [r * 0.2, tt + 0.005, s * r * 0.62], 8);
      this.smokeLaunchers(this.turret, r * 0.12, tt * 0.82, s * r * 0.82);
      this.liftEye(this.turret, r * 0.15, tt + 0.03, s * r * 0.45);
      // Zapasowe ogniwa gąsienic na burtach wieży.
      this.spareLinks(this.turret, -r * 0.5, tt * 0.42, s * r * 0.9, 4, 0, Math.PI / 2);
    }
    this.liftEye(this.turret, -r * 1.3, tt + 0.03, 0, Math.PI / 2);
    this.cupola(this.turret, -r * 0.55, tt, r * 0.4, r * 0.24, true);
    this.hatch(this.turret, -r * 0.3, tt, -r * 0.35, 0.26);
    this.periscope(this.turret, r * 0.15, tt, -r * 0.05);
    this.stowBin(this.turret, -r * 2.0, -r * 1.48, tt * 0.18, tt * 0.82, r * 0.7);
    this.antenna(this.turret, -r * 1.15, tt, -r * 0.45, 2.0);
    // Jarzmo „świński łeb” – zaokrąglony stożek ze śrubami.
    this.add(this.mantlet, this.cyl(tt * 0.42, tt * 0.22, 0.55, 12), this.m.armor, 0.05, 0, 0).rotation.z = -Math.PI / 2;
    this.boltRing(this.mantlet, 0.08, tt * 0.36, 8);
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
    const glacis = L / 2 - 1.15;
    this.add(this.body, loft([
      { x: -L / 2, y0: th, y1: H - 0.22, w0: W / 2, w1: W / 2 - 0.08 },
      { x: -L / 2 + 0.35, y0: th, y1: H, w0: W / 2, w1: W / 2 - 0.1 },
      { x: glacis, y0: th, y1: H, w0: W / 2, w1: W / 2 - 0.1 },
      { x: L / 2 + 0.05, y0: th - 0.15, y1: th + 0.08, w0: W / 2 - 0.1, w1: W / 2 - 0.15 },
    ]), this.m.armor);
    const ew = W / 2 - 0.1;
    const slope = Math.atan2(H - th - 0.08, L / 2 + 0.05 - glacis);
    // Płyta czołowa: właz kierowcy z peryskopami, kulisty karabin, zapasowe ogniwa, lina.
    const gx = (f: number): number => glacis + (L / 2 + 0.05 - glacis) * f;
    const gy = (f: number): number => H - (H - th - 0.08) * f;
    this.detail(this.body, new THREE.BoxGeometry(0.42, 0.07, 0.5), this.m.armor, [gx(0.32), gy(0.32) + 0.03, -0.5], { rz: -slope, outline: true });
    this.detail(this.body, this.cyl(0.03, 0.03, 0.4, 6, 'z'), this.m.dark, [gx(0.15), gy(0.15) + 0.05, -0.5]);
    for (const z of [-0.65, -0.35]) this.periscope(this.body, gx(0.08), gy(0.08), z);
    this.mg(this.body, gx(0.5), gy(0.5) + 0.05, 0.55, true);
    this.spareLinks(this.body, gx(0.72), gy(0.72) + 0.03, 0, 4, -slope, 0);
    for (const s of [-1, 1]) {
      this.headlight(this.body, L / 2 - 0.3, th + 0.16, s * (W / 2 - this.trackW / 2));
      this.weld(this.body, [glacis, H, s * ew], [L / 2 + 0.05, th + 0.08, s * (W / 2 - 0.15)]);
      this.jerrycan(this.body, -L / 2 + 0.55, th + 0.04, s * (W / 2 - this.trackW / 2), 0);
      // Uchwyty dla piechoty na burtach.
      for (let i = 0; i < 3; i++) this.detail(this.body, new THREE.TorusGeometry(0.1, 0.014, 4, 8, Math.PI), this.m.dark, [-L / 2 + 1.0 + i * 0.9, H - 0.1, s * (W / 2 + 0.01)], { rx: s * Math.PI / 2 });
    }
    this.weld(this.body, [glacis, H, -ew], [glacis, H, ew]);
    this.cable(this.body, [[glacis - 0.2, H + 0.04, ew - 0.15], [-0.2, H + 0.05, ew - 0.13], [-L / 2 + 1.6, H + 0.04, ew - 0.15]]);
    // Beczki z paliwem na tyle (z obejmami), bal do wyciągania z błota, kratka silnika.
    for (const x of [-L / 2 + 0.55, -L / 2 + 1.3]) {
      this.add(this.body, this.cyl(0.22, 0.22, 0.65, 12, 'x'), this.m.can, x, H + 0.05, -(W / 2 - 0.28));
      for (const dx of [-0.2, 0.2]) this.detail(this.body, new THREE.TorusGeometry(0.225, 0.015, 4, 12), this.m.dark, [x + dx, H + 0.05, -(W / 2 - 0.28)], { ry: Math.PI / 2 });
    }
    this.add(this.body, this.cyl(0.13, 0.13, W * 0.9, 8, 'z'), this.m.wood, -L / 2 + 0.05, H + 0.05, 0);
    for (const z of [-W * 0.3, W * 0.3]) this.detail(this.body, new THREE.TorusGeometry(0.14, 0.015, 4, 10), this.m.steel, [-L / 2 + 0.05, H + 0.05, z], { ry: Math.PI / 2 });
    this.grille(this.body, -L / 2 + 1.05, H + 0.01, 0.3, 1.1, 0.75, 7);
    this.exhausts(-L / 2 - 0.02, H - 0.35, 0.65, false);
    this.engineDeck.set(-L / 2 + 0.9, H + 0.1, 0);
    // Kopułowa, odlewana wieża z białym pasem rozpoznawczym.
    const r = d.turretRadius;
    const tt = d.turretHeight;
    const dome = new THREE.SphereGeometry(r, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1.08, (tt * 1.25) / r, 0.98);
    this.add(this.turret, dome, this.m.armor, -r * 0.08, 0, 0);
    this.add(this.turret, this.cyl(r * 0.98, r * 1.02, 0.12, 18), this.m.armor, -r * 0.08, 0.04, 0);
    const band = new THREE.TorusGeometry(r * 0.985, 0.045, 4, 28);
    band.rotateX(Math.PI / 2);
    band.scale(1.08, 1, 0.98);
    this.detail(this.turret, band, this.m.accent, [-r * 0.08, tt * 0.3, 0]);
    this.cupola(this.turret, -r * 0.3, tt * 1.05, -r * 0.35, r * 0.22, true);
    this.add(this.turret, this.cyl(r * 0.18, r * 0.2, 0.08, 10), this.m.armor, -r * 0.25, tt * 1.15, r * 0.35);
    this.periscope(this.turret, r * 0.15, tt * 1.12, r * 0.3);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) this.detail(this.turret, new THREE.TorusGeometry(0.11, 0.014, 4, 8, Math.PI), this.m.dark, [-r * 0.6 + i * r * 0.35, tt * 0.62, s * r * 0.92], { rx: s * Math.PI / 2 });
      this.liftEye(this.turret, r * 0.3, tt * 0.95, s * r * 0.55);
    }
    // Zwinięty brezent z tyłu wieży.
    this.add(this.turret, this.cyl(0.17, 0.17, r * 1.3, 10, 'z'), this.m.canvas, -r * 1.12, tt * 0.55, 0);
    for (const z of [-r * 0.35, r * 0.35]) this.detail(this.turret, new THREE.TorusGeometry(0.175, 0.016, 4, 10), this.m.dark, [-r * 1.12, tt * 0.55, z]);
    this.antenna(this.turret, -r * 0.7, tt * 0.9, r * 0.6, 2.0);
    // Odlewane jarzmo i lufa z eżektorem przy wylocie.
    this.add(this.mantlet, new THREE.SphereGeometry(tt * 0.42, 10, 8), this.m.armor, -0.02, 0, 0);
    this.boltRing(this.mantlet, tt * 0.33, tt * 0.22, 6);
    this.buildGun({ z: 0, br: d.barrelRadius * 0.55, brake: 'flash', evacuator: 0.8 });
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
    const ew = W / 2 - 0.08;
    // Ostrzegawcze pasy na klinie, kratka silnika, reflektory, właz kierowcy.
    const nose = Math.atan2(H - 0.12 - th - 0.05, 0.63);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 2; i++) this.detail(this.body, new THREE.BoxGeometry(0.5, 0.025, 0.1), this.m.accent, [L / 2 - 0.25 - i * 0.02, (H - 0.12 + th + 0.05) / 2 + 0.02, s * (0.35 + i * 0.25)], { rz: -nose, ry: s * 0.55 });
      this.headlight(this.body, L / 2 - 0.15, th + 0.2, s * (W / 2 - this.trackW / 2));
      this.weld(this.body, [-L / 2, H, s * ew], [L / 2 - 1.1, H, s * ew]);
      // Skrzynki na błotnikach.
      for (const x of [-0.95, 0.15]) {
        this.add(this.body, box(-0.42, 0.42, th + 0.04, th + 0.32, 0.17), this.m.armor, x, 0, s * (W / 2 - this.trackW / 2));
        this.detail(this.body, new THREE.BoxGeometry(0.04, 0.06, 0.05), this.m.dark, [x, th + 0.26, s * (W / 2 - this.trackW / 2 + 0.18)]);
      }
      this.jerrycan(this.body, -L / 2 + 0.3, th + 0.04, s * (W / 2 - this.trackW / 2), 0);
    }
    this.grille(this.body, L / 2 - 1.15, H + 0.01, 0, 0.7, 0.95, 5);
    this.hatch(this.body, L / 2 - 1.55, H, 0.55, 0.22);
    this.periscope(this.body, L / 2 - 1.3, H, 0.55);
    this.cable(this.body, [[-L / 2 - 0.02, th + 0.32, -0.75], [-L / 2 - 0.06, th + 0.14, 0], [-L / 2 - 0.02, th + 0.32, 0.75]]);
    this.exhausts(L / 2 - 1.3, H - 0.2, W / 2 - 0.05, false);
    this.engineDeck.set(L / 2 - 1.1, H + 0.1, 0);
    // Wieża oscylacyjna: niski kołnierz + górna część z długim koszem z tyłu.
    const r = d.turretRadius;
    const tt = d.turretHeight;
    this.add(this.turret, this.cyl(r * 0.85, r * 0.92, tt * 0.35, 14), this.m.armor, 0, tt * 0.17, 0);
    this.add(this.turret, loft([
      { x: -r * 2.0, y0: tt * 0.4, y1: tt * 0.95, w0: r * 0.55, w1: r * 0.45 },
      { x: -r * 0.6, y0: tt * 0.25, y1: tt * 1.05, w0: r * 0.88, w1: r * 0.7 },
      { x: r * 0.55, y0: tt * 0.25, y1: tt * 0.95, w0: r * 0.85, w1: r * 0.55 },
      { x: r * 0.85, y0: tt * 0.35, y1: tt * 0.75, w0: r * 0.6, w1: r * 0.4 },
    ]), this.m.armor);
    for (const s of [-1, 1]) {
      this.weld(this.turret, [-r * 0.6, tt * 1.05, s * r * 0.7], [r * 0.55, tt * 0.95, s * r * 0.55]);
      this.smokeLaunchers(this.turret, r * 0.25, tt * 0.85, s * r * 0.82);
      this.rivets(this.turret, [-r * 1.8, tt * 0.96, s * r * 0.4], [-r * 0.7, tt * 1.06, s * r * 0.62], 6, 0.022);
    }
    this.cupola(this.turret, -r * 0.3, tt * 1.05, r * 0.35, r * 0.2, true);
    this.periscope(this.turret, r * 0.2, tt * 1.0, -r * 0.3);
    // Kosz na bagaż za wieżą: stelaż z prętów i plandeka.
    for (const z of [-r * 0.45, r * 0.45]) this.detail(this.turret, this.cyl(0.018, 0.018, tt * 0.5, 5), this.m.dark, [-r * 2.25, tt * 0.75, z]);
    this.detail(this.turret, this.cyl(0.018, 0.018, r * 0.9, 5, 'z'), this.m.dark, [-r * 2.25, tt, 0]);
    this.detail(this.turret, new THREE.BoxGeometry(0.3, tt * 0.32, r * 0.75), this.m.canvas, [-r * 2.12, tt * 0.82, 0], { outline: true });
    this.antenna(this.turret, -r * 1.7, tt * 0.95, -r * 0.3, 1.7);
    // Bliźniacze działka z perforowanymi osłonami; reflektor na jarzmie.
    this.add(this.mantlet, new THREE.BoxGeometry(0.35, tt * 0.55, r * 1.25), this.m.armor, 0.05, 0, 0);
    this.boltRing(this.mantlet, 0.23, tt * 0.16, 6);
    this.detail(this.mantlet, this.cyl(0.08, 0.09, 0.14, 10, 'x'), this.m.dark, [0.1, tt * 0.4, -r * 0.5], { outline: true });
    this.detail(this.mantlet, this.cyl(0.065, 0.065, 0.02, 10, 'x'), this.m.glass, [0.18, tt * 0.4, -r * 0.5]);
    for (const z of [-r * 0.35, r * 0.35]) this.buildGun({ z, br: d.barrelRadius * 0.6, brake: 'flash', evacuator: null, jacket: true });
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
    const rw = W / 2 - 0.5;
    const sideTilt = Math.atan2(0.5, roof - th);
    const gx = (f: number): number => 0.55 + (L / 2 + 0.05 - 0.55) * f;
    const gy = (f: number): number => roof - (roof - th - 0.1) * f;
    const slope = Math.atan2(roof - th - 0.1, L / 2 + 0.05 - 0.55);
    for (const s of [-1, 1]) {
      this.weld(this.body, [-L / 2 + 0.45, roof, s * rw], [0.55, roof, s * rw]);
      this.weld(this.body, [0.55, roof, s * rw], [L / 2 + 0.05, th + 0.1, s * (W / 2 - 0.3)]);
      this.rivets(this.body, [-L / 2 + 0.65, roof + 0.005, s * (rw - 0.1)], [0.4, roof + 0.005, s * (rw - 0.1)], 12);
      this.headlight(this.body, L / 2 - 0.2, th + 0.16, s * (W / 2 - 0.3));
    }
    this.weld(this.body, [0.55, roof, -rw], [0.55, roof, rw]);
    // Burta lewa: zapasowe ogniwa na pochylonej płycie; prawa: lina.
    const ySide = th + 0.6;
    const zSide = W / 2 - 0.5 * ((ySide - th) / (roof - th)) + 0.03;
    this.spareLinks(this.body, -0.6, ySide, zSide, 6, 0, Math.PI / 2 - sideTilt);
    this.cable(this.body, [[0.3, ySide + 0.25, -(zSide - 0.08)], [-0.8, ySide + 0.3, -(zSide - 0.1)], [-1.8, ySide + 0.25, -(zSide - 0.08)]]);
    // Płyta czołowa: kulisty karabin, blokada lufy na czas marszu.
    this.mg(this.body, gx(0.45), gy(0.45) + 0.06, 0.75, true);
    for (const s of [-1, 1]) this.detail(this.body, new THREE.BoxGeometry(0.06, 0.55, 0.06), this.m.dark, [gx(0.85), gy(0.85) + 0.25, s * 0.14], { rx: s * 0.28, outline: true });
    this.detail(this.body, new THREE.TorusGeometry(0.1, 0.025, 4, 8, Math.PI), this.m.dark, [gx(0.85), gy(0.85) + 0.5, 0], { ry: Math.PI / 2 });
    this.spareLinks(this.body, gx(0.68), gy(0.68) + 0.03, -0.7, 2, -slope, 0);
    // Dach: właz z lunetą nożycową, peryskopy, wywietrzniki, antena.
    this.cupola(this.body, -0.9, roof - 0.04, 0.5, 0.22);
    for (const z of [0.42, 0.58]) this.detail(this.body, this.cyl(0.02, 0.02, 0.45, 5), this.m.dark, [-0.8, roof + 0.45, z], { rz: 0.15 });
    this.stowBin(this.body, -1.75, -1.05, roof - 0.04, roof + 0.18, 0.4);
    for (const z of [-0.45, -0.15, 0.15]) this.periscope(this.body, 0.32, roof, z);
    for (const z of [-0.35, 0.05]) this.detail(this.body, new THREE.SphereGeometry(0.12, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), this.m.armor, [-0.3, roof, z], { outline: true });
    this.antenna(this.body, -1.9, roof - 0.12, -0.85, 1.9);
    // Tył: wydechy, zapasowe koło, kanistry.
    this.exhausts(-L / 2 - 0.02, H - 0.25, 0.6, true);
    this.detail(this.body, this.cyl(0.3, 0.3, 0.12, 16, 'x'), this.m.rubber, [-L / 2 - 0.06, th + 0.3, -0.1], { outline: true });
    this.detail(this.body, this.cyl(0.22, 0.22, 0.14, 12, 'x'), this.m.armor, [-L / 2 - 0.07, th + 0.3, -0.1]);
    for (const z of [-0.95, 0.95]) this.jerrycan(this.body, -L / 2 - 0.12, th - 0.12, z, Math.PI / 2);
    this.engineDeck.set(-L / 2 + 0.8, roof, 0);
    // Jarzmo osadzone w płycie czołowej – „świński łeb” ze śrubami.
    const tt = d.turretHeight;
    this.add(this.mantlet, this.cyl(tt * 0.5, tt * 0.26, 0.6, 12), this.m.armor, 0.0, 0, 0).rotation.z = -Math.PI / 2;
    this.boltRing(this.mantlet, 0.05, tt * 0.42, 10);
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
