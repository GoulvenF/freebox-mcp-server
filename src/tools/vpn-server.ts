import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type {
  VpnServer,
  VpnServerState,
  VpnServerConfig,
  VpnServerUser,
  VpnIpPool,
  VpnServerConnection,
} from "../types.js";

const UNSTABLE_NOTE = `⚠️ This uses an UNSTABLE/internal Freebox API ([UNSTABLE] in Freebox's own documentation): endpoints and fields may change without notice.`;

function stateEmoji(state: VpnServerState): string {
  switch (state) {
    case "started":
      return "🟢";
    case "stopped":
      return "⚫";
    case "error":
      return "🔴";
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

const confPptpSchema = z
  .object({
    mppe: z
      .enum(["disable", "require", "require_128"])
      .optional()
      .describe("MPPE encryption mode"),
    allowed_auth: z
      .record(z.boolean())
      .optional()
      .describe("Allowed auth methods, e.g. {pap: false, chap: true, mschapv2: true}"),
  })
  .optional()
  .describe("PPTP specific configuration");

const confOpenvpnSchema = z
  .object({
    cipher: z
      .enum(["blowfish", "aes128", "aes256", "chacha20poly1305"])
      .optional()
      .describe("OpenVPN cipher"),
    disable_fragment: z.boolean().optional().describe("Disable fragmentation"),
    use_tcp: z.boolean().optional().describe("Use TCP instead of UDP"),
  })
  .optional()
  .describe("OpenVPN specific configuration");

const confWireguardSchema = z
  .object({
    mtu: z.number().int().min(512).max(1420).optional().describe("WireGuard MTU"),
  })
  .optional()
  .describe("WireGuard specific configuration");

export function registerVpnServerTools(server: McpServer): void {
  // List VPN servers
  server.registerTool(
    "freebox_vpn_server_list",
    {
      title: "List VPN Servers",
      description: `List all VPN servers hosted by the Freebox (remote clients connect INTO the LAN via PPTP/OpenVPN/IPsec/WireGuard).
${UNSTABLE_NOTE}

Returns: Array of VPN servers with name (id), type, state, connection_count, auth_connection_count.`,
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
        const response = await freeboxClient.apiRequest<VpnServer[]>("vpn/");
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
        const servers = response.result || [];
        if (servers.length === 0) {
          return {
            content: [{ type: "text", text: "No VPN server configured." }],
          };
        }
        const lines = servers.map(
          (s) =>
            `- ${stateEmoji(s.state)} **${s.name}** (${s.type}) — state: ${s.state}, connections: ${s.connection_count} (${s.auth_connection_count} authenticated)`
        );
        return {
          content: [
            {
              type: "text",
              text: `## VPN Servers (${servers.length})\n\n${lines.join("\n")}`,
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

  // Get VPN server config
  server.registerTool(
    "freebox_vpn_server_config_get",
    {
      title: "Get VPN Server Configuration",
      description: `Get the configuration of a specific VPN server hosted by the Freebox.
${UNSTABLE_NOTE}

Args:
  - vpn_id (string): VPN server id, e.g. "pptp", "openvpn_routed", "openvpn_bridge", "wireguard", "ipsec".

Returns: Configuration including enabled, ports, IP pool range and type-specific settings.`,
      inputSchema: {
        vpn_id: z
          .string()
          .describe(
            'VPN server id ("pptp", "openvpn_routed", "openvpn_bridge", "wireguard", "ipsec")'
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { vpn_id: string }) => {
      try {
        const response = await freeboxClient.apiRequest<VpnServerConfig>(
          `vpn/${params.vpn_id}/config/`
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
          `## VPN Server Configuration: ${c.id}`,
          `- **Type**: ${c.type}`,
          `- **Enabled**: ${c.enabled ? "✅" : "❌"}`,
          `- **IPv4**: ${c.enable_ipv4 ? "✅" : "❌"} — **IPv6**: ${c.enable_ipv6 ? "✅" : "❌"}`,
          `- **Port**: ${c.port}${c.min_port !== undefined ? ` (range ${c.min_port}-${c.max_port})` : ""}`,
        ];
        if (c.port_ike !== undefined) lines.push(`- **IKE port**: ${c.port_ike}`);
        if (c.port_nat !== undefined) lines.push(`- **NAT-T port**: ${c.port_nat}`);
        if (c.ip_start) lines.push(`- **IPv4 pool**: ${c.ip_start} → ${c.ip_end}`);
        if (c.ip6_start) lines.push(`- **IPv6 pool**: ${c.ip6_start} → ${c.ip6_end}`);
        if (c.conf_pptp)
          lines.push(
            `- **PPTP**: mppe=${c.conf_pptp.mppe}, auth=${Object.entries(c.conf_pptp.allowed_auth || {})
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join(", ") || "none"}`
          );
        if (c.conf_openvpn)
          lines.push(
            `- **OpenVPN**: cipher=${c.conf_openvpn.cipher}, tcp=${c.conf_openvpn.use_tcp ? "yes" : "no"}, disable_fragment=${c.conf_openvpn.disable_fragment ? "yes" : "no"}`
          );
        if (c.conf_wireguard)
          lines.push(`- **WireGuard**: mtu=${c.conf_wireguard.mtu}`);
        if (c.conf_ipsec)
          lines.push(
            `- **IPsec** (read-only): ike_version=${c.conf_ipsec.ike_version}, auth_modes=${c.conf_ipsec.auth_modes?.length ?? 0}`
          );
        return {
          content: [{ type: "text", text: lines.join("\n") }],
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

  // Update VPN server config
  server.registerTool(
    "freebox_vpn_server_config_update",
    {
      title: "Update VPN Server Configuration",
      description: `Update the configuration of a VPN server hosted by the Freebox. Only the provided fields are sent.
Requires 'settings' permission.
${UNSTABLE_NOTE}

Note: conf_ipsec and the IP pool range (ip_start/ip_end) are read-only and cannot be changed here.

Args:
  - vpn_id (string): VPN server id, e.g. "pptp", "openvpn_routed", "openvpn_bridge", "wireguard", "ipsec".
  - enabled (boolean, optional): Enable/disable the VPN server.
  - enable_ipv4 (boolean, optional): Enable IPv4.
  - enable_ipv6 (boolean, optional): Enable IPv6.
  - port (number, optional): Listening port.
  - port_ike (number, optional): IKE port (IPsec).
  - port_nat (number, optional): NAT-T port (IPsec).
  - conf_pptp (object, optional): { mppe, allowed_auth }.
  - conf_openvpn (object, optional): { cipher, disable_fragment, use_tcp }.
  - conf_wireguard (object, optional): { mtu }.`,
      inputSchema: {
        vpn_id: z.string().describe("VPN server id"),
        enabled: z.boolean().optional().describe("Enable the VPN server"),
        enable_ipv4: z.boolean().optional().describe("Enable IPv4"),
        enable_ipv6: z.boolean().optional().describe("Enable IPv6"),
        port: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .optional()
          .describe("Listening port"),
        port_ike: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .optional()
          .describe("IKE port (IPsec)"),
        port_nat: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .optional()
          .describe("NAT-T port (IPsec)"),
        conf_pptp: confPptpSchema,
        conf_openvpn: confOpenvpnSchema,
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
      vpn_id: string;
      enabled?: boolean;
      enable_ipv4?: boolean;
      enable_ipv6?: boolean;
      port?: number;
      port_ike?: number;
      port_nat?: number;
      conf_pptp?: {
        mppe?: "disable" | "require" | "require_128";
        allowed_auth?: Record<string, boolean>;
      };
      conf_openvpn?: {
        cipher?: "blowfish" | "aes128" | "aes256" | "chacha20poly1305";
        disable_fragment?: boolean;
        use_tcp?: boolean;
      };
      conf_wireguard?: { mtu?: number };
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.enabled !== undefined) body.enabled = params.enabled;
        if (params.enable_ipv4 !== undefined)
          body.enable_ipv4 = params.enable_ipv4;
        if (params.enable_ipv6 !== undefined)
          body.enable_ipv6 = params.enable_ipv6;
        if (params.port !== undefined) body.port = params.port;
        if (params.port_ike !== undefined) body.port_ike = params.port_ike;
        if (params.port_nat !== undefined) body.port_nat = params.port_nat;
        if (params.conf_pptp) body.conf_pptp = params.conf_pptp;
        if (params.conf_openvpn) body.conf_openvpn = params.conf_openvpn;
        if (params.conf_wireguard) body.conf_wireguard = params.conf_wireguard;

        if (Object.keys(body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Error: no field to update. Provide at least one configuration field.",
              },
            ],
          };
        }

        const response = await freeboxClient.apiRequest<VpnServerConfig>(
          `vpn/${params.vpn_id}/config/`,
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
              text: `VPN server "${params.vpn_id}" configuration updated.\n\n${JSON.stringify(response.result, null, 2)}`,
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

  // List VPN server users
  server.registerTool(
    "freebox_vpn_server_user_list",
    {
      title: "List VPN Server Users",
      description: `List all VPN users. Users are shared across all VPN server types hosted by the Freebox.
${UNSTABLE_NOTE}

Returns: Array of users with login, type, password_set, ip_reservation.`,
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
          await freeboxClient.apiRequest<VpnServerUser[]>("vpn/user/");
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
        const users = response.result || [];
        if (users.length === 0) {
          return {
            content: [{ type: "text", text: "No VPN user configured." }],
          };
        }
        const lines = users.map(
          (u) =>
            `- **${u.login}** (${u.type}) — password: ${u.password_set ? "🔑 set" : "⚠️ not set"}${u.ip_reservation ? `, IP: ${u.ip_reservation}` : ""}`
        );
        return {
          content: [
            {
              type: "text",
              text: `## VPN Users (${users.length})\n\n${lines.join("\n")}`,
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

  // Get a VPN server user
  server.registerTool(
    "freebox_vpn_server_user_get",
    {
      title: "Get VPN Server User",
      description: `Get a single VPN user by its login.
${UNSTABLE_NOTE}

Args:
  - login (string): User login.`,
      inputSchema: {
        login: z.string().describe("VPN user login"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { login: string }) => {
      try {
        const response = await freeboxClient.apiRequest<VpnServerUser>(
          `vpn/user/${encodeURIComponent(params.login)}`
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
        const u = response.result!;
        const lines = [
          `## VPN User: ${u.login}`,
          `- **Type**: ${u.type}`,
          `- **Password**: ${u.password_set ? "🔑 set" : "⚠️ not set"}`,
        ];
        if (u.ip_reservation)
          lines.push(`- **IP reservation**: ${u.ip_reservation}`);
        if (u.conf_wireguard)
          lines.push(
            `- **WireGuard**: keepalive=${u.conf_wireguard.keepalive}, psk=${u.conf_wireguard.psk ? "yes" : "no"}`
          );
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

  // Add a VPN server user
  server.registerTool(
    "freebox_vpn_server_user_add",
    {
      title: "Add VPN Server User",
      description: `Create a new VPN user allowed to connect to the Freebox VPN servers.
Requires 'settings' permission.
${UNSTABLE_NOTE}

Note: a password is required in practice for "standard" users, and an ip_reservation is required for "wireguard" users.

Args:
  - login (string): User login.
  - type (string, optional): "standard" (PPTP/OpenVPN/IPsec) or "wireguard" (default: "standard").
  - password (string, optional): Password, 8 to 32 characters.
  - ip_reservation (string, optional): Reserved IP address for this user.`,
      inputSchema: {
        login: z.string().min(1).describe("User login"),
        type: z
          .enum(["standard", "wireguard"])
          .default("standard")
          .describe("User type"),
        password: z
          .string()
          .min(8)
          .max(32)
          .optional()
          .describe("Password (8-32 characters)"),
        ip_reservation: z
          .string()
          .optional()
          .describe("Reserved IP address (required for wireguard users)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      login: string;
      type: "standard" | "wireguard";
      password?: string;
      ip_reservation?: string;
    }) => {
      try {
        if (params.type === "standard" && !params.password) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: 'Error: password is required for "standard" VPN users.',
              },
            ],
          };
        }
        if (params.type === "wireguard" && !params.ip_reservation) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: 'Error: ip_reservation is required for "wireguard" VPN users.',
              },
            ],
          };
        }

        const body: Record<string, unknown> = {
          login: params.login,
          type: params.type,
        };
        if (params.password) body.password = params.password;
        if (params.ip_reservation) body.ip_reservation = params.ip_reservation;

        const response = await freeboxClient.apiRequest<VpnServerUser>(
          "vpn/user/",
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
              text: `VPN user "${params.login}" created (${params.type}).`,
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

  // Update a VPN server user
  server.registerTool(
    "freebox_vpn_server_user_update",
    {
      title: "Update VPN Server User",
      description: `Update an existing VPN user (for example to change its password or IP reservation). Only the provided fields are sent.
Requires 'settings' permission.
${UNSTABLE_NOTE}

Args:
  - login (string): User login.
  - password (string, optional): New password, 8 to 32 characters.
  - ip_reservation (string, optional): New reserved IP address.`,
      inputSchema: {
        login: z.string().min(1).describe("User login"),
        password: z
          .string()
          .min(8)
          .max(32)
          .optional()
          .describe("New password (8-32 characters)"),
        ip_reservation: z
          .string()
          .optional()
          .describe("New reserved IP address"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      login: string;
      password?: string;
      ip_reservation?: string;
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.password !== undefined) body.password = params.password;
        if (params.ip_reservation !== undefined)
          body.ip_reservation = params.ip_reservation;

        if (Object.keys(body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Error: no field to update. Provide password and/or ip_reservation.",
              },
            ],
          };
        }

        const response = await freeboxClient.apiRequest<VpnServerUser>(
          `vpn/user/${encodeURIComponent(params.login)}`,
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
            { type: "text", text: `VPN user "${params.login}" updated.` },
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

  // Delete a VPN server user
  server.registerTool(
    "freebox_vpn_server_user_delete",
    {
      title: "Delete VPN Server User",
      description: `Delete a VPN user. The user will no longer be able to connect to any Freebox VPN server.
Requires 'settings' permission.
${UNSTABLE_NOTE}

Args:
  - login (string): User login.`,
      inputSchema: {
        login: z.string().min(1).describe("User login"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { login: string }) => {
      try {
        const response = await freeboxClient.apiRequest(
          `vpn/user/${encodeURIComponent(params.login)}`,
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
            { type: "text", text: `VPN user "${params.login}" deleted.` },
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

  // Get VPN IP pool
  server.registerTool(
    "freebox_vpn_server_ip_pool",
    {
      title: "Get VPN IP Pool",
      description: `Get the IP address pool used by the Freebox VPN servers, including per-user IP reservations.
${UNSTABLE_NOTE}

Returns: ip_start, ip_end and the list of reservations (login → ip).`,
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
          await freeboxClient.apiRequest<VpnIpPool>("vpn/ip_pool/");
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
        const pool = response.result!;
        const reservations = pool.reservations || [];
        const lines = [
          `## VPN IP Pool`,
          `- **Range**: ${pool.ip_start} → ${pool.ip_end}`,
          `- **Reservations**: ${reservations.length}`,
        ];
        for (const r of reservations) {
          lines.push(`  - ${r.login} → ${r.ip}`);
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

  // List active VPN server connections
  server.registerTool(
    "freebox_vpn_server_connections_list",
    {
      title: "List VPN Server Connections",
      description: `List the active client sessions connected to the Freebox VPN servers.
${UNSTABLE_NOTE}

Returns: Array of connections with id, user, vpn server id, source IP:port, authentication status and rx/tx bytes.`,
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
          await freeboxClient.apiRequest<VpnServerConnection[]>(
            "vpn/connection/"
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
        const connections = response.result || [];
        if (connections.length === 0) {
          return {
            content: [{ type: "text", text: "No active VPN connection." }],
          };
        }
        const lines = connections.map(
          (c) =>
            `- ${c.authenticated ? "🟢" : "🟡"} **${c.user || "unknown"}** on ${c.vpn} (ID: ${c.id}) — from ${c.src_ip}:${c.src_port}, ${c.authenticated ? "authenticated" : "not authenticated"} — ↓ ${formatBytes(c.rx_bytes)} / ↑ ${formatBytes(c.tx_bytes)}`
        );
        return {
          content: [
            {
              type: "text",
              text: `## VPN Server Connections (${connections.length})\n\n${lines.join("\n")}`,
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

  // Close a VPN server connection
  server.registerTool(
    "freebox_vpn_server_connection_close",
    {
      title: "Close VPN Server Connection",
      description: `Force-close an active VPN server connection, disconnecting the connected VPN user.
Requires 'settings' permission.
${UNSTABLE_NOTE}

Args:
  - id (string): Connection ID (from freebox_vpn_server_connections_list).`,
      inputSchema: {
        id: z.string().min(1).describe("VPN connection ID"),
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
          `vpn/connection/${encodeURIComponent(params.id)}`,
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
            { type: "text", text: `VPN connection ${params.id} closed.` },
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
