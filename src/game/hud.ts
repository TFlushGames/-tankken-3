// HUD walki: paski życia z „duchem”, paski biegu, zegar, rundy, komunikaty.
import { TANKS } from '../data/tanks';
import {
  FIGHT_CALL_FRAME, PH_FIGHT, PH_INTRO, PH_KO, PH_MATCH_END, RUN_MAX, STATE_NAMES,
} from '../sim/constants';
import type { GameState } from '../sim/types';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

interface Side {
  name: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  run: HTMLElement;
  pips: HTMLElement[];
  combo: HTMLElement;
  ghostHp: number;
  ghostDelay: number;
  lastHp: number;
}

export class Hud {
  readonly root: HTMLElement;
  private sides: Side[] = [];
  private timer!: HTMLElement;
  private banner: HTMLElement;
  private sub: HTMLElement;
  private debug: HTMLElement;
  private lastBanner = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    const top = el('div', 'hud-top', this.root);
    for (let i = 0; i < 2; i++) {
      const side = el('div', `hud-side hud-side-${i}`, top);
      const plate = el('div', 'hud-plate', side);
      el('span', 'hud-tag', plate, `P${i + 1}`);
      const name = el('div', 'hud-name', plate);
      const bar = el('div', 'hud-bar', side);
      const ghost = el('div', 'hud-ghost', bar);
      const fill = el('div', 'hud-fill', bar);
      const row = el('div', 'hud-row', side);
      const runWrap = el('div', 'hud-run', row);
      const run = el('div', 'hud-run-fill', runWrap);
      const pipsWrap = el('div', 'hud-pips', row);
      const pips = [el('span', 'pip', pipsWrap), el('span', 'pip', pipsWrap)];
      const combo = el('div', 'hud-combo', this.root);
      combo.classList.add(`hud-combo-${i}`);
      this.sides.push({ name, fill, ghost, run, pips, combo, ghostHp: 1000, ghostDelay: 0, lastHp: 1000 });
      if (i === 0) this.timer = el('div', 'hud-timer', top, '90');
    }
    this.banner = el('div', 'hud-banner', this.root);
    this.sub = el('div', 'hud-sub', this.root);
    this.debug = el('div', 'hud-debug', this.root);
  }

  show(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  setDebug(text: string): void {
    this.debug.textContent = text;
    this.debug.style.display = text ? '' : 'none';
  }

  update(s: GameState, dt: number, training: boolean): void {
    for (let i = 0; i < 2; i++) {
      const f = s.fighters[i]!;
      const sd = this.sides[i]!;
      sd.name.textContent = TANKS[f.tank]!.name;
      const hp = Math.max(0, f.hp);
      if (hp < sd.lastHp) sd.ghostDelay = 0.45;
      if (hp > sd.ghostHp) sd.ghostHp = hp;
      sd.lastHp = hp;
      sd.ghostDelay -= dt;
      if (sd.ghostDelay <= 0) sd.ghostHp = Math.max(hp, sd.ghostHp - dt * 450);
      sd.fill.style.width = `${hp / 10}%`;
      sd.ghost.style.width = `${sd.ghostHp / 10}%`;
      sd.fill.classList.toggle('low', hp < 250);
      sd.run.style.width = `${(f.run / RUN_MAX) * 100}%`;
      sd.pips.forEach((p, k) => p.classList.toggle('on', f.wins > k));
      if (f.combo >= 2 && s.phase !== PH_INTRO) {
        sd.combo.innerHTML = `<b>${f.combo}</b><span>HITS</span>`;
        sd.combo.classList.add('on');
      } else sd.combo.classList.remove('on');
    }
    this.timer.textContent = training ? '∞' : String(Math.ceil(s.timer / 60));

    let banner = '';
    const sub = '';
    if (s.phase === PH_INTRO) {
      banner = s.phaseFrame < FIGHT_CALL_FRAME ? `ROUND ${s.round}` : 'FIGHT!';
    } else if (s.phase === PH_FIGHT && s.phaseFrame < 30 && !training) {
      banner = 'FIGHT!';
    } else if (s.phase === PH_KO) {
      const ko = s.fighters.some((f) => f.hp <= 0);
      banner = ko ? 'K.O.' : 'TIME!';
      const final = s.roundWinner >= 0 && s.fighters[s.roundWinner]!.wins + 1 >= s.opts.roundsToWin;
      if (s.phaseFrame > 90 && !final) {
        banner = s.roundWinner >= 0 ? `${TANKS[s.fighters[s.roundWinner]!.tank]!.name} WINS THE ROUND` : 'DRAW';
      }
    } else if (s.phase === PH_MATCH_END) {
      // Za chwilę przerywnik z finisherem – zostaje samo K.O.
      banner = 'K.O.';
    }
    if (banner !== this.lastBanner) {
      this.banner.textContent = banner;
      this.banner.classList.remove('pop');
      void this.banner.offsetWidth;
      if (banner) this.banner.classList.add('pop');
      this.banner.classList.toggle('ko', banner === 'K.O.');
      this.lastBanner = banner;
    }
    this.sub.textContent = sub;
  }

  /** Stan zawodników do panelu debug. */
  static describe(s: GameState): string {
    return s.fighters
      .map((f, i) => `P${i + 1} ${STATE_NAMES[f.state]} f${f.stateFrame} hp${f.hp} ruch:${f.move} faza:${f.moveKey}`)
      .join('   ');
  }
}
