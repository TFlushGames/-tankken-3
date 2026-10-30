// Geometria hitboxów i hurtboxów. Funkcje czyste – używane przez symulację i (tylko do odczytu) debug renderera.
import { icos, isin, trigMul } from './fixed';
import type { TankParams } from './params';
import type { FighterState } from './types';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Wysokość górnej płyty kadłuba (z ugięciem zawieszenia). */
export function hullTop(f: FighterState, t: TankParams): number {
  return f.y + t.hullHeight - f.susp;
}

export function turretPivot(f: FighterState, t: TankParams): Point3 {
  const yaw = f.hullYaw + f.pivot;
  return {
    x: f.x + trigMul(t.turretOffset, icos(yaw)),
    y: hullTop(f, t) + (t.turretHeight >> 1),
    z: f.z + trigMul(t.turretOffset, isin(yaw)),
  };
}

/** Kierunek lufy w świecie (wektor skalowany TRIG_ONE). */
export function barrelDir(f: FighterState): Point3 {
  const yaw = f.hullYaw + f.pivot + f.turretYaw;
  const pitch = f.pitch + f.lift;
  const cp = icos(pitch);
  return { x: trigMul(icos(yaw), cp), y: isin(pitch), z: trigMul(isin(yaw), cp) };
}

/** Odległość czopów lufy (osi elewacji) od osi wieży – jarzmo jest z przodu wieży. */
export function trunnionOffset(t: TankParams): number {
  return Math.trunc((t.turretRadius * 8) / 10);
}

/** Czopy lufy: przód wieży, na wysokości jej środka. */
export function trunnion(f: FighterState, t: TankParams): Point3 {
  const p = turretPivot(f, t);
  const yaw = f.hullYaw + f.pivot + f.turretYaw;
  const o = trunnionOffset(t);
  return { x: p.x + trigMul(o, icos(yaw)), y: p.y, z: p.z + trigMul(o, isin(yaw)) };
}

/** Punkty próbkowania kapsuły lufy (od jarzma do wylotu). */
export function barrelPoints(f: FighterState, t: TankParams, count = 6): Point3[] {
  const p = trunnion(f, t);
  const d = barrelDir(f);
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
  const pts = barrelPoints(f, t, 2);
  return pts[1]!;
}

/** Punkty przodu kadłuba – hitbox „kopnięć”. */
export function hullFrontPoints(f: FighterState, t: TankParams): Point3[] {
  const yaw = f.hullYaw + f.pivot;
  const c = icos(yaw);
  const s = isin(yaw);
  const fwd = t.halfLen + 150;
  const side = Math.trunc((t.halfWid * 8) / 10);
  const h = f.y + 450 + Math.trunc((f.lift * 6) / 10);
  const pts: Point3[] = [];
  for (const lat of [-side, 0, side]) {
    pts.push({ x: f.x + trigMul(fwd, c) - trigMul(lat, s), y: h, z: f.z + trigMul(fwd, s) + trigMul(lat, c) });
  }
  return pts;
}

/** Czy kula (p, r) dotyka hurtboxów zawodnika (kadłub + wieża). */
export function pointHitsFighter(p: Point3, r: number, f: FighterState, t: TankParams): boolean {
  const yaw = f.hullYaw + f.pivot;
  const c = icos(yaw);
  const s = isin(yaw);
  const dx = p.x - f.x;
  const dz = p.z - f.z;
  const lx = trigMul(dx, c) + trigMul(dz, s);
  const lz = -trigMul(dx, s) + trigMul(dz, c);
  const top = hullTop(f, t);
  if (Math.abs(lx) <= t.halfLen + r && Math.abs(lz) <= t.halfWid + r && p.y >= f.y + 100 - r && p.y <= top + r) {
    return true;
  }
  const tr = t.turretRadius + r;
  return Math.abs(lx - t.turretOffset) <= tr && Math.abs(lz) <= tr && p.y >= top - r && p.y <= top + t.turretHeight + r;
}
