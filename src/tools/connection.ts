import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { ConnectionStatus, ConnectionConfig } from "../types.js";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatRate(bytesPerSec: number): string {
  return formatBytes(bytesPerSec) + "/s";
}

function formatBandwidth(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(0)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

export function registerConnectionTools(server: McpServer): void {
  // Get connection status
  server.registerTool(
    "freebox_connection_status",
    {
      title: "Get Connection Status",
      description: `Get the current internet connection status including connection type, state, IP addresses (IPv4/IPv6), bandwidth, current rates, and total bytes transferred.

Returns: Formatted connection status with type, state, media, IPs, bandwidth, current rates, and total data.`,
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
          await freeboxClient.apiRequest<ConnectionStatus>("connection/");
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
        const s = response.result!;
        const text = [
          `## Connection Status`,
          `- **State**: ${s.state}`,
          `- **Type**: ${s.type}`,
          `- **Media**: ${s.media}`,
          `- **IPv4**: ${s.ipv4}`,
          `- **IPv6**: ${s.ipv6}`,
          `- **Bandwidth**: ↓ ${formatBandwidth(s.bandwidth_down)} / ↑ ${formatBandwidth(s.bandwidth_up)}`,
          `- **Current rate**: ↓ ${formatRate(s.rate_down)} / ↑ ${formatRate(s.rate_up)}`,
          `- **Total**: ↓ ${formatBytes(s.bytes_down)} / ↑ ${formatBytes(s.bytes_up)}`,
          ...(s.ipv4_port_range
            ? [`- **Port range**: ${s.ipv4_port_range[0]}-${s.ipv4_port_range[1]}`]
            : []),
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

  // Get connection configuration
  server.registerTool(
    "freebox_connection_config",
    {
      title: "Get Connection Configuration",
      description: `Get the Freebox connection configuration including remote access settings, WOL, ad blocking, and API remote access.

Returns: JSON with ping, remote_access, remote_access_port, remote_access_min_port, remote_access_max_port, wol, adblock, adblock_not_set, api_remote_access, allow_token_request.`,
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
          await freeboxClient.apiRequest<ConnectionConfig>("connection/config/");
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
        const c = response.result!;
        // Explicit allowlist: never echo back credential-ish fields the API
        // may add to this object.
        const safe = {
          ping: c.ping,
          remote_access: c.remote_access,
          remote_access_port: c.remote_access_port,
          remote_access_min_port: c.remote_access_min_port,
          remote_access_max_port: c.remote_access_max_port,
          wol: c.wol,
          adblock: c.adblock,
          adblock_not_set: c.adblock_not_set,
          api_remote_access: c.api_remote_access,
          allow_token_request: c.allow_token_request,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(safe, null, 2) }],
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

  // Update connection configuration
  server.registerTool(
    "freebox_connection_config_update",
    {
      title: "Update Connection Configuration",
      description: `Update the Freebox connection configuration. Only specify the fields you want to change.
Requires 'settings' permission.

Args:
  - ping (boolean, optional): Enable/disable ping response
  - wol (boolean, optional): Enable/disable Wake on LAN
  - adblock (boolean, optional): Enable/disable ad blocking
  - remote_access (boolean, optional): Enable/disable remote access
  - remote_access_port (number, optional): Remote access port
  - api_remote_access (boolean, optional): Enable/disable API remote access
  - confirm (string, optional): REQUIRED when enabling 'remote_access' or 'api_remote_access'. Enabling either exposes your Freebox (and its full admin API) to the public internet. To proceed, pass confirm="JE-CONFIRME-EXPOSER-MA-FREEBOX".`,
      inputSchema: {
        ping: z.boolean().optional().describe("Enable/disable ping response"),
        wol: z.boolean().optional().describe("Enable/disable Wake on LAN"),
        adblock: z.boolean().optional().describe("Enable/disable ad blocking"),
        remote_access: z
          .boolean()
          .optional()
          .describe("Enable/disable remote access"),
        remote_access_port: z
          .number()
          .int()
          .optional()
          .describe("Remote access port"),
        api_remote_access: z
          .boolean()
          .optional()
          .describe("Enable/disable API remote access"),
        confirm: z
          .string()
          .optional()
          .describe(
            'Pass the exact confirmation phrase shown in the tool description to execute this action.'
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: Record<string, unknown>) => {
      try {
        const exposesFreebox =
          params.remote_access === true || params.api_remote_access === true;
        if (exposesFreebox && params.confirm !== "JE-CONFIRME-EXPOSER-MA-FREEBOX") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: 'Refusé : cette action est sensible. Activer remote_access ou api_remote_access expose votre Freebox — et son API d\'administration complète — sur Internet public. Confirmez avec confirm="JE-CONFIRME-EXPOSER-MA-FREEBOX".',
              },
            ],
          };
        }
        // Filter out undefined values
        const body: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
          if (key === "confirm") continue;
          if (value !== undefined) body[key] = value;
        }
        const response = await freeboxClient.apiRequest<ConnectionConfig>(
          "connection/config/",
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
            {
              type: "text",
              text: `Connection config updated.\n\n${JSON.stringify(response.result, null, 2)}`,
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
