# mcp-retroarch recipes

Practical examples of driving RetroArch from Claude or any MCP client. Each recipe is self-contained.

> Prerequisites: RetroArch running, Network Commands enabled, any libretro core + game loaded. Test with `retroarch_ping` first.

---

## 1. Identify what's loaded

```
retroarch_ping
retroarch_get_status
```

Returns the RetroArch version and the loaded game's system, basename, and CRC32. CRC32 is the canonical fingerprint — useful for cross-referencing community cheat databases or speedrun tables.

---

## 2. RAM hunting — find the address of a counter you can see on screen

> "I'm playing Pokémon Red. The badges count is currently 2. Walk into the gym, beat the leader, see badges count rise to 3, find the address."

```
1. retroarch_read_memory(address=0xC000, length=4096)   # snapshot A (badges=2)
2. <user fights and wins, badges=3>
3. retroarch_read_memory(address=0xC000, length=4096)   # snapshot B (badges=3)
4. <Claude diffs A vs B for any byte/u16/u32 that changed 2 → 3>
```

Memory map varies wildly by core — check `retroarch_get_status` first to know the system, then look up its memory map online. Common landmarks:

| System | WRAM start | Cart RAM start |
|--------|------------|----------------|
| NES    | `0x0000`   | `0x6000`       |
| SNES   | `0x7E0000` | `0x700000`     |
| GB/GBC | `0xC000`   | `0xA000`       |
| GBA    | `0x02000000` (EWRAM), `0x03000000` (IWRAM) | `0x0E000000` (SRAM) |
| Genesis| `0xFF0000` | `0x200000`     |
| PSX    | `0x80000000` | (saves on memcard, not addressable) |

If `retroarch_read_memory` returns "no memory map defined", the loaded core doesn't advertise one. Try `retroarch_read_ram` (CHEEVOS path) — many cores expose CHEEVOS even without a memory map.

---

## 3. Write a value into memory

> "The lives counter for this Mega Man game is at 0xC0FE. Set it to 99."

```
retroarch_write_memory(address=0xC0FE, bytes=[99])
```

Note: this **disables hardcore achievement mode** for the session — RetroArch won't let you cheat your way to achievements. If you want to keep hardcore on, save state first, write, do the test, then load state to restore.

---

## 4. Take a screenshot

```
retroarch_screenshot
```

RetroArch saves it to its configured screenshot directory. The NCI doesn't expose `screenshot_directory` via `GET_CONFIG_PARAM`, so check it via the GUI: Settings → Directory → Screenshot. (`savestate_directory`, `savefile_directory`, etc. ARE queryable via `retroarch_get_config`.)

---

## 5. Pause, inspect, resume

> "Pause the game, dump the current player position from RAM, then resume."

```
retroarch_pause_toggle                                        # pause
retroarch_read_memory(address=0xD361, length=2)               # X coord
retroarch_read_memory(address=0xD362, length=2)               # Y coord
retroarch_pause_toggle                                        # resume
```

`PAUSE_TOGGLE` flips current state — there's no separate `PAUSE` and `UNPAUSE`. If you need to know the current state, call `retroarch_get_status` first.

---

## 6. Frame-perfect inspection

> "Pause, then advance 1 frame at a time and read RNG state to see how it changes per frame."

```
retroarch_pause_toggle
for i in 1..10:
  rng_before = retroarch_read_memory(address=<rng_addr>, length=4)
  retroarch_frame_advance
  rng_after  = retroarch_read_memory(address=<rng_addr>, length=4)
  print(f"frame {i}: {rng_before} → {rng_after}")
retroarch_pause_toggle  # resume
```

`FRAMEADVANCE` only works when paused.

---

## 7. Snapshot, experiment, restore

> "Save current state, write some experimental values to RAM, see what happens, then restore."

```
retroarch_save_state_current
# ... experiment freely ...
retroarch_load_state_current
```

To target a specific slot:

```
# Walk slot pointer to slot 5
retroarch_state_slot_minus  # repeat as needed to reach slot 0 first if unsure
retroarch_state_slot_plus   # ×5
retroarch_save_state_current
```

(NCI has no "current slot is N" query and no "save to slot N" command — only walk + save_current.)

---

## 8. Show the user a status message

> "Tell the user 'starting RAM dump in 3 seconds' before doing the work."

```
retroarch_show_message(message="starting RAM dump in 3 seconds")
```

Renders on the RetroArch overlay for a few seconds. Useful for narrating long-running scripted sessions, or for letting the user know an automation has reached a checkpoint.

---

## 9. Sanity-check the bridge before doing anything

```
retroarch_ping        # returns "OK — RetroArch <version>"
retroarch_get_status  # confirms a game is loaded
```

If `ping` fails: RetroArch isn't running, Network Commands aren't enabled in `retroarch.cfg`, or the port doesn't match `RETROARCH_PORT`.

---

## What this server can NOT do (clearly)

- **Send game-pad input.** NCI exposes RetroArch hotkeys (pause, reset, state slots, etc.) but NOT controller buttons. There's a separate "Remote RetroPad" libretro core on UDP port 55400+ that does, but it requires loading that specific core (you can't drive a normal emulation core through it).

  If you need input automation, see [mcp-mgba](https://github.com/dmang-dev/mcp-mgba) (Game Boy Advance, full input + screenshot via Lua bridge).

- **Save to a specific slot in one call.** NCI has no `SAVE_STATE_SLOT N` command — only the slot-pointer + save-current dance shown in recipe #7.

- **Discover where screenshots land.** `screenshot_directory` isn't in the NCI's `GET_CONFIG_PARAM` allowlist. Check via RetroArch's GUI.

---

## Tips for using these tools

- **Always start with `retroarch_get_status`.** It tells you the system identifier (so you know the memory map) and the CRC32 (so you can cross-reference cheats databases).
- **Try `read_memory` first, fall back to `read_ram`.** Most cores have a memory map; the CHEEVOS path is for cores that don't.
- **Pause before bulk reads** if memory layout depends on game state — pausing freezes everything including DMA, ensuring consistent snapshots.
- **`show_message` is your friend** when the model is doing something visually invisible (like RAM scanning) and the user wants confirmation.
