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
import { registerCallTools } from "./tools/call.js";
import { registerContactTools } from "./tools/contact.js";

const server = new McpServer({
  name: "freebox-mcp-server",
  version: "1.2.0",
});

// Tool groups, by toolset name. A deployment can expose only some of them with
// --toolsets=a,b (or FREEBOX_TOOLSETS=a,b), e.g. to give an assistant the TV
// tools without the network ones. Default: all of them.
const TOOLSETS: Record<string, (server: McpServer) => void> = {
  auth: registerAuthTools,
  system: registerSystemTools,
  connection: registerConnectionTools,
  wifi: registerWifiTools,
  lan: registerLanTools,
  dhcp: registerDhcpTools,
  downloads: registerDownloadTools,
  filesystem: registerFilesystemTools,
  network: registerNetworkTools,
  freeplug: registerFreeplugTools,
  parental: registerParentalTools,
  "vpn-server": registerVpnServerTools,
  "vpn-client": registerVpnClientTools,
  upnp: registerUpnpTools,
  netshare: registerNetshareTools,
  ftp: registerFtpTools,
  tftp: registerTftpTools,
  sfp: registerSfpTools,
  call: registerCallTools,
  contact: registerContactTools,
};

function selectedToolsets(): string[] {
  const arg = process.argv
    .slice(2)
    .find((a) => a.startsWith("--toolsets="))
    ?.slice("--toolsets=".length);
  const value = (arg ?? process.env.FREEBOX_TOOLSETS ?? "").trim();
  if (value === "" || value === "all") return Object.keys(TOOLSETS);
  const names = value.split(",").map((n) => n.trim()).filter(Boolean);
  const unknown = names.filter((n) => !(n in TOOLSETS));
  if (unknown.length > 0) {
    // Fail loudly: silently exposing fewer (or more) tools than intended is worse.
    console.error(
      `Unknown toolset(s): ${unknown.join(", ")}. Available: ${Object.keys(TOOLSETS).join(", ")}`
    );
    process.exit(1);
  }
  return names;
}

for (const name of selectedToolsets()) {
  TOOLSETS[name](server);
}

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
