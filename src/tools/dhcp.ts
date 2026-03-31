import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type {
  DhcpConfig,
  DhcpStaticLease,
  DhcpDynamicLease,
} from "../types.js";

export function registerDhcpTools(server: McpServer): void {
  // Get DHCP config
  server.registerTool(
    "freebox_dhcp_config",
    {
      title: "Get DHCP Configuration",
      description: `Get the Freebox DHCP server configuration including enabled state, IP range, gateway, netmask, DNS servers, and sticky assignment setting.

Returns: JSON with enabled, gateway, netmask, ip_range_start, ip_range_end, sticky_assign, always_broadcast, dns.`,
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
          await freeboxClient.apiRequest<DhcpConfig>("dhcp/config/");
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
        const text = [
          `## DHCP Configuration`,
          `- **Enabled**: ${c.enabled}`,
          `- **Gateway**: ${c.gateway}`,
          `- **Netmask**: ${c.netmask}`,
          `- **IP Range**: ${c.ip_range_start} - ${c.ip_range_end}`,
          `- **Sticky assign**: ${c.sticky_assign}`,
          `- **Always broadcast**: ${c.always_broadcast}`,
          `- **DNS**: ${c.dns.filter(Boolean).join(", ")}`,
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

  // Update DHCP config
  server.registerTool(
    "freebox_dhcp_config_update",
    {
      title: "Update DHCP Configuration",
      description: `Update the Freebox DHCP server configuration. Only specify fields to change.
Requires 'settings' permission.

Args:
  - enabled (boolean, optional): Enable/disable DHCP server
  - ip_range_start (string, optional): Start of DHCP IP range
  - ip_range_end (string, optional): End of DHCP IP range
  - sticky_assign (boolean, optional): Always assign same IP to a host
  - always_broadcast (boolean, optional): Always broadcast DHCP responses
  - dns (string[], optional): DNS server list`,
      inputSchema: {
        enabled: z.boolean().optional().describe("Enable/disable DHCP"),
        ip_range_start: z
          .string()
          .optional()
          .describe("DHCP range start IP"),
        ip_range_end: z.string().optional().describe("DHCP range end IP"),
        sticky_assign: z.boolean().optional().describe("Sticky IP assignment"),
        always_broadcast: z.boolean().optional().describe("Always broadcast"),
        dns: z
          .array(z.string())
          .optional()
          .describe("DNS servers list"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: Record<string, unknown>) => {
      try {
        const body: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined) body[key] = value;
        }
        const response = await freeboxClient.apiRequest<DhcpConfig>(
          "dhcp/config/",
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
              text: `DHCP config updated.\n\n${JSON.stringify(response.result, null, 2)}`,
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

  // List dynamic leases
  server.registerTool(
    "freebox_dhcp_leases",
    {
      title: "List DHCP Dynamic Leases",
      description: `List all active DHCP dynamic leases showing which devices have been assigned IPs.

Returns: Array of leases with mac, hostname, ip, lease_remaining (seconds), assign_time, refresh_time, is_static.`,
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
        const response = await freeboxClient.apiRequest<DhcpDynamicLease[]>(
          "dhcp/dynamic_lease/"
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
        const leases = response.result || [];
        if (leases.length === 0) {
          return {
            content: [{ type: "text", text: "No active DHCP leases." }],
          };
        }
        const lines = leases.map(
          (l) =>
            `- **${l.hostname || l.mac}** — ${l.ip} (MAC: ${l.mac}, remaining: ${Math.round(l.lease_remaining / 60)} min${l.is_static ? ", static" : ""})`
        );
        return {
          content: [
            {
              type: "text",
              text: `## Active DHCP Leases (${leases.length})\n\n${lines.join("\n")}`,
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

  // List static leases
  server.registerTool(
    "freebox_dhcp_static_leases",
    {
      title: "List DHCP Static Leases",
      description: `List all configured DHCP static leases (fixed IP reservations).

Returns: Array of static leases with id, mac, hostname, ip, comment.`,
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
        const response = await freeboxClient.apiRequest<DhcpStaticLease[]>(
          "dhcp/static_lease/"
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
        const leases = response.result || [];
        if (leases.length === 0) {
          return {
            content: [{ type: "text", text: "No static DHCP leases configured." }],
          };
        }
        const lines = leases.map(
          (l) =>
            `- **${l.hostname}** — ${l.ip} (MAC: ${l.mac}${l.comment ? `, comment: ${l.comment}` : ""})`
        );
        return {
          content: [
            {
              type: "text",
              text: `## Static DHCP Leases (${leases.length})\n\n${lines.join("\n")}`,
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

  // Add static lease
  server.registerTool(
    "freebox_dhcp_static_lease_add",
    {
      title: "Add DHCP Static Lease",
      description: `Add a new DHCP static lease (reserve a fixed IP for a device).
Requires 'settings' permission.

Args:
  - ip (string): IP address to assign (must be in DHCP range)
  - mac (string): MAC address of the device
  - comment (string, optional): Description/comment`,
      inputSchema: {
        ip: z.string().describe("IP address to reserve"),
        mac: z.string().describe("MAC address of the device"),
        comment: z.string().default("").describe("Optional comment"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: { ip: string; mac: string; comment: string }) => {
      try {
        const body: Record<string, string> = {
          ip: params.ip,
          mac: params.mac,
        };
        if (params.comment) body.comment = params.comment;

        const response = await freeboxClient.apiRequest<DhcpStaticLease>(
          "dhcp/static_lease/",
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
              text: `Static lease created: ${params.ip} → ${params.mac}\n\n${JSON.stringify(response.result, null, 2)}`,
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

  // Delete static lease
  server.registerTool(
    "freebox_dhcp_static_lease_delete",
    {
      title: "Delete DHCP Static Lease",
      description: `Delete a DHCP static lease by its ID (MAC address).
Requires 'settings' permission.

Args:
  - id (string): Lease ID (same as MAC address, e.g., "00:DE:AD:B0:0B:55").`,
      inputSchema: {
        id: z.string().describe("Lease ID (MAC address)"),
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
          `dhcp/static_lease/${params.id}`,
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
              text: `Static lease ${params.id} deleted.`,
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
