// Typy danych symulacji. Wszystkie wartości liczbowe w stanie są całkowite.
import type { Button, RelDir } from './input';

export type HitLevel = 'high' | 'mid' | 'low' | 'overhead';
export type AttackKind = 'linear' | 'rotational';
/**
 * Źródło hitboxa: lufa, przód kadłuba, fala przy lądowaniu, cały kadłub (akrobacje),
 * pocisk (strzał wzdłuż lufy), wybuch przy wylocie lufy.
 */
export type HitSource = 'barrel' | 'hull' | 'shockwave' | 'body' | 'shot' | 'blast';
export type MoveStance = 'stand' | 'crouch' | 'air' | 'run';

/** Wejście ruchu: sekwencja kierunków względnych zakończona przyciskiem. */
export interface MoveInput {
  sequence: RelDir[];
  button: Button;
  /** Okno (w klatkach), w którym sekwencja musi się zmieścić. */
  window: number;
  /** Dokładne dopasowanie kierunku (np. „F” nie pasuje do „DF”). */
  strict?: boolean;
  /** Wymaga przytrzymanego RUN (akrobacje: RUN + przycisk). */
  withRun?: boolean;
}

/**
 * Klatka kluczowa ataku. Symulacja dąży do wartości docelowych w ramach fizycznych
 * limitów czołgu – czas trwania wynika z parametrów, a nie z animacji.
 * Kąty w stopniach, wysunięcie lufy 0..1 (część zakresu), prędkości w m/s.
 */
export interface MoveKey {
  /** Obrót wieży względem kierunku na przeciwnika (+ = przeciwnie do ruchu wskazówek patrząc z góry). */
  yaw?: number;
  /** Elewacja lufy. */
  pitch?: number;
  /** Wysunięcie lufy (mechanizm odrzutu) 0..1. */
  ext?: number;
  /** Uniesienie przodu kadłuba (stopnie). */
  lift?: number;
  /** Piwot kadłuba na gąsienicach (stopnie). */
  pivot?: number;
  /** Impuls kadłuba do przodu na wejściu w klatkę (m/s, skalowany masą). */
  impulse?: number;
  /** Impuls pionowy (m/s). */
  vyImpulse?: number;
  /** Czy hitbox jest aktywny w tej fazie. */
  active?: boolean;
  /** Minimalna liczba klatek w fazie. */
  hold?: number;
  /** Maksymalna liczba klatek w fazie (zabezpieczenie). */
  timeout?: number;
  /** Przewrót całego kadłuba przód–tył (stopnie, narastająco; ujemny = nosem w dół / do przodu). */
  bodyPitch?: number;
  /** Obrót całego kadłuba w poziomie względem początku ruchu (stopnie, np. 720 = dwa obroty). */
  hullSpin?: number;
  /** Lufa wbita w ziemię – czołg obraca się wokół jej końca jak wokół tyczki. */
  plant?: boolean;
  /** Skok naprowadzany: czołg ląduje w tej odległości (m) od przeciwnika (0 = na nim). */
  leap?: number;
  /** Wystrzał przy wejściu w fazę: pocisk wzdłuż lufy, wybuch przy wylocie albo harpun. */
  fire?: 'shot' | 'blast' | 'hook';
  /** Wystrzelenie pocisku (id z /src/data/projectiles.ts) przy wejściu w fazę. */
  spawn?: string;
  /** Teleport: czołg pojawia się za plecami przeciwnika (m za stykiem kadłubów), wysoko w powietrzu. */
  teleport?: number;
  /** Nietykalność od wejścia w fazę (klatki). */
  invuln?: number;
  /** Odrzut wystrzału (m/s, przeciwnie do kierunku lufy, skalowany masą). */
  recoil?: number;
  /** Napęd bez hamowania (domyślnie w fazie aktywnej) – cios przelatuje przez cel. */
  slam?: boolean;
  /** Faza kończy się po wylądowaniu (pancerny zrzut). */
  untilLanding?: boolean;
}

/** Przejście łańcucha: przycisk (opcjonalnie z kierunkiem) w trakcie ruchu → kolejny ruch. */
export interface ChainLink {
  button: Button;
  dir?: RelDir;
  to: string;
}

export interface MoveDef {
  id: string;
  name: string;
  input: MoveInput;
  stance: MoveStance[];
  level: HitLevel;
  kind: AttackKind;
  source: HitSource;
  /** Obrażenia bazowe przy 1000 HP (dla mnożnika 1,0). */
  damage: number;
  hitstun: number;
  blockstun: number;
  /** Odrzut trafionego (m/s). */
  knockback: number;
  /** Wyrzut w górę (m/s) – launcher / juggle. */
  launch?: number;
  knockdown?: boolean;
  hitstop: number;
  keys: MoveKey[];
  /** Dodatkowe klatki po wyhamowaniu wieży (recovery poza fizyką). */
  recoveryPad: number;
  /** Wielokrotne trafienia (seria OSY). */
  maxHits?: number;
  rehit?: number;
  /** Grubość hitboxa (m), domyślnie z czołgu. */
  radius?: number;
  /** Opis do listy ruchów. */
  desc: string;
  /** Kontynuacje kombo (auto-kombo przez powtarzanie przycisku). */
  chains?: ChainLink[];
  /** Ruch dostępny tylko jako kontynuacja łańcucha. */
  chainOnly?: boolean;
  /** Po zakończeniu w powietrzu można znów atakować (np. wybicie wystrzałem). */
  resetAir?: boolean;
  /** Ruch specjalny tylko dla jednego czołgu (id czołgu). */
  owner?: string;
  /**
   * Przewaga klatkowa po trafieniu / bloku (klatki, + = atakujący pierwszy). Czas ogłuszenia
   * obrońcy liczony jest z wybrzmienia atakującego, więc przewaga jest dokładnie taka, jak tu.
   */
  onHit?: number;
  onBlock?: number;
  /** Strzał z armaty – wymaga przeładowania (rzadki). */
  cannon?: boolean;
  /** Trafienie przyciąga przeciwnika przed atakującego (harpun). */
  pull?: boolean;
  /** Zasięg fali uderzeniowej poza stykiem kadłubów (m). */
  reach?: number;
}

/** Czołg zdefiniowany w jednostkach „ludzkich” (m, m/s, stopnie, tony). */
export interface TankDef {
  id: string;
  name: string;
  role: string;
  desc: string;
  damageMult: number;
  walk: number;
  back: number;
  run: number;
  turretMaxVel: number;
  turretAccel: number;
  pitchMaxVel: number;
  pitchAccel: number;
  pitchMin: number;
  pitchMax: number;
  barrelLength: number;
  extRange: number;
  extMaxVel: number;
  extAccel: number;
  jumpHeight: number;
  mass: number;
  hullLength: number;
  hullWidth: number;
  hullHeight: number;
  turretHeight: number;
  turretRadius: number;
  /** Przesunięcie osi wieży względem środka kadłuba (m, + = do przodu). */
  turretOffset: number;
  /** Ugięcie przy kucaniu (m). */
  crouchDrop: number;
  /** Obrót kadłuba w miejscu (stopnie/s). */
  hullTurnRate: number;
  /** Klatki rozpędzania/hamowania. */
  inertiaFrames: number;
  jumpSquat: number;
  barrelRadius: number;
  twinBarrels: boolean;
  /** Niszczyciel bez obrotowej wieży – zamachy wykonuje cały kadłub. */
  casemate?: boolean;
  /** Nadpisania ruchów dla czołgu (np. seria OSY). */
  moveOverrides?: Record<string, Partial<MoveDef>>;
}

/** Zdarzenie kosmetyczne wygenerowane przez symulację (dźwięk, iskry). */
export interface SimEvent {
  type: number;
  frame: number;
  actor: number;
  x: number;
  y: number;
  z: number;
  power: number;
}

export interface FighterState {
  tank: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  hullYaw: number;
  turretYaw: number;
  turretVel: number;
  pitch: number;
  pitchVel: number;
  ext: number;
  extVel: number;
  lift: number;
  liftVel: number;
  pivot: number;
  pivotVel: number;
  susp: number;
  suspVel: number;
  state: number;
  stateFrame: number;
  move: number;
  moveKey: number;
  keyFrame: number;
  moveFrame: number;
  moveBaseYaw: number;
  hitsDone: number;
  rehitTimer: number;
  moveConnected: number;
  airAttackUsed: number;
  hp: number;
  run: number;
  stun: number;
  invuln: number;
  linearInvuln: number;
  facingRight: number;
  crouching: number;
  blocking: number;
  jumpDir: number;
  sideDir: number;
  juggleCount: number;
  combo: number;
  techWindow: number;
  tipX: number;
  tipY: number;
  tipZ: number;
  throwSX: number;
  throwSZ: number;
  throwEX: number;
  throwEZ: number;
  idleFrames: number;
  bounces: number;
  chainBuf: number;
  /** Bufor przycisków (bitmaska) i jego ważność w klatkach. */
  bufBtn: number;
  bufTimer: number;
  /** Pozostałe wybrzmienie po kontakcie ciosu (klatki) – podstawa przewagi klatkowej. */
  contactRecover: number;
  /** Dokończenie zamachu po trafieniu: ile klatek jeszcze i według której fazy ruchu. */
  follow: number;
  followKey: number;
  /** Przeładowanie działa (klatki). */
  reload: number;
  /** Ile ciosów z rzędu zostało zablokowanych (rosnące odepchnięcie). */
  blockStreak: number;
  bodyPitch: number;
  bodyPitchVel: number;
  planted: number;
  plantX: number;
  plantY: number;
  plantZ: number;
  spinBase: number;
  dashUsed: number;
  chainTimer: number;
  prevInput: number;
  histHead: number;
  hist: number[];
  wins: number;
}

export interface MatchOptions {
  training: number;
  roundsToWin: number;
  roundFrames: number;
}

/** Pocisk w locie (pełnoprawny obiekt symulacji – może trafić, zostać zablokowany, zderzyć się z innym). */
export interface ProjectileState {
  id: number;
  kind: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
}

export interface GameState {
  frame: number;
  seed: number;
  phase: number;
  phaseFrame: number;
  round: number;
  timer: number;
  hitstop: number;
  slowmo: number;
  camRight: number;
  winner: number;
  roundWinner: number;
  opts: MatchOptions;
  fighters: [FighterState, FighterState];
  events: SimEvent[];
  projectiles: ProjectileState[];
  nextProj: number;
}
