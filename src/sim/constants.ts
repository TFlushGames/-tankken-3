// Stany zawodnika, fazy meczu i typy zdarzeń.
export const ST_IDLE = 0;
export const ST_CROUCH = 1;
export const ST_JUMPSQUAT = 2;
export const ST_AIR = 3;
export const ST_LAND = 4;
export const ST_RUN = 5;
export const ST_ATTACK = 6;
export const ST_BLOCKSTUN = 7;
export const ST_HITSTUN = 8;
export const ST_AIRHIT = 9;
export const ST_KNOCKDOWN = 10;
export const ST_GETUP = 11;
export const ST_SIDESTEP = 12;
export const ST_THROWN = 13;
export const ST_THROWING = 14;
export const ST_KO = 15;
export const ST_WIN = 16;

export const STATE_NAMES = [
  'IDLE', 'CROUCH', 'JUMPSQUAT', 'AIR', 'LAND', 'RUN', 'ATTACK', 'BLOCKSTUN', 'HITSTUN',
  'AIRHIT', 'KNOCKDOWN', 'GETUP', 'SIDESTEP', 'THROWN', 'THROWING', 'KO', 'WIN',
];

export const PH_INTRO = 0;
export const PH_FIGHT = 1;
export const PH_KO = 2;
export const PH_MATCH_END = 3;

export const EV_HIT = 1;
export const EV_BLOCK = 2;
export const EV_LAND = 3;
export const EV_KO = 4;
export const EV_ROUND = 5;
export const EV_FIGHT = 6;
export const EV_THROW = 7;
export const EV_TECH = 8;
export const EV_WALL = 9;
export const EV_WHOOSH = 10;
export const EV_JUMP = 11;
export const EV_TIMEUP = 12;
export const EV_SHOT = 13;

export const ARENA_RADIUS = 15000;
export const INTRO_FRAMES = 100;
export const FIGHT_CALL_FRAME = 60;
export const KO_FRAMES = 210;
export const RUN_MAX = 1000;
export const HIST_LEN = 60;

/** Profil prędkości uniku (mm/klatkę), suma = 1500 mm. */
export const SIDESTEP_PROFILE = [130, 140, 140, 130, 120, 110, 100, 95, 90, 85, 80, 75, 70, 60, 50, 25];
export const SIDESTEP_INVULN = 10;
export const THROW_STARTUP = 5;
export const THROW_ACTIVE = 2;
export const THROW_RECOVERY = 25;
export const THROW_RANGE = 1300;
export const THROW_TECH = 6;
export const THROW_FLIGHT = 34;
export const GETUP_FRAMES = 22;
export const KNOCKDOWN_FRAMES = 34;
