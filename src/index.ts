#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RetroArchClient } from "./retroarch.js";
import { RetropadClient } from "./retropad.js";
import { registerTools } from "./tools.js";

const HOST = process.env.RETROARCH_HOST ?? "127.0.0.1";
const PORT = parseInt(process.env.RETROARCH_PORT ?? "55355", 10);
// Network Gamepad (input) channel — separate from the NCI command port.
const RETROPAD_HOST = process.env.RETROARCH_RETROPAD_HOST ?? HOST;
const RETROPAD_BASE_PORT = parseInt(process.env.RETROARCH_RETROPAD_BASE_PORT ?? "55400", 10);

async function main() {
  const ra = new RetroArchClient({ host: HOST, port: PORT });
  const pad = new RetropadClient({ host: RETROPAD_HOST, basePort: RETROPAD_BASE_PORT });

  // Bring up the MCP transport immediately — don't block startup on reaching
  // RetroArch. Introspection (tools/list) must respond fast even with no
  // emulator running (e.g. in a CI/registry container). The connectivity
  // probe runs in the background and just logs its result; individual tool
  // calls each (re)connect on demand.
  const server = new Server(
    { name: "mcp-retroarch", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, ra, pad);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[mcp-retroarch] MCP server ready (stdio)\n");

  // Background connectivity probe — fire-and-forget, never blocks the server.
  ra.connect()
    .then(() => ra.getVersion())
    .then((v) => process.stderr.write(`[mcp-retroarch] connected to ${ra.describeTarget()} — RetroArch ${v}\n`))
    .catch((err) => process.stderr.write(
      `[mcp-retroarch] note: RetroArch not reachable yet (${ra.describeTarget()}): ${err}\n` +
      `             Enable Network Commands in retroarch.cfg (network_cmd_enable / network_cmd_port)\n` +
      `             or Settings > Network > Network Commands. Tool calls will connect on demand.\n`,
    ));
}

main().catch((err) => {
  process.stderr.write(`[mcp-retroarch] fatal: ${err}\n`);
  process.exit(1);
});
