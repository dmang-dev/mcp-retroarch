# Dockerfile — primarily for the Glama MCP registry (https://glama.ai/mcp/servers).
#
# Builds the MCP server and runs it over stdio. The server starts cleanly
# WITHOUT RetroArch present: the connectivity probe runs in the background
# and the MCP transport comes up immediately, so tools/list responds fast.
# That's exactly what Glama's "start + respond to introspection" check needs.
#
# For actual use you don't need Docker — `npm install -g mcp-retroarch` and
# point it at a running RetroArch with Network Commands enabled. See README.md.

FROM node:22-trixie-slim@sha256:cfd8f2a5bc50526aee08e88970979f92722828e7dcc6d8983607fb8bff4bdb82
WORKDIR /app

# Install dependencies. --ignore-scripts skips the `prepare` hook; we run the
# build explicitly below so the layer caching is predictable.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# The MCP server speaks JSON-RPC over stdio.
ENTRYPOINT ["node", "dist/index.js"]
