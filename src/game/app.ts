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
import { Hud } from './hud';
import { ACTIONS, DEFAULT_BINDINGS, Keyboard, keyLabel, saveBindings, type Action } from './input';

type Screen = 'menu' | 'select' | 'fight' | 'settings' | 'help';

const STEP_MS = 1000 / 60;
const SETTINGS_KEY = 'stalowy-pojedynek.settings.v1';

interface Settings {
  volume: number;
  quality: Quality;
}

const DUMMY_MODES = ['stoi', 'blokuje', 'blok w kucki', 'kuca', 'skacze', 'gracz 2'] as const;

function loadSettings(): Settings {
  const def: Settings = { volume: 0.7, quality: { shadows: true, post: true, particles: 1 } };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Settings>;
      return { volume: p.volume ?? def.volume, quality: { ...def.quality, ...p.quality } };
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

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.ui = ui;
    this.renderer = new GameRenderer(canvas);
    this.renderer.setQuality(this.settings.quality);
    this.renderer.setArena(0);
    this.audio.setVolume(this.settings.volume);
    this.hud = new Hud(document.body);
    this.hud.show(false);
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.showMenu();
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
    this.renderer.showroom = s !== 'fight';
    this.kb.clearPressed();
  }

  private showMenu(): void {
    this.state = null;
    this.audio.stopEngines();
    this.removeTrainingPanel();
    const items: [string, () => void, boolean][] = [
      ['Gra lokalna', () => this.showSelect(false), true],
      ['Trening', () => this.showSelect(true), true],
      ['Gra online', () => undefined, false],
      ['Ustawienia', () => this.showSettings(), true],
      ['Sterowanie', () => this.showHelp(), true],
    ];
    const list = h('div', { class: 'menu-list' });
    items.forEach(([label, fn, enabled], i) => {
      const b = h('button', { class: 'menu-item' }, label);
      if (!enabled) {
        b.disabled = true;
        b.append(h('span', { class: 'soon' }, 'wkrótce'));
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
      h('div', { class: 'logo' }, h('span', { class: 'logo-top' }, 'STALOWY'), h('span', { class: 'logo-bottom' }, 'POJEDYNEK')),
      h('div', { class: 'tagline' }, 'Bijatyka czołgów 1 na 1'),
      list,
      h('div', { class: 'hint' }, 'W/S lub ↑/↓ – wybór • Enter / T – zatwierdź'),
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
      ['Siła', t.damageMult / max((x) => x.damageMult)],
      ['Szybkość', t.run / max((x) => x.run)],
      ['Zasięg', t.barrelLength / max((x) => x.barrelLength)],
      ['Wieża', t.turretMaxVel / max((x) => x.turretMaxVel)],
      ['Skok', t.jumpHeight / max((x) => x.jumpHeight)],
      ['Masa', t.mass / max((x) => x.mass)],
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
        h('div', { class: 'select-player' }, isDummy ? 'MANEKIN' : `GRACZ ${p + 1}`),
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
          const b = h('button', { class: 'ready-btn' }, this.ready[p] ? 'GOTOWY ✓' : 'Gotowy');
          b.addEventListener('click', () => this.toggleReady(p as 0 | 1));
          return b;
        })(),
        h('div', { class: 'hint' }, p === 0 ? 'A/D – wybór • T – gotowy' : isDummy ? 'wybierz myszką lub ←/→' : '←/→ – wybór • Num 7 / Enter – gotowy'),
      );
      return col;
    });
    const arenaBtn = h('button', { class: 'arena-btn' }, `Arena: ${ARENAS[this.arena]!.name} (Tab)`);
    arenaBtn.addEventListener('click', () => this.cycleArena());
    const back = h('button', { class: 'back-btn' }, '← Menu (Esc)');
    back.addEventListener('click', () => this.showMenu());
    root.append(h('div', { class: 'select-title' }, this.training ? 'TRENING – WYBÓR CZOŁGU' : 'WYBÓR CZOŁGU'), cols[0]!, cols[1]!,
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
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
      const b = h('button', { class: 'toggle' }, `${label}: ${get() ? 'TAK' : 'NIE'}`);
      b.addEventListener('click', () => {
        set(!get());
        b.textContent = `${label}: ${get() ? 'TAK' : 'NIE'}`;
        this.renderer.setQuality(s.quality);
        this.saveSettings();
      });
      return b;
    };
    const partBtn = h('button', { class: 'toggle' }, `Cząsteczki: ${Math.round(s.quality.particles * 100)}%`);
    partBtn.addEventListener('click', () => {
      s.quality.particles = s.quality.particles >= 1 ? 0.25 : s.quality.particles + 0.25;
      partBtn.textContent = `Cząsteczki: ${Math.round(s.quality.particles * 100)}%`;
      this.renderer.setQuality(s.quality);
      this.saveSettings();
    });
    const table = h('table', { class: 'binds' },
      h('tr', {}, h('th', {}, 'Akcja'), h('th', {}, 'Gracz 1'), h('th', {}, 'Gracz 2')));
    for (const a of ACTIONS) {
      const row = h('tr', {}, h('td', {}, a.label));
      for (const p of [0, 1] as const) {
        const b = h('button', { class: 'bind' }, keyLabel(this.kb.bindings[p][a.id]));
        b.addEventListener('click', () => this.rebind(p, a.id, b));
        row.append(h('td', {}, b));
      }
      table.append(row);
    }
    const reset = h('button', { class: 'toggle' }, 'Przywróć domyślne klawisze');
    reset.addEventListener('click', () => {
      this.kb.bindings = [{ ...DEFAULT_BINDINGS[0] }, { ...DEFAULT_BINDINGS[1] }];
      saveBindings(this.kb.bindings);
      this.showSettings();
    });
    const back = h('button', { class: 'back-btn' }, '← Menu (Esc)');
    back.addEventListener('click', () => this.showMenu());
    const root = h('div', { class: 'screen settings' },
      h('h2', {}, 'USTAWIENIA'),
      h('div', { class: 'settings-grid' },
        h('div', { class: 'settings-box' },
          h('h3', {}, 'Dźwięk i grafika'),
          h('label', { class: 'vol' }, 'Głośność ', vol),
          toggle('Cienie', () => s.quality.shadows, (v) => (s.quality.shadows = v)),
          toggle('Post-processing (bloom, FXAA)', () => s.quality.post, (v) => (s.quality.post = v)),
          partBtn,
          h('p', { class: 'note' },
            'Wskazówka: gracz 2 używa klawiatury numerycznej – włącz NumLock. ',
            'Wiele klawiatur nie rejestruje kilku klawiszy naraz (ghosting) – jeśli jakaś kombinacja nie działa, przypisz klawisze inaczej.'),
        ),
        h('div', { class: 'settings-box' }, h('h3', {}, 'Klawisze (kliknij, aby zmienić)'), table, reset),
      ),
      back,
    );
    this.setScreen('settings', root);
  }

  private rebind(p: 0 | 1, a: Action, b: HTMLButtonElement): void {
    b.textContent = '…naciśnij klawisz';
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
      ['Ruch / skok / kucanie', 'W A S D', 'Strzałki'],
      ['High punch (HP)', 'T', 'Num 7'],
      ['Low punch (LP)', 'G', 'Num 4'],
      ['Bieg (RUN) + przód', 'H', 'Num 5'],
      ['Low kick (LK)', 'J', 'Num 6'],
      ['High kick (HK)', 'U', 'Num 9'],
      ['Blok', 'Spacja', 'Num 0'],
      ['Unik w głąb', 'B', 'Num 1'],
      ['Unik do kamery', 'M', 'Num 3'],
    ];
    const label = (id: string, depth = 0): string => {
      const m = MOVES.find((x) => x.id === id)!;
      if (m.chainOnly && depth < 4) {
        const parent = MOVES.find((p) => p.chains?.some((c) => c.to === id));
        const link = parent?.chains?.find((c) => c.to === id);
        if (parent && link) return `${label(parent.id, depth + 1)}, ${link.button}`;
      }
      const seq = m.input.sequence.map((d) => ({ D: 'dół', B: 'tył', F: 'przód', U: 'góra' } as Record<string, string>)[d] ?? d);
      const st = m.stance.includes('air') && !m.stance.includes('stand') ? 'w skoku + ' : '';
      return st + [...seq, m.input.button].join(' + ');
    };
    const moves = MOVES.map((m) =>
      h('tr', {}, h('td', {}, m.name), h('td', {}, label(m.id)), h('td', {}, m.desc)));
    const back = h('button', { class: 'back-btn' }, '← Menu (Esc)');
    back.addEventListener('click', () => this.showMenu());
    const root = h('div', { class: 'screen help' },
      h('h2', {}, 'STEROWANIE'),
      h('div', { class: 'settings-grid' },
        h('div', { class: 'settings-box' },
          h('table', { class: 'binds' }, h('tr', {}, h('th', {}, 'Akcja'), h('th', {}, 'Gracz 1'), h('th', {}, 'Gracz 2')),
            ...rows.map(([a, b, c]) => h('tr', {}, h('td', {}, a), h('td', {}, b), h('td', {}, c)))),
          h('p', { class: 'note' }, 'Kierunki są względne: „przód” = w stronę przeciwnika. Blok wysoki chroni przed high/mid/overhead, blok w kucki przed low/mid. Rzut: blisko + przód + LP; ucieczka: LP zaraz po złapaniu.'),
          h('p', { class: 'note' }, 'Debug: F1 – hitboxy • F3 – pauza (trening) • F4 – klatka po klatce • F6 – frame data • F7 – tryb manekina • Esc – pauza'),
        ),
        h('div', { class: 'settings-box' }, h('h3', {}, 'Ruchy'), h('table', { class: 'binds moves' }, ...moves)),
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
      h('div', { class: 'fd-title' }, `TRENING – ${TANKS[tank]!.name}`),
      h('div', { class: 'fd-mode' }, `Manekin: ${DUMMY_MODES[this.dummy]} (F7)`),
      h('div', { class: 'fd-mode' }, this.paused ? '⏸ PAUZA – F4: następna klatka' : 'F3: pauza • F1: hitboxy'),
      ...(this.showFd ? [h('table', { class: 'fd' },
        h('tr', {}, h('th', {}, 'Ruch'), h('th', {}, 'Start'), h('th', {}, 'Akt.'), h('th', {}, 'Odz.'), h('th', {}, 'Obr.'), h('th', {}, 'Typ')),
        ...fd.map((d) => h('tr', {}, h('td', {}, d.name), h('td', {}, String(d.startup)), h('td', {}, String(d.active)),
          h('td', {}, String(d.recovery)), h('td', {}, String(d.damage)), h('td', {}, `${d.level}, ${d.kind}`))))] : []),
      h('div', { class: 'fd-mode' }, 'F6: pokaż/ukryj frame data'),
    );
  }

  private removeTrainingPanel(): void {
    this.fdPanel?.remove();
    this.fdPanel = null;
  }

  private dummyInput(frame: number): number {
    switch (DUMMY_MODES[this.dummy]) {
      case 'blokuje':
        return IN_BLOCK;
      case 'blok w kucki':
        return IN_BLOCK | IN_DOWN;
      case 'kuca':
        return IN_DOWN;
      case 'skacze':
        return frame % 70 < 3 ? IN_UP : 0;
      case 'gracz 2':
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
    const resume = h('button', { class: 'menu-item active' }, 'Wznów (Esc)');
    resume.addEventListener('click', () => this.togglePause());
    const menu = h('button', { class: 'menu-item' }, 'Wyjdź do menu');
    menu.addEventListener('click', () => {
      this.togglePause();
      this.showMenu();
    });
    this.pauseMenu = h('div', { class: 'pause' }, h('h2', {}, 'PAUZA'), resume, menu);
    this.ui.append(this.pauseMenu);
  }

  private fightInput(): void {
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
      if (this.kb.consume('Enter') || this.kb.consume('KeyT') || this.kb.consume('Numpad7')) this.startMatch();
    }
  }

  private simStep(): void {
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
    }
    if (this.screen === 'fight' && this.state && this.prev) {
      const frozen = !!this.pauseMenu || (this.training && this.paused);
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
      if (this.showNet) dbg.push('Sieć: gra lokalna – statystyki pojawią się w trybie online.');
      this.hud.setDebug(dbg.join('\n'));
      this.audio.updateContinuous(this.state);
    } else {
      this.renderer.renderShowroom(this.pick[0], this.pick[1], dt);
    }
    requestAnimationFrame((t) => this.frame(t));
  }
}
