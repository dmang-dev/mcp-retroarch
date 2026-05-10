# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/dmang-dev/mcp-retroarch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dmang-dev/mcp-retroarch/releases/tag/v0.1.0
