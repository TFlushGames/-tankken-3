// Wylicza wynikowe frame data ruchów, uruchamiając symulację „na sucho” (bez przeciwnika w zasięgu).
import { MOVES } from '../data/moves';
import { EV_SPAWN, ST_ATTACK, ST_THROWING, THROW_ACTIVE, THROW_RECOVERY, THROW_STARTUP } from './constants';
import { TANK_PARAMS } from './params';
import { createMatch, forceMove, isMoveActive, step } from './step';

export interface FrameData {
  id: string;
  name: string;
  startup: number;
  active: number;
  recovery: number;
  total: number;
  damage: number;
  level: string;
  kind: string;
}

export function computeFrameData(tank: number): FrameData[] {
  const out: FrameData[] = [];
  const t = TANK_PARAMS[tank]!;
  for (const def of MOVES) {
    const m = t.moves.find((x) => x.def.id === def.id)!;
    if (!m.allowed) continue;
    if (def.id === 'throw') {
      out.push({
        id: def.id, name: m.def.name, startup: THROW_STARTUP, active: THROW_ACTIVE, recovery: THROW_RECOVERY,
        total: THROW_STARTUP + THROW_ACTIVE + THROW_RECOVERY, damage: m.damage, level: 'throw', kind: 'unblockable',
      });
      continue;
    }
    const s = createMatch(tank, 1, 1, { training: 1 });
    // Przeciwnik daleko, by nic nie przerwało ruchu.
    s.fighters[1].x = 14000;
    // Nietykalny – pociski mają duży zasięg i trafienie skróciłoby pomiar.
    s.fighters[1].invuln = 1_000_000;
    forceMove(s, 0, def.id);
    let first = -1;
    let active = 0;
    let frame = 0;
    // Klatka 1 = pierwsza klatka po wciśnięciu.
    while (frame < 240) {
      frame++;
      step(s, 0, 0);
      const f = s.fighters[0];
      // Pocisk liczymy jako fazę aktywną w klatce wystrzału.
      const spawned = s.events.some((e) => e.type === EV_SPAWN);
      if (isMoveActive(f) || spawned) {
        if (first < 0) first = frame;
        active++;
      }
      if (f.state !== ST_ATTACK && f.state !== ST_THROWING) break;
    }
    const total = frame;
    out.push({
      id: def.id,
      name: m.def.name,
      startup: first,
      active,
      recovery: first < 0 ? total : total - first - active + 1,
      total,
      // Ruchy z pociskiem: obrażenia pocisku.
      damage: m.keys.some((k) => k.spawn >= 0) ? t.projectiles[m.keys.find((k) => k.spawn >= 0)!.spawn]!.hit.damage : m.damage * m.maxHits,
      level: def.level,
      kind: def.kind === 'linear' ? 'linear' : 'rotational',
    });
  }
  return out;
}
