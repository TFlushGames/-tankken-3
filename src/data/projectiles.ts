// Pociski ataków specjalnych. Parametry trafienia jak w ruchach (obrażenia przy mnożniku 1,0).
import type { HitLevel } from '../sim/types';

export interface ProjectileDef {
  id: string;
  name: string;
  /** Prędkość (m/s). */
  speed: number;
  /** Promień kuli trafienia (m). */
  radius: number;
  /** Czas życia (klatki). */
  life: number;
  /** Fala sunąca po ziemi (nisko) zamiast pocisku na wysokości lufy. */
  ground: boolean;
  level: HitLevel;
  damage: number;
  hitstun: number;
  blockstun: number;
  knockback: number;
  knockdown?: boolean;
  hitstop: number;
}

export const PROJECTILES: ProjectileDef[] = [
  { id: 'shell', name: 'Cannon shell', speed: 24, radius: 0.45, life: 70, ground: false, level: 'high', damage: 80, hitstun: 22, blockstun: 12, knockback: 4, hitstop: 7 },
  { id: 'wave', name: 'Ground wave', speed: 15, radius: 0.7, life: 60, ground: true, level: 'low', damage: 70, hitstun: 22, blockstun: 12, knockback: 3, knockdown: true, hitstop: 7 },
  { id: 'bertha', name: 'Big shell', speed: 12, radius: 0.8, life: 110, ground: false, level: 'mid', damage: 110, hitstun: 26, blockstun: 16, knockback: 9, knockdown: true, hitstop: 10 },
  { id: 'rail', name: 'Railgun slug', speed: 75, radius: 0.32, life: 30, ground: false, level: 'mid', damage: 100, hitstun: 26, blockstun: 14, knockback: 7, hitstop: 10 },
];
