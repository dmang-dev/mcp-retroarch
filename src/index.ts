#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RetroArchClient } from "./retroarch.js";
import { registerTools } from "./tools.js";

const HOST = process.env.RETROARCH_HOST ?? "127.0.0.1";
const PORT = parseInt(process.env.RETROARCH_PORT ?? "55355", 10);

async function main() {
  const ra = new RetroArchClient({ host: HOST, port: PORT });

  // Probe with a VERSION query so we can give a clear startup line.
  // Don't fail hard if RetroArch isn't running yet — the user can launch it
  // mid-session and tools will start working as soon as it does.
  try {
    await ra.connect();
    const v = await ra.getVersion();
    process.stderr.write(`[mcp-retroarch] connected to ${ra.describeTarget()} — RetroArch ${v}\n`);
  } catch (err) {
    process.stderr.write(
      `[mcp-retroarch] WARNING: could not reach RetroArch (${ra.describeTarget()}): ${err}\n` +
      `             Make sure Network Commands are enabled in retroarch.cfg:\n` +
      `               network_cmd_enable = "true"\n` +
      `               network_cmd_port   = "${PORT}"\n` +
      `             (Also available via Settings > Network > Network Commands.)\n`,
    );
  }

  const server = new Server(
    { name: "mcp-retroarch", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  registerTools(server, ra);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[mcp-retroarch] MCP server ready (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`[mcp-retroarch] fatal: ${err}\n`);
  process.exit(1);
});
