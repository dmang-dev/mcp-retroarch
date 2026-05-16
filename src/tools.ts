import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { RetroArchClient } from "./retroarch.js";

// ──────────────────────────────────────────────────────────────────────────────
// Tool descriptions are written to the TDQS rubric (Glama's Tool Definition
// Quality Score). Each description covers, in order:
//
//   • PURPOSE — one clear action sentence.
//   • USAGE — when to use this vs sibling tools (read_memory vs read_ram,
//     pause_toggle vs frame_advance, save_state_current vs slot navigation, etc.).
//   • BEHAVIOR — side effects, error conditions, destructive notes. Reads say
//     "no side effects — pure read." State-mutating tools document the
//     RetroArch NCI fire-and-forget UDP semantics: the protocol does NOT
//     acknowledge most state changes, so writes / control commands return
//     immediately and there is no way to verify they landed without a
//     follow-up observation (read, get_status, screenshot, etc.).
//   • RETURNS — exact shape of the success output.
//
// Each parameter has a `description` that adds context the schema can't
// (units, examples, interactions, address-space caveats).
// ──────────────────────────────────────────────────────────────────────────────

const NCI_TRANSPORT_NOTE =
  "Transport: RetroArch's Network Control Interface (NCI) over UDP " +
  "(default 127.0.0.1:55355, requires `network_cmd_enable = true` in retroarch.cfg).";

const FIRE_AND_FORGET_NOTE =
  "FIRE-AND-FORGET: the NCI does NOT acknowledge this command — the call " +
  "returns as soon as the UDP datagram is sent, with no confirmation that " +
  "RetroArch received or applied it. To verify the effect, follow up with an " +
  "observable tool (retroarch_get_status for run state, retroarch_read_memory / " +
  "retroarch_read_ram for memory mutations, retroarch_screenshot for visual " +
  "state). UDP packets to a not-listening RetroArch are silently dropped.";

const MEMORY_API_NOTE =
  "RetroArch exposes TWO distinct memory APIs with different address spaces:\n" +
  "  • READ_CORE_MEMORY / WRITE_CORE_MEMORY (used by retroarch_read_memory / " +
  "retroarch_write_memory): goes through the libretro core's system memory map. " +
  "Preferred when the loaded core advertises a memory map (most modern cores do). " +
  "Errors with 'no memory map defined' if the loaded core doesn't.\n" +
  "  • READ_CORE_RAM / WRITE_CORE_RAM (used by retroarch_read_ram / retroarch_write_ram): " +
  "uses the achievement (CHEEVOS) address space. Works even when no core memory map is " +
  "defined, but addresses follow CHEEVOS conventions, not the system bus. Use as a " +
  "fallback when read_memory returns 'no memory map defined'.\n" +
  "Both APIs depend on the loaded core's exposed mapping — addresses you used on a " +
  "different core / system will NOT carry over.";

const TOOLS: Tool[] = [
  // ── Connectivity & introspection ────────────────────────────────────────

  {
    name: "retroarch_ping",
    description:
      "PURPOSE: Verify connectivity to RetroArch's Network Control Interface and return the running RetroArch version string. " +
      "USAGE: Call once at start-of-session before issuing other tool calls — if it succeeds, the UDP transport is up and other tools should reach RetroArch. Use retroarch_get_status afterwards to confirm a game is loaded (ping succeeds even when RetroArch is sitting at the menu with no content). " +
      `BEHAVIOR: No side effects — pure liveness probe. ${NCI_TRANSPORT_NOTE} Times out after ~5 seconds with a clear error if RetroArch isn't running, has Network Commands disabled, is bound to a different host/port, or a firewall is blocking UDP 55355. ` +
      "RETURNS: Single line 'OK — RetroArch VERSION', e.g. 'OK — RetroArch 1.20.0'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_get_status",
    description:
      "PURPOSE: Report whether RetroArch is currently playing or paused, plus the loaded system, game basename, and CRC32. " +
      "USAGE: Call after retroarch_ping to learn what (if anything) is loaded; before retroarch_pause_toggle to decide whether the toggle will pause or unpause; before retroarch_frame_advance (which only steps when paused); whenever you need to confirm the previous fire-and-forget control command (pause/reset/load_state) actually took effect. For RetroArch settings (paths, flags) use retroarch_get_config instead — this tool only reports run-state and the loaded ROM identity. " +
      "BEHAVIOR: No side effects — pure read of emulator status via the NCI's GET_STATUS command. Returns 'No content loaded' (state=contentless) when RetroArch is sitting at the menu with no ROM. Returns an error on UDP timeout (RetroArch not reachable). " +
      "RETURNS: When content is loaded: four lines 'State: playing|paused', 'System: SYSTEM_ID', 'Game: BASENAME', 'CRC32: HEX or (none reported)'. When no content: literal 'No content loaded'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_get_config",
    description:
      "PURPOSE: Read a single RetroArch configuration parameter by name via the NCI GET_CONFIG_PARAM command. " +
      "USAGE: Discover RetroArch's filesystem paths and selected settings without parsing retroarch.cfg yourself. For run-state (playing/paused, loaded ROM) use retroarch_get_status instead — this tool only reads static config. RetroArch whitelists which params are exposed; non-whitelisted names error even if they exist in retroarch.cfg. `screenshot_directory` is NOT exposed — see retroarch_screenshot. " +
      `BEHAVIOR: No side effects — pure read. ${NCI_TRANSPORT_NOTE} Errors if the param isn't in RetroArch's NCI whitelist, the value contains characters that break the line-based reply parser (rare — embedded newlines or null bytes), or the UDP query times out. ` +
      "RETURNS: 'NAME = VALUE' where VALUE is the raw string as stored in retroarch.cfg (paths unquoted, booleans as 'true'/'false', integers as decimal).",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          description:
            "Config key — same snake_case ASCII identifier RetroArch uses in retroarch.cfg, case-sensitive, no surrounding quotes. " +
            "Path-class keys (return absolute paths on disk): `savefile_directory`, `savestate_directory`, `system_directory`, `cache_directory`, `log_dir`, `runtime_log_directory`, `core_assets_directory`. " +
            "User-data keys: `netplay_nickname`. " +
            "Toggle keys (return 'true' / 'false'): `video_fullscreen`, `video_vsync`, `audio_mute_enable`. " +
            "The full whitelist varies per RetroArch build; if a key returns an error rather than a value, it's not exposed via the NCI on this build. " +
            "Notable exclusions: `screenshot_directory` is intentionally NOT exposed by RetroArch (see retroarch_screenshot for the workaround). Also no key for the currently-selected savestate slot — track that client-side via retroarch_state_slot_plus/minus.",
        },
      },
      additionalProperties: false,
    },
  },

  // ── Memory reads ────────────────────────────────────────────────────────

  {
    name: "retroarch_read_memory",
    description:
      "PURPOSE: Read up to 4096 bytes from emulated memory via the libretro core's system memory map (READ_CORE_MEMORY) and return them as a hex dump. " +
      "USAGE: Preferred memory-read tool when the loaded core advertises a memory map (most modern cores do). If it returns 'no memory map defined', fall back to retroarch_read_ram which uses the CHEEVOS address space. To poke a value back, pair with retroarch_write_memory at the same address. The classic two-snapshot RAM-hunt workflow uses this: snapshot before a known change, snapshot after, diff for matching deltas. Maximum 4096 bytes per call (NCI line-length limit); for larger reads, batch in 4 KiB chunks. " +
      `BEHAVIOR: No side effects — pure read. ${NCI_TRANSPORT_NOTE} Reads work whether emulation is paused or running. Returns an error if the loaded core doesn't expose a memory map ('no memory map defined'), the address is outside any core descriptor, length < 1, length > 4096, or the UDP query times out. RetroArch may return FEWER bytes than requested if the read crosses a memory-region boundary — the response reports the actual count.\n\n${MEMORY_API_NOTE}\n\n` +
      "RETURNS: Header line 'ADDR_HEX [N bytes]:' followed by space-separated 2-digit uppercase hex bytes.",
    inputSchema: {
      type: "object",
      required: ["address", "length"],
      properties: {
        address: {
          type: "integer",
          minimum: 0,
          description:
            "Starting address in the libretro core's system memory map (NOT the CHEEVOS " +
            "address space — that's read_ram). Address layout depends on the loaded core: " +
            "e.g. SNES WRAM is typically at 0x7E0000-0x7FFFFF, GBA EWRAM at 0x02000000-0x0203FFFF, " +
            "Genesis 68K RAM at 0xFF0000-0xFFFFFF. Reads `length` consecutive bytes starting here.",
        },
        length: {
          type: "integer",
          minimum: 1,
          maximum: 4096,
          description:
            "Number of consecutive bytes to read (1-4096). Hard cap is RetroArch's NCI " +
            "single-datagram size; chunk larger reads yourself. RetroArch may return fewer " +
            "bytes if the read crosses a memory-region boundary in the core's descriptor list.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "retroarch_read_ram",
    description:
      "PURPOSE: Read up to 4096 bytes from emulated memory via the achievement (CHEEVOS) address space (READ_CORE_RAM) and return them as a hex dump. " +
      "USAGE: Fallback memory-read tool — use when retroarch_read_memory returns 'no memory map defined' (older cores or those without an exposed system memory map can still respond to the older CHEEVOS read API). To poke back, pair with retroarch_write_ram at the same CHEEVOS address. Maximum 4096 bytes per call (NCI line-length limit). " +
      `BEHAVIOR: No side effects — pure read. ${NCI_TRANSPORT_NOTE} Reads work whether emulation is paused or running. Returns an error if the address is invalid for the CHEEVOS space, length < 1, length > 4096, or the UDP query times out. Like read_memory, RetroArch may return fewer bytes than requested at memory-region boundaries.\n\n${MEMORY_API_NOTE}\n\n` +
      "RETURNS: Header line 'ADDR_HEX [N bytes, CHEEVOS]:' followed by space-separated 2-digit uppercase hex bytes.",
    inputSchema: {
      type: "object",
      required: ["address", "length"],
      properties: {
        address: {
          type: "integer",
          minimum: 0,
          description:
            "Starting address in the CHEEVOS (achievements) address space — distinct from " +
            "the libretro system memory map used by retroarch_read_memory. CHEEVOS addresses " +
            "follow per-system conventions used by RetroAchievements (e.g. SNES CHEEVOS " +
            "addresses for WRAM start at 0x000000, not the SNES system bus 0x7E0000). " +
            "If unsure, retroarch_read_memory is usually the right starting point.",
        },
        length: {
          type: "integer",
          minimum: 1,
          maximum: 4096,
          description:
            "Number of consecutive bytes to read (1-4096). Hard cap is RetroArch's NCI " +
            "single-datagram size. May return fewer bytes at region boundaries.",
        },
      },
      additionalProperties: false,
    },
  },

  // ── Memory writes ───────────────────────────────────────────────────────

  {
    name: "retroarch_write_memory",
    description:
      "PURPOSE: Write a byte sequence to emulated memory via the libretro core's system memory map (WRITE_CORE_MEMORY). " +
      "USAGE: Preferred memory-write tool when the loaded core advertises a memory map. Use for cheats, debug pokes, and game-state mutations (give a player N lives, unlock a flag, install a cheat table). If it returns 'no memory map defined', fall back to retroarch_write_ram. Maximum 4096 bytes per call (NCI line-length limit); for larger writes, batch in 4 KiB chunks. To establish a rollback point first, use retroarch_save_state_current. " +
      `BEHAVIOR: DESTRUCTIVE: overwrites N bytes starting at \`address\` with no undo (snapshot via retroarch_save_state_current first if you need rollback). Disables RetroArch's hardcore mode for the rest of the session (RetroArch silently flips this flag when any memory-write NCI command is used). UNLIKE most NCI commands, this one DOES return a count — RetroArch replies with the number of bytes actually written, which may be less than requested if a read-only descriptor is hit mid-write (writes still apply up to that boundary). Direct memory write — bypasses MBC/mapper/DMA semantics. ${NCI_TRANSPORT_NOTE} Returns an error if the loaded core doesn't expose a memory map, the address is invalid, the byte array is empty or > 4096, or the UDP query times out.\n\n${MEMORY_API_NOTE}\n\n` +
      "RETURNS: Single line 'Wrote N bytes → ADDR_HEX' where N is RetroArch's reported actual byte count.",
    inputSchema: {
      type: "object",
      required: ["address", "bytes"],
      properties: {
        address: {
          type: "integer",
          minimum: 0,
          description:
            "Starting address in the libretro core's system memory map (NOT CHEEVOS space). " +
            "Bytes are written sequentially address, address+1, ..., address+N-1.",
        },
        bytes: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 255 },
          minItems: 1,
          maxItems: 4096,
          description:
            "Byte values to write, one per element (each 0-255). Length 1-4096 (hard cap " +
            "from RetroArch's NCI single-datagram size). Written sequentially from `address`. " +
            "If a read-only descriptor is encountered mid-array, the write stops at that " +
            "boundary and the response reports how many bytes actually landed.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "retroarch_write_ram",
    description:
      "PURPOSE: Write a byte sequence to emulated memory via the achievement (CHEEVOS) address space (WRITE_CORE_RAM). " +
      "USAGE: Fallback memory-write tool — use when retroarch_write_memory returns 'no memory map defined' or the core only supports the older CHEEVOS write API. Maximum 4096 bytes per call (NCI line-length limit). To verify the write landed (this command does NOT acknowledge — see BEHAVIOR), follow up with retroarch_read_ram at the same address. To establish a rollback point first, use retroarch_save_state_current. " +
      `BEHAVIOR: DESTRUCTIVE: overwrites bytes starting at \`address\` with no undo (snapshot via retroarch_save_state_current first if you need rollback). Disables RetroArch's hardcore mode for the rest of the session. ${FIRE_AND_FORGET_NOTE} This is the key behavioral difference vs retroarch_write_memory, which DOES return a count: write_ram has no way to report a partial write or a rejected address — the only way to verify is a follow-up retroarch_read_ram. Direct memory write — bypasses MBC/mapper/DMA semantics. ${NCI_TRANSPORT_NOTE} Local input validation rejects empty arrays, > 4096 bytes, or values outside 0-255 before the UDP send.\n\n${MEMORY_API_NOTE}\n\n` +
      "RETURNS: Single line 'Wrote N bytes → ADDR_HEX (CHEEVOS, no ack)' where N is the array length you sent. The 'no ack' in the message is a reminder that RetroArch did not confirm the write.",
    inputSchema: {
      type: "object",
      required: ["address", "bytes"],
      properties: {
        address: {
          type: "integer",
          minimum: 0,
          description:
            "Starting address in the CHEEVOS (achievements) address space — distinct from " +
            "the libretro system memory map used by retroarch_write_memory. See retroarch_read_ram " +
            "for address-space caveats. Bytes are written sequentially address, address+1, ...",
        },
        bytes: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 255 },
          minItems: 1,
          maxItems: 4096,
          description:
            "Byte values to write, one per element (each 0-255). Length 1-4096 (hard cap " +
            "from RetroArch's NCI single-datagram size). Written sequentially from `address`. " +
            "Because RetroArch does not acknowledge this command, partial / rejected writes " +
            "cannot be distinguished from successful ones at the protocol level.",
        },
      },
      additionalProperties: false,
    },
  },

  // ── Emulator control ───────────────────────────────────────────────────

  {
    name: "retroarch_pause_toggle",
    description:
      "PURPOSE: Toggle RetroArch's pause state — pause if running, unpause if paused. " +
      "USAGE: RetroArch's NCI exposes ONLY a toggle, not separate pause/unpause commands. To reach a known state, call retroarch_get_status first to check `state: playing|paused`, then toggle if and only if you need to flip it. Use before a sequence of memory-inspect / write / screenshot calls when you need a stable game state across calls; pair with retroarch_frame_advance to step single frames without leaving pause. " +
      `BEHAVIOR: Modifies emulator run state by flipping it. ${FIRE_AND_FORGET_NOTE} Calling toggle when you don't know the current state will flip it to whichever state it ISN'T — confirm with retroarch_get_status before and after if it matters. ${NCI_TRANSPORT_NOTE} ` +
      "RETURNS: Single line 'Pause toggled' (this is a confirmation that the UDP datagram was sent, NOT that RetroArch received or acted on it).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_frame_advance",
    description:
      "PURPOSE: Step emulation forward by exactly one frame. " +
      "USAGE: Use for frame-precise input automation, animation inspection, or letting the system initialize after a reset. ONLY effective while emulation is paused — RetroArch's FRAMEADVANCE is a no-op when running, so call retroarch_pause_toggle first (after checking retroarch_get_status to confirm you'll end up paused, not unpaused). For long jumps (thousands of frames) prefer retroarch_save_state_current / retroarch_load_state_current of a pre-prepared state — frame-by-frame stepping costs ~1 UDP round-trip per frame. " +
      `BEHAVIOR: When paused, advances the emulator by exactly one frame and remains paused. When NOT paused, the command is silently ignored by RetroArch. ${FIRE_AND_FORGET_NOTE} The new frame count is not reported — to verify progress, take screenshots before/after with retroarch_screenshot or read a known-changing memory value. ${NCI_TRANSPORT_NOTE} ` +
      "RETURNS: Single line 'Advanced one frame' (UDP-send confirmation only — does NOT confirm that RetroArch was paused or that the frame actually advanced).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_reset",
    description:
      "PURPOSE: Soft-reset the running game — equivalent to pressing the console's reset button (NOT a power cycle). " +
      "USAGE: Use to start fresh from the game's reset vector. To return to a specific known-good point instead of boot, use retroarch_load_state_current or retroarch_load_state_slot with a previously saved state. Note this is a SOFT reset (button reset): RAM contents and any cart-internal state may persist depending on the system, unlike a true power cycle. " +
      `BEHAVIOR: DESTRUCTIVE: triggers the loaded core's reset routine, which on most systems clears registers, resets the PC to the reset vector, and starts the boot sequence over. Unsaved game progress is lost. The loaded ROM stays loaded — only volatile state is affected. ${FIRE_AND_FORGET_NOTE} To confirm the reset took, follow up with retroarch_get_status (state should still be 'playing') and/or a screenshot. ${NCI_TRANSPORT_NOTE} ` +
      "RETURNS: Single line 'Game reset' (UDP-send confirmation only — does NOT verify the reset executed).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_screenshot",
    description:
      "PURPOSE: Capture a PNG screenshot of the current emulator display and save it to RetroArch's configured screenshot directory. " +
      "USAGE: Use to capture visible game state for inspection, sequence documentation, or to verify that a fire-and-forget control command (pause / reset / load_state / write) had a visible effect. To capture a specific game state, pause / advance frames / load state first to get the frame you want, then call this. IMPORTANT: unlike most screenshot tools, this one DOES NOT take a path argument — RetroArch saves to its own configured `screenshot_directory`, which the NCI does not expose (it is NOT readable via retroarch_get_config). To find the file, check RetroArch's settings UI (Settings → Directory → Screenshots) or look at where screenshots normally land for your install. " +
      `BEHAVIOR: Writes a new timestamped PNG to RetroArch's screenshot directory — no existing files are overwritten (RetroArch generates a fresh filename per shot). ${FIRE_AND_FORGET_NOTE} The returned message confirms only that the SCREENSHOT command was sent, not that the file was actually written (disk full, permission denied, etc. would fail silently from the tool's perspective). ${NCI_TRANSPORT_NOTE} ` +
      "RETURNS: Single line 'Screenshot saved to RetroArch's configured screenshot directory' (UDP-send confirmation only).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_show_message",
    description:
      "PURPOSE: Display a single-line notification message overlaid on the RetroArch window (OSD). " +
      "USAGE: For in-emulator debug output, progress markers during long scripts, or text to a human watching the RetroArch window. Purely cosmetic — no effect on game state. The ONLY way to push agent-generated text onto the RetroArch display; there is no read-the-screen counterpart. " +
      `BEHAVIOR: Renders the message in RetroArch's notification area for ~3 seconds (RetroArch's default notification timeout, configurable via the input_overlay_show_inputs_port setting family). Messages are NOT queued — rapid calls replace the previous message before users can read it. ${FIRE_AND_FORGET_NOTE} ${NCI_TRANSPORT_NOTE} ` +
      "RETURNS: 'Showed: MESSAGE' echoing what was sent (UDP-send confirmation only — does NOT verify the overlay rendered).",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: {
        message: {
          type: "string",
          minLength: 1,
          description:
            "UTF-8 message text. Spaces and most punctuation are preserved verbatim. " +
            "NEWLINES (\\n / \\r) TRUNCATE the message — the NCI protocol is line-terminated, so anything after the first newline is silently dropped on the wire. " +
            "Keep messages to ONE LINE; recommended ≤80 chars to fit RetroArch's notification overlay without horizontal clipping (the exact width depends on the user's video resolution and font size). " +
            "Consecutive calls REPLACE rather than queue, so use one message per logical event rather than emitting a stream of status updates. " +
            "Special characters: percent-signs are safe (RetroArch does NOT printf-interpret the string), quotes are safe (no shell interpolation), but ASCII control bytes other than space are likely rendered as boxes or stripped.",
        },
      },
      additionalProperties: false,
    },
  },

  // ── Save state ─────────────────────────────────────────────────────────

  {
    name: "retroarch_save_state_current",
    description:
      "PURPOSE: Save the entire emulator state to RetroArch's currently-selected save slot (one of slots 0-9). " +
      "USAGE: Use as a rollback point before risky writes, to bookmark interesting game states, or to share repro states. RetroArch's NCI has NO 'save to slot N' command — to target a specific slot, you must first walk the slot pointer there with retroarch_state_slot_plus / retroarch_state_slot_minus, then call this. The current slot is RetroArch's internal state and is NOT reported back by the NCI, so if you don't track it yourself, observe the on-screen slot indicator after each plus/minus or use retroarch_show_message as a confirmation echo. The companion retroarch_load_state_current restores from the same slot. For path-based savestate I/O (no slots), there is no NCI equivalent — use the BizHawk or mGBA MCP servers instead. " +
      `BEHAVIOR: DESTRUCTIVE TO TARGET SLOT FILE: overwrites whatever was previously in the currently-selected slot with no prompt or backup. The state file lands in RetroArch's configured \`savestate_directory\` (queryable via retroarch_get_config). State files are bound to the EXACT ROM and core version that produced them — loading on a different ROM or core typically fails. ${FIRE_AND_FORGET_NOTE} To verify the save happened, retroarch_load_state_current it back and observe via memory-read or screenshot. ${NCI_TRANSPORT_NOTE} ` +
      "RETURNS: Single line 'Saved to current slot' (UDP-send confirmation only — does NOT verify the file was written, nor report which slot number it landed in).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_load_state_current",
    description:
      "PURPOSE: Restore the emulator from RetroArch's currently-selected save slot (one of slots 0-9). " +
      "USAGE: Counterpart to retroarch_save_state_current. Use to undo a sequence of writes/inputs (the snapshot/experiment/restore workflow) or to start each tool-call sequence from a known baseline. Loads from whichever slot is currently selected (the same slot save_state_current would target). To load from a specific slot WITHOUT changing the current-slot pointer, use retroarch_load_state_slot instead — that's important if you're alternating between bookmarks. To start fresh from boot, use retroarch_reset. " +
      `BEHAVIOR: DESTRUCTIVE TO LIVE STATE: replaces ALL current emulator state (RAM, registers, mapper, audio, framecount) with the slot file's contents. Anything not previously snapshotted is lost. The state file MUST come from the same ROM and same core version that produced it — loading mismatched files typically fails or destabilizes the core. ${FIRE_AND_FORGET_NOTE} If the currently-selected slot has no saved state, RetroArch silently ignores the command — no error is raised. To verify the load happened, follow up with a memory-read or screenshot. ${NCI_TRANSPORT_NOTE} ` +
      "RETURNS: Single line 'Loaded from current slot' (UDP-send confirmation only — does NOT verify the slot existed or the load succeeded).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_load_state_slot",
    description:
      "PURPOSE: Load state from an explicitly-named save slot number, without modifying RetroArch's currently-selected slot pointer. " +
      "USAGE: Use to load from a specific slot when you don't want to disturb the current-slot pointer (e.g. you're alternating between two bookmarks while keeping the 'live' slot for ongoing saves). For loading from the currently-selected slot, use retroarch_load_state_current — semantically distinct: this tool ignores the current-slot pointer entirely and addresses by number. Slots are numbered 0-9 by RetroArch convention. There is no `retroarch_save_state_slot` counterpart in the NCI — saving to a specific slot still requires walking the pointer with state_slot_plus/minus and then calling save_state_current. " +
      `BEHAVIOR: DESTRUCTIVE TO LIVE STATE: replaces ALL current emulator state with the named slot's contents. Anything not previously snapshotted is lost. The state file MUST come from the same ROM and core version that produced it. ${NCI_TRANSPORT_NOTE} UNLIKE most NCI control commands, LOAD_STATE_SLOT does send a reply (this client awaits it), so a UDP timeout will surface as an error here even though sibling load/save calls are fire-and-forget. If the named slot has no saved state, RetroArch's reply still indicates the command was processed — verify with a memory-read or screenshot. The current-slot pointer is unchanged after this call. ` +
      "RETURNS: Single line 'Loaded from slot N' echoing the requested slot number.",
    inputSchema: {
      type: "object",
      required: ["slot"],
      properties: {
        slot: {
          type: "integer",
          minimum: 0,
          description:
            "Save state slot number to load from. RetroArch's standard slot range is 0-9 " +
            "(ten slots), but the NCI does not enforce a hard upper bound — slot numbers " +
            "outside the configured range will simply find no file and silently no-op. " +
            "This call does NOT change the currently-selected slot pointer (use " +
            "retroarch_state_slot_plus / retroarch_state_slot_minus for that).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "retroarch_state_slot_plus",
    description:
      "PURPOSE: Increment RetroArch's currently-selected save slot pointer by 1 (e.g. slot 3 → slot 4). " +
      "USAGE: Combine with retroarch_save_state_current or retroarch_load_state_current to target a specific slot — these tools always operate on the current slot, so to save TO slot 5 you must walk the pointer there first. Pair with retroarch_state_slot_minus to walk backwards. RetroArch's NCI exposes NO way to set the slot directly to N or to query the current slot number, so if you don't track it yourself you must walk from a known position (e.g. slot 0) or observe the on-screen indicator. For loading a specific slot WITHOUT changing the pointer, use retroarch_load_state_slot instead. " +
      `BEHAVIOR: Mutates RetroArch's internal current-slot pointer (+1). Wraps or clamps per RetroArch's slot-cycling configuration (typically wraps at 9 → 0). ${FIRE_AND_FORGET_NOTE} The new slot number is NOT reported back — track it client-side or watch the on-screen slot indicator. No effect on emulator memory / run state — only the slot pointer used by future save_state_current / load_state_current calls changes. ${NCI_TRANSPORT_NOTE} ` +
      "RETURNS: Single line 'Incremented current slot' (UDP-send confirmation only — does NOT report the new slot number).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_state_slot_minus",
    description:
      "PURPOSE: Decrement RetroArch's currently-selected save slot pointer by 1 (e.g. slot 3 → slot 2). " +
      "USAGE: Counterpart to retroarch_state_slot_plus. Combine with retroarch_save_state_current or retroarch_load_state_current to target a lower-numbered slot — these tools always operate on the current slot. RetroArch's NCI exposes NO way to set the slot directly to N or to query the current slot number, so track it client-side or walk from a known position. For loading a specific slot WITHOUT changing the pointer, use retroarch_load_state_slot. " +
      `BEHAVIOR: Mutates RetroArch's internal current-slot pointer (-1). Wraps or clamps per RetroArch's slot-cycling configuration (typically wraps at 0 → 9). ${FIRE_AND_FORGET_NOTE} The new slot number is NOT reported back — track it client-side or watch the on-screen slot indicator. No effect on emulator memory / run state — only the slot pointer used by future save_state_current / load_state_current calls changes. ${NCI_TRANSPORT_NOTE} ` +
      "RETURNS: Single line 'Decremented current slot' (UDP-send confirmation only — does NOT report the new slot number).",
    inputSchema: { type: "object", properties: {} },
  },
];

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function addrHex(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function registerTools(server: Server, ra: RetroArchClient): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const p = args as Record<string, unknown>;

    switch (name) {
      case "retroarch_ping": {
        const v = await ra.getVersion();
        return ok(`OK — RetroArch ${v}`);
      }

      case "retroarch_get_status": {
        const s = await ra.getStatus();
        if (s.state === "contentless") return ok("No content loaded");
        return ok(
          `State:  ${s.state}\n` +
          `System: ${s.system}\n` +
          `Game:   ${s.game}\n` +
          `CRC32:  ${s.crc32 ?? "(none reported)"}`,
        );
      }

      case "retroarch_get_config": {
        const v = await ra.getConfigParam(p.name as string);
        return ok(`${p.name} = ${v}`);
      }

      case "retroarch_read_memory": {
        const bytes = await ra.readMemory(p.address as number, p.length as number);
        const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
        return ok(`${addrHex(p.address as number)} [${bytes.length} bytes]:\n${hex}`);
      }

      case "retroarch_write_memory": {
        const n = await ra.writeMemory(p.address as number, p.bytes as number[]);
        return ok(`Wrote ${n} bytes → ${addrHex(p.address as number)}`);
      }

      case "retroarch_read_ram": {
        const bytes = await ra.readRam(p.address as number, p.length as number);
        const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
        return ok(`${addrHex(p.address as number)} [${bytes.length} bytes, CHEEVOS]:\n${hex}`);
      }

      case "retroarch_write_ram": {
        await ra.writeRam(p.address as number, p.bytes as number[]);
        return ok(`Wrote ${(p.bytes as number[]).length} bytes → ${addrHex(p.address as number)} (CHEEVOS, no ack)`);
      }

      case "retroarch_pause_toggle":  await ra.pauseToggle();   return ok("Pause toggled");
      case "retroarch_frame_advance": await ra.frameAdvance();  return ok("Advanced one frame");
      case "retroarch_reset":         await ra.reset();         return ok("Game reset");
      case "retroarch_screenshot":    await ra.screenshot();    return ok("Screenshot saved to RetroArch's configured screenshot directory");
      case "retroarch_show_message": {
        await ra.showMessage(p.message as string);
        return ok(`Showed: ${p.message}`);
      }

      case "retroarch_save_state_current":  await ra.saveStateCurrent();          return ok("Saved to current slot");
      case "retroarch_load_state_current":  await ra.loadStateCurrent();          return ok("Loaded from current slot");
      case "retroarch_load_state_slot":     await ra.loadStateSlot(p.slot as number); return ok(`Loaded from slot ${p.slot}`);
      case "retroarch_state_slot_plus":     await ra.stateSlotPlus();             return ok("Incremented current slot");
      case "retroarch_state_slot_minus":    await ra.stateSlotMinus();            return ok("Decremented current slot");

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}
