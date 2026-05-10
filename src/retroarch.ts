// RetroArch Network Control Interface (NCI) client
// ─────────────────────────────────────────────────
// Wire format (text-based UDP):
//   Send:    "COMMAND arg1 arg2 ...\n" as a single UDP datagram
//   Receive: One UDP datagram per response, plain text. Most responses echo
//            the command name as a prefix (e.g. "READ_CORE_MEMORY 0x1000 ab cd ef").
//            VERSION is the only one with no echo — the response is just the
//            version string itself.
//
// Default port: 55355 (UDP). Enable in retroarch.cfg with:
//   network_cmd_enable = "true"
//   network_cmd_port = "55355"
// (Or via Settings > Network > Network Commands.)
//
// Concurrency model: this client serializes — exactly one query in flight at
// a time. UDP responses don't carry request IDs, and matching by command-name
// echo is fragile (VERSION doesn't echo at all, two reads to different
// addresses look indistinguishable to a naive matcher). Serial keeps the
// implementation honest and small. Loopback latency makes this fine.

import dgram from "node:dgram";

export interface RetroArchOptions {
  /** Target host (UDP destination). Default 127.0.0.1. */
  host?: string;
  /** UDP port. Must match `network_cmd_port` in retroarch.cfg. Default 55355. */
  port?: number;
  /** Per-call timeout in ms (responses only). Default 5000. */
  timeoutMs?: number;
}

export type EmuStatus =
  | { state: "playing" | "paused"; system: string; game: string; crc32?: string }
  | { state: "contentless" };

export class RetroArchClient {
  private socket: dgram.Socket | null = null;
  private pending: ((data: Buffer) => void) | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(opts: RetroArchOptions = {}) {
    this.host      = opts.host       ?? "127.0.0.1";
    this.port      = opts.port       ?? 55355;
    this.timeoutMs = opts.timeoutMs  ?? 5000;
  }

  describeTarget(): string {
    return `udp ${this.host}:${this.port}`;
  }

  /** Open a UDP socket and bind a message handler. */
  async connect(): Promise<void> {
    if (this.socket) return;
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket("udp4");
      sock.once("error", (err) => reject(err));
      sock.bind(0, () => {
        sock.on("message", (msg) => {
          const cb = this.pending;
          if (!cb) return;       // unsolicited or late reply — drop
          this.pending = null;
          cb(msg);
        });
        sock.on("error", () => { /* swallow late errors */ });
        this.socket = sock;
        resolve();
      });
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  /** Fire-and-forget send. Use for hotkey-style commands (PAUSE_TOGGLE, etc.). */
  async send(command: string): Promise<void> {
    if (!this.socket) await this.connect();
    return new Promise((resolve, reject) => {
      this.socket!.send(command, this.port, this.host, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  /**
   * Send and await one UDP response. Serial: throws if a previous query is
   * still in flight. Times out per `timeoutMs`.
   */
  async query(command: string): Promise<Buffer> {
    if (!this.socket) await this.connect();
    if (this.pending) {
      throw new Error("retroarch query already in flight (client is serial)");
    }
    return new Promise<Buffer>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = setTimeout(() => {
        this.pending = null;
        reject(new Error(
          `RetroArch query "${command.split(" ")[0]}" timed out after ${this.timeoutMs}ms ` +
          `— is RetroArch running with Network Commands enabled?`,
        ));
      }, this.timeoutMs);

      this.pending = (data) => {
        if (timer) { clearTimeout(timer); timer = null; }
        resolve(data);
      };

      this.socket!.send(command, this.port, this.host, (err) => {
        if (err) {
          if (timer) { clearTimeout(timer); timer = null; }
          this.pending = null;
          reject(err);
        }
      });
    });
  }

  // ── High-level commands ────────────────────────────────────────────────

  async getVersion(): Promise<string> {
    const r = await this.query("VERSION");
    return r.toString().trim();
  }

  async getStatus(): Promise<EmuStatus> {
    const r = (await this.query("GET_STATUS")).toString().trim();
    // "GET_STATUS PAUSED system_id,game_basename,crc32=XXXXXXXX"
    // "GET_STATUS PLAYING ..."
    // "GET_STATUS CONTENTLESS"
    const m = r.match(/^GET_STATUS\s+(\w+)(?:\s+([^,]+),(.+?)(?:,crc32=([0-9a-fA-F]+))?)?$/);
    if (!m) throw new Error(`unexpected GET_STATUS reply: ${r}`);
    const state = m[1].toLowerCase();
    if (state === "contentless") return { state: "contentless" };
    if (state !== "playing" && state !== "paused") {
      throw new Error(`unexpected emulator state: ${state}`);
    }
    return {
      state,
      system: m[2] ?? "(unknown)",
      game:   m[3] ?? "(unknown)",
      crc32:  m[4],
    };
  }

  /** Memory read via libretro's system memory map (preferred). */
  async readMemory(addr: number, length: number): Promise<Uint8Array> {
    if (length <= 0)   throw new Error("length must be positive");
    if (length > 4096) throw new Error("length exceeds 4096 byte limit");
    const cmd = `READ_CORE_MEMORY 0x${addr.toString(16)} ${length}`;
    const r = (await this.query(cmd)).toString().trim();
    return parseMemoryReply(r, "READ_CORE_MEMORY", length);
  }

  /** Memory read via the achievements (CHEEVOS) address space. */
  async readRam(addr: number, length: number): Promise<Uint8Array> {
    if (length <= 0)   throw new Error("length must be positive");
    if (length > 4096) throw new Error("length exceeds 4096 byte limit");
    const cmd = `READ_CORE_RAM 0x${addr.toString(16)} ${length}`;
    const r = (await this.query(cmd)).toString().trim();
    return parseMemoryReply(r, "READ_CORE_RAM", length);
  }

  /** Memory write via libretro's system memory map (preferred). */
  async writeMemory(addr: number, bytes: Uint8Array | number[]): Promise<number> {
    if (bytes.length === 0)    throw new Error("at least one byte required");
    if (bytes.length > 4096)   throw new Error("byte count exceeds 4096 limit");
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const cmd = `WRITE_CORE_MEMORY 0x${addr.toString(16)} ${hex}`;
    const r = (await this.query(cmd)).toString().trim();
    // "WRITE_CORE_MEMORY <addr> <bytes_written>" or "<addr> -1 <error>"
    const m = r.match(/^WRITE_CORE_MEMORY\s+\S+\s+(-?\d+)(?:\s+(.+))?$/);
    if (!m) throw new Error(`unexpected WRITE_CORE_MEMORY reply: ${r}`);
    const n = parseInt(m[1], 10);
    if (n < 0) throw new Error(`WRITE_CORE_MEMORY failed: ${m[2] ?? "(no error message)"}`);
    return n;
  }

  /** Memory write via CHEEVOS address space. No reply — fire-and-forget. */
  async writeRam(addr: number, bytes: Uint8Array | number[]): Promise<void> {
    if (bytes.length === 0)    throw new Error("at least one byte required");
    if (bytes.length > 4096)   throw new Error("byte count exceeds 4096 limit");
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
    await this.send(`WRITE_CORE_RAM 0x${addr.toString(16)} ${hex}`);
  }

  // ── Emulator control (all fire-and-forget) ─────────────────────────────

  async pauseToggle():    Promise<void> { await this.send("PAUSE_TOGGLE"); }
  async frameAdvance():   Promise<void> { await this.send("FRAMEADVANCE"); }
  async reset():          Promise<void> { await this.send("RESET"); }
  async screenshot():     Promise<void> { await this.send("SCREENSHOT"); }
  async showMessage(msg: string): Promise<void> { await this.send(`SHOW_MSG ${msg}`); }

  // ── Save state ─────────────────────────────────────────────────────────
  // RetroArch's NCI exposes:
  //   * SAVE_STATE         — save to currently-selected slot (no reply)
  //   * LOAD_STATE         — load from currently-selected slot (no reply)
  //   * LOAD_STATE_SLOT N  — load from explicit slot (echoes command)
  //   * STATE_SLOT_PLUS / STATE_SLOT_MINUS — change current slot
  // There's NO "save_state_slot N" or "get_current_slot" — saving to a
  // specific slot requires walking the slot pointer to it first.

  async saveStateCurrent(): Promise<void> { await this.send("SAVE_STATE"); }
  async loadStateCurrent(): Promise<void> { await this.send("LOAD_STATE"); }
  async loadStateSlot(slot: number): Promise<void> {
    await this.query(`LOAD_STATE_SLOT ${slot}`);
  }
  async stateSlotPlus():   Promise<void> { await this.send("STATE_SLOT_PLUS"); }
  async stateSlotMinus():  Promise<void> { await this.send("STATE_SLOT_MINUS"); }

  // ── Config / paths ──────────────────────────────────────────────────────

  /** GET_CONFIG_PARAM — query select RetroArch config values by name. */
  async getConfigParam(name: string): Promise<string> {
    const r = (await this.query(`GET_CONFIG_PARAM ${name}`)).toString().trim();
    // "GET_CONFIG_PARAM <name> <value>"
    const prefix = `GET_CONFIG_PARAM ${name} `;
    if (!r.startsWith(prefix)) throw new Error(`unexpected GET_CONFIG_PARAM reply: ${r}`);
    return r.slice(prefix.length);
  }
}

/**
 * Parse a "READ_CORE_MEMORY <addr> b1 b2 b3 ..." (or READ_CORE_RAM) reply
 * into a byte array. Throws on the documented "-1 <error>" failure shape.
 */
function parseMemoryReply(reply: string, expectedCmd: string, expectedLen: number): Uint8Array {
  const tokens = reply.split(/\s+/);
  if (tokens[0] !== expectedCmd) {
    throw new Error(`unexpected reply prefix (got "${tokens[0]}", expected "${expectedCmd}")`);
  }
  const tail = tokens.slice(2);
  if (tail.length === 0) {
    throw new Error(`${expectedCmd} returned no bytes`);
  }
  // Failure shape: "<cmd> <addr> -1 <error_msg>"
  if (tail[0] === "-1") {
    const err = tail.slice(1).join(" ") || "(no error message)";
    throw new Error(`${expectedCmd} failed: ${err}`);
  }
  const out = new Uint8Array(tail.length);
  for (let i = 0; i < tail.length; i++) {
    const v = parseInt(tail[i], 16);
    if (Number.isNaN(v) || v < 0 || v > 255) {
      throw new Error(`${expectedCmd}: malformed byte at index ${i}: "${tail[i]}"`);
    }
    out[i] = v;
  }
  if (out.length !== expectedLen) {
    // Not strictly an error — RetroArch may clamp at memory-region boundaries.
    // Caller can decide what to do with a short read.
  }
  return out;
}
