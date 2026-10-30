// Wiadomości sieciowe (JSON). Małe, walidowane przy odbiorze.
export type NetMsg =
  | { t: 'hello'; ver: number }
  | { t: 'pick'; tank: number; ready: boolean; arena: number }
  | { t: 'start'; seed: number; tanks: [number, number]; arena: number; match: number }
  | { t: 'in'; m: number; f: number; i: number[]; ack: number }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'hash'; m: number; f: number; h: number }
  | { t: 'rematch' };

export const NET_VERSION = 3;
const MAX_LEN = 4096;

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** Walidacja przychodzącej wiadomości – nieznane lub zniekształcone są odrzucane. */
export function parseMsg(raw: unknown): NetMsg | null {
  if (typeof raw === 'string') {
    if (raw.length > MAX_LEN) return null;
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m['t']) {
    case 'hello':
      return isInt(m['ver']) ? { t: 'hello', ver: m['ver'] } : null;
    case 'pick':
      return isInt(m['tank']) && typeof m['ready'] === 'boolean' && isInt(m['arena'])
        ? { t: 'pick', tank: m['tank'], ready: m['ready'], arena: m['arena'] } : null;
    case 'start': {
      const tanks = m['tanks'];
      if (!isInt(m['seed']) || !isInt(m['arena']) || !isInt(m['match']) || !Array.isArray(tanks) || tanks.length !== 2 || !tanks.every(isInt)) return null;
      return { t: 'start', seed: m['seed'], tanks: [tanks[0] as number, tanks[1] as number], arena: m['arena'], match: m['match'] };
    }
    case 'in': {
      const i = m['i'];
      if (!isInt(m['f']) || !isInt(m['m']) || !isInt(m['ack']) || !Array.isArray(i) || i.length > 16 || !i.every(isInt)) return null;
      return { t: 'in', m: m['m'], f: m['f'], i: i as number[], ack: m['ack'] };
    }
    case 'ping':
      return isInt(m['ts']) ? { t: 'ping', ts: m['ts'] } : null;
    case 'pong':
      return isInt(m['ts']) ? { t: 'pong', ts: m['ts'] } : null;
    case 'hash':
      return isInt(m['f']) && isInt(m['h']) && isInt(m['m']) ? { t: 'hash', m: m['m'], f: m['f'], h: m['h'] } : null;
    case 'rematch':
      return { t: 'rematch' };
    default:
      return null;
  }
}

/** Kanał do przeciwnika (P2P albo testowy w pamięci). */
export interface Transport {
  send(msg: NetMsg): void;
  onMessage: ((msg: NetMsg) => void) | null;
  onClose: (() => void) | null;
  close(): void;
}

/** Symulacja słabego łącza: opóźnienie, wahania i utrata pakietów (`?lag=120&jitter=30&loss=5`). */
export class LossyTransport implements Transport {
  onMessage: ((msg: NetMsg) => void) | null = null;
  onClose: (() => void) | null = null;
  constructor(
    private readonly inner: Transport,
    private readonly lag: number,
    private readonly jitter: number,
    private readonly loss: number,
  ) {
    inner.onMessage = (m) => this.deliver(m);
    inner.onClose = () => this.onClose?.();
  }

  private deliver(m: NetMsg): void {
    // Utrata dotyczy tylko wejść (redundantnych) – wiadomości lobby muszą dojść.
    if (m.t === 'in' && Math.random() * 100 < this.loss) return;
    const d = this.lag / 2 + (Math.random() - 0.5) * this.jitter;
    window.setTimeout(() => this.onMessage?.(m), Math.max(0, d));
  }

  send(msg: NetMsg): void {
    if (msg.t === 'in' && Math.random() * 100 < this.loss) return;
    const d = this.lag / 2 + (Math.random() - 0.5) * this.jitter;
    window.setTimeout(() => this.inner.send(msg), Math.max(0, d));
  }

  close(): void {
    this.inner.close();
  }
}
