// Deterministyczna symulacja walki: step(state, inputP1, inputP2) -> state.
// Wyłącznie arytmetyka całkowita, bez DOM, bez three.js, bez Math.random i czasu rzeczywistego.
import {
  ARENA_RADIUS, EV_BLOCK, EV_FIGHT, EV_HIT, EV_JUMP, EV_KO, EV_LAND, EV_ROUND, EV_SHOT, EV_TECH,
  EV_THROW, EV_TIMEUP, EV_WALL, EV_WHOOSH, FIGHT_CALL_FRAME, GETUP_FRAMES, HIST_LEN, INTRO_FRAMES,
  KNOCKDOWN_FRAMES, KO_FRAMES, PH_FIGHT, PH_INTRO, PH_KO, PH_MATCH_END, RUN_MAX, SIDESTEP_INVULN,
  SIDESTEP_PROFILE, ST_AIR, ST_AIRHIT, ST_ATTACK, ST_BLOCKSTUN, ST_CROUCH, ST_GETUP, ST_HITSTUN,
  ST_IDLE, ST_JUMPSQUAT, ST_KNOCKDOWN, ST_KO, ST_LAND, ST_RUN, ST_SIDESTEP, ST_THROWING, ST_THROWN,
  ST_WIN, THROW_ACTIVE, THROW_FLIGHT, THROW_RANGE, THROW_RECOVERY, THROW_STARTUP, THROW_TECH,
} from './constants';
import { approach, clamp, iatan2, icos, isin, isqrt, signedAngle, trigMul } from './fixed';
import { barrelPoints, barrelTip, hullFrontPoints, pointHitsFighter, type Point3 } from './geometry';
import {
  BUTTON_BITS, IN_BLOCK, IN_LP, IN_RUN, IN_SS_IN, IN_SS_OUT, REL_B, REL_D, REL_F, REL_U, dirMatches,
  relDirBits,
} from './input';
import { GRAVITY, MOVE_INDEX, REF_MASS, TANK_PARAMS, type CompiledMove, type TankParams } from './params';
import { nextRandom } from './rng';
import type { FighterState, GameState, MatchOptions, MoveStance } from './types';

const BUTTON_MASK = 0xff0;
const THROW_MOVE = MOVE_INDEX['throw']!;
/** Podbicie przy trafieniu w powietrzu (mm/klatkę). */
const JUGGLE_LIFT = 330;

// Tolerancje osiągnięcia celu przez napędy.
const TOL_YAW = 250;
const TOL_PITCH = 300;
const TOL_EXT = 40;
const TOL_LIFT = 150;
const TOL_PIVOT = 250;

export function createFighter(tank: number, side: number): FighterState {
  const hist: number[] = [];
  for (let i = 0; i < HIST_LEN; i++) hist.push(0);
  return {
    tank,
    x: side === 0 ? -4500 : 4500,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    hullYaw: side === 0 ? 0 : 18000,
    turretYaw: 0,
    turretVel: 0,
    pitch: 0,
    pitchVel: 0,
    ext: 0,
    extVel: 0,
    lift: 0,
    liftVel: 0,
    pivot: 0,
    pivotVel: 0,
    susp: 0,
    suspVel: 0,
    state: ST_IDLE,
    stateFrame: 0,
    move: -1,
    moveKey: 0,
    keyFrame: 0,
    moveFrame: 0,
    moveBaseYaw: 0,
    hitsDone: 0,
    rehitTimer: 0,
    moveConnected: 0,
    airAttackUsed: 0,
    hp: 1000,
    run: RUN_MAX,
    stun: 0,
    invuln: 0,
    linearInvuln: 0,
    facingRight: side === 0 ? 1 : 0,
    crouching: 0,
    blocking: 0,
    jumpDir: 0,
    sideDir: 0,
    juggleCount: 0,
    combo: 0,
    techWindow: 0,
    tipX: 0,
    tipY: 0,
    tipZ: 0,
    throwSX: 0,
    throwSZ: 0,
    throwEX: 0,
    throwEZ: 0,
    idleFrames: 0,
    bounces: 0,
    chainBuf: 0,
    chainTimer: 0,
    prevInput: 0,
    histHead: 0,
    hist,
    wins: 0,
  };
}

export const DEFAULT_OPTS: MatchOptions = { training: 0, roundsToWin: 2, roundFrames: 90 * 60 };

export function createMatch(tank1: number, tank2: number, seed: number, opts: Partial<MatchOptions> = {}): GameState {
  const o: MatchOptions = { ...DEFAULT_OPTS, ...opts };
  return {
    frame: 0,
    seed: seed >>> 0 || 1,
    phase: o.training ? PH_FIGHT : PH_INTRO,
    phaseFrame: 0,
    round: 1,
    timer: o.roundFrames,
    hitstop: 0,
    slowmo: 0,
    camRight: 0,
    winner: -1,
    roundWinner: -1,
    opts: o,
    fighters: [createFighter(tank1, 0), createFighter(tank2, 1)],
    events: [],
  };
}

function resetRound(s: GameState): void {
  for (let i = 0; i < 2; i++) {
    const old = s.fighters[i]!;
    const f = createFighter(old.tank, i);
    f.wins = old.wins;
    s.fighters[i] = f;
  }
  s.round++;
  s.phase = PH_INTRO;
  s.phaseFrame = 0;
  s.timer = s.opts.roundFrames;
  s.hitstop = 0;
  s.slowmo = 0;
  s.camRight = 0;
  s.roundWinner = -1;
}

function emit(s: GameState, type: number, actor: number, p: Point3, power: number): void {
  s.events.push({ type, frame: s.frame, actor, x: p.x, y: p.y, z: p.z, power });
}

function setState(f: FighterState, st: number): void {
  f.state = st;
  f.stateFrame = 0;
}

function tankOf(f: FighterState): TankParams {
  return TANK_PARAMS[f.tank]!;
}

/**
 * Napęd z ograniczeniem prędkości i przyspieszenia.
 * Zwykle hamuje przed celem; w trybie `slam` (faza aktywna ciosu) przyspiesza do końca
 * i przelatuje przez cel – pęd trzeba potem wytracić, co tworzy recovery.
 */
function drive(pos: number, vel: number, target: number, maxV: number, acc: number, slam = false): [number, number] {
  const err = target - pos;
  if (slam) {
    const v = approach(vel, err > 0 ? maxV : err < 0 ? -maxV : vel, acc);
    return [pos + v, v];
  }
  const brake = isqrt(2 * acc * Math.abs(err));
  let desired = Math.min(maxV, brake);
  if (err < 0) desired = -desired;
  let v = approach(vel, desired, acc);
  if (Math.abs(err) <= acc && Math.abs(v) <= acc * 2) {
    return [target, 0];
  }
  // Nie przeskakuj celu w jednej klatce.
  if ((err > 0 && v > err) || (err < 0 && v < err)) v = err;
  return [pos + v, v];
}

/** Najbliższy odpowiednik kąta `a` w „rozwiniętym” układzie wieży względem bieżącej wartości. */
function nearestUnwrapped(current: number, a: number): number {
  return current + signedAngle(a - current);
}

function aimAngle(f: FighterState, o: FighterState): number {
  return iatan2(o.z - f.z, o.x - f.x);
}

function yawSign(f: FighterState): number {
  return f.facingRight ? -1 : 1;
}

function grounded(f: FighterState): boolean {
  return f.y <= 0 && f.state !== ST_AIR && f.state !== ST_AIRHIT && f.state !== ST_JUMPSQUAT;
}

function axisVel(f: FighterState, aim: number): [number, number] {
  const c = icos(aim);
  const s = isin(aim);
  return [trigMul(f.vx, c) + trigMul(f.vz, s), -trigMul(f.vx, s) + trigMul(f.vz, c)];
}

function setAxisVel(f: FighterState, aim: number, along: number, perp: number): void {
  const c = icos(aim);
  const s = isin(aim);
  f.vx = trigMul(along, c) - trigMul(perp, s);
  f.vz = trigMul(along, s) + trigMul(perp, c);
}

// ---------------------------------------------------------------- bufor wejść

function recordInput(f: FighterState, input: number): void {
  f.histHead = (f.histHead + 1) % HIST_LEN;
  f.hist[f.histHead] = (relDirBits(input, f.facingRight === 1) << 12) | (input & BUTTON_MASK);
}

function histRel(f: FighterState, ago: number): number {
  return f.hist[(f.histHead - ago + HIST_LEN * 2) % HIST_LEN]! >> 12;
}

/** Dopasowanie sekwencji kierunków (od końca) w oknie klatek. Gotowe na kombosy typu D, B, HP. */
function sequenceMatches(f: FighterState, move: CompiledMove): boolean {
  const seq = move.def.input.sequence;
  if (seq.length === 0) return true;
  const strict = move.def.input.strict ?? false;
  let idx = seq.length - 1;
  const window = move.def.input.window;
  for (let ago = 0; ago < window + 8 * (seq.length - 1) && ago < HIST_LEN; ago++) {
    if (dirMatches(histRel(f, ago), seq[idx]!, strict)) {
      if (idx === 0) return true;
      idx--;
    } else if (idx === seq.length - 1 && ago >= window) {
      return false;
    }
  }
  return false;
}

function stanceOf(f: FighterState): MoveStance | null {
  switch (f.state) {
    case ST_IDLE:
      return 'stand';
    case ST_CROUCH:
      return 'crouch';
    case ST_RUN:
      return 'run';
    case ST_AIR:
      return f.airAttackUsed ? null : 'air';
    default:
      return null;
  }
}

function findMove(f: FighterState, o: FighterState, pressed: number): CompiledMove | null {
  const stance = stanceOf(f);
  if (stance === null) return null;
  const t = tankOf(f);
  for (const m of t.moves) {
    if (m.def.chainOnly) continue;
    if (!(pressed & BUTTON_BITS[m.def.input.button])) continue;
    if (!m.def.stance.includes(stance)) continue;
    // Rzut tylko z bliska – w przeciwnym razie zwykłe dźgnięcie.
    if (m.index === THROW_MOVE && frontGap(f, o) > THROW_RANGE + 400) continue;
    if (sequenceMatches(f, m)) return m;
  }
  return null;
}

// ---------------------------------------------------------------- ataki

function startMove(s: GameState, i: number, m: CompiledMove): void {
  const f = s.fighters[i]!;
  const o = s.fighters[1 - i]!;
  const wasAir = f.state === ST_AIR;
  if (m.index === THROW_MOVE) {
    setState(f, ST_THROWING);
    f.move = m.index;
    f.moveConnected = 0;
    f.blocking = 0;
    return;
  }
  setState(f, ST_ATTACK);
  f.chainBuf = 0;
  f.chainTimer = 0;
  f.move = m.index;
  f.moveKey = 0;
  f.keyFrame = 0;
  f.moveFrame = 0;
  f.hitsDone = 0;
  f.rehitTimer = 0;
  f.moveConnected = 0;
  f.blocking = 0;
  f.crouching = m.def.stance.includes('crouch') && f.crouching ? 1 : 0;
  if (wasAir) f.airAttackUsed = 1;
  const aim = aimAngle(f, o);
  f.moveBaseYaw = nearestUnwrapped(f.turretYaw, aim - f.hullYaw - f.pivot);
  enterKey(s, i);
}

/**
 * Łańcuchy kombo: przycisk wciśnięty w trakcie ataku jest buforowany, a od pierwszej
 * aktywnej fazy ruch przechodzi płynnie w kolejny – wieża zachowuje swój pęd.
 */
function tryChain(s: GameState, i: number, pressed: number, rel: number): void {
  const f = s.fighters[i]!;
  const m = tankOf(f).moves[f.move]!;
  if (!m.chains.length) return;
  if (pressed) {
    f.chainBuf = pressed;
    f.chainTimer = 14;
  } else if (f.chainTimer > 0 && --f.chainTimer === 0) f.chainBuf = 0;
  if (!f.chainBuf || f.moveKey < m.cancelKey) return;
  for (const c of m.chains) {
    if (!(f.chainBuf & c.bit) || c.to < 0) continue;
    if (c.dir !== null && !dirMatches(rel, c.dir, false)) continue;
    f.chainBuf = 0;
    f.chainTimer = 0;
    startMove(s, i, tankOf(f).moves[c.to]!);
    return;
  }
}

function enterKey(s: GameState, i: number): void {
  const f = s.fighters[i]!;
  const t = tankOf(f);
  const m = t.moves[f.move]!;
  const k = m.keys[f.moveKey];
  if (!k) return;
  f.keyFrame = 0;
  const aim = aimAngle(f, s.fighters[1 - i]!);
  if (k.impulse !== 0) {
    const [along, perp] = axisVel(f, aim);
    setAxisVel(f, aim, along + k.impulse, perp);
  }
  if (k.vyImpulse !== 0) f.vy += k.vyImpulse;
  if (k.active) emit(s, EV_WHOOSH, i, barrelTip(f, t), m.damage);
}

/** Cel napędów w bieżącej fazie ataku (null = pozycja spoczynkowa). */
function moveTargets(f: FighterState, t: TankParams, rest: Targets): Targets {
  const m = t.moves[f.move]!;
  const k = m.keys[f.moveKey];
  if (!k) return rest;
  const sign = yawSign(f);
  return {
    yaw: k.yaw === null ? rest.yaw : f.moveBaseYaw + k.yaw * sign,
    pitch: k.pitch === null ? rest.pitch : k.pitch,
    ext: k.ext === null ? 0 : k.ext,
    lift: k.lift === null ? 0 : k.lift,
    pivot: k.pivot === null ? 0 : k.pivot * sign,
    slam: k.slam,
  };
}

interface Targets {
  yaw: number;
  pitch: number;
  ext: number;
  lift: number;
  pivot: number;
  slam: boolean;
}

function near(err: number, vel: number, tol: number, slam: boolean): boolean {
  // W trybie `slam` cel jest osiągnięty, gdy napęd go mija (lub minie w tej klatce).
  return Math.abs(err) <= (slam ? Math.max(tol, Math.abs(vel)) : tol);
}

function reached(f: FighterState, tg: Targets, k: CompiledMove['keys'][number]): boolean {
  const sl = k.slam;
  if (k.yaw !== null && !near(tg.yaw - f.turretYaw, f.turretVel, TOL_YAW, sl)) return false;
  if (k.pitch !== null && !near(tg.pitch - f.pitch, f.pitchVel, TOL_PITCH, sl)) return false;
  if (k.ext !== null && !near(tg.ext - f.ext, f.extVel, TOL_EXT, sl)) return false;
  if (k.lift !== null && !near(tg.lift - f.lift, f.liftVel, TOL_LIFT, sl)) return false;
  if (k.pivot !== null && !near(tg.pivot - f.pivot, f.pivotVel, TOL_PIVOT, sl)) return false;
  return true;
}

function settled(f: FighterState, tg: Targets, t: TankParams): boolean {
  return (
    Math.abs(tg.yaw - f.turretYaw) <= TOL_YAW * 2 &&
    Math.abs(f.turretVel) <= t.turretAccel * 2 &&
    Math.abs(tg.pitch - f.pitch) <= TOL_PITCH * 2 &&
    Math.abs(f.ext) <= TOL_EXT * 2 &&
    Math.abs(f.lift) <= TOL_LIFT * 2 &&
    Math.abs(f.pivot) <= TOL_PIVOT * 2
  );
}

/** Postęp ataku: przejścia między klatkami kluczowymi na podstawie osiągnięcia celu. */
function advanceMove(s: GameState, i: number, tg: Targets): void {
  const f = s.fighters[i]!;
  const t = tankOf(f);
  const m = t.moves[f.move]!;
  f.moveFrame++;
  f.keyFrame++;
  if (f.rehitTimer > 0) f.rehitTimer--;
  const k = m.keys[f.moveKey];
  if (k) {
    let done: boolean;
    if (k.untilLanding) done = f.y <= 0 && f.vy <= 0 && f.keyFrame > 1;
    else done = f.keyFrame >= k.hold && reached(f, tg, k);
    if (f.keyFrame >= k.timeout) done = true;
    if (done) {
      f.moveKey++;
      enterKey(s, i);
    }
    return;
  }
  if (f.moveKey === m.keys.length) {
    if (settled(f, tg, t) || f.keyFrame > 90) {
      f.moveKey++;
      f.keyFrame = 0;
    }
    return;
  }
  if (f.keyFrame >= m.def.recoveryPad) endMove(f);
}

function endMove(f: FighterState): void {
  f.move = -1;
  f.turretYaw = signedAngle(f.turretYaw);
  f.moveBaseYaw = 0;
  if (f.y > 0) {
    setState(f, ST_AIR);
  } else {
    setState(f, f.crouching ? ST_CROUCH : ST_IDLE);
  }
}

function isActive(f: FighterState): CompiledMove | null {
  if (f.state !== ST_ATTACK || f.move < 0) return null;
  const m = tankOf(f).moves[f.move]!;
  const k = m.keys[f.moveKey];
  if (!k || !k.active) return null;
  if (f.hitsDone >= m.maxHits || f.rehitTimer > 0) return null;
  return m;
}

// ---------------------------------------------------------------- logika stanów

function canAct(f: FighterState): boolean {
  return f.state === ST_IDLE || f.state === ST_CROUCH || f.state === ST_RUN;
}

function updateFighter(s: GameState, i: number, input: number): void {
  const f = s.fighters[i]!;
  const o = s.fighters[1 - i]!;
  const t = tankOf(f);
  const aim = aimAngle(f, o);
  const rel = relDirBits(input, f.facingRight === 1);
  const pressed = input & ~f.prevInput & BUTTON_MASK;
  f.stateFrame++;
  if (f.invuln > 0) f.invuln--;
  if (f.linearInvuln > 0) f.linearInvuln--;

  // Ataki mają pierwszeństwo.
  if (canAct(f) || f.state === ST_AIR) {
    const m = findMove(f, o, pressed);
    if (m) startMove(s, i, m);
  } else if (f.state === ST_ATTACK && f.move >= 0) {
    tryChain(s, i, pressed, rel);
  }

  let desiredAlong = 0;
  let controlVel = false;
  const blockHeld = (input & IN_BLOCK) !== 0;

  switch (f.state) {
    case ST_IDLE:
    case ST_CROUCH: {
      f.blocking = blockHeld ? 1 : 0;
      const wantCrouch = (rel & REL_D) !== 0;
      if (pressed & (IN_SS_IN | IN_SS_OUT)) {
        setState(f, ST_SIDESTEP);
        f.sideDir = pressed & IN_SS_IN ? -1 : 1;
        f.linearInvuln = SIDESTEP_INVULN;
        f.blocking = 0;
        break;
      }
      if (rel & REL_U && !f.blocking) {
        setState(f, ST_JUMPSQUAT);
        f.jumpDir = rel & REL_F ? 1 : rel & REL_B ? -1 : 0;
        f.crouching = 0;
        break;
      }
      if (wantCrouch !== (f.state === ST_CROUCH)) setState(f, wantCrouch ? ST_CROUCH : ST_IDLE);
      f.crouching = wantCrouch ? 1 : 0;
      controlVel = true;
      const turning = Math.abs(signedAngle(aim - f.hullYaw)) > 6000;
      if (!f.crouching && !f.blocking && !turning) {
        if (rel & REL_F) {
          if (input & IN_RUN && f.run > 50) {
            setState(f, ST_RUN);
            desiredAlong = t.run;
          } else desiredAlong = t.walk;
        } else if (rel & REL_B) desiredAlong = -t.back;
      }
      break;
    }
    case ST_RUN: {
      f.blocking = 0;
      controlVel = true;
      if (!(rel & REL_F) || !(input & IN_RUN) || f.run <= 0) {
        setState(f, ST_IDLE);
        desiredAlong = t.walk;
      } else {
        desiredAlong = t.run;
        f.run = Math.max(0, f.run - 8);
      }
      break;
    }
    case ST_JUMPSQUAT: {
      if (f.stateFrame >= t.jumpSquat) {
        setState(f, ST_AIR);
        f.airAttackUsed = 0;
        f.vy = t.jumpVel;
        const along = f.jumpDir > 0 ? Math.trunc((t.walk * 24) / 10) : f.jumpDir < 0 ? -Math.trunc((t.walk * 15) / 10) : 0;
        setAxisVel(f, aim, along, 0);
        emit(s, EV_JUMP, i, f, t.mass);
      }
      break;
    }
    case ST_LAND:
      controlVel = true;
      if (f.stateFrame >= 3 + Math.trunc(t.mass / 15000)) setState(f, ST_IDLE);
      break;
    case ST_SIDESTEP: {
      const idx = f.stateFrame - 1;
      if (idx >= SIDESTEP_PROFILE.length) {
        setState(f, ST_IDLE);
        f.vx = 0;
        f.vz = 0;
        break;
      }
      const scale = clamp(t.kickScale, 850, 1150);
      const v = Math.trunc((SIDESTEP_PROFILE[idx]! * scale) / 1000);
      const dirAng = s.camRight + (f.sideDir < 0 ? -9000 : 9000);
      f.vx = trigMul(v, icos(dirAng));
      f.vz = trigMul(v, isin(dirAng));
      break;
    }
    case ST_ATTACK:
      break;
    case ST_BLOCKSTUN:
      f.blocking = 1;
      if (--f.stun <= 0) setState(f, f.crouching ? ST_CROUCH : ST_IDLE);
      break;
    case ST_HITSTUN:
      f.blocking = 0;
      if (--f.stun <= 0) {
        setState(f, ST_IDLE);
        f.combo = 0;
      }
      break;
    case ST_KNOCKDOWN:
      f.blocking = 0;
      f.invuln = 2;
      if (f.hp <= 0 && !s.opts.training && f.y <= 0) {
        setState(f, ST_KO);
        break;
      }
      if (f.y <= 0 && f.stateFrame >= KNOCKDOWN_FRAMES) {
        setState(f, ST_GETUP);
        f.invuln = GETUP_FRAMES + 6;
      }
      break;
    case ST_GETUP:
      if (f.stateFrame >= GETUP_FRAMES) {
        setState(f, ST_IDLE);
        f.combo = 0;
        f.juggleCount = 0;
      }
      break;
    case ST_THROWING:
      updateThrowing(s, i);
      break;
    case ST_THROWN:
      updateThrown(s, i, pressed);
      break;
    default:
      break;
  }

  // Pasek biegu.
  if (f.state !== ST_RUN && f.run < RUN_MAX && s.frame % 2 === 0) f.run = Math.min(RUN_MAX, f.run + 7);

  // Prędkość wzdłuż osi walki (bezwładność).
  if (controlVel && f.y <= 0) {
    const [along, perp] = axisVel(f, aim);
    const acc = f.state === ST_RUN ? Math.trunc((t.accel * 3) / 2) : t.accel;
    setAxisVel(f, aim, approach(along, desiredAlong, acc), approach(perp, 0, acc * 2));
  } else if (f.y <= 0 && f.state !== ST_SIDESTEP && f.state !== ST_THROWN) {
    // Tarcie gąsienic w stanach bez kontroli (odrzut, atak).
    const fr = f.state === ST_ATTACK ? Math.trunc(t.accel / 2) + 1 : t.accel;
    const [along, perp] = axisVel(f, aim);
    setAxisVel(f, aim, approach(along, 0, fr), approach(perp, 0, fr));
  }

  // Kadłub obraca się w stronę przeciwnika (zawracanie w miejscu po przeskoku).
  if (grounded(f) && f.state !== ST_THROWN && f.state !== ST_KNOCKDOWN && f.state !== ST_KO) {
    f.hullYaw = (f.hullYaw + clamp(signedAngle(aim - f.hullYaw), -t.hullTurn, t.hullTurn) + 36000) % 36000;
  }

  // Napędy wieży, lufy i kadłuba.
  const rest: Targets = {
    yaw: nearestUnwrapped(f.turretYaw, aim - f.hullYaw - f.pivot) + (f.blocking ? -5500 * yawSign(f) : 0),
    pitch: f.blocking ? 900 : f.crouching ? -500 : f.state === ST_KO ? -1000 : 0,
    ext: 0,
    lift: 0,
    pivot: 0,
    slam: false,
  };
  if (f.state === ST_THROWING && f.moveConnected) rest.pitch = t.pitchMax;
  const tg = f.state === ST_ATTACK ? moveTargets(f, t, rest) : rest;
  const sl = tg.slam;
  [f.turretYaw, f.turretVel] = drive(f.turretYaw, f.turretVel, tg.yaw, t.turretMaxVel, t.turretAccel, sl);
  [f.pitch, f.pitchVel] = drive(f.pitch, f.pitchVel, clamp(tg.pitch, t.pitchMin, t.pitchMax), t.pitchMaxVel, t.pitchAccel, sl);
  [f.ext, f.extVel] = drive(f.ext, f.extVel, tg.ext, t.extMaxVel, t.extAccel, sl);
  [f.lift, f.liftVel] = drive(f.lift, f.liftVel, tg.lift, t.liftMaxVel, t.liftAccel, sl);
  [f.pivot, f.pivotVel] = drive(f.pivot, f.pivotVel, tg.pivot, t.pivotMaxVel, t.pivotAccel, sl);
  // Mechaniczne ograniczniki: elewacja i wysunięcie lufy.
  if (f.pitch < t.pitchMin || f.pitch > t.pitchMax) {
    f.pitch = clamp(f.pitch, t.pitchMin, t.pitchMax);
    f.pitchVel = 0;
  }
  if (f.ext < 0 || f.ext > t.extRange) {
    f.ext = clamp(f.ext, 0, t.extRange);
    f.extVel = 0;
  }
  if (f.state === ST_ATTACK) advanceMove(s, i, tg);

  // Zawieszenie: sprężyna z tłumieniem.
  let suspTarget = f.crouching ? t.crouchDrop : 0;
  if (f.state === ST_JUMPSQUAT) suspTarget = Math.trunc((t.crouchDrop * 9) / 10);
  if (f.state === ST_KNOCKDOWN || f.state === ST_KO) suspTarget = Math.trunc(t.hullHeight / 3);
  if (f.y > 0) suspTarget = -60;
  f.suspVel += Math.trunc(((suspTarget - f.susp) * 22) / 64) - Math.trunc((f.suspVel * 6) / 16);
  f.susp = clamp(f.susp + f.suspVel, -150, Math.trunc(t.hullHeight / 2));

  f.prevInput = input;
}

// ---------------------------------------------------------------- rzuty

function frontGap(a: FighterState, b: FighterState): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return isqrt(dx * dx + dz * dz) - tankOf(a).halfLen - tankOf(b).halfLen;
}

function updateThrowing(s: GameState, i: number): void {
  const f = s.fighters[i]!;
  const o = s.fighters[1 - i]!;
  const t = tankOf(f);
  if (!f.moveConnected) {
    if (f.stateFrame >= THROW_STARTUP && f.stateFrame < THROW_STARTUP + THROW_ACTIVE) {
      const ok =
        o.y <= 0 && o.invuln === 0 && frontGap(f, o) < THROW_RANGE &&
        o.state !== ST_KNOCKDOWN && o.state !== ST_GETUP && o.state !== ST_THROWN && o.state !== ST_KO &&
        o.state !== ST_AIR && o.state !== ST_JUMPSQUAT && o.state !== ST_SIDESTEP;
      if (ok) {
        f.moveConnected = 1;
        f.stateFrame = 0;
        setState(o, ST_THROWN);
        o.techWindow = THROW_TECH;
        o.blocking = 0;
        o.move = -1;
        o.vx = 0;
        o.vz = 0;
        o.vy = 0;
        o.throwSX = o.x;
        o.throwSZ = o.z;
        const aim = aimAngle(f, o);
        const ot = tankOf(o);
        const dist = t.halfLen + ot.halfLen + 300 + Math.trunc((1800 * REF_MASS) / ot.mass) + Math.trunc(t.mass / 40);
        o.throwEX = f.x - trigMul(dist, icos(aim));
        o.throwEZ = f.z - trigMul(dist, isin(aim));
        emit(s, EV_THROW, i, o, t.mass);
      }
    } else if (f.stateFrame >= THROW_STARTUP + THROW_ACTIVE + THROW_RECOVERY) {
      f.move = -1;
      setState(f, ST_IDLE);
    }
    return;
  }
  if (o.state !== ST_THROWN && f.stateFrame > THROW_TECH + THROW_FLIGHT + 4) {
    f.move = -1;
    f.moveConnected = 0;
    setState(f, ST_IDLE);
  }
}

function updateThrown(s: GameState, i: number, pressed: number): void {
  const f = s.fighters[i]!;
  const a = s.fighters[1 - i]!;
  const at = tankOf(a);
  if (f.techWindow > 0) {
    f.techWindow--;
    if (pressed & IN_LP) {
      // Ucieczka z rzutu.
      emit(s, EV_TECH, i, f, 0);
      const aim = aimAngle(a, f);
      setState(f, ST_BLOCKSTUN);
      f.stun = 14;
      a.state = ST_BLOCKSTUN;
      a.stun = 14;
      a.move = -1;
      a.moveConnected = 0;
      f.vx = trigMul(120, icos(aim));
      f.vz = trigMul(120, isin(aim));
      a.vx = -f.vx;
      a.vz = -f.vz;
      return;
    }
    return;
  }
  const tt = f.stateFrame - THROW_TECH;
  if (tt <= THROW_FLIGHT) {
    const px = f.x;
    const pz = f.z;
    f.x = f.throwSX + Math.trunc(((f.throwEX - f.throwSX) * tt) / THROW_FLIGHT);
    f.z = f.throwSZ + Math.trunc(((f.throwEZ - f.throwSZ) * tt) / THROW_FLIGHT);
    f.y = Math.trunc((4 * 3200 * tt * (THROW_FLIGHT - tt)) / (THROW_FLIGHT * THROW_FLIGHT));
    f.vx = f.x - px;
    f.vz = f.z - pz;
    f.hullYaw = (f.hullYaw + 1100 * (a.facingRight ? 1 : -1) + 36000) % 36000;
    return;
  }
  const m = at.moves[THROW_MOVE]!;
  f.y = 0;
  f.vx = 0;
  f.vz = 0;
  applyDamage(s, i, m.damage);
  setState(f, ST_KNOCKDOWN);
  f.vy = 0;
  s.hitstop = 6;
  emit(s, EV_LAND, i, f, tankOf(f).mass * 2);
  emit(s, EV_HIT, i, f, m.damage);
}

// ---------------------------------------------------------------- trafienia

function applyDamage(s: GameState, i: number, dmg: number): void {
  const f = s.fighters[i]!;
  f.hp = Math.max(0, f.hp - dmg);
  if (s.opts.training && f.hp <= 0) f.hp = 1;
}

function speedFactor(f: FighterState, t: TankParams, m: CompiledMove): number {
  // Prędkość końca lufy / kadłuba względem maksimum czołgu → 80..120%.
  let r = 0;
  if (m.def.source === 'barrel') {
    r = Math.max(
      Math.trunc((Math.abs(f.turretVel) * 1000) / t.turretMaxVel),
      Math.trunc((Math.abs(f.pitchVel) * 1000) / t.pitchMaxVel),
      Math.trunc((Math.abs(f.extVel) * 1000) / t.extMaxVel),
    );
  } else {
    const sp = isqrt(f.vx * f.vx + f.vz * f.vz) + Math.abs(f.vy);
    r = Math.trunc((sp * 1000) / t.run);
  }
  return 800 + Math.trunc((400 * Math.min(1000, Math.trunc((r * 5) / 4))) / 1000);
}

function blockable(level: string, d: FighterState): boolean {
  if (!d.blocking) return false;
  if (d.state !== ST_IDLE && d.state !== ST_CROUCH && d.state !== ST_BLOCKSTUN) return false;
  if (d.crouching) return level === 'low' || level === 'mid';
  return level !== 'low';
}

function hitTest(s: GameState, i: number, m: CompiledMove): Point3 | null {
  const a = s.fighters[i]!;
  const d = s.fighters[1 - i]!;
  const at = tankOf(a);
  const dt = tankOf(d);
  if (d.invuln > 0 || d.state === ST_KO || d.state === ST_THROWN || d.state === ST_KNOCKDOWN || d.state === ST_GETUP) {
    return null;
  }
  if (m.def.kind === 'linear' && d.linearInvuln > 0) return null;
  if (m.def.level === 'high' && d.crouching && d.y <= 0) return null;
  if (m.def.source === 'shockwave') {
    if (a.y > 0 || d.y > 400) return null;
    const dx = d.x - a.x;
    const dz = d.z - a.z;
    const reach = at.halfLen + dt.halfLen + 1400;
    if (dx * dx + dz * dz > reach * reach) return null;
    return { x: (a.x + d.x) >> 1, y: 200, z: (a.z + d.z) >> 1 };
  }
  const pts = m.def.source === 'barrel' ? barrelPoints(a, at) : hullFrontPoints(a, at);
  const r = m.def.source === 'barrel' ? m.radius : 350;
  for (let k = pts.length - 1; k >= 0; k--) {
    const p = pts[k]!;
    if (pointHitsFighter(p, r, d, dt)) return p;
  }
  return null;
}

interface PendingHit {
  attacker: number;
  move: CompiledMove;
  point: Point3;
}

function resolveHit(s: GameState, h: PendingHit): void {
  const i = h.attacker;
  const a = s.fighters[i]!;
  const d = s.fighters[1 - i]!;
  const at = tankOf(a);
  const dt = tankOf(d);
  const m = h.move;
  const aim = aimAngle(a, d);
  const massFactor = Math.trunc(((at.mass + REF_MASS) * 1000) / (dt.mass + REF_MASS));
  a.hitsDone++;
  a.rehitTimer = m.rehit;
  a.moveConnected = 1;
  const multi = a.hitsDone < m.maxHits;
  if (!multi) {
    // Trafienie wytraca pęd – lufa się odbija.
    a.turretVel = -Math.trunc(a.turretVel / 3);
    a.pitchVel = -Math.trunc(a.pitchVel / 3);
    a.extVel = -Math.trunc(a.extVel / 2);
    if (a.move >= 0 && m.keys[a.moveKey]?.active && !m.keys[a.moveKey]!.untilLanding) {
      a.moveKey = m.keys.length;
      a.keyFrame = 0;
    }
  }
  if (m.def.id === 'hp' && at.def.twinBarrels) emit(s, EV_SHOT, i, h.point, 1);

  if (blockable(m.def.level, d)) {
    applyDamage(s, 1 - i, Math.trunc((m.damage * 15) / 100));
    setState(d, ST_BLOCKSTUN);
    d.stun = m.def.blockstun;
    const push = Math.trunc((m.knockback * massFactor) / 2000) + 20;
    const [along, perp] = axisVel(d, aim);
    setAxisVel(d, aim, Math.max(along, push), perp);
    s.hitstop = Math.max(s.hitstop, Math.max(3, m.def.hitstop - 3));
    emit(s, EV_BLOCK, i, h.point, m.damage);
    return;
  }

  let dmg = Math.trunc((m.damage * speedFactor(a, at, m)) / 1000);
  // Skalowanie obrażeń w kombo.
  if (d.combo > 0) dmg = Math.trunc((dmg * Math.max(400, 1000 - d.combo * 150)) / 1000);
  dmg = Math.max(1, dmg);
  applyDamage(s, 1 - i, dmg);
  d.combo++;
  d.blocking = 0;
  d.move = -1;
  let kb = Math.trunc((m.knockback * massFactor) / 1000);
  const airborne = d.y > 0 || d.state === ST_AIR || d.state === ST_AIRHIT;
  if (m.launch > 0 || airborne) {
    setState(d, ST_AIRHIT);
    d.bounces = 0;
    // Każde kolejne trafienie w powietrzu podbija wyżej, ale coraz słabiej.
    const jug = Math.max(250, 1000 - d.juggleCount * 150);
    const base = m.launch > 0 ? m.launch : JUGGLE_LIFT;
    const lift = Math.trunc((((base * massFactor) / 1000) * jug) / 1000);
    d.vy = m.launch > 0 ? lift : Math.max(d.vy + Math.trunc(lift / 2), lift);
    // W powietrzu odrzut jest mocniejszy – przeciwnik leci do tyłu.
    kb = Math.trunc((kb * 3) / 2) + Math.trunc((40 * massFactor) / 1000);
    d.juggleCount++;
    d.y = Math.max(d.y, 1);
  } else if (m.def.knockdown) {
    setState(d, ST_KNOCKDOWN);
    d.vy = Math.trunc((90 * massFactor) / 1000);
    d.y = 1;
  } else {
    setState(d, ST_HITSTUN);
    d.stun = m.def.hitstun;
  }
  d.crouching = 0;
  const [, perp] = axisVel(d, aim);
  setAxisVel(d, aim, kb, perp);
  d.suspVel += Math.trunc(kb / 2);
  s.hitstop = Math.max(s.hitstop, m.def.hitstop);
  emit(s, EV_HIT, i, h.point, dmg);
}

// ---------------------------------------------------------------- fizyka świata

function integrate(s: GameState, i: number): void {
  const f = s.fighters[i]!;
  const t = tankOf(f);
  if (f.state === ST_THROWN) return;
  f.x += f.vx;
  f.z += f.vz;
  if (f.y > 0 || f.vy > 0) {
    f.y += f.vy;
    f.vy -= GRAVITY;
    if (f.y <= 0) {
      const impact = -f.vy;
      f.y = 0;
      f.vy = 0;
      f.suspVel += Math.trunc(impact / 3);
      emit(s, EV_LAND, i, f, Math.trunc((t.mass * Math.min(impact, 600)) / 300));
      if (f.state === ST_AIR) setState(f, ST_LAND);
      else if (f.state === ST_AIRHIT && f.bounces === 0 && impact > 200) {
        // Odbicie od ziemi po mocnym wyrzucie – czołg podskakuje i dalej sunie do tyłu.
        f.bounces = 1;
        f.vy = Math.trunc((impact * 35) / 100);
        f.y = 1;
      } else if (f.state === ST_AIRHIT) setState(f, ST_KNOCKDOWN);
      else if (f.state === ST_ATTACK) {
        const k = t.moves[f.move]!.keys[f.moveKey];
        if (!k || !k.untilLanding) {
          f.move = -1;
          setState(f, ST_LAND);
          f.stateFrame = -4;
        }
      }
    }
  }
  // Ściany areny – odbicie.
  const lim = ARENA_RADIUS - t.halfLen;
  const d2 = f.x * f.x + f.z * f.z;
  if (d2 > lim * lim) {
    const d = isqrt(d2);
    const nx = Math.trunc((f.x * 1000) / d);
    const nz = Math.trunc((f.z * 1000) / d);
    f.x = Math.trunc((nx * lim) / 1000);
    f.z = Math.trunc((nz * lim) / 1000);
    const vn = Math.trunc((f.vx * nx + f.vz * nz) / 1000);
    if (vn > 0) {
      const bounce = f.state === ST_HITSTUN || f.state === ST_AIRHIT || f.state === ST_KNOCKDOWN ? 600 : 300;
      f.vx -= Math.trunc((vn * nx * (1000 + bounce)) / 1000000);
      f.vz -= Math.trunc((vn * nz * (1000 + bounce)) / 1000000);
      if (vn > 60) emit(s, EV_WALL, i, f, Math.trunc((vn * t.mass) / 1000));
    }
  }
}

function pushApart(s: GameState): void {
  const a = s.fighters[0];
  const b = s.fighters[1];
  if (a.state === ST_THROWN || b.state === ST_THROWN) return;
  const ta = tankOf(a);
  const tb = tankOf(b);
  // Wysoko w powietrzu można przeskoczyć nad kadłubem.
  if (a.y > Math.trunc((tb.hullHeight * 7) / 10) || b.y > Math.trunc((ta.hullHeight * 7) / 10)) return;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const minD = ta.halfLen + tb.halfLen - 200;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minD * minD) return;
  let d = isqrt(d2);
  let nx: number;
  let nz: number;
  if (d < 10) {
    nx = trigMul(1000, icos(s.camRight));
    nz = trigMul(1000, isin(s.camRight));
    d = 1;
  } else {
    nx = Math.trunc((dx * 1000) / d);
    nz = Math.trunc((dz * 1000) / d);
  }
  let overlap = minD - d;
  const total = ta.mass + tb.mass;
  let ma = Math.trunc((overlap * tb.mass) / total);
  let mb = overlap - ma;
  // Lądowanie na przeciwniku: skaczący zsuwa się na stronę, w którą leci (przeskok).
  const airA = a.y > 0;
  const airB = b.y > 0;
  if (airA !== airB) {
    const j = airA ? a : b;
    const vn = Math.trunc((j.vx * nx + j.vz * nz) / 1000) * (airA ? 1 : -1);
    if (vn > 0 && d < Math.trunc(minD / 2)) {
      // Leci „przez” przeciwnika – przerzuć na drugą stronę.
      overlap = minD + d;
      if (airA) {
        ma = -overlap;
        mb = 0;
      } else {
        mb = -overlap;
        ma = 0;
      }
    } else if (airA) {
      ma = overlap;
      mb = 0;
    } else {
      mb = overlap;
      ma = 0;
    }
  }
  a.x -= Math.trunc((nx * ma) / 1000);
  a.z -= Math.trunc((nz * ma) / 1000);
  b.x += Math.trunc((nx * mb) / 1000);
  b.z += Math.trunc((nz * mb) / 1000);
}

function updateCamera(s: GameState): void {
  const a = s.fighters[0];
  const b = s.fighters[1];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (dx * dx + dz * dz > 900 * 900) {
    const ang = iatan2(dz, dx);
    const c1 = signedAngle(ang - s.camRight);
    const c2 = signedAngle(ang + 18000 - s.camRight);
    const target = Math.abs(c1) <= Math.abs(c2) ? ang : ang + 18000;
    s.camRight = (s.camRight + signedAngle(target - s.camRight) + 36000) % 36000;
  }
  const cx = icos(s.camRight);
  const cz = isin(s.camRight);
  const proj = trigMul(dx, cx) + trigMul(dz, cz);
  // Kierunek „przód” zmienia się dopiero po wyraźnym przejściu na drugą stronę.
  if (proj > 300) {
    a.facingRight = 1;
    b.facingRight = 0;
  } else if (proj < -300) {
    a.facingRight = 0;
    b.facingRight = 1;
  }
}

// ---------------------------------------------------------------- przebieg rundy

function checkRoundEnd(s: GameState): void {
  if (s.phase !== PH_FIGHT || s.opts.training) return;
  const [a, b] = s.fighters;
  const koA = a.hp <= 0;
  const koB = b.hp <= 0;
  let timeUp = false;
  if (!koA && !koB) {
    if (s.timer > 0) return;
    timeUp = true;
  }
  s.phase = PH_KO;
  s.phaseFrame = 0;
  let w = -1;
  if (koA && !koB) w = 1;
  else if (koB && !koA) w = 0;
  else if (timeUp) w = a.hp > b.hp ? 0 : b.hp > a.hp ? 1 : -1;
  s.roundWinner = w;
  if (timeUp) emit(s, EV_TIMEUP, -1, { x: 0, y: 0, z: 0 }, 0);
  else {
    s.slowmo = 90;
    s.hitstop = 0;
  }
  for (let i = 0; i < 2; i++) {
    const f = s.fighters[i]!;
    if (f.hp <= 0) {
      if (f.state !== ST_AIRHIT) setState(f, ST_KO);
      emit(s, EV_KO, i, f, tankOf(f).mass);
    }
  }
}

function updatePhase(s: GameState): void {
  s.phaseFrame++;
  if (s.phase === PH_INTRO) {
    if (s.phaseFrame === 1) emit(s, EV_ROUND, -1, { x: 0, y: 0, z: 0 }, s.round);
    if (s.phaseFrame === FIGHT_CALL_FRAME) emit(s, EV_FIGHT, -1, { x: 0, y: 0, z: 0 }, 0);
    if (s.phaseFrame >= INTRO_FRAMES) {
      s.phase = PH_FIGHT;
      s.phaseFrame = 0;
    }
  } else if (s.phase === PH_FIGHT) {
    if (!s.opts.training && s.timer > 0) s.timer--;
  } else if (s.phase === PH_KO) {
    if (s.slowmo > 0) s.slowmo--;
    if (s.phaseFrame === 80 && s.roundWinner >= 0) {
      const w = s.fighters[s.roundWinner]!;
      if (w.state === ST_IDLE || w.state === ST_CROUCH) setState(w, ST_WIN);
    }
    if (s.phaseFrame >= KO_FRAMES) {
      if (s.roundWinner >= 0) s.fighters[s.roundWinner]!.wins++;
      const wa = s.fighters[0].wins;
      const wb = s.fighters[1].wins;
      if (wa >= s.opts.roundsToWin || wb >= s.opts.roundsToWin) {
        s.phase = PH_MATCH_END;
        s.phaseFrame = 0;
        s.winner = wa > wb ? 0 : 1;
      } else {
        resetRound(s);
      }
    }
  }
}

function trainingRefill(s: GameState): void {
  if (!s.opts.training) return;
  for (const f of s.fighters) {
    const calm = f.state === ST_IDLE || f.state === ST_CROUCH || f.state === ST_RUN;
    f.idleFrames = calm ? f.idleFrames + 1 : 0;
    if (f.idleFrames > 50 && f.hp < 1000) f.hp = Math.min(1000, f.hp + 25);
  }
}

// ---------------------------------------------------------------- krok

export function step(s: GameState, in1: number, in2: number): GameState {
  s.frame++;
  s.events.length = 0;
  [s.seed] = nextRandom(s.seed);
  const control = s.phase === PH_FIGHT;
  const inputs = [control ? in1 : 0, control ? in2 : 0];
  for (let i = 0; i < 2; i++) recordInput(s.fighters[i]!, inputs[i]!);

  updatePhase(s);
  if (s.phase === PH_MATCH_END) return s;
  if (s.hitstop > 0) {
    s.hitstop--;
    for (let i = 0; i < 2; i++) s.fighters[i]!.prevInput = inputs[i]!;
    return s;
  }
  // Zwolnione tempo K.O.: fizyka co drugą klatkę.
  if (s.slowmo > 0 && s.frame % 2 === 1) return s;

  updateCamera(s);
  for (let i = 0; i < 2; i++) {
    const f = s.fighters[i]!;
    updateFighter(s, i, f.state === ST_KO || f.state === ST_WIN ? 0 : inputs[i]!);
  }
  for (let i = 0; i < 2; i++) integrate(s, i);
  pushApart(s);

  // Trafienia liczone jednocześnie (wymiana ciosów jest możliwa).
  const hits: PendingHit[] = [];
  for (let i = 0; i < 2; i++) {
    const a = s.fighters[i]!;
    const m = isActive(a);
    if (!m) continue;
    const p = hitTest(s, i, m);
    if (p) hits.push({ attacker: i, move: m, point: p });
  }
  for (const h of hits) resolveHit(s, h);

  for (let i = 0; i < 2; i++) {
    const f = s.fighters[i]!;
    const tip = barrelTip(f, tankOf(f));
    f.tipX = tip.x;
    f.tipY = tip.y;
    f.tipZ = tip.z;
  }
  trainingRefill(s);
  checkRoundEnd(s);
  return s;
}

// ---------------------------------------------------------------- narzędzia

/** Rozpoczyna ruch bez wejścia (narzędzie frame data, testy). */
export function forceMove(s: GameState, i: number, moveId: string): void {
  const f = s.fighters[i]!;
  const m = tankOf(f).moves[MOVE_INDEX[moveId]!]!;
  if (m.def.stance.includes('air') && !m.def.stance.includes('stand')) {
    f.y = 2500;
    f.vy = 0;
    setState(f, ST_AIR);
  }
  startMove(s, i, m);
}

export function isMoveActive(f: FighterState): boolean {
  return isActive(f) !== null || (f.state === ST_THROWING && !f.moveConnected &&
    f.stateFrame >= THROW_STARTUP && f.stateFrame < THROW_STARTUP + THROW_ACTIVE);
}

