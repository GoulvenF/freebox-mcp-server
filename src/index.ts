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
import { registerFreeplugTools } from "./tools/freeplug.js";
import { registerParentalTools } from "./tools/parental.js";
import { registerVpnServerTools } from "./tools/vpn-server.js";
import { registerVpnClientTools } from "./tools/vpn-client.js";
import { registerUpnpTools } from "./tools/upnp.js";
import { registerNetshareTools } from "./tools/netshare.js";
import { registerFtpTools } from "./tools/ftp.js";
import { registerTftpTools } from "./tools/tftp.js";
import { registerSfpTools } from "./tools/sfp.js";

const server = new McpServer({
  name: "freebox-mcp-server",
  version: "1.1.0",
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
registerFreeplugTools(server);
registerParentalTools(server);
registerVpnServerTools(server);
registerVpnClientTools(server);
registerUpnpTools(server);
registerNetshareTools(server);
registerFtpTools(server);
registerTftpTools(server);
registerSfpTools(server);

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
