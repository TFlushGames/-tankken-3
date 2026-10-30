// Połączenie P2P (WebRTC) przez PeerJS. Darmowy publiczny serwer PeerJS służy tylko do
// zestawienia połączenia; dalej dane płyną bezpośrednio między przeglądarkami.
import type { DataConnection, Peer as PeerType } from 'peerjs';
import { parseMsg, type NetMsg, type Transport } from './protocol';

const ID_PREFIX = 'tankken3-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(raw: string): string | null {
  const c = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 6 ? c : null;
}

class ConnTransport implements Transport {
  onMessage: ((msg: NetMsg) => void) | null = null;
  onClose: (() => void) | null = null;
  constructor(readonly conn: DataConnection) {
    conn.on('data', (d) => {
      const m = parseMsg(d);
      if (m) this.onMessage?.(m);
    });
    conn.on('close', () => this.onClose?.());
    conn.on('error', () => this.onClose?.());
  }
  send(msg: NetMsg): void {
    if (this.conn.open) void this.conn.send(msg);
  }
  close(): void {
    this.conn.close();
  }
}

export interface PeerEvents {
  /** Gospodarz: pokój gotowy (kod zarejestrowany). */
  onRoomReady?: (code: string) => void;
  /** Połączenie z przeciwnikiem gotowe. */
  onConnected: (t: Transport) => void;
  onError: (message: string) => void;
}

/** Pokój P2P: gospodarz rejestruje identyfikator z kodem, gość łączy się z nim. */
export class PeerRoom {
  private peer: PeerType | null = null;
  private conn: DataConnection | null = null;
  code = '';
  readonly isHost: boolean;

  private constructor(isHost: boolean, private readonly ev: PeerEvents) {
    this.isHost = isHost;
  }

  static async host(ev: PeerEvents, attempt = 0): Promise<PeerRoom> {
    const room = new PeerRoom(true, ev);
    const { Peer } = await import('peerjs');
    room.code = randomCode();
    const peer = new Peer(ID_PREFIX + room.code, peerOptions());
    room.peer = peer;
    peer.on('open', () => ev.onRoomReady?.(room.code));
    peer.on('connection', (c) => {
      if (room.conn && room.conn.open) {
        c.close();
        return;
      }
      room.conn = c;
      c.on('open', () => ev.onConnected(new ConnTransport(c)));
    });
    peer.on('error', (e: { type?: string }) => {
      if (e.type === 'unavailable-id' && attempt < 3) {
        peer.destroy();
        void PeerRoom.host(ev, attempt + 1);
        return;
      }
      ev.onError(describe(e.type));
    });
    peer.on('disconnected', () => {
      // Utrata połączenia z serwerem pośredniczącym nie zrywa gry – spróbuj wrócić.
      if (!peer.destroyed) peer.reconnect();
    });
    return room;
  }

  static async join(code: string, ev: PeerEvents): Promise<PeerRoom> {
    const room = new PeerRoom(false, ev);
    room.code = code;
    const { Peer } = await import('peerjs');
    const peer = new Peer(peerOptions());
    room.peer = peer;
    peer.on('open', () => room.connect());
    peer.on('error', (e: { type?: string }) => ev.onError(describe(e.type)));
    return room;
  }

  /** Gość: (ponowne) połączenie z gospodarzem. */
  connect(): void {
    if (!this.peer || this.isHost) return;
    const c = this.peer.connect(ID_PREFIX + this.code, { reliable: true, serialization: 'json' });
    this.conn = c;
    c.on('open', () => this.ev.onConnected(new ConnTransport(c)));
  }

  destroy(): void {
    this.conn?.close();
    this.peer?.destroy();
    this.peer = null;
    this.conn = null;
  }
}

/**
 * Opcje serwera pośredniczącego. Domyślnie darmowy publiczny serwer PeerJS; własny można
 * wskazać parametrami adresu: ?peerhost=…&peerport=…&peerpath=…&peersecure=0
 */
function peerOptions(): Record<string, unknown> {
  const p = new URLSearchParams(location.search);
  const host = p.get('peerhost');
  const o: Record<string, unknown> = { debug: 0 };
  if (host) {
    o['host'] = host;
    o['port'] = Number(p.get('peerport') ?? 443);
    o['path'] = p.get('peerpath') ?? '/';
    o['secure'] = p.get('peersecure') !== '0';
  }
  return o;
}

function describe(type: string | undefined): string {
  switch (type) {
    case 'peer-unavailable':
      return 'There is no room with this code (or the host has left).';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Cannot reach the matchmaking server. Check your internet connection and try again.';
    case 'browser-incompatible':
      return 'This browser does not support WebRTC.';
    case 'webrtc':
      return 'Could not establish a peer-to-peer connection (your network may block it).';
    default:
      return `Connection error (${type ?? 'unknown'}).`;
  }
}
