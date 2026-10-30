import { describe, expect, it } from 'vitest';
import { TANKS } from '../src/data/tanks';
import { computeFrameData } from '../src/sim/framedata';

describe('frame data', () => {
  it('każdy ruch każdego czołgu ma fazę aktywną i kończy się', () => {
    for (let i = 0; i < TANKS.length; i++) {
      const fd = computeFrameData(i);
      if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env['PRINT_FD']) {
        console.log(`== ${TANKS[i]!.name}\n` + fd.map((d) => `${d.id.padEnd(9)} ${`${d.startup}/${d.active}/${d.recovery}`.padEnd(10)} ${d.damage}`).join('\n'));
      }
      for (const d of fd) {
        expect(d.startup, `${TANKS[i]!.name} ${d.id}`).toBeGreaterThan(0);
        expect(d.active).toBeGreaterThan(0);
        expect(d.total).toBeLessThan(200);
      }
    }
  });
});
