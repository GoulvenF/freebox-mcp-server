import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { VpnClientConfig, VpnClientStatus } from "../types.js";

const UNSTABLE_NOTE = `⚠️ This uses an UNSTABLE/internal Freebox API ([UNSTABLE] in Freebox's own documentation): endpoints and fields may change without notice.`;

const OPENVPN_NOTE = `Note: OpenVPN client configuration fields are not fully documented by Freebox (the .ovpn profile is usually uploaded separately). For type "openvpn", only description/active are sent — finish the configuration in the Freebox OS web UI once created.`;

function stateEmoji(state: VpnClientStatus["state"]): string {
  switch (state) {
    case "up":
      return "🟢";
    case "down":
      return "⚫";
    case "waiting_wan":
      return "⏳";
    default:
      return "🟡";
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

const LOG_CHARACTER_LIMIT = 4000;

type ConfPptp = {
  remote_host?: string;
  username?: string;
  password?: string;
  mppe?: "disable" | "require" | "require_128";
  allowed_auth?: Record<string, boolean>;
};

type ConfWireguard = {
  remote_addr?: string;
  remote_port?: number;
  remote_public_key?: string;
  remote_preshared_key?: string;
  local_priv_key?: string;
  local_addr?: Array<{ ip: string; len: number }>;
  dns?: string[];
};

const confPptpSchema = z
  .object({
    remote_host: z.string().optional().describe("Remote PPTP server host"),
    username: z.string().optional().describe("PPTP username"),
    password: z.string().optional().describe("PPTP password"),
    mppe: z
      .enum(["disable", "require", "require_128"])
      .default("require")
      .describe("MPPE encryption mode"),
    allowed_auth: z
      .record(z.boolean())
      .optional()
      .describe(
        "Allowed auth methods, e.g. {eap: false, pap: false, chap: true, mschap: true, mschapv2: true}"
      ),
  })
  .optional()
  .describe("PPTP client configuration");

const confWireguardSchema = z
  .object({
    remote_addr: z.string().optional().describe("Remote WireGuard endpoint address"),
    remote_port: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe("Remote WireGuard endpoint port"),
    remote_public_key: z.string().optional().describe("Remote peer public key"),
    remote_preshared_key: z
      .string()
      .optional()
      .describe("Optional pre-shared key"),
    local_priv_key: z.string().optional().describe("Local private key"),
    local_addr: z
      .array(
        z.object({
          ip: z.string().describe("Local tunnel IP"),
          len: z.number().int().describe("Prefix length"),
        })
      )
      .optional()
      .describe("Local tunnel addresses"),
    dns: z.array(z.string()).optional().describe("DNS servers to use over the tunnel"),
  })
  .optional()
  .describe("WireGuard client configuration");

export function registerVpnClientTools(server: McpServer): void {
  // List VPN client configurations
  server.registerTool(
    "freebox_vpn_client_list",
    {
      title: "List VPN Client Configurations",
      description: `List the VPN client configurations of the Freebox (the Freebox connects OUT to a remote VPN as a client). Only one configuration can be active at a time.
${UNSTABLE_NOTE}

Returns: Array of configurations with id, description, type, active.`,
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
          await freeboxClient.apiRequest<VpnClientConfig[]>(
            "vpn_client/config/"
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
        const configs = response.result || [];
        if (configs.length === 0) {
          return {
            content: [
              { type: "text", text: "No VPN client configuration defined." },
            ],
          };
        }
        const lines = configs.map(
          (c) =>
            `- ${c.active ? "🟢" : "⚫"} **${c.description || "(no description)"}** (ID: ${c.id}) — type: ${c.type}, ${c.active ? "active" : "inactive"}`
        );
        return {
          content: [
            {
              type: "text",
              text: `## VPN Client Configurations (${configs.length})\n\n${lines.join("\n")}`,
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

  // Get a VPN client configuration
  server.registerTool(
    "freebox_vpn_client_get",
    {
      title: "Get VPN Client Configuration",
      description: `Get a single VPN client configuration by its ID.
${UNSTABLE_NOTE}

Args:
  - id (string): VPN client configuration ID.`,
      inputSchema: {
        id: z.string().min(1).describe("VPN client configuration ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: string }) => {
      try {
        const response = await freeboxClient.apiRequest<VpnClientConfig>(
          `vpn_client/config/${encodeURIComponent(params.id)}`
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
        const c = response.result!;
        const lines = [
          `## VPN Client Configuration: ${c.description || c.id}`,
          `- **ID**: ${c.id}`,
          `- **Type**: ${c.type}`,
          `- **Active**: ${c.active ? "🟢 yes" : "⚫ no"}`,
        ];
        if (c.conf_pptp) {
          lines.push(
            `- **PPTP**: ${c.conf_pptp.username}@${c.conf_pptp.remote_host}, mppe=${c.conf_pptp.mppe}`
          );
        }
        if (c.conf_wireguard) {
          lines.push(
            `- **WireGuard**: ${c.conf_wireguard.remote_addr}:${c.conf_wireguard.remote_port}`
          );
          lines.push(
            `  - Local addresses: ${(c.conf_wireguard.local_addr || []).map((a) => `${a.ip}/${a.len}`).join(", ") || "none"}`
          );
          lines.push(
            `  - DNS: ${(c.conf_wireguard.dns || []).join(", ") || "none"}`
          );
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Add a VPN client configuration
  server.registerTool(
    "freebox_vpn_client_add",
    {
      title: "Add VPN Client Configuration",
      description: `Create a new VPN client configuration on the Freebox (the Freebox connects OUT to a remote VPN server). Only one configuration can be active at a time.
Requires 'settings' permission.
${UNSTABLE_NOTE}

${OPENVPN_NOTE}

Args:
  - type (string): "pptp", "openvpn" or "wireguard".
  - description (string): Human readable description.
  - active (boolean, optional): Activate this configuration (default: false).
  - conf_pptp (object, optional): { remote_host, username, password, mppe, allowed_auth }.
  - conf_wireguard (object, optional): { remote_addr, remote_port, remote_public_key, remote_preshared_key, local_priv_key, local_addr, dns }.`,
      inputSchema: {
        type: z.enum(["pptp", "openvpn", "wireguard"]).describe("VPN type"),
        description: z.string().min(1).describe("Configuration description"),
        active: z
          .boolean()
          .default(false)
          .describe("Activate this configuration"),
        conf_pptp: confPptpSchema,
        conf_wireguard: confWireguardSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      type: "pptp" | "openvpn" | "wireguard";
      description: string;
      active: boolean;
      conf_pptp?: ConfPptp;
      conf_wireguard?: ConfWireguard;
    }) => {
      try {
        const body: Record<string, unknown> = {
          type: params.type,
          description: params.description,
          active: params.active,
        };
        if (params.type === "pptp" && params.conf_pptp)
          body.conf_pptp = params.conf_pptp;
        if (params.type === "wireguard" && params.conf_wireguard)
          body.conf_wireguard = params.conf_wireguard;

        const response = await freeboxClient.apiRequest<VpnClientConfig>(
          "vpn_client/config/",
          "POST",
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
              text: `VPN client configuration created (ID: ${response.result?.id}).${params.type === "openvpn" ? `\n\n${OPENVPN_NOTE}` : ""}\n\n${JSON.stringify(response.result, null, 2)}`,
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

  // Update a VPN client configuration
  server.registerTool(
    "freebox_vpn_client_update",
    {
      title: "Update VPN Client Configuration",
      description: `Update an existing VPN client configuration. Only the provided fields are sent — most commonly just active to switch which configuration is used.
Requires 'settings' permission.
${UNSTABLE_NOTE}

Note: setting active: true deactivates any other currently-active VPN client configuration, since only one can be active at a time.

Args:
  - id (string): VPN client configuration ID.
  - active (boolean, optional): Activate/deactivate this configuration.
  - description (string, optional): New description.
  - conf_pptp (object, optional): PPTP settings to change.
  - conf_wireguard (object, optional): WireGuard settings to change.`,
      inputSchema: {
        id: z.string().min(1).describe("VPN client configuration ID"),
        active: z
          .boolean()
          .optional()
          .describe("Activate this configuration (deactivates the others)"),
        description: z.string().optional().describe("New description"),
        conf_pptp: confPptpSchema,
        conf_wireguard: confWireguardSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      id: string;
      active?: boolean;
      description?: string;
      conf_pptp?: ConfPptp;
      conf_wireguard?: ConfWireguard;
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.active !== undefined) body.active = params.active;
        if (params.description !== undefined)
          body.description = params.description;
        if (params.conf_pptp) body.conf_pptp = params.conf_pptp;
        if (params.conf_wireguard) body.conf_wireguard = params.conf_wireguard;

        if (Object.keys(body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Error: no field to update. Provide at least one field.",
              },
            ],
          };
        }

        const response = await freeboxClient.apiRequest<VpnClientConfig>(
          `vpn_client/config/${encodeURIComponent(params.id)}`,
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
              text: `VPN client configuration ${params.id} updated.\n\n${JSON.stringify(response.result, null, 2)}`,
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

  // Delete a VPN client configuration
  server.registerTool(
    "freebox_vpn_client_delete",
    {
      title: "Delete VPN Client Configuration",
      description: `Delete a VPN client configuration by its ID.
Requires 'settings' permission.
${UNSTABLE_NOTE}

Args:
  - id (string): VPN client configuration ID.`,
      inputSchema: {
        id: z.string().min(1).describe("VPN client configuration ID"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: string }) => {
      try {
        const response = await freeboxClient.apiRequest(
          `vpn_client/config/${encodeURIComponent(params.id)}`,
          "DELETE"
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
              text: `VPN client configuration ${params.id} deleted.`,
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

  // Get VPN client status
  server.registerTool(
    "freebox_vpn_client_status",
    {
      title: "Get VPN Client Status",
      description: `Get the current status of the Freebox VPN client connection: active configuration, state, timings, last error, throughput and IPv4 settings obtained over the tunnel.
${UNSTABLE_NOTE}

Returns: Formatted status with state, active VPN, stats and IPv4 configuration.`,
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
          await freeboxClient.apiRequest<VpnClientStatus>("vpn_client/status");
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
        const lines = [
          `## VPN Client Status`,
          `- **State**: ${stateEmoji(s.state)} ${s.state}`,
          `- **Enabled**: ${s.enabled ? "✅" : "❌"}`,
        ];
        if (s.active_vpn)
          lines.push(
            `- **Active VPN**: ${s.active_vpn_description || s.active_vpn} (${s.active_vpn})${s.type ? ` — type: ${s.type}` : ""}`
          );
        if (s.last_up)
          lines.push(`- **Last up**: ${new Date(s.last_up * 1000).toISOString()}`);
        if (s.last_try)
          lines.push(
            `- **Last try**: ${new Date(s.last_try * 1000).toISOString()}`
          );
        if (s.next_try)
          lines.push(
            `- **Next try**: ${new Date(s.next_try * 1000).toISOString()}`
          );
        if (s.last_error) lines.push(`- **Last error**: 🔴 ${s.last_error}`);
        if (s.stats)
          lines.push(
            `- **Rates**: ↓ ${formatBytes(s.stats.rate_down)}/s / ↑ ${formatBytes(s.stats.rate_up)}/s`,
            `- **Total**: ↓ ${formatBytes(s.stats.bytes_down)} / ↑ ${formatBytes(s.stats.bytes_up)}`
          );
        if (s.ipv4) {
          lines.push(
            `- **IPv4 config**: ${s.ipv4.config_valid ? "✅ valid" : "❌ invalid"}`
          );
          if (s.ipv4.ip_mask)
            lines.push(
              `  - Address: ${s.ipv4.ip_mask.ip} / ${s.ipv4.ip_mask.mask}`
            );
          if (s.ipv4.gateway) lines.push(`  - Gateway: ${s.ipv4.gateway}`);
          if (s.ipv4.domain) lines.push(`  - Domain: ${s.ipv4.domain}`);
          if (s.ipv4.dns?.length)
            lines.push(`  - DNS: ${s.ipv4.dns.join(", ")}`);
          if (s.ipv4.provider) lines.push(`  - Provider: ${s.ipv4.provider}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Get VPN client logs
  server.registerTool(
    "freebox_vpn_client_logs",
    {
      title: "Get VPN Client Logs",
      description: `Get the connection logs of the Freebox VPN client. Useful to diagnose why a tunnel fails to come up.
${UNSTABLE_NOTE}

Returns: Plain text log dump, truncated to the last ${LOG_CHARACTER_LIMIT} characters when longer.`,
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
          await freeboxClient.apiRequest<string>("vpn_client/log");
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
        const log = response.result || "";
        if (!log) {
          return {
            content: [{ type: "text", text: "VPN client log is empty." }],
          };
        }
        const truncated = log.length > LOG_CHARACTER_LIMIT;
        const text = truncated ? log.slice(-LOG_CHARACTER_LIMIT) : log;
        return {
          content: [
            {
              type: "text",
              text: `## VPN Client Logs${truncated ? ` (truncated to last ${LOG_CHARACTER_LIMIT} characters)` : ""}\n\n\`\`\`\n${text}\n\`\`\``,
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
