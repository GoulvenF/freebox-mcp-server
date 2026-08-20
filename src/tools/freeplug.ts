import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { Freeplug, FreeplugNetwork } from "../types.js";

const ROLE_LABELS: Record<Freeplug["net_role"], string> = {
  cco: "CCO (coordinator)",
  pco: "PCO (proxy)",
  sta: "STA (station)",
};

function formatFreeplug(plug: Freeplug): string {
  const port =
    plug.eth_port_status === "up"
      ? `🟢 UP — ${plug.eth_speed} Mb/s ${plug.eth_full_duplex ? "full-duplex" : "half-duplex"}`
      : plug.eth_port_status === "down"
        ? "⚫ DOWN"
        : "❓ UNKNOWN";
  return [
    `- **${plug.id}** (${plug.model || "unknown model"})${plug.local ? " 📍 local" : ""}`,
    `  Role: ${ROLE_LABELS[plug.net_role] || plug.net_role}`,
    `  Ethernet: ${port}`,
    `  Rates: ⬇️ ${plug.rx_rate} Mb/s / ⬆️ ${plug.tx_rate} Mb/s`,
    `  Network: ${plug.has_network ? "✅ connected" : "❌ not connected"}`,
  ].join("\n");
}

export function registerFreeplugTools(server: McpServer): void {
  // List freeplug networks
  server.registerTool(
    "freebox_freeplug_list",
    {
      title: "List Freeplug Networks",
      description: `List all Freeplug (CPL/PLC powerline) networks known by the Freebox, grouped by network id.

Returns: For each network, its members with id, model, role (sta/pco/cco), ethernet port status, speed, duplex, rx/tx rates and network state.`,
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
          await freeboxClient.apiRequest<FreeplugNetwork[]>("freeplug/");
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
        const networks = response.result || [];
        if (networks.length === 0) {
          return {
            content: [{ type: "text", text: "No Freeplug network detected." }],
          };
        }
        const blocks = networks.map((net) => {
          const members = net.members || [];
          const body =
            members.length === 0
              ? "- No member."
              : members.map(formatFreeplug).join("\n");
          return `### Network ${net.id} (${members.length} member(s))\n\n${body}`;
        });
        return {
          content: [
            {
              type: "text",
              text: `## Freeplug Networks (${networks.length})\n\n${blocks.join("\n\n")}`,
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

  // Get a single freeplug
  server.registerTool(
    "freebox_freeplug_get",
    {
      title: "Get Freeplug",
      description: `Get detailed information about a single Freeplug (CPL/PLC) adapter.

Args:
  - id (string): Freeplug adapter ID (its MAC address, as returned by freebox_freeplug_list).`,
      inputSchema: {
        id: z
          .string()
          .regex(
            /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/,
            "MAC invalide (format attendu : 00:DE:AD:B0:0B:55)"
          )
          .describe("Freeplug adapter ID (MAC address)"),
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
        const response = await freeboxClient.apiRequest<Freeplug>(
          `freeplug/${encodeURIComponent(params.id)}/`
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
        const plug = response.result;
        if (!plug) {
          return {
            content: [
              { type: "text", text: `No Freeplug found with ID ${params.id}.` },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Freeplug ${plug.id}\n\n${formatFreeplug(plug)}\n  Network ID: ${plug.net_id}\n  Inactive since: ${plug.inactive}s`,
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

  // Reset a freeplug
  server.registerTool(
    "freebox_freeplug_reset",
    {
      title: "Reset Freeplug",
      description: `Reset a Freeplug (CPL/PLC) adapter.
The adapter reboots, which briefly drops its powerline and ethernet links.
Requires 'settings' permission.

Args:
  - id (string): Freeplug adapter ID (MAC address).`,
      inputSchema: {
        id: z
          .string()
          .regex(
            /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/,
            "MAC invalide (format attendu : 00:DE:AD:B0:0B:55)"
          )
          .describe("Freeplug adapter ID (MAC address)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: { id: string }) => {
      try {
        const response = await freeboxClient.apiRequest(
          `freeplug/${encodeURIComponent(params.id)}/reset/`,
          "POST"
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
              text: `🔄 Freeplug ${params.id} reset requested. The adapter link will be unavailable for a few seconds.`,
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
