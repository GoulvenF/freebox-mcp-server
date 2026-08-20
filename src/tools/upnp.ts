import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { UpnpAvConfig, UpnpIgdConfig, UpnpRedir } from "../types.js";

export function registerUpnpTools(server: McpServer): void {
  // Get UPnP IGD configuration
  server.registerTool(
    "freebox_upnpigd_config_get",
    {
      title: "Get UPnP IGD Configuration",
      description: `Get the UPnP IGD (Internet Gateway Device) configuration of the Freebox.
UPnP IGD lets LAN devices automatically create their own port redirections.

Returns: enabled (boolean), version (1 or 2).`,
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
          await freeboxClient.apiRequest<UpnpIgdConfig>("upnpigd/config/");
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
        const cfg = response.result;
        return {
          content: [
            {
              type: "text",
              text: `## UPnP IGD Configuration\n\n- Status: ${cfg?.enabled ? "✅ Enabled" : "❌ Disabled"}\n- Version: ${cfg?.version ?? "unknown"}`,
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

  // Update UPnP IGD configuration
  server.registerTool(
    "freebox_upnpigd_config_update",
    {
      title: "Update UPnP IGD Configuration",
      description: `Update the UPnP IGD configuration of the Freebox.
Requires 'settings' permission.

Args:
  - enabled (boolean, optional): Enable or disable UPnP IGD.
  - version (number, optional): UPnP IGD protocol version: 1 or 2.`,
      inputSchema: {
        enabled: z
          .boolean()
          .optional()
          .describe("Enable or disable UPnP IGD"),
        version: z
          .union([z.literal(1), z.literal(2)])
          .optional()
          .describe("UPnP IGD protocol version (1 or 2)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { enabled?: boolean; version?: 1 | 2 }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.enabled !== undefined) body.enabled = params.enabled;
        if (params.version !== undefined) body.version = params.version;

        if (Object.keys(body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Error: no field to update. Provide at least 'enabled' or 'version'.",
              },
            ],
          };
        }

        const response = await freeboxClient.apiRequest<UpnpIgdConfig>(
          "upnpigd/config/",
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
        const cfg = response.result;
        return {
          content: [
            {
              type: "text",
              text: `UPnP IGD configuration updated.\n\n- Status: ${cfg?.enabled ? "✅ Enabled" : "❌ Disabled"}\n- Version: ${cfg?.version ?? "unknown"}`,
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

  // List UPnP IGD redirections
  server.registerTool(
    "freebox_upnpigd_redirections_list",
    {
      title: "List UPnP IGD Redirections",
      description: `List the port redirections created dynamically by LAN devices through UPnP IGD.

Returns: Array of redirections with id, enabled, ext_src_ip, ext_port, int_ip, int_port, proto, desc, remaining lease time (seconds) and host info.`,
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
          await freeboxClient.apiRequest<UpnpRedir[]>("upnpigd/redir/");
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
        const redirs = response.result || [];
        if (redirs.length === 0) {
          return {
            content: [
              { type: "text", text: "No UPnP IGD redirection currently active." },
            ],
          };
        }
        const lines = redirs.map((r) => {
          const hostName = r.host?.primary_name
            ? ` (${r.host.primary_name})`
            : "";
          return `- ${r.enabled ? "✅" : "❌"} **${r.desc || "No description"}** (ID: ${r.id}) — ${r.proto.toUpperCase()} :${r.ext_port} → ${r.int_ip}:${r.int_port}${hostName}\n  Remaining lease: ${r.remaining}s${r.ext_src_ip ? ` — Source filter: ${r.ext_src_ip}` : ""}`;
        });
        return {
          content: [
            {
              type: "text",
              text: `## UPnP IGD Redirections (${redirs.length})\n\n${lines.join("\n")}`,
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

  // Delete a UPnP IGD redirection
  server.registerTool(
    "freebox_upnpigd_redirection_delete",
    {
      title: "Delete UPnP IGD Redirection",
      description: `Delete a port redirection created by a LAN device through UPnP IGD.
Requires 'settings' permission.

Args:
  - id (string): UPnP redirection ID (as returned by freebox_upnpigd_redirections_list).`,
      inputSchema: {
        id: z.string().describe("UPnP redirection ID"),
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
          `upnpigd/redir/${encodeURIComponent(params.id)}`,
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
              text: `UPnP IGD redirection ${params.id} deleted.`,
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

  // Get UPnP AV configuration
  server.registerTool(
    "freebox_upnpav_config_get",
    {
      title: "Get UPnP AV Configuration",
      description: `Get the UPnP AV (media sharing / DLNA) service configuration of the Freebox.

Returns: enabled (boolean).`,
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
          await freeboxClient.apiRequest<UpnpAvConfig>("upnpav/config/");
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
              text: `## UPnP AV Configuration\n\n- Media sharing: ${response.result?.enabled ? "✅ Enabled" : "❌ Disabled"}`,
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

  // Update UPnP AV configuration
  server.registerTool(
    "freebox_upnpav_config_update",
    {
      title: "Update UPnP AV Configuration",
      description: `Enable or disable the UPnP AV (media sharing / DLNA) service of the Freebox.
Requires 'settings' permission.

Args:
  - enabled (boolean): Enable or disable UPnP AV media sharing.`,
      inputSchema: {
        enabled: z.boolean().describe("Enable or disable UPnP AV"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { enabled: boolean }) => {
      try {
        const response = await freeboxClient.apiRequest<UpnpAvConfig>(
          "upnpav/config/",
          "PUT",
          { enabled: params.enabled }
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
              text: `UPnP AV configuration updated.\n\n- Media sharing: ${response.result?.enabled ? "✅ Enabled" : "❌ Disabled"}`,
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
