// RetroArch Network RetroPad sender
// ──────────────────────────────────
// Talks to RetroArch's Network Gamepad receiver (Settings > Input > Network
// Gamepad, `network_remote_enable = true`), which binds one UDP socket per
// enabled player at `network_remote_base_port + player` (default 55400+).
//
// Wire format (from RetroArch input/input_driver.h, struct remote_message):
//
//   struct remote_message {
//     int      port;    // offset  0 — player index; receiver derives the user
//                       //             from the socket, but we mirror it anyway
//     int      device;  // offset  4 — RETRO_DEVICE_JOYPAD (1) or _ANALOG (2)
//     int      index;   // offset  8 — analog stick: 0 = left, 1 = right
//     int      id;      // offset 12 — button id (0-15) or axis (0 = X, 1 = Y)
//     uint16_t state;   // offset 16 — 1/0 for buttons, int16 for analog axes
//   };                  // sizeof == 20 (2 trailing pad bytes)
//
// The receiver (input/input_driver.c) only parses datagrams whose size is
// exactly sizeof(struct remote_message) and reads the struct with the host's
// native layout — little-endian on every platform RetroArch ships on. Two
// receiver behaviors matter to callers:
//
//   1. LATCHING — a button stays pressed until an explicit state=0 message
//      arrives. There is no per-frame keepalive.
//   2. ONE DATAGRAM PER FRAME — the receiver consumes at most one queued
//      datagram per emulated frame per player. Two changes sent back-to-back
//      apply on two consecutive frames, not the same one. For frame-accurate
//      scripting, interleave sends with FRAMEADVANCE while paused.
//
// A datagram of any OTHER size makes the receiver zero all buttons and axes
// for that player — releaseAll() uses that deliberately as a single-packet
// panic reset.
//
// There is no handshake and no acknowledgement; this is fire-and-forget UDP,
// same as the NCI command channel.

import dgram from "node:dgram";

export const RETRO_DEVICE_JOYPAD = 1;
export const RETRO_DEVICE_ANALOG = 2;

/** libretro RetroPad button ids (RETRO_DEVICE_ID_JOYPAD_*). */
export const BUTTON_IDS = {
  b: 0, y: 1, select: 2, start: 3,
  up: 4, down: 5, left: 6, right: 7,
  a: 8, x: 9, l: 10, r: 11,
  l2: 12, r2: 13, l3: 14, r3: 15,
} as const;

export type ButtonName = keyof typeof BUTTON_IDS;

const ANALOG_INDEX = { left: 0, right: 1 } as const;
export type StickName = keyof typeof ANALOG_INDEX;

export interface RemoteMessage {
  port: number;
  device: number;
  index: number;
  id: number;
  /** 1/0 for buttons; int16 (-32768..32767) for analog axes. */
  state: number;
}

/** Encode one remote_message as the exact 20-byte struct RetroArch expects. */
export function encodeRemoteMessage(msg: RemoteMessage): Buffer {
  const buf = Buffer.alloc(20); // trailing 2 pad bytes stay zero
  buf.writeInt32LE(msg.port, 0);
  buf.writeInt32LE(msg.device, 4);
  buf.writeInt32LE(msg.index, 8);
  buf.writeInt32LE(msg.id, 12);
  // Buttons use 0/1; analog axes are int16 sent through the uint16 field.
  buf.writeUInt16LE(msg.state < 0 ? msg.state + 0x10000 : msg.state, 16);
  return buf;
}

export interface RetropadOptions {
  /** Target host. Default 127.0.0.1. */
  host?: string;
  /** RetroArch's `network_remote_base_port`; player N listens at base+N. Default 55400. */
  basePort?: number;
}

export class RetropadClient {
  private socket: dgram.Socket | null = null;
  private readonly host: string;
  private readonly basePort: number;

  constructor(opts: RetropadOptions = {}) {
    this.host = opts.host ?? "127.0.0.1";
    this.basePort = opts.basePort ?? 55400;
  }

  describeTarget(): string {
    return `udp ${this.host}:${this.basePort}+player`;
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  private sendRaw(payload: Buffer, player: number): Promise<void> {
    if (!Number.isInteger(player) || player < 0 || player > 20) {
      throw new Error(`player must be an integer 0-20, got ${player}`);
    }
    if (!this.socket) this.socket = dgram.createSocket("udp4");
    return new Promise((resolve, reject) => {
      this.socket!.send(payload, this.basePort + player, this.host, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  private sendMessage(player: number, device: number, index: number, id: number, state: number): Promise<void> {
    return this.sendRaw(encodeRemoteMessage({ port: player, device, index, id, state }), player);
  }

  private static buttonId(name: string): number {
    const id = BUTTON_IDS[name.toLowerCase() as ButtonName];
    if (id === undefined) {
      throw new Error(
        `unknown button "${name}" — valid RetroPad names: ${Object.keys(BUTTON_IDS).join(", ")}`,
      );
    }
    return id;
  }

  /** Press (latch down) each named button. State persists until released. */
  async pressButtons(buttons: readonly string[], player = 0): Promise<void> {
    const ids = buttons.map(RetropadClient.buttonId); // validate all before sending any
    for (const id of ids) {
      await this.sendMessage(player, RETRO_DEVICE_JOYPAD, 0, id, 1);
    }
  }

  /** Release each named button. */
  async releaseButtons(buttons: readonly string[], player = 0): Promise<void> {
    const ids = buttons.map(RetropadClient.buttonId);
    for (const id of ids) {
      await this.sendMessage(player, RETRO_DEVICE_JOYPAD, 0, id, 0);
    }
  }

  /** Set one analog stick's X and Y axes (each -32768..32767; 0,0 = centered). */
  async setAnalog(stick: StickName, x: number, y: number, player = 0): Promise<void> {
    const index = ANALOG_INDEX[stick];
    if (index === undefined) {
      throw new Error(`unknown stick "${stick}" — expected "left" or "right"`);
    }
    for (const v of [x, y]) {
      if (!Number.isInteger(v) || v < -32768 || v > 32767) {
        throw new Error(`analog value ${v} outside int16 range -32768..32767`);
      }
    }
    await this.sendMessage(player, RETRO_DEVICE_ANALOG, index, 0, x);
    await this.sendMessage(player, RETRO_DEVICE_ANALOG, index, 1, y);
  }

  /**
   * Zero every button and both analog sticks for the player in one packet.
   * Sends a deliberately undersized datagram: RetroArch's receiver resets all
   * input state for a player whenever it reads a datagram whose size is not
   * exactly sizeof(struct remote_message).
   */
  async releaseAll(player = 0): Promise<void> {
    await this.sendRaw(Buffer.from([0]), player);
  }
}
