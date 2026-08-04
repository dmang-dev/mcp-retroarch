// Packet-level tests for the Network RetroPad sender.
//
// RetroArch's receiver (input/input_driver.c) does:
//   recvfrom(fd, &msg, sizeof(msg)) where msg is
//   struct remote_message { int port; int device; int index; int id; uint16_t state; }
// and only parses when ret == sizeof(msg) — i.e. exactly 20 bytes with
// standard x86/ARM alignment (4×int32 LE + uint16 LE + 2 pad bytes).
// Any other datagram size zeroes ALL input state for that user.
//
// These tests pin the exact wire bytes against a loopback UDP listener; no
// RetroArch instance is required.

import { test } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import {
  encodeRemoteMessage,
  RetropadClient,
  RETRO_DEVICE_JOYPAD,
  RETRO_DEVICE_ANALOG,
  BUTTON_IDS,
} from "./retropad.js";

// ── encoding ──────────────────────────────────────────────────────────────

test("encodeRemoteMessage produces a 20-byte little-endian struct", () => {
  const buf = encodeRemoteMessage({ port: 0, device: 1, index: 0, id: 8, state: 1 });
  assert.equal(buf.length, 20);
  assert.equal(buf.readInt32LE(0), 0);   // port
  assert.equal(buf.readInt32LE(4), 1);   // device
  assert.equal(buf.readInt32LE(8), 0);   // index
  assert.equal(buf.readInt32LE(12), 8);  // id
  assert.equal(buf.readUInt16LE(16), 1); // state
  assert.equal(buf.readUInt16LE(18), 0); // struct padding — must be zero
});

test("encodeRemoteMessage encodes negative analog values as two's-complement uint16", () => {
  const min = encodeRemoteMessage({ port: 0, device: RETRO_DEVICE_ANALOG, index: 0, id: 0, state: -32768 });
  assert.equal(min.readUInt16LE(16), 0x8000);
  const negOne = encodeRemoteMessage({ port: 0, device: RETRO_DEVICE_ANALOG, index: 1, id: 1, state: -1 });
  assert.equal(negOne.readUInt16LE(16), 0xffff);
});

test("BUTTON_IDS matches the libretro RetroPad id layout", () => {
  assert.deepEqual(
    { b: 0, y: 1, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7,
      a: 8, x: 9, l: 10, r: 11, l2: 12, r2: 13, l3: 14, r3: 15 },
    BUTTON_IDS,
  );
});

// ── UDP sending against a loopback listener ───────────────────────────────

interface Listener {
  port: number;
  packets: Buffer[];
  waitFor(count: number): Promise<Buffer[]>;
  close(): void;
}

function listen(): Promise<Listener> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    const packets: Buffer[] = [];
    let waiting: { count: number; resolve: (p: Buffer[]) => void } | null = null;
    sock.on("message", (msg) => {
      packets.push(Buffer.from(msg));
      if (waiting && packets.length >= waiting.count) {
        waiting.resolve(packets);
        waiting = null;
      }
    });
    sock.once("error", reject);
    sock.bind(0, "127.0.0.1", () => {
      resolve({
        port: sock.address().port,
        packets,
        waitFor(count: number) {
          if (packets.length >= count) return Promise.resolve(packets);
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error(`timed out waiting for ${count} packets (got ${packets.length})`)), 2000);
            waiting = { count, resolve: (p) => { clearTimeout(t); res(p); } };
          });
        },
        close() { sock.close(); },
      });
    });
  });
}

test("pressButtons sends one 20-byte joypad message per button with state=1", async () => {
  const l = await listen();
  const pad = new RetropadClient({ host: "127.0.0.1", basePort: l.port });
  try {
    await pad.pressButtons(["a", "up"]);
    const pkts = await l.waitFor(2);
    for (const p of pkts) assert.equal(p.length, 20);
    assert.equal(pkts[0].readInt32LE(4), RETRO_DEVICE_JOYPAD);
    assert.equal(pkts[0].readInt32LE(12), BUTTON_IDS.a);
    assert.equal(pkts[0].readUInt16LE(16), 1);
    assert.equal(pkts[1].readInt32LE(12), BUTTON_IDS.up);
    assert.equal(pkts[1].readUInt16LE(16), 1);
  } finally {
    pad.close();
    l.close();
  }
});

test("releaseButtons sends state=0 for each button", async () => {
  const l = await listen();
  const pad = new RetropadClient({ host: "127.0.0.1", basePort: l.port });
  try {
    await pad.releaseButtons(["start"]);
    const pkts = await l.waitFor(1);
    assert.equal(pkts[0].length, 20);
    assert.equal(pkts[0].readInt32LE(12), BUTTON_IDS.start);
    assert.equal(pkts[0].readUInt16LE(16), 0);
  } finally {
    pad.close();
    l.close();
  }
});

test("player index selects basePort + player", async () => {
  const l = await listen();
  // Listener is bound to one port; target player 1 with basePort = port - 1.
  const pad = new RetropadClient({ host: "127.0.0.1", basePort: l.port - 1 });
  try {
    await pad.pressButtons(["b"], 1);
    const pkts = await l.waitFor(1);
    assert.equal(pkts[0].readInt32LE(0), 1); // port field mirrors player index
    assert.equal(pkts[0].readInt32LE(12), BUTTON_IDS.b);
  } finally {
    pad.close();
    l.close();
  }
});

test("setAnalog sends X and Y messages for the named stick", async () => {
  const l = await listen();
  const pad = new RetropadClient({ host: "127.0.0.1", basePort: l.port });
  try {
    await pad.setAnalog("right", 12345, -20000);
    const pkts = await l.waitFor(2);
    assert.equal(pkts[0].readInt32LE(4), RETRO_DEVICE_ANALOG);
    assert.equal(pkts[0].readInt32LE(8), 1);        // index: right stick
    assert.equal(pkts[0].readInt32LE(12), 0);       // id: X
    assert.equal(pkts[0].readUInt16LE(16), 12345);
    assert.equal(pkts[1].readInt32LE(12), 1);       // id: Y
    assert.equal(pkts[1].readInt16LE(16), -20000);
  } finally {
    pad.close();
    l.close();
  }
});

test("setAnalog rejects out-of-range values instead of truncating", async () => {
  const pad = new RetropadClient({ host: "127.0.0.1", basePort: 55400 });
  try {
    await assert.rejects(() => pad.setAnalog("left", 40000, 0), /range/);
    await assert.rejects(() => pad.setAnalog("left", 0, -40000), /range/);
  } finally {
    pad.close();
  }
});

test("pressButtons rejects unknown button names", async () => {
  const pad = new RetropadClient({ host: "127.0.0.1", basePort: 55400 });
  try {
    await assert.rejects(() => pad.pressButtons(["triangle"]), /unknown button/i);
  } finally {
    pad.close();
  }
});

test("releaseAll sends a deliberately short datagram (receiver zeroes all input)", async () => {
  const l = await listen();
  const pad = new RetropadClient({ host: "127.0.0.1", basePort: l.port });
  try {
    await pad.releaseAll();
    const pkts = await l.waitFor(1);
    assert.notEqual(pkts[0].length, 20);
  } finally {
    pad.close();
    l.close();
  }
});
