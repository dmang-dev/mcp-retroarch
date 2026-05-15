# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-05-15

Tool description quality pass — written to Glama's Tool Definition Quality
Score (TDQS) rubric so every tool maximizes Purpose Clarity, Usage
Guidelines, Behavioral Transparency, Parameter Semantics, Conciseness,
and Contextual Completeness.

### Changed

- **Every tool description rewritten to the PURPOSE / USAGE / BEHAVIOR /
  RETURNS template** — explicit error conditions, explicit
  when-to-use-this-vs-sibling guidance (e.g. read_memory vs read_ram;
  state_slot_plus/minus vs load_state_slot), explicit destructive-
  behavior notes for state-mutating tools (`retroarch_write_*`,
  `retroarch_reset`, `retroarch_load_state_*`, `retroarch_save_state_current`
  slot overwrite), and explicit return-value shape.
- **Fire-and-forget UDP semantics surfaced everywhere it matters** —
  RetroArch's NCI doesn't acknowledge most state mutations. Every
  affected tool's BEHAVIOR section now warns that the success message
  is a UDP-send confirmation only, NOT verification that RetroArch
  received or acted on the command. The lone exception
  (`retroarch_write_memory`, which DOES return a byte count) is also
  documented prominently as the contrast.
- **Two distinct memory APIs documented** — `_memory` (system bus, via
  CMD_CORE_MEMORY) vs `_ram` (libretro CHEEVOS map). Each tool says
  which API it uses and recommends fallback paths if one returns "no
  memory map defined".
- **Slot-based savestate model** documented — NCI has no "save to slot
  N" command, so `save_state_current` writes to whatever slot the GUI
  currently has selected, and `state_slot_plus`/`minus` are the only
  way to walk the pointer (current slot is not queryable; track
  client-side or use `show_message` for echo confirmation).
- **Every parameter now has a description** that adds context beyond
  the JSON Schema (RetroArch slot conventions, memory address-space
  caveats, message-display lifetime).

## [0.1.1] - 2026-05-11

### Changed

- **Non-blocking startup.** The MCP transport now comes up immediately
  instead of waiting on the RetroArch connectivity probe. Previously,
  with no emulator reachable, startup blocked ~5s on the `VERSION`
  query timeout (UDP has no fast "connection refused"), which delayed
  `tools/list` introspection. The probe now runs in the background and
  just logs its result; tool calls still connect on demand. Matters
  for CI / registry containers (e.g. Glama) that expect fast
  introspection.

### Added

- **Dockerfile** for the [Glama](https://glama.ai/mcp/servers) MCP
  registry. Builds the server and runs it over stdio; introspection
  works with no emulator present.

## [0.1.0] - 2026-05-10

Initial public release.

### Added

- **UDP client (`src/retroarch.ts`)** for RetroArch's text-based Network
  Control Interface. Serial-by-default (one query in flight at a time)
  to keep matching simple — the NCI doesn't carry request IDs and
  matching by command-name echo is fragile.
- **MCP server (`dist/index.js`)** with eager probe at startup; tools
  start working as soon as RetroArch is reachable.
- **17 MCP tools**: `retroarch_ping`, `retroarch_get_status`,
  `retroarch_get_config`, `retroarch_read_memory` /
  `retroarch_write_memory` (system memory map), `retroarch_read_ram` /
  `retroarch_write_ram` (CHEEVOS fallback), `retroarch_pause_toggle`,
  `retroarch_frame_advance`, `retroarch_reset`, `retroarch_screenshot`,
  `retroarch_show_message`, save/load state suite (current slot, explicit
  slot, slot pointer +/-).
- **Configurable target** via `RETROARCH_HOST` and `RETROARCH_PORT` env
  vars.
- **Cross-platform install** via `npm install -g mcp-retroarch`,
  `npx -y mcp-retroarch`, or clone-and-build.
- **GitHub Actions CI** matrix on Node 18/20/22 across
  Linux / macOS / Windows.

### Known limitations

- **Game-pad input not exposed.** The NCI doesn't expose
  controller-button injection — only RetroArch hotkeys (pause, reset,
  state slots, etc.). RetroArch has a separate "Remote RetroPad" core
  on UDP port 55400+ that does, but it requires loading that specific
  core, which means you can't drive a normal libretro emulation core
  through it. Out of scope for v0.1.0; may revisit.
- **Save-state slot targeting is two-step.** NCI's `SAVE_STATE` only
  saves to the currently-selected slot. To save to slot N, walk the
  slot pointer to N first via `state_slot_plus` / `state_slot_minus`.

[Unreleased]: https://github.com/dmang-dev/mcp-retroarch/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/dmang-dev/mcp-retroarch/releases/tag/v0.1.2
[0.1.1]: https://github.com/dmang-dev/mcp-retroarch/releases/tag/v0.1.1
[0.1.0]: https://github.com/dmang-dev/mcp-retroarch/releases/tag/v0.1.0
