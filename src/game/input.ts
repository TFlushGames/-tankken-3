// Klawiatura → bitmaska wejścia. Używamy event.code, więc układ klawiatury nie ma znaczenia.
import {
  IN_BLOCK, IN_DOWN, IN_HK, IN_HP, IN_LEFT, IN_LK, IN_LP, IN_RIGHT, IN_RUN, IN_SS_IN, IN_SS_OUT, IN_UP,
} from '../sim/input';

export type Action = 'up' | 'down' | 'left' | 'right' | 'HP' | 'LP' | 'RUN' | 'LK' | 'HK' | 'BLOCK' | 'SSIN' | 'SSOUT';

export const ACTIONS: { id: Action; label: string; bit: number }[] = [
  { id: 'up', label: 'Jump (up)', bit: IN_UP },
  { id: 'down', label: 'Crouch (down)', bit: IN_DOWN },
  { id: 'left', label: 'Left', bit: IN_LEFT },
  { id: 'right', label: 'Right', bit: IN_RIGHT },
  { id: 'HP', label: 'High punch (HP)', bit: IN_HP },
  { id: 'LP', label: 'Low punch (LP)', bit: IN_LP },
  { id: 'RUN', label: 'Run (RUN)', bit: IN_RUN },
  { id: 'LK', label: 'Low kick (LK)', bit: IN_LK },
  { id: 'HK', label: 'High kick (HK)', bit: IN_HK },
  { id: 'BLOCK', label: 'Block', bit: IN_BLOCK },
  { id: 'SSIN', label: 'Sidestep in', bit: IN_SS_IN },
  { id: 'SSOUT', label: 'Sidestep out', bit: IN_SS_OUT },
];

export type Bindings = Record<Action, string>;

export const DEFAULT_BINDINGS: [Bindings, Bindings] = [
  {
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    HP: 'KeyT', LP: 'KeyG', RUN: 'KeyH', LK: 'KeyJ', HK: 'KeyU', BLOCK: 'Space', SSIN: 'KeyB', SSOUT: 'KeyM',
  },
  {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    HP: 'Numpad7', LP: 'Numpad4', RUN: 'Numpad5', LK: 'Numpad6', HK: 'Numpad9', BLOCK: 'Numpad0',
    SSIN: 'Numpad1', SSOUT: 'Numpad3',
  },
];

const STORAGE_KEY = 'tankken3.bindings.v1';

export function loadBindings(): [Bindings, Bindings] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as [Partial<Bindings>, Partial<Bindings>];
      return [
        { ...DEFAULT_BINDINGS[0], ...parsed[0] },
        { ...DEFAULT_BINDINGS[1], ...parsed[1] },
      ];
    }
  } catch {
    /* brak dostępu do localStorage – domyślne klawisze */
  }
  return [{ ...DEFAULT_BINDINGS[0] }, { ...DEFAULT_BINDINGS[1] }];
}

export function saveBindings(b: [Bindings, Bindings]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    /* ignoruj */
  }
}

/** Ładna nazwa klawisza do UI. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map: Record<string, string> = {
    Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'L-Shift',
    ShiftRight: 'P-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'P-Ctrl', Enter: 'Enter', Backspace: 'Backspace',
  };
  return map[code] ?? code;
}

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F6', 'F7']);

export class Keyboard {
  private down = new Set<string>();
  private pressedOnce = new Set<string>();
  /** Klawisze wciśnięte od ostatniego odczytu – krótkie stuknięcie między klatkami nie ginie. */
  private latched = new Set<string>();
  bindings: [Bindings, Bindings];
  /** Gdy ustawione – następny klawisz trafia tutaj (przypisywanie klawiszy). */
  capture: ((code: string) => void) | null = null;

  constructor() {
    this.bindings = loadBindings();
    window.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const c = this.capture;
        this.capture = null;
        c(e.code);
        return;
      }
      if (PREVENT.has(e.code) || e.code.startsWith('Numpad')) e.preventDefault();
      if (!this.down.has(e.code)) {
        this.pressedOnce.add(e.code);
        this.latched.add(e.code);
      }
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Jednorazowe wciśnięcie (do menu i skrótów debug). */
  consume(code: string): boolean {
    if (this.pressedOnce.has(code)) {
      this.pressedOnce.delete(code);
      return true;
    }
    return false;
  }

  clearPressed(): void {
    this.pressedOnce.clear();
  }

  read(player: 0 | 1): number {
    const b = this.bindings[player];
    let m = 0;
    for (const a of ACTIONS) if (this.down.has(b[a.id]) || this.latched.has(b[a.id])) m |= a.bit;
    return m;
  }

  /** Wywoływane po każdym kroku symulacji. */
  endStep(): void {
    this.latched.clear();
  }

  actionPressed(player: 0 | 1, action: Action): boolean {
    return this.consume(this.bindings[player][action]);
  }
}
