// Kompilacja danych „ludzkich” (/src/data) do jednostek symulacji (mm, setne stopnia, klatki).
// Liczby zmiennoprzecinkowe pojawiają się WYŁĄCZNIE tutaj i są od razu zaokrąglane.
import { MOVES } from '../data/moves';
import { PROJECTILES, type ProjectileDef } from '../data/projectiles';
import { TANKS } from '../data/tanks';
import { BUTTON_BITS } from './input';
import type { MoveDef, TankDef } from './types';

/**
 * Skala gry: przyspieszenia z tabeli czołgów są „realistyczne”; mnożnik ten przenosi je
 * do fantastycznej skali bijatyki (patrz DECISIONS.md). Proporcje między czołgami zostają.
 */
export const ACCEL_SCALE = 3.0;
/** Grawitacja (mm/klatkę²). */
export const GRAVITY = 30;
export const REF_MASS = 35000; // kg
/** Przyspieszenie kątowe kadłuba (°/s²) dla masy referencyjnej 35 t. */
export const BODY_ACCEL = 6000;
export const BODY_MAX_VEL = 900;
/** Salto kadłuba (°/s, °/s²) i młynek na lufie – dla 35 t. */
export const FLIP_MAX_VEL = 560;
export const FLIP_ACCEL = 9000;
export const SPIN_MAX_VEL = 2400;
export const SPIN_ACCEL = 30000;
/** Globalne skrócenie faz „przytrzymania” – tempo gry. */
export const HOLD_SCALE = 0.5;

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
  bodyPitch: number | null;
  hullSpin: number | null;
  plant: boolean;
  fire: 'shot' | 'blast' | 'hook' | null;
  spawn: number;
  teleport: number | null;
  invuln: number;
  recoil: number;
  leap: number | null;
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
  /** Indeks pierwszej aktywnej klatki kluczowej – od niej można przejść do następnego ciosu. */
  cancelKey: number;
  /** Ruch dostępny dla tego czołgu (specjalne mają właściciela). */
  allowed: boolean;
  /** Zasięg fali uderzeniowej (mm). */
  reach: number;
  chains: { bit: number; dir: CompiledChainDir; to: number }[];
}

export type CompiledChainDir = import('./input').RelDir | null;

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
  flipMaxVel: number;
  flipAccel: number;
  spinMaxVel: number;
  spinAccel: number;
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
  projectiles: CompiledProjectile[];
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
    cancelKey: Math.max(0, m.keys.findIndex((k) => k.active || k.spawn !== undefined)),
    allowed: !m.owner || m.owner === tank.id,
    reach: mm(m.reach ?? 1.4),
    chains: (m.chains ?? []).map((c) => ({ bit: BUTTON_BITS[c.button], dir: c.dir ?? null, to: MOVES.findIndex((x) => x.id === c.to) })),
    keys: m.keys.map((k) => ({
      yaw: k.yaw === undefined ? null : cd(k.yaw),
      pitch: k.pitch === undefined ? null : cd(Math.max(tank.pitchMin, Math.min(tank.pitchMax, k.pitch))),
      ext: k.ext === undefined ? null : mm(k.ext * tank.extRange),
      lift: k.lift === undefined ? null : cd(k.lift),
      pivot: k.pivot === undefined ? null : cd(k.pivot),
      impulse: Math.round((mm(perFrame(k.impulse ?? 0)) * kickScale) / 1000),
      vyImpulse: mm(perFrame(k.vyImpulse ?? 0)),
      active: k.active ?? false,
      hold: Math.round((k.hold ?? 0) * inertia * HOLD_SCALE),
      // Limit czasu fazy to tylko zabezpieczenie – cięższy czołg potrzebuje go więcej.
      timeout: Math.round((k.timeout ?? 30) * inertia * 2),
      untilLanding: k.untilLanding ?? false,
      slam: k.slam ?? k.active ?? false,
      bodyPitch: k.bodyPitch === undefined ? null : cd(k.bodyPitch),
      hullSpin: k.hullSpin === undefined ? null : cd(k.hullSpin),
      plant: k.plant ?? false,
      leap: k.leap === undefined ? null : mm(k.leap),
      fire: k.fire ?? null,
      spawn: k.spawn === undefined ? -1 : PROJECTILES.findIndex((p) => p.id === k.spawn),
      teleport: k.teleport === undefined ? null : mm(k.teleport),
      invuln: k.invuln ?? 0,
      recoil: Math.round((mm(perFrame(k.recoil ?? 0)) * kickScale) / 1000),
    })),
  };
}

export interface CompiledProjectile {
  def: ProjectileDef;
  index: number;
  speed: number;
  radius: number;
  life: number;
  /** Dane trafienia w formie ruchu – wspólna obsługa z ciosami. */
  hit: CompiledMove;
}

function compileProjectile(p: ProjectileDef, index: number, tank: TankDef, kickScale: number): CompiledProjectile {
  const hitDef: MoveDef = {
    id: `proj_${p.id}`, name: p.name, desc: '', input: { sequence: [], button: 'HP', window: 1 }, stance: [],
    level: p.level, kind: 'linear', source: 'shot', damage: p.damage, hitstun: p.hitstun, blockstun: p.blockstun,
    knockback: p.knockback, knockdown: p.knockdown, hitstop: p.hitstop, recoveryPad: 0, keys: [],
  };
  return {
    def: p,
    index,
    speed: mm(perFrame(p.speed)),
    radius: mm(p.radius),
    life: p.life,
    hit: compileMove(hitDef, -1, tank, kickScale),
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
    // Akrobacje całego kadłuba (salto, młynek) – też zależne od masy.
    flipMaxVel: Math.round(cd(perFrame(FLIP_MAX_VEL)) * Math.sqrt(massRatio)),
    flipAccel: Math.max(1, Math.round(cd(perFrame2(FLIP_ACCEL)) * massRatio)),
    spinMaxVel: Math.round(cd(perFrame(SPIN_MAX_VEL)) * Math.sqrt(massRatio)),
    spinAccel: Math.max(1, Math.round(cd(perFrame2(SPIN_ACCEL)) * massRatio)),
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
    projectiles: PROJECTILES.map((p, i) => compileProjectile(p, i, def, kickScale)),
  };
}

export const TANK_PARAMS: TankParams[] = TANKS.map(compileTank);
export const MOVE_INDEX: Record<string, number> = Object.fromEntries(MOVES.map((m, i) => [m.id, i]));
