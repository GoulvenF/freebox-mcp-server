#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAuthTools } from "./tools/auth.js";
import { registerSystemTools } from "./tools/system.js";
import { registerConnectionTools } from "./tools/connection.js";
import { registerWifiTools } from "./tools/wifi.js";
import { registerLanTools } from "./tools/lan.js";
import { registerDhcpTools } from "./tools/dhcp.js";
import { registerDownloadTools } from "./tools/downloads.js";
import { registerFilesystemTools } from "./tools/filesystem.js";
import { registerNetworkTools } from "./tools/network.js";

const server = new McpServer({
  name: "freebox-mcp-server",
  version: "1.0.0",
});

// Register all tool groups
registerAuthTools(server);
registerSystemTools(server);
registerConnectionTools(server);
registerWifiTools(server);
registerLanTools(server);
registerDhcpTools(server);
registerDownloadTools(server);
registerFilesystemTools(server);
registerNetworkTools(server);

// Run with stdio transport
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Freebox MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
