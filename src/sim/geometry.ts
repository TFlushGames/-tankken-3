// Geometria hitboxów i hurtboxów z pełną orientacją kadłuba (obrót poziomy + przewrót przód–tył).
// Funkcje czyste – używane przez symulację i (tylko do odczytu) debug renderera.
import { icos, isin, trigMul } from './fixed';
import type { TankParams } from './params';
import type { FighterState } from './types';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Układ kadłuba: środek obrotu w połowie wysokości kadłuba, oś X do przodu, Y w górę, Z w bok.
 * Kolejność obrotów: najpierw przewrót (wokół lokalnej osi Z), potem obrót poziomy (wokół Y).
 */
interface Frame {
  cx: number;
  cy: number;
  cz: number;
  cyaw: number;
  syaw: number;
  cp: number;
  sp: number;
}

function frameOf(f: FighterState, t: TankParams): Frame {
  const yaw = f.hullYaw + f.pivot;
  return {
    cx: f.x,
    cy: f.y + (t.hullHeight >> 1),
    cz: f.z,
    cyaw: icos(yaw),
    syaw: isin(yaw),
    cp: icos(f.bodyPitch),
    sp: isin(f.bodyPitch),
  };
}

/** Kierunek z układu kadłuba do świata (bez przesunięcia). */
function rotate(fr: Frame, lx: number, ly: number, lz: number): Point3 {
  const px = trigMul(lx, fr.cp) - trigMul(ly, fr.sp);
  const py = trigMul(lx, fr.sp) + trigMul(ly, fr.cp);
  return { x: trigMul(px, fr.cyaw) - trigMul(lz, fr.syaw), y: py, z: trigMul(px, fr.syaw) + trigMul(lz, fr.cyaw) };
}

function toWorld(fr: Frame, lx: number, ly: number, lz: number): Point3 {
  const r = rotate(fr, lx, ly, lz);
  return { x: fr.cx + r.x, y: fr.cy + r.y, z: fr.cz + r.z };
}

function toLocal(fr: Frame, p: Point3): Point3 {
  const dx = p.x - fr.cx;
  const dy = p.y - fr.cy;
  const dz = p.z - fr.cz;
  const px = trigMul(dx, fr.cyaw) + trigMul(dz, fr.syaw);
  const pz = -trigMul(dx, fr.syaw) + trigMul(dz, fr.cyaw);
  return { x: trigMul(px, fr.cp) + trigMul(dy, fr.sp), y: -trigMul(px, fr.sp) + trigMul(dy, fr.cp), z: pz };
}

/** Wysokość górnej płyty kadłuba (z ugięciem zawieszenia), względem podłoża czołgu. */
export function hullTop(f: FighterState, t: TankParams): number {
  return f.y + t.hullHeight - f.susp;
}

/** Górna płyta kadłuba w układzie lokalnym (względem środka obrotu). */
function localTop(f: FighterState, t: TankParams): number {
  return t.hullHeight - (t.hullHeight >> 1) - f.susp;
}

function localTurret(f: FighterState, t: TankParams): Point3 {
  return { x: t.turretOffset, y: localTop(f, t) + (t.turretHeight >> 1), z: 0 };
}

export function turretPivot(f: FighterState, t: TankParams): Point3 {
  const l = localTurret(f, t);
  return toWorld(frameOf(f, t), l.x, l.y, l.z);
}

/** Kierunek lufy w świecie (wektor skalowany TRIG_ONE). */
export function barrelDir(f: FighterState, t: TankParams): Point3 {
  const pitch = f.pitch + f.lift;
  const cp = icos(pitch);
  const lx = trigMul(icos(f.turretYaw), cp);
  const lz = trigMul(isin(f.turretYaw), cp);
  return rotate(frameOf(f, t), lx, isin(pitch), lz);
}

/** Odległość czopów lufy (osi elewacji) od osi wieży – jarzmo jest z przodu wieży. */
export function trunnionOffset(t: TankParams): number {
  return Math.trunc((t.turretRadius * 8) / 10);
}

/** Czopy lufy: przód wieży, na wysokości jej środka. */
export function trunnion(f: FighterState, t: TankParams): Point3 {
  const l = localTurret(f, t);
  const o = trunnionOffset(t);
  return toWorld(frameOf(f, t), l.x + trigMul(o, icos(f.turretYaw)), l.y, trigMul(o, isin(f.turretYaw)));
}

/** Punkty próbkowania kapsuły lufy (od jarzma do wylotu). */
export function barrelPoints(f: FighterState, t: TankParams, count = 6): Point3[] {
  const p = trunnion(f, t);
  const d = barrelDir(f, t);
  const start = Math.trunc(t.turretRadius / 5);
  const end = start + t.barrelLength + f.ext;
  const pts: Point3[] = [];
  for (let i = 0; i < count; i++) {
    const s = start + Math.trunc(((end - start) * i) / (count - 1));
    pts.push({ x: p.x + trigMul(s, d.x), y: p.y + trigMul(s, d.y), z: p.z + trigMul(s, d.z) });
  }
  return pts;
}

export function barrelTip(f: FighterState, t: TankParams): Point3 {
  return barrelPoints(f, t, 2)[1]!;
}

/** Punkty przodu kadłuba – hitbox „kopnięć”. */
export function hullFrontPoints(f: FighterState, t: TankParams): Point3[] {
  const fr = frameOf(f, t);
  const fwd = t.halfLen + 150;
  const side = Math.trunc((t.halfWid * 8) / 10);
  const h = 450 + Math.trunc((f.lift * 6) / 10) - (t.hullHeight >> 1);
  return [-side, 0, side].map((lat) => toWorld(fr, fwd, h, lat));
}

/** Punkty całego kadłuba (narożniki i środki ścian) – hitbox akrobacji (gąsienice, spód). */
export function hullBodyPoints(f: FighterState, t: TankParams): Point3[] {
  const fr = frameOf(f, t);
  const bottom = 100 - (t.hullHeight >> 1);
  const top = localTop(f, t);
  const pts: Point3[] = [];
  for (const x of [-t.halfLen, 0, t.halfLen]) {
    for (const y of [bottom, top]) {
      for (const z of [-t.halfWid, t.halfWid]) pts.push(toWorld(fr, x, y, z));
    }
  }
  return pts;
}

/** Czy kula (p, r) dotyka hurtboxów zawodnika (kadłub + wieża). */
export function pointHitsFighter(p: Point3, r: number, f: FighterState, t: TankParams): boolean {
  const l = toLocal(frameOf(f, t), p);
  const bottom = 100 - (t.hullHeight >> 1);
  const top = localTop(f, t);
  if (Math.abs(l.x) <= t.halfLen + r && Math.abs(l.z) <= t.halfWid + r && l.y >= bottom - r && l.y <= top + r) {
    return true;
  }
  const tr = t.turretRadius + r;
  return Math.abs(l.x - t.turretOffset) <= tr && Math.abs(l.z) <= tr && l.y >= top - r && l.y <= top + t.turretHeight + r;
}

/** Najniższy punkt kadłuba nad ziemią (do lądowania po saltach). */
export function lowestPoint(f: FighterState, t: TankParams): number {
  let min = Infinity;
  for (const p of hullBodyPoints(f, t)) min = Math.min(min, p.y);
  return min;
}
