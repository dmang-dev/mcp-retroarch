# Adding game-pad input to mcp-retroarch — investigation notes

Status: scoping, mostly unknowns. Nothing implemented.

The big shortcoming of `mcp-retroarch` v0.1.0 is no game-pad input — RetroArch's Network Control Interface only exposes hotkeys and menu navigation, not player-controller buttons. This document captures what we know about the realistic ways to fix that.

## The two RetroArch network input pieces (often confused)

There are two related-but-distinct things, and the docs don't help:

### 1. The "Remote RetroPad" libretro core

A built-in libretro core whose only purpose is to send controller inputs over the network. **Loading it replaces whatever emulation core was running**, so you can't be playing Mario *and* using Remote RetroPad at the same time on the same RetroArch instance.

Stated use case (per upstream docs): "controlling another instance of RetroArch over the network." So instance-A loads Remote RetroPad and acts as a sender; instance-B loads a real game core and accepts the inputs.

That two-instance shape isn't useful for `mcp-retroarch` — we want to drive *the* user's running game, not a separate phantom RetroArch.

### 2. The "Network Retropad" input driver (the actual interesting thing)

The receiver side. RetroArch supports configuring one of its controller "ports" to take input from the network instead of from a physical/USB controller. This is what we'd want to talk to.

**What we know:**
- It exists.
- UDP, port range 55400-55420 (one port per controller player; 55400 = Player 1).
- Configured per-port in RetroArch settings.

**What we don't know:**
- Wire format. Is it a 16-bit RetroPad bitmask? A struct with analog axes? Length-prefixed? Plain text? **Not documented at the protocol level anywhere I could find.**
- Whether it requires a handshake or is purely fire-and-forget.
- How packet rate affects input — does each packet = one frame's input? Latched until next packet? Held for N ms?
- Analog stick / trigger handling.

This is **source-read territory**. The wire format is implementation-defined inside `libretro/RetroArch` (probably `input/drivers/udev_input.c` or `input/input_driver.c` or one of the `joypad/` subdirs).

## Estimated effort to add input to mcp-retroarch

| Phase | Time |
|---|---|
| Read RetroArch source to determine the wire format | **1-3 h** (uncertain — could be obvious, could be buried) |
| Build a TS UDP sender that emits the right packets | 1 h |
| Add MCP tools: `retroarch_press_buttons`, `retroarch_set_analog`, etc. | 1 h |
| Test against running RetroArch — verify presses register in-game | 1-2 h |
| README + recipes update | 30 min |
| **Total** | **~5-7 h** |

The big variance is the source dive. If the wire format turns out to be an undocumented sequence of opcodes with state, this could blow up.

## Risks

| Risk | Likelihood | Notes |
|---|---|---|
| Wire format is per-version unstable | Medium | RetroArch evolves; what works in 1.22 may not work in 1.18 or 1.30. |
| Receiver needs to be configured per-game (per-controller-port) | High | User has to flip "Player 1 device → Network Retropad" in RetroArch settings before starting any session. Documentation burden. |
| Some libretro cores ignore the device-type override | Medium | Cores can override input device handling; not all of them honor a "network" input driver cleanly. |
| Latency / dropped UDP packets cause missed inputs | Medium | UDP doesn't retransmit. A dropped packet = a missed frame of input. May need to repeat each press for ~3 frames to be safe. |

## Alternative: OS-level keyboard injection (out of scope, but cleaner pitch)

A different way to add "game-pad input" is to bypass RetroArch's network input entirely and use the OS:

- **Windows:** PowerShell `[System.Windows.Forms.SendKeys]::SendWait("...")` or AutoHotkey
- **Linux:** `xdotool key`, or the `uinput` virtual joystick API
- **macOS:** `osascript` keystroke, or the `IOKit` HID layer

Pros: works for ANY emulator, not just RetroArch. Same trick would also fill the input gap for `mcp-pine` (PCSX2) and any other input-less bridge.

Cons: out-of-band — it's not really "MCP server controls emulator," it's "MCP server impersonates a keyboard." Different mental model. Also platform-specific, more permission/safety concerns.

For a v0.2.0 of `mcp-retroarch`, the "Network Retropad" path is the right one. For a more ambitious "input across all our bridges" v1.0 of *something*, OS keyboard injection might be worth a small dedicated package (`mcp-keyboard`?) that any other bridge can recommend.

## Recommendation

**Defer until BizHawk ships.** `mcp-bizhawk` already gives full game-pad input across 10+ systems via `joypad.set` (see `mcp-bizhawk/SCOPE.md`). That covers the "drive games via Claude" use case much more cleanly than back-doored UDP packets to a undocumented RetroArch input driver.

Once BizHawk is live, revisit:
- If users specifically want network input on a system BizHawk doesn't cover well → spend the source-dive on Network Retropad
- If the demand is for "drive games on system X" generally → BizHawk probably already covers X

## Action items if/when we do come back to this

1. Clone RetroArch source: `git clone https://github.com/libretro/RetroArch`
2. Search for "network retropad" / "udp_input" / "55400" — find the receiver.
3. Document the wire format with byte-level captures using `tcpdump` / `Wireshark` on UDP port 55400 with the Remote RetroPad core sending live.
4. Re-evaluate complexity once we know what we're dealing with.

For now, the most honest action is **leave this gap documented and ship something else.**
