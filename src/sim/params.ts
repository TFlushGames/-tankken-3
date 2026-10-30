// Kompilacja danych „ludzkich” (/src/data) do jednostek symulacji (mm, setne stopnia, klatki).
// Liczby zmiennoprzecinkowe pojawiają się WYŁĄCZNIE tutaj i są od razu zaokrąglane.
import { MOVES } from '../data/moves';
import { TANKS } from '../data/tanks';
import type { MoveDef, TankDef } from './types';

/**
 * Skala gry: przyspieszenia z tabeli czołgów są „realistyczne”; mnożnik ten przenosi je
 * do fantastycznej skali bijatyki (patrz DECISIONS.md). Proporcje między czołgami zostają.
 */
export const ACCEL_SCALE = 1.0;
/** Grawitacja (mm/klatkę²). */
export const GRAVITY = 18;
export const REF_MASS = 35000; // kg
/** Przyspieszenie kątowe kadłuba (°/s²) dla masy referencyjnej 35 t. */
export const BODY_ACCEL = 2200;
export const BODY_MAX_VEL = 480;

const mm = (m: number): number => Math.round(m * 1000);
const cd = (deg: number): number => Math.round(deg * 100);
const perFrame = (perSec: number): number => perSec / 60;
const perFrame2 = (perSec2: number): number => perSec2 / 3600;

export interface CompiledKey {
  yaw: number | null;
  pitch: number | null;
  ext: number | null;
  lift: number | null;
  pivot: number | null;
  impulse: number;
  vyImpulse: number;
  active: boolean;
  hold: number;
  timeout: number;
  untilLanding: boolean;
  slam: boolean;
}

export interface CompiledMove {
  def: MoveDef;
  index: number;
  damage: number;
  knockback: number;
  launch: number;
  keys: CompiledKey[];
  maxHits: number;
  rehit: number;
  radius: number;
}

export interface TankParams {
  def: TankDef;
  index: number;
  mass: number;
  walk: number;
  back: number;
  run: number;
  accel: number;
  turretMaxVel: number;
  turretAccel: number;
  pitchMaxVel: number;
  pitchAccel: number;
  pitchMin: number;
  pitchMax: number;
  extRange: number;
  extMaxVel: number;
  extAccel: number;
  liftMaxVel: number;
  liftAccel: number;
  pivotMaxVel: number;
  pivotAccel: number;
  barrelLength: number;
  barrelRadius: number;
  jumpVel: number;
  jumpSquat: number;
  halfLen: number;
  halfWid: number;
  hullHeight: number;
  turretHeight: number;
  turretRadius: number;
  turretOffset: number;
  crouchDrop: number;
  hullTurn: number;
  /** Współczynnik impulsów kadłuba w promilach (lżejszy = mocniejsze szarpnięcie). */
  kickScale: number;
  moves: CompiledMove[];
}

function compileMove(def: MoveDef, index: number, tank: TankDef, kickScale: number): CompiledMove {
  // Czas „przytrzymania” fazy skaluje się bezwładnością (√masy), jak czas ruchu napędów.
  const inertia = Math.sqrt(tank.mass / (REF_MASS / 1000));
  const o = tank.moveOverrides?.[def.id];
  const m: MoveDef = o ? { ...def, ...o } : def;
  return {
    def: m,
    index,
    damage: Math.round(m.damage * tank.damageMult),
    knockback: mm(perFrame(m.knockback)),
    launch: mm(perFrame(m.launch ?? 0)),
    maxHits: m.maxHits ?? 1,
    rehit: m.rehit ?? 0,
    radius: mm(m.radius ?? tank.barrelRadius),
    keys: m.keys.map((k) => ({
      yaw: k.yaw === undefined ? null : cd(k.yaw),
      pitch: k.pitch === undefined ? null : cd(Math.max(tank.pitchMin, Math.min(tank.pitchMax, k.pitch))),
      ext: k.ext === undefined ? null : mm(k.ext * tank.extRange),
      lift: k.lift === undefined ? null : cd(k.lift),
      pivot: k.pivot === undefined ? null : cd(k.pivot),
      impulse: Math.round((mm(perFrame(k.impulse ?? 0)) * kickScale) / 1000),
      vyImpulse: mm(perFrame(k.vyImpulse ?? 0)),
      active: k.active ?? false,
      hold: Math.round((k.hold ?? 0) * inertia),
      timeout: k.timeout ?? 30,
      untilLanding: k.untilLanding ?? false,
      slam: k.slam ?? k.active ?? false,
    })),
  };
}

function compileTank(def: TankDef, index: number): TankParams {
  const massRatio = REF_MASS / (def.mass * 1000);
  const kickScale = Math.round(1000 * Math.sqrt(massRatio));
  const jumpVel = Math.round(Math.sqrt(2 * GRAVITY * mm(def.jumpHeight)));
  const walk = mm(perFrame(def.walk));
  // „Mięśnie” kadłuba (uniesienie, piwot): ta sama siła napędu, więc przyspieszenie ~ 1/masa.
  const bodyAccel = Math.max(1, Math.round(cd(perFrame2(BODY_ACCEL * ACCEL_SCALE)) * massRatio));
  const bodyVel = Math.round(cd(perFrame(BODY_MAX_VEL)) * Math.sqrt(massRatio));
  return {
    def,
    index,
    mass: def.mass * 1000,
    walk,
    back: mm(perFrame(def.back)),
    run: mm(perFrame(def.run)),
    accel: Math.max(1, Math.round(walk / def.inertiaFrames)),
    turretMaxVel: cd(perFrame(def.turretMaxVel)),
    turretAccel: Math.max(1, cd(perFrame2(def.turretAccel * ACCEL_SCALE))),
    pitchMaxVel: cd(perFrame(def.pitchMaxVel)),
    pitchAccel: Math.max(1, cd(perFrame2(def.pitchAccel * ACCEL_SCALE))),
    pitchMin: cd(def.pitchMin),
    pitchMax: cd(def.pitchMax),
    extRange: mm(def.extRange),
    extMaxVel: mm(perFrame(def.extMaxVel)),
    extAccel: Math.max(1, mm(perFrame2(def.extAccel))),
    liftMaxVel: bodyVel,
    liftAccel: bodyAccel,
    pivotMaxVel: Math.round(bodyVel * 1.6),
    pivotAccel: Math.round(bodyAccel * 3),
    barrelLength: mm(def.barrelLength),
    barrelRadius: mm(def.barrelRadius),
    jumpVel,
    jumpSquat: def.jumpSquat,
    halfLen: mm(def.hullLength / 2),
    halfWid: mm(def.hullWidth / 2),
    hullHeight: mm(def.hullHeight),
    turretHeight: mm(def.turretHeight),
    turretRadius: mm(def.turretRadius),
    turretOffset: mm(def.turretOffset),
    crouchDrop: mm(def.crouchDrop),
    hullTurn: cd(perFrame(def.hullTurnRate)),
    kickScale,
    moves: MOVES.map((m, i) => compileMove(m, i, def, kickScale)),
  };
}

export const TANK_PARAMS: TankParams[] = TANKS.map(compileTank);
export const MOVE_INDEX: Record<string, number> = Object.fromEntries(MOVES.map((m, i) => [m.id, i]));
