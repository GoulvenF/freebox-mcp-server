import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { PortForwardingConfig, SwitchPortStatus } from "../types.js";

export function registerNetworkTools(server: McpServer): void {
  // List port forwarding rules
  server.registerTool(
    "freebox_port_forwarding_list",
    {
      title: "List Port Forwarding Rules",
      description: `List all port forwarding (NAT) rules configured on the Freebox.

Returns: Array of rules with id, enabled, comment, lan_ip, lan_port, wan_port_start, wan_port_end, ip_proto (tcp/udp), hostname.`,
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
        const response = await freeboxClient.apiRequest<PortForwardingConfig[]>(
          "fw/redir/"
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
        const rules = response.result || [];
        if (rules.length === 0) {
          return {
            content: [
              { type: "text", text: "No port forwarding rules configured." },
            ],
          };
        }
        const lines = rules.map((r) => {
          const portRange =
            r.wan_port_start === r.wan_port_end
              ? `${r.wan_port_start}`
              : `${r.wan_port_start}-${r.wan_port_end}`;
          return `- ${r.enabled ? "✅" : "❌"} **${r.comment || "No comment"}** (ID: ${r.id}) — WAN ${r.ip_proto.toUpperCase()} :${portRange} → ${r.lan_ip}:${r.lan_port}${r.hostname ? ` (${r.hostname})` : ""}`;
        });
        return {
          content: [
            {
              type: "text",
              text: `## Port Forwarding Rules (${rules.length})\n\n${lines.join("\n")}`,
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

  // Add port forwarding rule
  server.registerTool(
    "freebox_port_forwarding_add",
    {
      title: "Add Port Forwarding Rule",
      description: `Add a new port forwarding (NAT) rule to the Freebox.
Requires 'settings' permission.

Args:
  - lan_ip (string): Destination LAN IP address.
  - lan_port (number): Destination LAN port.
  - wan_port_start (number): WAN port range start.
  - wan_port_end (number, optional): WAN port range end (defaults to wan_port_start for single port).
  - ip_proto (string): Protocol: "tcp" or "udp".
  - comment (string, optional): Description for the rule.
  - enabled (boolean, optional): Enable the rule (default: true).
  - src_ip (string, optional): Source IP filter (only allow from this IP).`,
      inputSchema: {
        lan_ip: z.string().describe("Destination LAN IP"),
        lan_port: z.number().int().min(1).max(65535).describe("LAN port"),
        wan_port_start: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .describe("WAN port start"),
        wan_port_end: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .optional()
          .describe("WAN port end (default: same as start)"),
        ip_proto: z.enum(["tcp", "udp"]).describe("Protocol"),
        comment: z.string().default("").describe("Rule description"),
        enabled: z.boolean().default(true).describe("Enable rule"),
        src_ip: z
          .string()
          .optional()
          .describe("Source IP filter (optional)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      lan_ip: string;
      lan_port: number;
      wan_port_start: number;
      wan_port_end?: number;
      ip_proto: "tcp" | "udp";
      comment: string;
      enabled: boolean;
      src_ip?: string;
    }) => {
      try {
        const body: Record<string, unknown> = {
          lan_ip: params.lan_ip,
          lan_port: params.lan_port,
          wan_port_start: params.wan_port_start,
          wan_port_end: params.wan_port_end ?? params.wan_port_start,
          ip_proto: params.ip_proto,
          enabled: params.enabled,
        };
        if (params.comment) body.comment = params.comment;
        if (params.src_ip) body.src_ip = params.src_ip;

        const response =
          await freeboxClient.apiRequest<PortForwardingConfig>(
            "fw/redir/",
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
              text: `Port forwarding rule created (ID: ${response.result?.id}).\n\n${JSON.stringify(response.result, null, 2)}`,
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

  // Delete port forwarding rule
  server.registerTool(
    "freebox_port_forwarding_delete",
    {
      title: "Delete Port Forwarding Rule",
      description: `Delete a port forwarding rule by its ID.
Requires 'settings' permission.

Args:
  - id (number): Port forwarding rule ID.`,
      inputSchema: {
        id: z.number().int().describe("Rule ID"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number }) => {
      try {
        const response = await freeboxClient.apiRequest(
          `fw/redir/${params.id}`,
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
              text: `Port forwarding rule ${params.id} deleted.`,
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

  // Get switch port status
  server.registerTool(
    "freebox_switch_status",
    {
      title: "Get Switch Port Status",
      description: `Get the status of all Ethernet switch ports on the Freebox: link state, speed, duplex, and connected MAC addresses.

Returns: Array of port statuses with id, link (up/down), speed, duplex, mode, and connected MAC addresses.`,
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
        const response = await freeboxClient.apiRequest<SwitchPortStatus[]>(
          "switch/status/"
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
        const ports = response.result || [];
        const lines = ports.map((p) => {
          const macs = (p.mac_list || [])
            .map(
              (m) =>
                `${m.mac}${m.hostname ? ` (${m.hostname})` : ""}`
            )
            .join(", ");
          return `- **Port ${p.id}**: ${p.link === "up" ? "🟢 UP" : "⚫ DOWN"}${p.link === "up" ? ` — ${p.speed} ${p.duplex}` : ""}${macs ? `\n  Connected: ${macs}` : ""}`;
        });
        return {
          content: [
            {
              type: "text",
              text: `## Switch Port Status\n\n${lines.join("\n")}`,
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
