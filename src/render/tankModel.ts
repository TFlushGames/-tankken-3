// Proceduralne modele czołgów w stylu komiksowym (toon + kontury).
// Hierarchia: korzeń → salto (obrót wokół środka) → podwozie (gąsienice, koła) + kadłub
// (zawieszenie, uniesienie) → wieża (yaw) → jarzmo na czopach z przodu wieży (pitch)
// → lufa wysuwana teleskopowo z kołyski (wysunięcie).
import * as THREE from 'three';
import type { TankDef } from '../sim/types';
import { addOutlines, toonMat } from './toon';
import { numberTexture, toonCamoTexture } from './textures';

export interface TankStyle {
  base: string;
  patch: string;
  accent: string;
  alt: [string, string, string];
  number: string;
  numberColor: string;
  roadWheels: number;
  skirts: boolean;
  spacedArmor: boolean;
  muzzleBrake: 'big' | 'normal' | 'none';
  fumeExtractor: boolean;
  turretShape: 'wedge' | 'hex' | 'small';
}

export const TANK_STYLES: Record<string, TankStyle> = {
  mamut: {
    base: '#6f7d3c',
    patch: '#4c5a2a',
    accent: '#ffc226',
    alt: ['#8a4b3a', '#5e2f25', '#f0e6c8'],
    number: '701',
    numberColor: '#ffe9a8',
    roadWheels: 7,
    skirts: true,
    spacedArmor: true,
    muzzleBrake: 'big',
    fumeExtractor: false,
    turretShape: 'wedge',
  },
  grom: {
    base: '#3d86b8',
    patch: '#2b6390',
    accent: '#f4f1e6',
    alt: ['#b8463a', '#86302a', '#ffd23a'],
    number: '214',
    numberColor: '#ffffff',
    roadWheels: 5,
    skirts: true,
    spacedArmor: false,
    muzzleBrake: 'normal',
    fumeExtractor: true,
    turretShape: 'hex',
  },
  osa: {
    base: '#ee7a2a',
    patch: '#c85a1a',
    accent: '#1c1c22',
    alt: ['#7a5ac8', '#5a3ea0', '#fff16a'],
    number: '07',
    numberColor: '#1c1c22',
    roadWheels: 4,
    skirts: false,
    spacedArmor: false,
    muzzleBrake: 'none',
    fumeExtractor: false,
    turretShape: 'small',
  },
};

const LINK_PITCH = 0.17;
const OUTLINE = 0.035;

interface Track {
  mesh: THREE.InstancedMesh;
  side: number;
  offset: number;
  count: number;
}

export class TankModel {
  readonly root = new THREE.Group();
  /** Grupa obracana przy saltach – oś obrotu w połowie wysokości kadłuba. */
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
  /** Punkty końca lufy w układzie lufy (do smugi ciosu). */
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
  readonly exhaust = new THREE.Vector3();
  readonly engineDeck = new THREE.Vector3();

  constructor(def: TankDef, alt: boolean) {
    this.def = def;
    const st = TANK_STYLES[def.id]!;
    const L = def.hullLength;
    const W = def.hullWidth;
    const H = def.hullHeight;
    const trackW = Math.max(0.42, W * 0.22);
    const trackH = H * 0.56;
    this.trackH = trackH;
    this.trackR = trackH / 2;
    this.trackA = L / 2 - this.trackR - 0.05;
    this.trackLen = 4 * this.trackA + 2 * Math.PI * this.trackR;

    const [base, patch, accentCol] = alt ? st.alt : [st.base, st.patch, st.accent];
    const camo = toonCamoTexture(base, patch, def.id.length * 13 + (alt ? 5 : 0));
    const armor = this.mat({ map: camo });
    const accent = this.mat({ color: accentCol });
    const dark = this.mat({ color: 0x2b2b30 });
    const steel = this.mat({ color: 0x6b6e78 });
    const rubber = this.mat({ color: 0x1e1e22 });
    const trackMat = this.mat({ color: 0x3c3a40 });

    this.root.add(this.spin);
    this.spin.position.y = H / 2;
    this.spin.add(this.inner);
    this.inner.position.y = -H / 2;
    this.inner.add(this.chassis);
    this.inner.add(this.body);

    // --- kadłub dolny (między gąsienicami)
    const lowerW = W - trackW * 2;
    const lower = new THREE.Shape();
    lower.moveTo(-L / 2 + 0.15, trackH * 0.35);
    lower.lineTo(L / 2 - 0.5, trackH * 0.35);
    lower.lineTo(L / 2 - 0.05, trackH);
    lower.lineTo(-L / 2 + 0.05, trackH);
    lower.closePath();
    this.addExtrude(lower, lowerW, dark, this.body);

    // --- kadłub górny ze skośnymi płytami (nad gąsienicami – błotniki)
    const top = H;
    const upper = new THREE.Shape();
    const glacis = def.id === 'mamut' ? 1.6 : def.id === 'osa' ? 0.9 : 1.2;
    upper.moveTo(-L / 2, trackH);
    upper.lineTo(L / 2 + 0.05, trackH);
    upper.lineTo(L / 2 + 0.05, trackH + 0.08);
    upper.lineTo(L / 2 - glacis, top);
    upper.lineTo(-L / 2 + 0.35, top);
    upper.lineTo(-L / 2, top - 0.25);
    upper.closePath();
    this.addExtrude(upper, W, armor, this.body, 0.05);

    // Pas w kolorze akcentu na przedniej płycie.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, W * 0.98), accent);
    const ga = Math.atan2(top - trackH - 0.08, glacis);
    stripe.position.set(L / 2 - glacis * 0.45, trackH + (top - trackH) * 0.55 + 0.02, 0);
    stripe.rotation.z = ga;
    stripe.userData['noOutline'] = true;
    this.body.add(stripe);

    // Płyta silnika z kratkami.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(L * 0.28, 0.05, W * 0.6), dark);
    deck.position.set(-L / 2 + L * 0.2, top + 0.02, 0);
    this.body.add(deck);
    this.engineDeck.set(-L / 2 + L * 0.2, top + 0.1, 0);
    for (let i = 0; i < 5; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, W * 0.55), steel);
      slat.position.set(-L / 2 + L * 0.1 + i * L * 0.045, top + 0.06, 0);
      slat.userData['noOutline'] = true;
      this.body.add(slat);
    }
    // Rury wydechowe.
    const exGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.35, 10);
    for (const side of [-1, 1]) {
      const ex = new THREE.Mesh(exGeo, dark);
      ex.rotation.z = Math.PI / 2;
      ex.position.set(-L / 2 - 0.05, top - 0.3, side * W * 0.28);
      this.body.add(ex);
    }
    this.exhaust.set(-L / 2 - 0.25, top - 0.3, 0);

    // Skrzynki, liny holownicze, reflektory.
    const boxGeo = new THREE.BoxGeometry(L * 0.18, 0.22, 0.3);
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(boxGeo, accent);
      b.position.set(-L * 0.1, top + 0.11, side * (W / 2 - 0.2));
      this.body.add(b);
      const cable = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(L * 0.3, top + 0.03, side * (W / 2 - 0.08)),
            new THREE.Vector3(L * 0.05, top + 0.05, side * (W / 2 - 0.05)),
            new THREE.Vector3(-L * 0.25, top + 0.03, side * (W / 2 - 0.08)),
          ]),
          16, 0.025, 6, false,
        ),
        steel,
      );
      cable.userData['noOutline'] = true;
      this.body.add(cable);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 12), this.mat({ color: 0xfff1b0, emissive: 0xffd060, emissiveIntensity: 0.6 }));
      lamp.rotation.z = Math.PI / 2;
      lamp.position.set(L / 2 - glacis * 0.55, (trackH + top) / 2 + 0.12, side * (W / 2 - 0.35));
      lamp.userData['noOutline'] = true;
      this.body.add(lamp);
    }

    // Nity na krawędziach płyt (instancing).
    const rivetGeo = new THREE.SphereGeometry(0.03, 6, 4);
    const rivetCount = Math.floor(L / 0.22) * 2;
    const rivets = new THREE.InstancedMesh(rivetGeo, steel, rivetCount);
    let ri = 0;
    for (const side of [-1, 1]) {
      for (let x = -L / 2 + 0.4; x < L / 2 - glacis && ri < rivetCount; x += 0.22) {
        this.tmpM.makeTranslation(x, top + 0.005, side * (W / 2 - 0.03));
        rivets.setMatrixAt(ri++, this.tmpM);
      }
    }
    rivets.count = ri;
    this.body.add(rivets);

    // Fartuchy boczne (odpadają przy dużych uszkodzeniach).
    if (st.skirts) {
      const segs = Math.round(L / 1.0);
      const segL = (L - 0.3) / segs;
      const sh = trackH * (st.spacedArmor ? 0.75 : 0.55);
      for (const side of [-1, 1]) {
        for (let i = 0; i < segs; i++) {
          const sk = new THREE.Mesh(new THREE.BoxGeometry(segL - 0.05, sh, 0.05), i % 2 ? armor : accent);
          sk.position.set(-L / 2 + 0.15 + segL * (i + 0.5), trackH - sh / 2 + 0.02, side * (W / 2 + 0.04));
          this.body.add(sk);
          this.skirts.push(sk);
        }
      }
    }

    // --- gąsienice i koła
    const linkGeo = new THREE.BoxGeometry(LINK_PITCH * 0.86, 0.07, trackW);
    const count = Math.floor(this.trackLen / LINK_PITCH);
    for (const side of [-1, 1]) {
      const mesh = new THREE.InstancedMesh(linkGeo, trackMat, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.position.z = side * (W / 2 - trackW / 2);
      this.chassis.add(mesh);
      this.tracks.push({ mesh, side, offset: 0, count });
      const z = side * (W / 2 - trackW / 2);
      const rw = st.roadWheels;
      const wr = this.trackR * 0.78;
      const wheelGeo = new THREE.CylinderGeometry(wr, wr, trackW * 0.8, 18);
      wheelGeo.rotateX(Math.PI / 2);
      const hubGeo = new THREE.CylinderGeometry(wr * 0.4, wr * 0.4, trackW * 0.86, 8);
      hubGeo.rotateX(Math.PI / 2);
      for (let i = 0; i < rw; i++) {
        const x = -this.trackA + 0.15 + ((2 * this.trackA - 0.3) * i) / (rw - 1);
        const g = new THREE.Group();
        const w = new THREE.Mesh(wheelGeo, rubber);
        const hub = new THREE.Mesh(hubGeo, accent);
        hub.userData['noOutline'] = true;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(wr * 1.5, 0.06, trackW * 0.88), steel);
        spoke.userData['noOutline'] = true;
        g.add(w, hub, spoke);
        g.position.set(x, wr + 0.04, z);
        this.chassis.add(g);
        this.wheels.push({ mesh: g, side, radius: wr, baseY: wr + 0.04, phase: i * 1.7 });
      }
      // Koło napędowe z zębami (tył) i napinające (przód).
      const sr = this.trackR * 0.85;
      for (const [x, teeth] of [[-this.trackA, true], [this.trackA, false]] as const) {
        const g = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(sr, sr, trackW * 0.7, 20), steel);
        disc.rotation.x = Math.PI / 2;
        g.add(disc);
        if (teeth) {
          for (let k = 0; k < 10; k++) {
            const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, trackW * 0.5), dark);
            const a = (k / 10) * Math.PI * 2;
            tooth.position.set(Math.cos(a) * sr, Math.sin(a) * sr, 0);
            tooth.rotation.z = a;
            g.add(tooth);
          }
        }
        g.position.set(x, this.trackR, z);
        this.chassis.add(g);
        this.wheels.push({ mesh: g, side, radius: sr, baseY: this.trackR, phase: 0 });
      }
    }

    // --- wieża
    this.turret.position.set(def.turretOffset, top, 0);
    this.body.add(this.turret);
    const r = def.turretRadius;
    const th = def.turretHeight;
    const ts = new THREE.Shape();
    if (st.turretShape === 'wedge') {
      ts.moveTo(r * 1.0, -r * 0.5);
      ts.lineTo(r * 1.0, r * 0.5);
      ts.lineTo(r * 0.2, r * 0.95);
      ts.lineTo(-r * 1.25, r * 0.85);
      ts.lineTo(-r * 1.35, -r * 0.85);
      ts.lineTo(r * 0.2, -r * 0.95);
    } else if (st.turretShape === 'hex') {
      ts.moveTo(r * 0.92, -r * 0.42);
      ts.lineTo(r * 0.92, r * 0.42);
      ts.lineTo(r * 0.25, r * 0.9);
      ts.lineTo(-r * 0.9, r * 0.75);
      ts.lineTo(-r * 1.0, -r * 0.75);
      ts.lineTo(r * 0.25, -r * 0.9);
    } else {
      ts.moveTo(r * 0.9, -r * 0.55);
      ts.lineTo(r * 0.9, r * 0.55);
      ts.lineTo(-r * 0.8, r * 0.8);
      ts.lineTo(-r * 0.9, -r * 0.8);
    }
    ts.closePath();
    const tGeo = new THREE.ExtrudeGeometry(ts, {
      depth: th * 0.9,
      bevelEnabled: true,
      bevelThickness: th * 0.1,
      bevelSize: 0.08,
      bevelSegments: 2,
    });
    tGeo.rotateX(-Math.PI / 2);
    this.turret.add(new THREE.Mesh(tGeo, armor));
    // Pas akcentu dookoła wieży.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.93, r * 0.93, 0.1, 24), accent);
    band.position.set(-r * 0.1, th * 0.25, 0);
    band.scale.set(1.04, 1, 0.97);
    band.userData['noOutline'] = true;
    this.turret.add(band);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.9, 0.1, 24), dark);
    ring.position.y = 0.03;
    this.turret.add(ring);
    // Właz, wieżyczka dowódcy, peryskopy, antena, kosz.
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.27, 0.08, 14), armor);
    hatch.position.set(-r * 0.3, th + 0.04, r * 0.3);
    this.turret.add(hatch);
    const cupola = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.26, 0.22, 10), armor);
    cupola.position.set(-r * 0.35, th + 0.11, -r * 0.35);
    this.turret.add(cupola);
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.08), this.mat({ color: 0x9ad8ff, emissive: 0x2a6080 }));
      const a = (i / 5) * Math.PI * 2;
      p.position.set(-r * 0.35 + Math.cos(a) * r * 0.22, th + 0.2, -r * 0.35 + Math.sin(a) * r * 0.22);
      this.turret.add(p);
    }
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 2.2, 4), dark);
    ant.position.set(-r * 0.95, th + 1.1, r * 0.55);
    ant.userData['noOutline'] = true;
    this.turret.add(ant);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.22), this.mat({ color: accentCol, side: THREE.DoubleSide }));
    flag.position.set(-r * 0.95 - 0.2, th + 2.05, r * 0.55);
    flag.userData['noOutline'] = true;
    this.turret.add(flag);
    const bustle = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, th * 0.45, r * 1.3), dark);
    bustle.position.set(-r * 1.2, th * 0.45, 0);
    this.turret.add(bustle);
    const numTex = numberTexture(st.number, st.numberColor);
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false });
    for (const side of [-1, 1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.9, r * 0.45), numMat);
      plane.position.set(-r * 0.35, th * 0.55, side * (r * 0.83 + 0.11));
      plane.rotation.y = side > 0 ? 0 : Math.PI;
      this.turret.add(plane);
    }

    // --- jarzmo na czopach z przodu wieży (zgodnie z geometrią symulacji)
    const trunnion = r * 0.8;
    this.mantlet.position.set(trunnion, th / 2, 0);
    this.turret.add(this.mantlet);
    const twin = def.twinBarrels;
    // Osłona jarzma – zaokrąglony blok obracający się z lufą, zasłania otwór w wieży.
    const shieldW = twin ? r * 1.25 : r * 0.85;
    const shieldGeo = new THREE.CylinderGeometry(th * 0.42, th * 0.42, shieldW, 16);
    shieldGeo.rotateX(Math.PI / 2);
    const shield = new THREE.Mesh(shieldGeo, armor);
    shield.position.x = -0.02;
    this.mantlet.add(shield);
    const len = def.barrelLength;
    const br = def.barrelRadius * 0.6;
    const start = r * 0.2;
    const ext = def.extRange;
    const barrels = twin ? [-r * 0.35, r * 0.35] : [0];
    for (const z of barrels) {
      // Kołyska (stała względem jarzma) – w niej przesuwa się lufa, więc nigdy nie odstaje.
      const cradleLen = start + ext + 0.35;
      const cradle = new THREE.Mesh(new THREE.CylinderGeometry(br * 1.65, br * 1.8, cradleLen, 14), armor);
      cradle.rotation.z = -Math.PI / 2;
      cradle.position.set(cradleLen / 2, 0, z);
      this.mantlet.add(cradle);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(br * 1.9, br * 1.9, 0.1, 14), accent);
      collar.rotation.z = -Math.PI / 2;
      collar.position.set(cradleLen - 0.05, 0, z);
      collar.userData['noOutline'] = true;
      this.mantlet.add(collar);
      // Lufa: od wnętrza kołyski do wylotu (wylot = start + długość, jak w symulacji).
      const tubeLen = len + 0.3;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(br * 0.85, br, tubeLen, 14), steel);
      tube.rotation.z = -Math.PI / 2;
      tube.position.set(start + len - tubeLen / 2, 0, z);
      this.barrel.add(tube);
      if (st.fumeExtractor) {
        const fe = new THREE.Mesh(new THREE.CylinderGeometry(br * 1.6, br * 1.6, len * 0.12, 14), dark);
        fe.rotation.z = -Math.PI / 2;
        fe.position.set(start + len * 0.55, 0, z);
        this.barrel.add(fe);
      }
      if (st.muzzleBrake !== 'none') {
        const s = st.muzzleBrake === 'big' ? 1.0 : 0.75;
        const mb = new THREE.Mesh(new THREE.BoxGeometry(len * 0.07, br * 2.6 * s, br * 3.2 * s), dark);
        mb.position.set(start + len - len * 0.03, 0, z);
        this.barrel.add(mb);
        const mb2 = mb.clone();
        mb2.position.x -= len * 0.06;
        this.barrel.add(mb2);
      } else {
        const jacket = new THREE.Mesh(new THREE.CylinderGeometry(br * 1.4, br * 1.4, len * 0.45, 8), dark);
        jacket.rotation.z = -Math.PI / 2;
        jacket.position.set(start + len * 0.5, 0, z);
        this.barrel.add(jacket);
      }
    }
    this.mantlet.add(this.barrel);
    this.tipLocal = new THREE.Vector3(start + len, 0, 0);
    this.midLocal = new THREE.Vector3(start + len * 0.35, 0, 0);

    addOutlines(this.inner, OUTLINE);
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

  private addExtrude(shape: THREE.Shape, depth: number, mat: THREE.Material, parent: THREE.Object3D, bevel = 0): void {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: depth - bevel * 2,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
    });
    g.translate(0, 0, -(depth - bevel * 2) / 2);
    parent.add(new THREE.Mesh(g, mat));
  }

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
