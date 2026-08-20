import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { FtpConfig } from "../types.js";

export function registerFtpTools(server: McpServer): void {
  // Get FTP configuration
  server.registerTool(
    "freebox_ftp_config_get",
    {
      title: "Get FTP Server Configuration",
      description: `Get the FTP server configuration of the Freebox.

Returns: enabled, allow_anonymous, allow_anonymous_write, username (read-only), allow_remote_access, weak_password (read-only), port_ctrl, port_data, remote_domain.
The FTP password is write-only in the Freebox API and is never returned by this tool.`,
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
          await freeboxClient.apiRequest<FtpConfig>("ftp/config/");
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
        // Never echo the password field back, even if the API unexpectedly returns it.
        const lines = [
          `- Status: ${cfg?.enabled ? "✅ Enabled" : "❌ Disabled"}`,
          `- Anonymous access: ${cfg?.allow_anonymous ? "✅ Allowed" : "❌ Denied"}`,
          `- Anonymous write: ${cfg?.allow_anonymous_write ? "✅ Allowed" : "❌ Denied"}`,
          `- Username: ${cfg?.username || "(none)"}`,
          `- Remote (WAN) access: ${cfg?.allow_remote_access ? "✅ Enabled" : "❌ Disabled"}`,
          `- Password strength: ${cfg?.weak_password ? "⚠️ Weak" : "🟢 Strong"}`,
          `- Control port: ${cfg?.port_ctrl ?? "(default)"}`,
          `- Data port: ${cfg?.port_data ?? "(default)"}`,
          `- Remote domain: ${cfg?.remote_domain || "(none)"}`,
        ];
        return {
          content: [
            {
              type: "text",
              text: `## FTP Server Configuration\n\n${lines.join("\n")}`,
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

  // Update FTP configuration
  server.registerTool(
    "freebox_ftp_config_update",
    {
      title: "Update FTP Server Configuration",
      description: `Update the FTP server configuration of the Freebox.
Only the provided fields are sent to the Freebox.
Requires 'settings' permission.

Note: enabling 'allow_remote_access' requires a strong (non-weak) FTP password to already be set.
Otherwise the Freebox silently keeps remote access disabled — this is surfaced by the 'weak_password'
field in the response, and this tool adds a warning line when that happens.

Args:
  - enabled (boolean, optional): Enable the FTP server.
  - allow_anonymous (boolean, optional): Allow anonymous read access.
  - allow_anonymous_write (boolean, optional): Allow anonymous write access.
  - password (string, optional): FTP password (sensitive, write-only — never returned by the API).
  - allow_remote_access (boolean, optional): Allow FTP access from the Internet (requires a strong password).
  - port_ctrl (number, optional): FTP control port used for remote access.
  - port_data (number, optional): FTP data port used for remote access.
  - remote_domain (string, optional): Domain name used to reach the FTP server remotely.`,
      inputSchema: {
        enabled: z.boolean().optional().describe("Enable the FTP server"),
        allow_anonymous: z
          .boolean()
          .optional()
          .describe("Allow anonymous read access"),
        allow_anonymous_write: z
          .boolean()
          .optional()
          .describe("Allow anonymous write access"),
        password: z
          .string()
          .optional()
          .describe(
            "FTP password — SENSITIVE, write-only: it is sent to the Freebox but never returned or displayed"
          ),
        allow_remote_access: z
          .boolean()
          .optional()
          .describe(
            "Allow FTP access from the Internet (requires a strong password already set)"
          ),
        port_ctrl: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .optional()
          .describe("FTP control port for remote access"),
        port_data: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .optional()
          .describe("FTP data port for remote access"),
        remote_domain: z
          .string()
          .optional()
          .describe("Domain name used to reach the FTP server remotely"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: {
      enabled?: boolean;
      allow_anonymous?: boolean;
      allow_anonymous_write?: boolean;
      password?: string;
      allow_remote_access?: boolean;
      port_ctrl?: number;
      port_data?: number;
      remote_domain?: string;
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.enabled !== undefined) body.enabled = params.enabled;
        if (params.allow_anonymous !== undefined)
          body.allow_anonymous = params.allow_anonymous;
        if (params.allow_anonymous_write !== undefined)
          body.allow_anonymous_write = params.allow_anonymous_write;
        if (params.password !== undefined) body.password = params.password;
        if (params.allow_remote_access !== undefined)
          body.allow_remote_access = params.allow_remote_access;
        if (params.port_ctrl !== undefined) body.port_ctrl = params.port_ctrl;
        if (params.port_data !== undefined) body.port_data = params.port_data;
        if (params.remote_domain !== undefined)
          body.remote_domain = params.remote_domain;

        if (Object.keys(body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Error: no field to update. Provide at least one FTP setting.",
              },
            ],
          };
        }

        const response = await freeboxClient.apiRequest<FtpConfig>(
          "ftp/config/",
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
        // Never echo the password field back.
        const lines = [
          `- Status: ${cfg?.enabled ? "✅ Enabled" : "❌ Disabled"}`,
          `- Anonymous access: ${cfg?.allow_anonymous ? "✅ Allowed" : "❌ Denied"}`,
          `- Anonymous write: ${cfg?.allow_anonymous_write ? "✅ Allowed" : "❌ Denied"}`,
          `- Username: ${cfg?.username || "(none)"}`,
          `- Remote (WAN) access: ${cfg?.allow_remote_access ? "✅ Enabled" : "❌ Disabled"}`,
          `- Password strength: ${cfg?.weak_password ? "⚠️ Weak" : "🟢 Strong"}`,
          `- Control port: ${cfg?.port_ctrl ?? "(default)"}`,
          `- Data port: ${cfg?.port_data ?? "(default)"}`,
          `- Remote domain: ${cfg?.remote_domain || "(none)"}`,
        ];
        if (params.allow_remote_access === true && cfg?.weak_password === true) {
          lines.push(
            `\n⚠️ **Warning**: remote access was requested but the FTP password is weak. The Freebox keeps remote access disabled until a strong password is set — set a stronger 'password' and retry.`
          );
        }
        return {
          content: [
            {
              type: "text",
              text: `FTP configuration updated.\n\n${lines.join("\n")}`,
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
