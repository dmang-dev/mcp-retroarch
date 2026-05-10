import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { RetroArchClient } from "./retroarch.js";

const MEMORY_NOTE = `
RetroArch exposes two distinct memory APIs:
  - READ_CORE_MEMORY / WRITE_CORE_MEMORY (used by retroarch_read/write_memory):
      Goes through the libretro core's system memory map. Most reliable when
      the core advertises a memory map (most cores do). Errors with "no
      memory map defined" if the loaded core doesn't.
  - READ_CORE_RAM / WRITE_CORE_RAM (used by retroarch_read/write_ram):
      Uses the achievement (CHEEVOS) address space. Works even when no core
      memory map is defined, but addresses follow CHEEVOS conventions, not
      the system bus. Use when read_memory returns "no memory map defined".`.trim();

const TOOLS: Tool[] = [
  {
    name: "retroarch_ping",
    description: "Verify connectivity to RetroArch's Network Control Interface. Returns the RetroArch version string if reachable.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_get_status",
    description: "Get the current emulation status: playing/paused state, system identifier, game basename, and CRC32. Returns 'contentless' if no game is loaded.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_get_config",
    description: "Read a RetroArch configuration parameter by name. Useful values: `savefile_directory`, `savestate_directory`, `system_directory`, `cache_directory`, `log_dir`, `runtime_log_directory`, `netplay_nickname`, `video_fullscreen`. Note: `screenshot_directory` is NOT exposed via this command — RetroArch saves screenshots wherever it's configured but doesn't let the NCI report that path.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "Config parameter name (see description for supported values)" },
      },
    },
  },

  {
    name: "retroarch_read_memory",
    description: `Read up to 4096 bytes from emulated memory via the loaded core's system memory map. Returns an array of byte values.\n\n${MEMORY_NOTE}`,
    inputSchema: {
      type: "object",
      required: ["address", "length"],
      properties: {
        address: { type: "integer", description: "Memory address (in the core's address space)" },
        length:  { type: "integer", minimum: 1, maximum: 4096 },
      },
    },
  },
  {
    name: "retroarch_write_memory",
    description: `Write a byte sequence to emulated memory via the system memory map. Returns the number of bytes actually written (may be less than requested if a read-only descriptor is hit). Disables hardcore mode for the session.\n\n${MEMORY_NOTE}`,
    inputSchema: {
      type: "object",
      required: ["address", "bytes"],
      properties: {
        address: { type: "integer", description: "Memory address" },
        bytes: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 255 },
          minItems: 1,
          maxItems: 4096,
        },
      },
    },
  },
  {
    name: "retroarch_read_ram",
    description: "Read memory via the CHEEVOS (achievements) address space. Use this if `retroarch_read_memory` reports 'no memory map defined' — some libretro cores don't advertise a memory map but DO support the older CHEEVOS read API.",
    inputSchema: {
      type: "object",
      required: ["address", "length"],
      properties: {
        address: { type: "integer" },
        length:  { type: "integer", minimum: 1, maximum: 4096 },
      },
    },
  },
  {
    name: "retroarch_write_ram",
    description: "Write to CHEEVOS memory address space. Fire-and-forget — RetroArch sends no acknowledgement for this command. Disables hardcore mode for the session.",
    inputSchema: {
      type: "object",
      required: ["address", "bytes"],
      properties: {
        address: { type: "integer" },
        bytes: {
          type: "array",
          items: { type: "integer", minimum: 0, maximum: 255 },
          minItems: 1,
          maxItems: 4096,
        },
      },
    },
  },

  {
    name: "retroarch_pause_toggle",
    description: "Toggle the pause state. There's no separate pause/unpause command in the NCI — this single command flips the current state. Check `retroarch_get_status` first to know the current state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_frame_advance",
    description: "Step exactly one frame forward. Only effective while paused; pause first with `retroarch_pause_toggle`.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_reset",
    description: "Hard-reset the running game (equivalent to pressing the console's reset button).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_screenshot",
    description: "Capture a screenshot of the current display. RetroArch saves it to its configured screenshot directory (which the NCI doesn't report — check RetroArch's settings). Fire-and-forget; returns immediately.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_show_message",
    description: "Display a notification message overlaid on the RetroArch window. Useful for debugging or telling the user something during a long-running script.",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string", description: "Message text. Spaces are kept; line breaks are not." },
      },
    },
  },

  // Save state
  {
    name: "retroarch_save_state_current",
    description: "Save state to the currently-selected slot. RetroArch's NCI doesn't expose a 'save to slot N' command — you must walk the slot selector to N first using state_slot_plus/minus, then call this. The current slot is RetroArch's internal state and isn't reported back.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_load_state_current",
    description: "Load state from the currently-selected slot. Use `retroarch_load_state_slot` if you want to load from an explicit numbered slot without changing the current slot pointer.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_load_state_slot",
    description: "Load state from an explicit numbered slot. Doesn't change the 'current slot' selector (unlike state_slot_plus/minus + load_state_current).",
    inputSchema: {
      type: "object",
      required: ["slot"],
      properties: {
        slot: { type: "integer", minimum: 0, description: "Save state slot number" },
      },
    },
  },
  {
    name: "retroarch_state_slot_plus",
    description: "Increment the currently-selected save state slot. Combine with retroarch_save_state_current / retroarch_load_state_current to target a specific slot for SAVE.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "retroarch_state_slot_minus",
    description: "Decrement the currently-selected save state slot.",
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
