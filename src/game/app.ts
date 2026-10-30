// Aplikacja: stany (menu, wybór, walka, trening, ustawienia), pętla 60 Hz, spięcie symulacji z renderem.
import { AudioEngine } from '../audio/audio';
import { MOVES } from '../data/moves';
import { TANKS } from '../data/tanks';
import { ARENAS } from '../render/arena';
import { GameRenderer, type Quality } from '../render/renderer';
import { PH_MATCH_END } from '../sim/constants';
import { computeFrameData } from '../sim/framedata';
import { IN_BLOCK, IN_DOWN, IN_UP } from '../sim/input';
import { snapshot } from '../sim/snapshot';
import { createMatch, step } from '../sim/step';
import type { GameState } from '../sim/types';
import { PeerRoom, normalizeCode } from '../net/peer';
import { LossyTransport, NET_VERSION, type NetMsg, type Transport } from '../net/protocol';
import { RollbackSession } from '../net/rollback';
import { Hud } from './hud';
import { ACTIONS, DEFAULT_BINDINGS, Keyboard, keyLabel, saveBindings, type Action } from './input';

type Screen = 'menu' | 'select' | 'fight' | 'settings' | 'help' | 'online';

const STEP_MS = 1000 / 60;
const SETTINGS_KEY = 'tankken3.settings.v1';

interface Settings {
  volume: number;
  music: number;
  quality: Quality;
}

const DUMMY_MODES = ['stand', 'block', 'crouch block', 'crouch', 'jump', 'player 2'] as const;

function loadSettings(): Settings {
  const def: Settings = { volume: 0.7, music: 0.6, quality: { shadows: true, post: true, particles: 1 } };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Settings>;
      return { volume: p.volume ?? def.volume, music: p.music ?? def.music, quality: { ...def.quality, ...p.quality } };
    }
  } catch {
    /* domyślne */
  }
  return def;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export class App {
  private readonly kb = new Keyboard();
  private readonly audio = new AudioEngine();
  private readonly renderer: GameRenderer;
  private readonly hud: Hud;
  private readonly ui: HTMLElement;
  private screen: Screen = 'menu';
  private state: GameState | null = null;
  private prev: GameState | null = null;
  private acc = 0;
  private last = performance.now();
  private training = false;
  private paused = false;
  private stepOnce = false;
  private menuIndex = 0;
  private pick: [number, number] = [1, 1];
  private ready: [boolean, boolean] = [false, false];
  private arena = 0;
  private dummy = 0;
  private settings = loadSettings();
  private fdPanel: HTMLElement | null = null;
  private showFd = false;
  private pauseMenu: HTMLElement | null = null;
  private seedCounter = 1;
  private showNet = false;
  private net: OnlineState | null = null;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.ui = ui;
    this.renderer = new GameRenderer(canvas);
    this.renderer.setQuality(this.settings.quality);
    this.renderer.setArena(0);
    this.audio.setVolume(this.settings.volume);
    this.audio.setMusicVolume(this.settings.music);
    this.audio.playMusic('menu');
    this.hud = new Hud(document.body);
    this.hud.show(false);
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.showMenu();
    // Link z zaproszeniem: ?room=KOD
    const room = normalizeCode(new URLSearchParams(location.search).get('room') ?? '');
    if (room) this.joinRoom(room);
    requestAnimationFrame((t) => this.frame(t));
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignoruj */
    }
  }

  // ------------------------------------------------------------ ekrany

  private setScreen(s: Screen, content: HTMLElement | null): void {
    this.screen = s;
    this.ui.replaceChildren();
    if (content) this.ui.append(content);
    this.hud.show(s === 'fight');
    this.audio.playMusic(s === 'fight' ? 'fight' : 'menu');
    this.renderer.showroom = s !== 'fight';
    this.kb.clearPressed();
  }

  private showMenu(): void {
    this.state = null;
    this.audio.stopEngines();
    this.removeTrainingPanel();
    this.leaveOnline();
    const items: [string, () => void, boolean][] = [
      ['Local versus', () => this.showSelect(false), true],
      ['Training', () => this.showSelect(true), true],
      ['Online', () => this.showOnline(), true],
      ['Settings', () => this.showSettings(), true],
      ['Controls', () => this.showHelp(), true],
    ];
    const list = h('div', { class: 'menu-list' });
    items.forEach(([label, fn, enabled], i) => {
      const b = h('button', { class: 'menu-item' }, label);
      if (!enabled) {
        b.disabled = true;
        b.append(h('span', { class: 'soon' }, 'soon'));
      }
      b.addEventListener('click', () => {
        this.audio.unlock();
        fn();
      });
      b.addEventListener('mouseenter', () => {
        this.menuIndex = i;
        this.highlightMenu();
      });
      list.append(b);
    });
    const root = h(
      'div', { class: 'screen menu' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-top' }, 'TANKKEN'), h('span', { class: 'logo-bottom' }, '3')),
      h('div', { class: 'tagline' }, '1-on-1 tank fighting'),
      list,
      h('div', { class: 'hint' }, 'W/S or ↑/↓ – select • Enter / T – confirm'),
    );
    this.setScreen('menu', root);
    this.highlightMenu();
  }

  private highlightMenu(): void {
    const items = Array.from(this.ui.querySelectorAll<HTMLButtonElement>('.menu-item'));
    items.forEach((b, i) => b.classList.toggle('active', i === this.menuIndex));
  }

  private menuInput(): void {
    const items = Array.from(this.ui.querySelectorAll<HTMLButtonElement>('.menu-item'));
    if (!items.length) return;
    const move = (d: number): void => {
      let i = this.menuIndex;
      do i = (i + d + items.length) % items.length;
      while (items[i]!.disabled);
      this.menuIndex = i;
      this.highlightMenu();
    };
    if (this.kb.consume('KeyW') || this.kb.consume('ArrowUp')) move(-1);
    if (this.kb.consume('KeyS') || this.kb.consume('ArrowDown')) move(1);
    if (this.kb.consume('Enter') || this.kb.consume('KeyT') || this.kb.consume('Numpad7')) items[this.menuIndex]!.click();
  }

  private statBars(i: number): HTMLElement {
    const t = TANKS[i]!;
    const max = (k: (x: typeof t) => number): number => Math.max(...TANKS.map(k));
    const rows: [string, number][] = [
      ['Power', t.damageMult / max((x) => x.damageMult)],
      ['Speed', t.run / max((x) => x.run)],
      ['Reach', t.barrelLength / max((x) => x.barrelLength)],
      ['Turret', t.turretMaxVel / max((x) => x.turretMaxVel)],
      ['Jump', t.jumpHeight / max((x) => x.jumpHeight)],
      ['Mass', t.mass / max((x) => x.mass)],
    ];
    return h('div', { class: 'stats' }, ...rows.map(([label, v]) =>
      h('div', { class: 'stat' }, h('span', {}, label), h('div', { class: 'stat-bar' }, h('div', { class: 'stat-fill', style: `width:${Math.round(v * 100)}%` })))));
  }

  private showSelect(training: boolean): void {
    this.training = training;
    this.ready = [false, false];
    const root = h('div', { class: 'screen select' });
    this.setScreen('select', root);
    this.renderSelect();
  }

  private renderSelect(): void {
    const root = this.ui.querySelector('.select');
    if (!root) return;
    root.replaceChildren();
    const cols = [0, 1].map((p) => {
      const t = TANKS[this.pick[p]!]!;
      const isDummy = this.training && p === 1;
      const col = h('div', { class: `select-col p${p + 1} ${this.ready[p] ? 'ready' : ''}` },
        h('div', { class: 'select-player' }, isDummy ? 'DUMMY' : `PLAYER ${p + 1}`),
        h('div', { class: 'select-name' }, t.name),
        h('div', { class: 'select-role' }, t.role),
        this.statBars(this.pick[p]!),
        h('div', { class: 'select-desc' }, t.desc),
        h('div', { class: 'select-cards' }, ...TANKS.map((x, i) => {
          const b = h('button', { class: `card ${i === this.pick[p] ? 'on' : ''}` }, x.name);
          b.addEventListener('click', () => {
            this.pick[p] = i;
            this.ready[p] = false;
            this.renderSelect();
          });
          return b;
        })),
        (() => {
          const b = h('button', { class: 'ready-btn' }, this.ready[p] ? 'READY ✓' : 'Ready');
          b.addEventListener('click', () => this.toggleReady(p as 0 | 1));
          return b;
        })(),
        h('div', { class: 'hint' }, p === 0 ? 'A/D – select • T – ready' : isDummy ? 'pick with mouse or ←/→' : '←/→ – select • Num 7 / Enter – ready'),
      );
      return col;
    });
    const arenaBtn = h('button', { class: 'arena-btn' }, `Arena: ${ARENAS[this.arena]!.name} (Tab)`);
    arenaBtn.addEventListener('click', () => this.cycleArena());
    const back = h('button', { class: 'back-btn' }, '← Menu (Esc)');
    back.addEventListener('click', () => this.showMenu());
    root.append(h('div', { class: 'select-title' }, this.training ? 'TRAINING – SELECT TANK' : 'SELECT YOUR TANK'), cols[0]!, cols[1]!,
      h('div', { class: 'select-bottom' }, back, arenaBtn));
  }

  private cycleArena(): void {
    this.arena = (this.arena + 1) % ARENAS.length;
    this.renderer.setArena(this.arena);
    this.renderSelect();
  }

  private toggleReady(p: 0 | 1): void {
    this.ready[p] = !this.ready[p];
    if (this.training) this.ready[1] = true;
    this.renderSelect();
    if (this.ready[0] && this.ready[1]) this.startMatch();
  }

  private selectInput(): void {
    if (this.kb.consume('Escape')) return this.showMenu();
    if (this.kb.consume('Tab')) this.cycleArena();
    const change = (p: 0 | 1, d: number): void => {
      if (this.ready[p]) return;
      this.pick[p] = (this.pick[p] + d + TANKS.length) % TANKS.length;
      this.renderSelect();
    };
    if (this.kb.consume('KeyA')) change(0, -1);
    if (this.kb.consume('KeyD')) change(0, 1);
    if (this.kb.consume('ArrowLeft')) change(1, -1);
    if (this.kb.consume('ArrowRight')) change(1, 1);
    if (this.kb.consume(this.kb.bindings[0].HP)) this.toggleReady(0);
    if (!this.training && (this.kb.consume(this.kb.bindings[1].HP) || this.kb.consume('Enter'))) this.toggleReady(1);
    if (this.training && this.kb.consume('Enter')) this.toggleReady(0);
  }

  private startMatch(): void {
    this.hud.escHint = 'menu';
    this.state = createMatch(this.pick[0], this.pick[1], 0x5eed + this.seedCounter++, { training: this.training ? 1 : 0 });
    this.prev = snapshot(this.state);
    this.acc = 0;
    this.paused = false;
    this.renderer.setTanks(this.pick[0], this.pick[1]);
    this.audio.startEngines([this.pick[0], this.pick[1]]);
    this.setScreen('fight', null);
    if (this.training) this.buildTrainingPanel();
  }

  private showSettings(): void {
    const s = this.settings;
    const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume) });
    vol.addEventListener('input', () => {
      s.volume = Number(vol.value);
      this.audio.setVolume(s.volume);
      this.saveSettings();
    });
    const mus = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.music) });
    mus.addEventListener('input', () => {
      s.music = Number(mus.value);
      this.audio.setMusicVolume(s.music);
      this.saveSettings();
    });
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
      const b = h('button', { class: 'toggle' }, `${label}: ${get() ? 'ON' : 'OFF'}`);
      b.addEventListener('click', () => {
        set(!get());
        b.textContent = `${label}: ${get() ? 'ON' : 'OFF'}`;
        this.renderer.setQuality(s.quality);
        this.saveSettings();
      });
      return b;
    };
    const partBtn = h('button', { class: 'toggle' }, `Particles: ${Math.round(s.quality.particles * 100)}%`);
    partBtn.addEventListener('click', () => {
      s.quality.particles = s.quality.particles >= 1 ? 0.25 : s.quality.particles + 0.25;
      partBtn.textContent = `Particles: ${Math.round(s.quality.particles * 100)}%`;
      this.renderer.setQuality(s.quality);
      this.saveSettings();
    });
    const table = h('table', { class: 'binds' },
      h('tr', {}, h('th', {}, 'Action'), h('th', {}, 'Player 1'), h('th', {}, 'Player 2')));
    for (const a of ACTIONS) {
      const row = h('tr', {}, h('td', {}, a.label));
      for (const p of [0, 1] as const) {
        const b = h('button', { class: 'bind' }, keyLabel(this.kb.bindings[p][a.id]));
        b.addEventListener('click', () => this.rebind(p, a.id, b));
        row.append(h('td', {}, b));
      }
      table.append(row);
    }
    const reset = h('button', { class: 'toggle' }, 'Restore default keys');
    reset.addEventListener('click', () => {
      this.kb.bindings = [{ ...DEFAULT_BINDINGS[0] }, { ...DEFAULT_BINDINGS[1] }];
      saveBindings(this.kb.bindings);
      this.showSettings();
    });
    const back = h('button', { class: 'back-btn' }, '← Menu (Esc)');
    back.addEventListener('click', () => this.showMenu());
    const root = h('div', { class: 'screen settings' },
      h('h2', {}, 'SETTINGS'),
      h('div', { class: 'settings-grid' },
        h('div', { class: 'settings-box' },
          h('h3', {}, 'Sound & graphics'),
          h('label', { class: 'vol' }, 'Sound effects ', vol),
          h('label', { class: 'vol' }, 'Music ', mus),
          toggle('Shadows', () => s.quality.shadows, (v) => (s.quality.shadows = v)),
          toggle('Post-processing (bloom, FXAA)', () => s.quality.post, (v) => (s.quality.post = v)),
          partBtn,
          h('p', { class: 'note' },
            'Tip: player 2 uses the numeric keypad – turn on NumLock. ',
            'Many keyboards cannot register several keys at once (ghosting) – if a combination does not work, rebind the keys.'),
        ),
        h('div', { class: 'settings-box' }, h('h3', {}, 'Keys (click to change)'), table, reset),
      ),
      back,
    );
    this.setScreen('settings', root);
  }

  private rebind(p: 0 | 1, a: Action, b: HTMLButtonElement): void {
    b.textContent = '…press a key';
    b.classList.add('wait');
    this.kb.capture = (code) => {
      if (code !== 'Escape') {
        this.kb.bindings[p][a] = code;
        saveBindings(this.kb.bindings);
      }
      b.textContent = keyLabel(this.kb.bindings[p][a]);
      b.classList.remove('wait');
    };
  }

  private showHelp(): void {
    const rows: [string, string, string][] = [
      ['Move / jump / crouch', 'W A S D', 'Arrows'],
      ['High punch (HP)', 'T', 'Num 7'],
      ['Low punch (LP)', 'G', 'Num 4'],
      ['Run (RUN) + forward', 'H', 'Num 5'],
      ['Low kick (LK)', 'J', 'Num 6'],
      ['High kick (HK)', 'U', 'Num 9'],
      ['Block', 'Space', 'Num 0'],
      ['Sidestep in', 'B', 'Num 1'],
      ['Sidestep out', 'M', 'Num 3'],
      ['Dash', '2× forward / back', '2× → / ←'],
      ['Double jump (flip)', 'W in the air', '↑ in the air'],
      ['Air dash', 'H + direction', 'Num 5 + direction'],
    ];
    const label = (id: string, depth = 0): string => {
      const m = MOVES.find((x) => x.id === id)!;
      if (m.chainOnly && depth < 4) {
        const parent = MOVES.find((p) => p.chains?.some((c) => c.to === id));
        const link = parent?.chains?.find((c) => c.to === id);
        if (parent && link) return `${label(parent.id, depth + 1)}, ${link.button}`;
      }
      const seq = m.input.sequence.map((d) => ({ D: 'down', B: 'back', F: 'forward', U: 'up' } as Record<string, string>)[d] ?? d);
      const st = m.stance.includes('air') && !m.stance.includes('stand') ? 'in air + ' : '';
      const run = m.input.withRun ? 'RUN + ' : '';
      return st + run + [...seq, m.input.button].join(' + ');
    };
    const moves = MOVES.map((m) =>
      h('tr', {}, h('td', {}, m.name), h('td', {}, label(m.id)), h('td', {}, m.desc)));
    const back = h('button', { class: 'back-btn' }, '← Menu (Esc)');
    back.addEventListener('click', () => this.showMenu());
    const root = h('div', { class: 'screen help' },
      h('h2', {}, 'CONTROLS'),
      h('div', { class: 'settings-grid' },
        h('div', { class: 'settings-box' },
          h('table', { class: 'binds' }, h('tr', {}, h('th', {}, 'Action'), h('th', {}, 'Player 1'), h('th', {}, 'Player 2')),
            ...rows.map(([a, b, c]) => h('tr', {}, h('td', {}, a), h('td', {}, b), h('td', {}, c)))),
          h('p', { class: 'note' }, 'Directions are relative: “forward” = towards the opponent. Standing block stops high/mid/overhead, crouching block stops low/mid. Throw: close + forward + LP; escape: LP right after being grabbed. Mash a button during an attack to chain combos.'),
          h('p', { class: 'note' }, 'Debug: F1 – hitboxes • F2 – network stats • F3 – pause (training) • F4 – frame step • F6 – frame data • F7 – dummy mode • Esc – pause'),
        ),
        h('div', { class: 'settings-box' }, h('h3', {}, 'Moves'), h('table', { class: 'binds moves' }, ...moves)),
      ),
      back,
    );
    this.setScreen('help', root);
  }

  // ------------------------------------------------------------ trening

  private buildTrainingPanel(): void {
    this.removeTrainingPanel();
    const p = h('div', { class: 'fd-panel' });
    document.body.append(p);
    this.fdPanel = p;
    this.renderTrainingPanel();
  }

  private renderTrainingPanel(): void {
    const p = this.fdPanel;
    if (!p || !this.state) return;
    const tank = this.state.fighters[0].tank;
    const fd = computeFrameData(tank);
    p.replaceChildren(
      h('div', { class: 'fd-title' }, `TRAINING – ${TANKS[tank]!.name}`),
      h('div', { class: 'fd-mode' }, `Dummy: ${DUMMY_MODES[this.dummy]} (F7)`),
      h('div', { class: 'fd-mode' }, this.paused ? '⏸ PAUSED – F4: next frame' : 'F3: pause • F1: hitboxes'),
      ...(this.showFd ? [h('table', { class: 'fd' },
        h('tr', {}, h('th', {}, 'Move'), h('th', {}, 'Start'), h('th', {}, 'Act.'), h('th', {}, 'Rec.'), h('th', {}, 'Dmg'), h('th', {}, 'Type')),
        ...fd.map((d) => h('tr', {}, h('td', {}, d.name), h('td', {}, String(d.startup)), h('td', {}, String(d.active)),
          h('td', {}, String(d.recovery)), h('td', {}, String(d.damage)), h('td', {}, `${d.level}, ${d.kind}`))))] : []),
      h('div', { class: 'fd-mode' }, 'F6: show/hide frame data'),
    );
  }

  private removeTrainingPanel(): void {
    this.fdPanel?.remove();
    this.fdPanel = null;
  }

  private dummyInput(frame: number): number {
    switch (DUMMY_MODES[this.dummy]) {
      case 'block':
        return IN_BLOCK;
      case 'crouch block':
        return IN_BLOCK | IN_DOWN;
      case 'crouch':
        return IN_DOWN;
      case 'jump':
        return frame % 70 < 3 ? IN_UP : 0;
      case 'player 2':
        return this.kb.read(1);
      default:
        return 0;
    }
  }

  // ------------------------------------------------------------ walka

  private togglePause(): void {
    if (this.pauseMenu) {
      this.pauseMenu.remove();
      this.pauseMenu = null;
      return;
    }
    const resume = h('button', { class: 'menu-item active' }, 'Resume (Esc)');
    resume.addEventListener('click', () => this.togglePause());
    const items: HTMLElement[] = [resume];
    if (this.net) {
      // Online: gra się nie zatrzymuje; wyjście wraca obu graczy do wyboru czołgu.
      const lobby = h('button', { class: 'menu-item' }, 'Back to tank select');
      lobby.addEventListener('click', () => {
        this.togglePause();
        this.goToLobby(true);
      });
      const leave = h('button', { class: 'menu-item' }, 'Leave room');
      leave.addEventListener('click', () => {
        this.togglePause();
        this.showMenu();
      });
      items.push(lobby, leave);
    } else {
      const menu = h('button', { class: 'menu-item' }, 'Quit to menu');
      menu.addEventListener('click', () => {
        this.togglePause();
        this.showMenu();
      });
      items.push(menu);
    }
    this.pauseMenu = h('div', { class: 'pause' }, h('h2', {}, this.net ? 'MENU' : 'PAUSED'), ...items);
    this.ui.append(this.pauseMenu);
  }

  private fightInput(): void {
    // Online po meczu: Esc wraca do wyboru czołgu (połączenie zostaje).
    if (this.net && this.state?.phase === PH_MATCH_END && this.kb.consume('Escape')) return this.goToLobby(true);
    if (this.kb.consume('Escape')) this.togglePause();
    if (this.kb.consume('F1')) this.renderer.showDebug = !this.renderer.showDebug;
    if (this.kb.consume('F2')) this.showNet = !this.showNet;
    if (this.training) {
      if (this.kb.consume('F3')) {
        this.paused = !this.paused;
        this.renderTrainingPanel();
      }
      if (this.kb.consume('F4')) this.stepOnce = true;
      if (this.kb.consume('F6')) {
        this.showFd = !this.showFd;
        this.renderTrainingPanel();
      }
      if (this.kb.consume('F7')) {
        this.dummy = (this.dummy + 1) % DUMMY_MODES.length;
        this.renderTrainingPanel();
      }
    }
    if (this.state?.phase === PH_MATCH_END) {
      if (this.kb.consume('Enter') || this.kb.consume('KeyT') || this.kb.consume('Numpad7')) {
        if (this.net) this.requestRematch();
        else this.startMatch();
      }
    }
  }

  private simStep(): void {
    if (this.net?.session) {
      const ses = this.net.session;
      ses.tick(this.kb.read(0));
      this.kb.endStep();
      this.state = ses.state;
      this.prev = ses.prev;
      const fresh = this.renderer.handleEvents(ses.events, ses.state);
      this.audio.handleEvents(fresh);
      return;
    }
    const s = this.state!;
    this.prev = snapshot(s);
    const in1 = this.kb.read(0);
    const in2 = this.training ? this.dummyInput(s.frame) : this.kb.read(1);
    step(s, in1, in2);
    this.kb.endStep();
    const fresh = this.renderer.handleEvents(s.events, s);
    this.audio.handleEvents(fresh);
  }

  private frame(now: number): void {
    const dtMs = Math.min(100, now - this.last);
    this.last = now;
    const dt = dtMs / 1000;
    switch (this.screen) {
      case 'menu':
        this.menuInput();
        break;
      case 'select':
        this.selectInput();
        break;
      case 'settings':
      case 'help':
        if (this.kb.consume('Escape')) this.showMenu();
        break;
      case 'fight':
        this.fightInput();
        break;
      case 'online':
        this.onlineInput();
        break;
    }
    this.netHeartbeat(now);
    if (this.screen === 'fight' && this.state && this.prev) {
      const frozen = !this.net && (!!this.pauseMenu || (this.training && this.paused));
      if (!frozen) {
        this.acc += dtMs;
        let n = 0;
        while (this.acc >= STEP_MS && n < 5) {
          this.simStep();
          this.acc -= STEP_MS;
          n++;
        }
        if (n === 5) this.acc = 0;
      } else if (this.stepOnce) {
        this.simStep();
        this.acc = 0;
      }
      this.stepOnce = false;
      const alpha = frozen ? 1 : Math.min(1, this.acc / STEP_MS);
      this.renderer.render(this.prev, this.state, alpha, frozen ? 0 : dt);
      this.hud.update(this.state, dt, this.training);
      const dbg: string[] = [];
      if (this.renderer.showDebug) dbg.push(Hud.describe(this.state));
      if (this.showNet) dbg.push(this.netStatsText());
      this.hud.setDebug(dbg.join('\n'));
      this.audio.updateContinuous(this.state);
    } else {
      const showP2 = this.screen === 'online' && this.net?.opp ? this.net.opp.tank : this.pick[1];
      this.renderer.renderShowroom(this.screen === 'online' && this.net ? this.net.myPick : this.pick[0], showP2, dt);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------ gra online (P2P + rollback)

  private showOnline(message = ''): void {
    this.leaveOnline();
    const code = h('input', { class: 'code-input', maxlength: '6', placeholder: 'CODE', autocomplete: 'off', spellcheck: 'false' });
    const create = h('button', { class: 'menu-item active' }, 'Create room');
    create.addEventListener('click', () => this.createRoom());
    const join = h('button', { class: 'menu-item' }, 'Join');
    const doJoin = (): void => {
      const c = normalizeCode(code.value);
      if (c) this.joinRoom(c);
      else code.classList.add('bad');
    };
    join.addEventListener('click', doJoin);
    code.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') doJoin();
    });
    const back = h('button', { class: 'back-btn' }, '← Menu (Esc)');
    back.addEventListener('click', () => this.showMenu());
    const root = h('div', { class: 'screen online' },
      h('h2', {}, 'ONLINE'),
      h('div', { class: 'online-box' },
        create,
        h('div', { class: 'online-or' }, 'or enter a code from a friend'),
        h('div', { class: 'online-join' }, code, join),
        message ? h('div', { class: 'online-msg' }, message) : '',
        h('p', { class: 'note' }, 'The connection is direct (peer-to-peer). You always use the player 1 keys. To simulate a bad connection add ?lag=120&jitter=30&loss=5 to the address.'),
      ),
      back,
    );
    this.setScreen('online', root);
    code.focus();
  }

  private onlineStatus(title: string, detail: string, extra?: HTMLElement): void {
    const back = h('button', { class: 'back-btn' }, '← Cancel (Esc)');
    back.addEventListener('click', () => this.showMenu());
    const root = h('div', { class: 'screen online' },
      h('h2', {}, title), h('div', { class: 'online-box' }, h('div', { class: 'online-msg' }, detail), extra ?? ''), back);
    this.setScreen('online', root);
  }

  private newNet(room: PeerRoom | null): OnlineState {
    return {
      room, transport: null, session: null, myPick: this.pick[0], myReady: false, opp: null, arena: this.arena,
      match: 0, rematchMe: false, rematchOpp: false, lastPing: 0, ping: 0, lostAt: 0, retryAt: 0, inFight: false,
    };
  }

  private createRoom(): void {
    this.onlineStatus('CREATING ROOM', 'Connecting to the matchmaking server…');
    const net = this.newNet(null);
    this.net = net;
    void PeerRoom.host({
      onRoomReady: (code) => {
        if (this.net !== net) return;
        // Link zachowuje ewentualne parametry własnego serwera / symulacji łącza.
        const params = new URLSearchParams(location.search);
        params.set('room', code);
        const link = `${location.origin}${location.pathname}?${params.toString()}`;
        const copy = h('button', { class: 'menu-item active' }, 'Copy link');
        copy.addEventListener('click', () => {
          void navigator.clipboard?.writeText(link).then(() => (copy.textContent = 'Copied ✓'));
        });
        this.onlineStatus('ROOM READY', 'Send the link or the code to a friend and wait for them to join.',
          h('div', {}, h('div', { class: 'room-code' }, code), h('div', { class: 'room-link' }, link), copy));
      },
      onConnected: (t) => this.netConnected(net, t),
      onError: (msg) => {
        if (this.net === net) this.showOnline(msg);
      },
    }).then((room) => {
      if (this.net === net) net.room = room;
      else room.destroy();
    });
  }

  private joinRoom(code: string): void {
    this.onlineStatus('JOINING', `Connecting to room ${code}…`);
    const net = this.newNet(null);
    this.net = net;
    void PeerRoom.join(code, {
      onConnected: (t) => this.netConnected(net, t),
      onError: (msg) => {
        if (this.net !== net) return;
        if (net.inFight || net.lostAt) return;
        this.showOnline(msg);
      },
    }).then((room) => {
      if (this.net === net) net.room = room;
      else room.destroy();
    });
  }

  private netConnected(net: OnlineState, raw: Transport): void {
    if (this.net !== net) return;
    const p = new URLSearchParams(location.search);
    const lag = Number(p.get('lag') ?? 0);
    const jitter = Number(p.get('jitter') ?? 0);
    const loss = Number(p.get('loss') ?? 0);
    const t = lag || jitter || loss ? new LossyTransport(raw, lag, jitter, loss) : raw;
    net.transport = t;
    net.lostAt = 0;
    t.onMessage = (m) => this.onNetMessage(net, m);
    t.onClose = () => this.onNetLost(net);
    t.send({ t: 'hello', ver: NET_VERSION });
    if (net.session) {
      // Powrót po zerwaniu – walka trwa dalej, brakujące wejścia dojdą.
      net.session.setTransport(t);
      this.hud.setDebug('');
      return;
    }
    this.sendPick();
    this.showLobby();
  }

  private onNetLost(net: OnlineState): void {
    if (this.net !== net || net.lostAt) return;
    net.lostAt = performance.now();
    net.retryAt = net.lostAt + 1500;
    net.transport = null;
  }

  private sendPick(): void {
    const n = this.net;
    n?.transport?.send({ t: 'pick', tank: n.myPick, ready: n.myReady, arena: n.arena });
  }

  private isHost(): boolean {
    return this.net?.room?.isHost ?? false;
  }

  private showLobby(): void {
    const n = this.net;
    if (!n) return;
    const me = this.isHost() ? 0 : 1;
    const col = (who: 'me' | 'opp'): HTMLElement => {
      const tank = who === 'me' ? n.myPick : n.opp?.tank ?? -1;
      const ready = who === 'me' ? n.myReady : n.opp?.ready ?? false;
      const t = tank >= 0 ? TANKS[tank]! : null;
      const cls = (who === 'me') === (me === 0) ? 'p1' : 'p2';
      const c = h('div', { class: `select-col ${cls} ${ready ? 'ready' : ''}` },
        h('div', { class: 'select-player' }, who === 'me' ? 'YOU' : 'OPPONENT'),
        h('div', { class: 'select-name' }, t ? t.name : '…'),
        h('div', { class: 'select-role' }, t ? t.role : 'choosing a tank'),
        ...(t ? [this.statBars(tank), h('div', { class: 'select-desc' }, t.desc)] : []));
      if (who === 'me') {
        c.append(h('div', { class: 'select-cards' }, ...TANKS.map((x, i) => {
          const b = h('button', { class: `card ${i === n.myPick ? 'on' : ''}` }, x.name);
          b.addEventListener('click', () => this.lobbyPick(i));
          return b;
        })));
        const rb = h('button', { class: 'ready-btn' }, n.myReady ? 'READY ✓' : 'Ready');
        rb.addEventListener('click', () => this.lobbyReady());
        c.append(rb, h('div', { class: 'hint' }, 'A/D – select • T – ready'));
      } else {
        c.append(h('div', { class: 'hint' }, ready ? 'Ready!' : 'Waiting…'));
      }
      return c;
    };
    const arenaBtn = h('button', { class: 'arena-btn' }, `Arena: ${ARENAS[n.arena]!.name}${this.isHost() ? ' (Tab)' : ''}`);
    if (this.isHost()) arenaBtn.addEventListener('click', () => this.lobbyArena());
    const back = h('button', { class: 'back-btn' }, '← Leave (Esc)');
    back.addEventListener('click', () => this.showMenu());
    const cols = me === 0 ? [col('me'), col('opp')] : [col('opp'), col('me')];
    const root = h('div', { class: 'screen select' },
      h('div', { class: 'select-title' }, `ONLINE – ROOM ${n.room?.code ?? ''}${n.ping ? ` • ${n.ping} ms` : ''}`),
      cols[0]!, cols[1]!, h('div', { class: 'select-bottom' }, back, arenaBtn));
    this.setScreen('online', root);
  }

  private lobbyPick(i: number): void {
    const n = this.net;
    if (!n || n.myReady) return;
    n.myPick = (i + TANKS.length) % TANKS.length;
    this.sendPick();
    this.showLobby();
  }

  private lobbyReady(): void {
    const n = this.net;
    if (!n) return;
    n.myReady = !n.myReady;
    this.sendPick();
    this.showLobby();
    this.maybeStartOnline();
  }

  private lobbyArena(): void {
    const n = this.net;
    if (!n || !this.isHost()) return;
    n.arena = (n.arena + 1) % ARENAS.length;
    this.renderer.setArena(n.arena);
    this.sendPick();
    this.showLobby();
  }

  private maybeStartOnline(): void {
    const n = this.net;
    if (!n || !this.isHost() || !n.myReady || !n.opp?.ready || n.inFight) return;
    const seed = (Math.random() * 0x7fffffff) | 0;
    const msg: NetMsg = { t: 'start', seed, tanks: [n.myPick, n.opp.tank], arena: n.arena, match: n.match + 1 };
    n.transport?.send(msg);
    this.startOnline(msg);
  }

  private startOnline(msg: Extract<NetMsg, { t: 'start' }>): void {
    const n = this.net;
    if (!n || !n.transport) return;
    n.match = msg.match;
    n.inFight = true;
    n.rematchMe = false;
    n.rematchOpp = false;
    n.arena = msg.arena;
    const tanks: [number, number] = [msg.tanks[0] % TANKS.length, msg.tanks[1] % TANKS.length];
    this.training = false;
    this.renderer.setArena(n.arena);
    const state = createMatch(tanks[0], tanks[1], msg.seed);
    n.session = new RollbackSession(n.transport, state, this.isHost() ? 0 : 1, msg.match);
    this.state = state;
    this.prev = snapshot(state);
    this.acc = 0;
    this.renderer.setTanks(tanks[0], tanks[1]);
    this.audio.startEngines(tanks);
    this.hud.escHint = 'change tank';
    this.setScreen('fight', null);
  }

  /** Powrót do wyboru czołgu bez zrywania połączenia (opcjonalnie powiadamia przeciwnika). */
  private goToLobby(notify: boolean): void {
    const n = this.net;
    if (!n) return;
    if (this.pauseMenu) this.togglePause();
    n.session = null;
    n.inFight = false;
    n.myReady = false;
    n.rematchMe = false;
    n.rematchOpp = false;
    if (n.opp) n.opp.ready = false;
    this.state = null;
    this.prev = null;
    this.audio.stopEngines();
    this.hud.setDebug('');
    if (notify) n.transport?.send({ t: 'lobby' });
    this.sendPick();
    this.showLobby();
  }

  private requestRematch(): void {
    const n = this.net;
    if (!n || n.rematchMe) return;
    n.rematchMe = true;
    n.transport?.send({ t: 'rematch' });
    this.hud.setDebug('Waiting for the opponent to accept the rematch…');
    this.checkRematch();
  }

  private checkRematch(): void {
    const n = this.net;
    if (!n || !n.rematchMe || !n.rematchOpp || !this.isHost() || !n.opp) return;
    const seed = (Math.random() * 0x7fffffff) | 0;
    const tanks: [number, number] = [n.session?.state.fighters[0].tank ?? n.myPick, n.session?.state.fighters[1].tank ?? n.opp.tank];
    const msg: NetMsg = { t: 'start', seed, tanks, arena: n.arena, match: n.match + 1 };
    n.transport?.send(msg);
    this.startOnline(msg);
  }

  private onNetMessage(net: OnlineState, m: NetMsg): void {
    if (this.net !== net) return;
    if (net.session?.handle(m)) return;
    switch (m.t) {
      case 'ping':
        net.transport?.send({ t: 'pong', ts: m.ts });
        break;
      case 'pong': {
        const rtt = Math.max(0, Math.round(performance.now()) - m.ts);
        net.ping = net.ping ? Math.round(net.ping * 0.8 + rtt * 0.2) : rtt;
        net.session?.setPing(rtt);
        break;
      }
      case 'hello':
        if (m.ver !== NET_VERSION) this.showOnline('Your opponent runs a different game version – refresh the page (Ctrl+F5).');
        break;
      case 'pick':
        net.opp = { tank: m.tank % TANKS.length, ready: m.ready };
        if (!this.isHost() && m.arena !== net.arena) {
          net.arena = m.arena % ARENAS.length;
          this.renderer.setArena(net.arena);
        }
        if (!net.inFight) this.showLobby();
        this.maybeStartOnline();
        break;
      case 'start':
        if (!this.isHost()) this.startOnline(m);
        break;
      case 'rematch':
        net.rematchOpp = true;
        this.checkRematch();
        break;
      case 'lobby':
        if (net.inFight) this.goToLobby(false);
        break;
      default:
        break;
    }
  }

  /** Ping co sekundę, a po zerwaniu – próby ponownego połączenia przez 10 s. */
  private netHeartbeat(now: number): void {
    const n = this.net;
    if (!n) return;
    if (n.transport && now - n.lastPing > 1000) {
      n.lastPing = now;
      n.transport.send({ t: 'ping', ts: Math.round(now) });
    }
    if (n.lostAt) {
      const left = Math.ceil((10000 - (now - n.lostAt)) / 1000);
      if (left <= 0) {
        this.showMenu();
        window.alert('The opponent disconnected.');
        return;
      }
      const text = `Connection lost – trying to reconnect (${left} s)…`;
      if (this.screen === 'fight') this.hud.setDebug(text);
      if (!this.isHost() && now > n.retryAt) {
        n.retryAt = now + 2000;
        n.room?.connect();
      }
    }
  }

  private onlineInput(): void {
    const n = this.net;
    if (this.kb.consume('Escape')) return this.showMenu();
    if (!n?.transport || n.inFight) return;
    if (this.kb.consume('KeyA')) this.lobbyPick(n.myPick - 1);
    if (this.kb.consume('KeyD')) this.lobbyPick(n.myPick + 1);
    if (this.kb.consume(this.kb.bindings[0].HP)) this.lobbyReady();
    if (this.kb.consume('Tab')) this.lobbyArena();
  }

  private netStatsText(): string {
    const st = this.net?.session?.stats;
    if (!st) return 'Network: local game.';
    return `Network: ping ${st.ping} ms • input delay ${st.delay} f • last rollback ${st.lastRollback} f (total ${st.rollbacks}) • frame advantage ${st.advantage} • stalls ${st.stalls} • desyncs ${st.desyncs}${st.desyncs ? ` (frame ${st.lastDesyncFrame})` : ''}`;
  }

  private leaveOnline(): void {
    const n = this.net;
    if (!n) return;
    this.net = null;
    n.transport?.close();
    n.room?.destroy();
    const params = new URLSearchParams(location.search);
    if (params.has('room')) {
      params.delete('room');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? `?${q}` : ''));
    }
  }
}

interface OnlineState {
  room: PeerRoom | null;
  transport: Transport | null;
  session: RollbackSession | null;
  myPick: number;
  myReady: boolean;
  opp: { tank: number; ready: boolean } | null;
  arena: number;
  match: number;
  rematchMe: boolean;
  rematchOpp: boolean;
  lastPing: number;
  ping: number;
  lostAt: number;
  retryAt: number;
  inFight: boolean;
}
