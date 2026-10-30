// Snapshot / przywracanie stanu (fundament rollbacku) i hash do wykrywania desynchronizacji.
import type { GameState } from './types';

export function snapshot(s: GameState): GameState {
  return structuredClone(s);
}

export function restore(target: GameState, snap: GameState): void {
  Object.assign(target, structuredClone(snap));
}

/** FNV-1a po deterministycznej serializacji stanu (bez zdarzeń kosmetycznych). */
export function hashState(s: GameState): number {
  const json = JSON.stringify(s, (k, v: unknown) => (k === 'events' ? undefined : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
