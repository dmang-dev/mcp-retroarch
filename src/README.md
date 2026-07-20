# src/

TypeScript source for the `mcp-retroarch` MCP server (Node.js). Compiled into
`../dist/` by `tsc` — that's what the published `mcp-retroarch` bin runs.

## Files

- **`index.ts`** — stdio MCP entrypoint. Reads `RETROARCH_HOST` /
  `RETROARCH_PORT`, registers tools, awaits MCP requests on stdio.
- **`retroarch.ts`** — UDP client speaking RetroArch's Network Control
  Interface (NCI) text protocol. Handles request/response framing over UDP
  datagrams. Implements both memory paths: `READ_CORE_MEMORY` (system memory
  map) and `READ_CORE_RAM` (CHEEVOS fallback).
- **`tools.ts`** — registers every MCP tool against the SDK server. Wraps NCI
  commands as MCP tools: memory r/w, savestate slot walk, pause/frame-advance,
  reset, screenshot, on-screen message.

## Build

```bash
npm run dev      # tsc --watch
npm run build    # one-shot
```

Output goes to `../dist/index.js`.
