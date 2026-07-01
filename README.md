# mcp-retroarch

[![npm version](https://img.shields.io/npm/v/mcp-retroarch.svg)](https://www.npmjs.com/package/mcp-retroarch)
[![npm downloads](https://img.shields.io/npm/dm/mcp-retroarch.svg)](https://www.npmjs.com/package/mcp-retroarch)
[![CI](https://github.com/dmang-dev/mcp-retroarch/actions/workflows/ci.yml/badge.svg)](https://github.com/dmang-dev/mcp-retroarch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/mcp-retroarch.svg)](LICENSE)
[![Snyk](https://snyk.io/test/npm/mcp-retroarch/badge.svg)](https://snyk.io/test/npm/mcp-retroarch)
[![Socket](https://img.shields.io/badge/Socket-security-2F7BFF?logo=socket)](https://socket.dev/npm/package/mcp-retroarch)
[![Bundlephobia](https://img.shields.io/badge/bundlephobia-size-FF6B81)](https://bundlephobia.com/package/mcp-retroarch)
[![npmgraph](https://img.shields.io/badge/npmgraph-dependencies-2496ED)](https://npmgraph.js.org/?q=mcp-retroarch)

An [MCP](https://modelcontextprotocol.io) server that bridges Claude (and any other MCP client) to [RetroArch](https://www.retroarch.com/) via its built-in **Network Control Interface** (UDP, port 55355).

Works against any libretro core (NES, SNES, Genesis, GB/GBC/GBA, PSX, N64, etc.) — give the model memory r/w, save-state automation, screenshot, pause / frame-advance / reset, and on-screen messages.

## What it can do

| Capability | Available? | Notes |
|---|---|---|
| Memory read / write | ✅ | Two paths: `READ_CORE_MEMORY` (system memory map, preferred) and `READ_CORE_RAM` (CHEEVOS, fallback) |
| Save / load state | ✅ | Current slot or explicit slot for load; save is current-slot-only (NCI limitation) |
| Screenshot | ✅ | Saved to RetroArch's configured screenshot directory |
| Pause / frame advance | ✅ | `PAUSE_TOGGLE` flips state; `FRAMEADVANCE` steps one frame |
| Reset | ✅ | Hard-reset the running game |
| On-screen message | ✅ | Useful for "look here" cues during scripted runs |
| Game info | ✅ | Title, system, CRC32 |
| **Game-pad input** | ❌ | **NCI doesn't expose this.** RetroArch has a separate "Remote RetroPad" core on UDP port 55400 that does, but it requires loading that specific core (you can't drive an existing emulation core through it). Not in scope for v0.1.0. |

If you need game-pad input on Game Boy Advance specifically, see [mcp-mgba](https://github.com/dmang-dev/mcp-mgba). For PCSX2 (memory + savestate only, no input/screenshot), see [mcp-pine](https://github.com/dmang-dev/mcp-pine).

## How it works

```
+----------------+    stdio     +-----------------+   UDP :55355  +-----------------+
|   MCP client   |   JSON-RPC   |  mcp-retroarch  |  text proto   |    RetroArch    |
|  (Claude etc)  | -----------> |    (Node.js)    | ------------> |  (NCI enabled)  |
+----------------+              +-----------------+               +-----------------+
```

## Requirements

- **RetroArch** (any recent version) with Network Commands enabled
- **Node.js 22+**

## Install

### Option A — install from npm (recommended)

```bash
npm install -g mcp-retroarch
```

### Option B — `npx` (no install)

```bash
npx -y mcp-retroarch
```

### Option C — clone and develop

```bash
git clone https://github.com/dmang-dev/mcp-retroarch
cd mcp-retroarch
npm install
```

## Enable RetroArch's Network Control Interface

Either:
- **GUI:** Settings → Network → Network Commands → **ON**, then confirm `Network Cmd Port` is `55355` (the default)
- **Or via `retroarch.cfg`:**
  ```ini
  network_cmd_enable = "true"
  network_cmd_port   = "55355"
  ```

Then launch any libretro core + game. The NCI is always-on once enabled — no script to load.

## Register with your MCP client

### Claude Code

```bash
claude mcp add retroarch --scope user mcp-retroarch
```

Verify:
```bash
claude mcp list
# retroarch: mcp-retroarch - ✓ Connected
```

### Claude Desktop

Edit `claude_desktop_config.json`:

| Platform | Path |
|---|---|
| macOS    | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows  | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux    | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "retroarch": {
      "command": "mcp-retroarch"
    }
  }
}
```

Restart Claude Desktop after editing.

## Configuration

| Env var             | Default       | Purpose |
|---------------------|---------------|---------|
| `RETROARCH_HOST`    | `127.0.0.1`   | UDP destination host |
| `RETROARCH_PORT`    | `55355`       | UDP port (must match `network_cmd_port` in `retroarch.cfg`) |

## Tools

| Tool | Description |
|------|-------------|
| `retroarch_ping` | Verify reachability — returns RetroArch version |
| `retroarch_get_status` | State (playing/paused), system, game, CRC32 |
| `retroarch_get_config` | Read named RetroArch config values (e.g. `savestate_directory`) |
| `retroarch_read_memory` / `retroarch_write_memory` | Memory r/w via system memory map |
| `retroarch_read_ram` / `retroarch_write_ram` | Memory r/w via CHEEVOS address space (fallback when no memory map) |
| `retroarch_pause_toggle` | Toggle pause state |
| `retroarch_frame_advance` | Step one frame (only effective while paused) |
| `retroarch_reset` | Hardware-reset the running game |
| `retroarch_screenshot` | Save a screenshot to RetroArch's screenshot directory |
| `retroarch_show_message` | Display a notification on the RetroArch window |
| `retroarch_save_state_current` | Save to currently-selected slot |
| `retroarch_load_state_current` | Load from currently-selected slot |
| `retroarch_load_state_slot` | Load from explicit slot number |
| `retroarch_state_slot_plus` / `retroarch_state_slot_minus` | Change current slot pointer (NCI has no "set slot to N") |

See [`docs/RECIPES.md`](docs/RECIPES.md) for end-to-end examples.

## Tested cores

Verified end-to-end against `mcp-retroarch`:

| System | Core | `read_memory` | `read_ram` | Notes |
|---|---|---|---|---|
| Game Boy Advance | `mgba_libretro` | ✅ | ✅ | GBA interrupt vector table visible at `0x0000` (`d3 00 00 ea ...`) |
| NES | `mesen_libretro` | ✅ **(only NES core tested that does)** | ✅ | Full 16-bit NES address space exposed. WRAM at `0x0000-0x07FF`, mirrored to `0x1FFF`. CHEEVOS bounded to first 64 KB. |
| NES | `nestopia_libretro` | ❌ no memory map | ✅ | CHEEVOS only. 64 KB bound. **For NES + memory map, prefer Mesen.** |
| SNES | `snes9x_libretro` | ❌ no memory map | ✅ | CHEEVOS bounded to ~128 KB (matches SNES WRAM size). 65C816 RTS opcodes (`60`) visible in code regions. |
| Sega Mega Drive / Genesis | `genesis_plus_gx_libretro` | ❌ no memory map | ⚠️ **sparse** | CHEEVOS exposes some 68K WRAM addresses but fails at others ("no error message"). Usable if you know specific addresses; blanket sweep doesn't work. |
| Nintendo 64 | `mupen64plus_next_libretro` | ✅ | ✅ | Full N64 RAM exposed. KSEG0 mirror is faithful — `read_memory(0x80000000)` returns the same bytes as `read_memory(0x0)`. Bound is the connected RAM size (4 MB without Expansion Pak, 8 MB with). |
| PlayStation 1 | `swanstation_libretro` | ❌ no memory map | ✅ | CHEEVOS only. PSX main RAM begins around CHEEVOS offset `0x010000` (lower addresses are typically zero). |

### Patterns observed

- **Most libretro cores don't advertise a system memory map to NCI** — they implement only the CHEEVOS read API. Of those tested, only **Mesen** (NES) and **Mupen64Plus-Next** (N64) expose a system memory map. Both also expose CHEEVOS, so they're strictly better.
- **System memory maps are faithful to real hardware** — Mupen64Plus-Next preserves the N64's KSEG0 mirror (`0x80000000` reads as `0x0`); Mesen preserves the NES's WRAM mirroring (`0x1000` reads as `0x0`). This is great for anyone using the bridge alongside disassembly.
- **CHEEVOS bounds match the system's main RAM size** — NES exposes 64 KB, SNES 128 KB, etc. Reads past the bound fail with "no error message".
- When choosing a core for memory work, **prefer the one with a system memory map** if available.

If you've tested another core, please open a PR adding it to this table.

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `RetroArch query timed out` | Network Commands aren't enabled in RetroArch, or the port doesn't match `RETROARCH_PORT`. Confirm `network_cmd_enable = "true"` in `retroarch.cfg`. **Also**: UDP datagrams can be dropped under load even on loopback — if a single call times out but a retry succeeds, that's the cause. The bridge doesn't auto-retry; just call again. |
| `READ_CORE_MEMORY failed: no memory map defined` | The loaded libretro core doesn't advertise a system memory map. Try `retroarch_read_ram` (CHEEVOS path) — many cores expose CHEEVOS even without a memory map. Confirmed for SwanStation (PSX); use `read_ram` for that core. |
| `READ_CORE_MEMORY failed: no descriptor for address` | The address isn't covered by the core's memory map. Either a different core would expose it, or the address you want is outside the system bus (e.g. video memory in some cores). |
| Screenshots don't appear where I expect | RetroArch saves to its configured screenshot directory. The NCI doesn't expose `screenshot_directory` via `GET_CONFIG_PARAM`, so check the value via RetroArch's GUI: Settings → Directory → Screenshot. |
| Can't save to a specific state slot directly | NCI limitation, not a bug. The protocol only exposes "save to current slot" — you have to walk the slot pointer to your target with `state_slot_plus`/`state_slot_minus`, then save. |

## Development

```bash
npm install
npm run dev      # tsc --watch
```

Smoke test against a running RetroArch:
```bash
node .scratch/smoke.cjs
```

## Debugging with the MCP Inspector

Browse and call this server's tools interactively with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npm run inspector
```

Build first if you've edited `src/` since your last `npm install` (`npm run build`, or keep `npm run dev` running). Override the target with `RETROARCH_HOST` / `RETROARCH_PORT` (default `127.0.0.1:55355`). `tools/list` works even without RetroArch connected; *calling* a tool needs RetroArch running with Network Commands enabled.

## License

[MIT](LICENSE)

## Related

- [mcp-mgba](https://github.com/dmang-dev/mcp-mgba) — Game Boy Advance via mGBA's Lua bridge (includes button input + screenshot)
- [mcp-pine](https://github.com/dmang-dev/mcp-pine) — PINE-speaking emulators (PCSX2 et al.) — memory + savestate only
- [RetroArch NCI documentation](https://docs.libretro.com/development/retroarch/network-control-interface/)
