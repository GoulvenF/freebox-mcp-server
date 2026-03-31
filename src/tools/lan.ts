import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { LanConfig, LanHost } from "../types.js";

export function registerLanTools(server: McpServer): void {
  // Get LAN configuration
  server.registerTool(
    "freebox_lan_config",
    {
      title: "Get LAN Configuration",
      description: `Get the Freebox LAN configuration: network name, mode (router/bridge), IP address, DNS/mDNS/NetBIOS names.

Returns: JSON with name, mode, ip, name_dns, name_mdns, name_netbios.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const response =
          await freeboxClient.apiRequest<LanConfig>("lan/config/");
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        const config = response.result!;
        const text = [
          `## LAN Configuration`,
          `- **Name**: ${config.name}`,
          `- **Mode**: ${config.mode}`,
          `- **IP**: ${config.ip}`,
          `- **DNS name**: ${config.name_dns}`,
          `- **mDNS name**: ${config.name_mdns}`,
          `- **NetBIOS name**: ${config.name_netbios}`,
        ].join("\n");
        return { content: [{ type: "text", text }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Browse LAN hosts
  server.registerTool(
    "freebox_lan_hosts",
    {
      title: "List LAN Hosts",
      description: `List all hosts (devices) discovered on the local network via the LAN browser.
Shows device name, type, MAC address, IP addresses, and connectivity status.

Args:
  - interface (string, optional): Network interface to browse. Default: "pub" (main network). Other options depend on Freebox model.

Returns: Array of hosts with id, primary_name, host_type, mac, IP addresses, reachable status, active status, vendor name.`,
      inputSchema: {
        interface: z
          .string()
          .default("pub")
          .describe(
            'Network interface to browse (default: "pub" for main LAN)'
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { interface: string }) => {
      try {
        const response = await freeboxClient.apiRequest<LanHost[]>(
          `lan/browser/${encodeURIComponent(params.interface)}/`
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        const hosts = response.result || [];
        if (hosts.length === 0) {
          return {
            content: [{ type: "text", text: "No hosts found on the LAN." }],
          };
        }

        // Sort: active first, then by name
        const sorted = [...hosts].sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return (a.primary_name || "").localeCompare(b.primary_name || "");
        });

        const lines = sorted.map((h) => {
          const ips = (h.l3connectivities || [])
            .filter((c) => c.active)
            .map((c) => c.addr);
          const mac = h.l2ident?.id || "unknown";
          const status = h.active
            ? "🟢 active"
            : h.reachable
              ? "🟡 reachable"
              : "⚫ offline";
          return `- **${h.primary_name || "Unknown"}** (${h.host_type}) — ${status}\n  MAC: ${mac} | IP: ${ips.join(", ") || "N/A"}${h.vendor_name ? ` | Vendor: ${h.vendor_name}` : ""}`;
        });

        return {
          content: [
            {
              type: "text",
              text: `## LAN Hosts (${hosts.length} devices)\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Get specific host
  server.registerTool(
    "freebox_lan_host_get",
    {
      title: "Get LAN Host Details",
      description: `Get detailed information about a specific host on the LAN by its ID.
The host ID format is "l2type-macaddress" (e.g., "ether-00:24:d4:7e:00:4c").

Args:
  - host_id (string): The host ID (e.g., "ether-00:24:d4:7e:00:4c"). Get from freebox_lan_hosts.
  - interface (string, optional): Network interface (default: "pub").

Returns: Full host details including name, type, MAC, IPs, reachable/active status, vendor, connectivity history.`,
      inputSchema: {
        host_id: z
          .string()
          .describe('Host ID (e.g., "ether-00:24:d4:7e:00:4c")'),
        interface: z.string().default("pub").describe("Network interface"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { host_id: string; interface: string }) => {
      try {
        const response = await freeboxClient.apiRequest<LanHost>(
          `lan/browser/${encodeURIComponent(params.interface)}/${encodeURIComponent(params.host_id)}`
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        return {
          content: [
            { type: "text", text: JSON.stringify(response.result, null, 2) },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Update host name
  server.registerTool(
    "freebox_lan_host_update",
    {
      title: "Update LAN Host",
      description: `Update a LAN host's name or type. Useful for renaming devices on your network.

Args:
  - host_id (string): Host ID (e.g., "ether-00:24:d4:7e:00:4c").
  - interface (string, optional): Network interface (default: "pub").
  - primary_name (string, optional): New display name for the host.
  - host_type (string, optional): Host type (e.g., "workstation", "laptop", "smartphone", "tablet", "printer", "vg_console", "television", "nas", "ip_camera", "ip_phone", "freebox_player", "freebox_hd", "freebox_crystal", "freebox_mini", "freebox_delta", "freebox_one", "networking_device", "multimedia_device", "other").`,
      inputSchema: {
        host_id: z.string().describe("Host ID"),
        interface: z.string().default("pub").describe("Network interface"),
        primary_name: z
          .string()
          .optional()
          .describe("New display name for the host"),
        host_type: z.string().optional().describe("Host type"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: {
      host_id: string;
      interface: string;
      primary_name?: string;
      host_type?: string;
    }) => {
      try {
        const body: Record<string, unknown> = { id: params.host_id };
        if (params.primary_name) body.primary_name = params.primary_name;
        if (params.host_type) body.host_type = params.host_type;

        const response = await freeboxClient.apiRequest<LanHost>(
          `lan/browser/${encodeURIComponent(params.interface)}/${encodeURIComponent(params.host_id)}`,
          "PUT",
          body
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        return {
          content: [
            { type: "text", text: `Host updated.\n\n${JSON.stringify(response.result, null, 2)}` },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Wake on LAN
  server.registerTool(
    "freebox_wol",
    {
      title: "Wake on LAN",
      description: `Send a Wake-on-LAN magic packet to wake up a device on the network.

Args:
  - mac (string): MAC address of the device to wake (e.g., "00:24:d4:7e:00:4c").
  - password (string, optional): SecureOn password if required by the device.
  - interface (string, optional): Network interface (default: "pub").`,
      inputSchema: {
        mac: z.string().describe("MAC address of the device to wake"),
        password: z.string().default("").describe("SecureOn password (optional)"),
        interface: z.string().default("pub").describe("Network interface"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: { mac: string; password: string; interface: string }) => {
      try {
        const response = await freeboxClient.apiRequest(
          `lan/wol/${encodeURIComponent(params.interface)}/`,
          "POST",
          { mac: params.mac, password: params.password }
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Wake-on-LAN packet sent to ${params.mac}.`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );
}
