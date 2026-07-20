# docs/

Design notes and recipes referenced from the top-level `README.md`.

## Files

- **`RECIPES.md`** — end-to-end workflows: memory r/w across libretro cores
  (Mesen, Mupen64Plus-Next, SwanStation, etc.), savestate slot-walking,
  screenshot capture.
- **`REMOTE-RETROPAD-INVESTIGATION.md`** — write-up of why game-pad input via
  NCI didn't work. The "Remote RetroPad" core on UDP :55400 exists but
  requires loading that specific core, not driving an existing emulation
  core. Records the dead-end so it doesn't get re-investigated.
