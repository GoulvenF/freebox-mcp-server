import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { TftpConfig } from "../types.js";

/**
 * Decode a TFTP root path. The Freebox API documents `root` as a base64-encoded
 * absolute path, but real-world responses often contain a plain path (e.g. "/ssd2").
 * Decode when it round-trips as base64, otherwise return the raw value.
 */
function decodeRootPath(root: string): string {
  if (!root) return "";
  try {
    const decoded = Buffer.from(root, "base64").toString("utf-8");
    const reencoded = Buffer.from(decoded, "utf-8").toString("base64");
    if (reencoded === root && decoded.length > 0) {
      return decoded;
    }
  } catch {
    // Fall through to the raw value.
  }
  return root;
}

export function registerTftpTools(server: McpServer): void {
  // Get TFTP configuration
  server.registerTool(
    "freebox_tftp_config_get",
    {
      title: "Get TFTP Server Configuration",
      description: `Get the TFTP server configuration of the Freebox.

Returns: enabled (boolean), root (absolute path to the shared folder inside the Freebox storage).
The Freebox API documents 'root' as base64-encoded but real-world values are often plain paths;
this tool decodes it when it is base64 and shows the raw value otherwise.`,
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
          await freeboxClient.apiRequest<TftpConfig>("tftp/config/");
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
        const rootPath = decodeRootPath(cfg?.root ?? "");
        return {
          content: [
            {
              type: "text",
              text: `## TFTP Server Configuration\n\n- Status: ${cfg?.enabled ? "✅ Enabled" : "❌ Disabled"}\n- Root folder: ${rootPath || "(none)"}${rootPath !== (cfg?.root ?? "") ? `\n- Raw value: ${cfg?.root}` : ""}`,
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

  // Update TFTP configuration
  server.registerTool(
    "freebox_tftp_config_update",
    {
      title: "Update TFTP Server Configuration",
      description: `Update the TFTP server configuration of the Freebox.
Only the provided fields are sent to the Freebox.
Requires 'settings' permission.

Note: the Freebox API documentation says 'root' should be base64-encoded, but real-world examples
show plain paths (e.g. "/ssd2"). The value is passed through unmodified and validated by the Freebox.

Args:
  - enabled (boolean, optional): Enable the TFTP server.
  - root (string, optional): Absolute path to the shared folder inside the Freebox storage, e.g. "/ssd2".`,
      inputSchema: {
        enabled: z.boolean().optional().describe("Enable the TFTP server"),
        root: z
          .string()
          .optional()
          .describe(
            'Absolute path to the shared folder, e.g. "/ssd2" (sent as-is, the Freebox validates it)'
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { enabled?: boolean; root?: string }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.enabled !== undefined) body.enabled = params.enabled;
        if (params.root !== undefined) body.root = params.root;

        if (Object.keys(body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Error: no field to update. Provide at least 'enabled' or 'root'.",
              },
            ],
          };
        }

        const response = await freeboxClient.apiRequest<TftpConfig>(
          "tftp/config/",
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
        const rootPath = decodeRootPath(cfg?.root ?? "");
        return {
          content: [
            {
              type: "text",
              text: `TFTP configuration updated.\n\n- Status: ${cfg?.enabled ? "✅ Enabled" : "❌ Disabled"}\n- Root folder: ${rootPath || "(none)"}`,
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
