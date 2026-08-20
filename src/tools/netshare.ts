import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { AfpConfig, AfpServerType, SambaConfig } from "../types.js";

const AFP_SERVER_TYPES = [
  "powerbook",
  "powermac",
  "macmini",
  "imac",
  "macbook",
  "macbookpro",
  "macbookair",
  "macpro",
  "appletv",
  "airport",
  "xserve",
] as const;

export function registerNetshareTools(server: McpServer): void {
  // Get Samba configuration
  server.registerTool(
    "freebox_samba_config_get",
    {
      title: "Get Samba (Windows Sharing) Configuration",
      description: `Get the Samba (Windows / SMB) network sharing configuration of the Freebox.

Returns: file_share_enabled, print_share_enabled, logon_enabled, logon_user, workgroup, smbv2_enabled.
The logon password is write-only in the Freebox API and is never returned by this tool.`,
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
          await freeboxClient.apiRequest<SambaConfig>("netshare/samba/");
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
        // Never echo logon_password back, even if the API unexpectedly returns it.
        const lines = [
          `- File sharing: ${cfg?.file_share_enabled ? "✅ Enabled" : "❌ Disabled"}`,
          `- Printer sharing: ${cfg?.print_share_enabled ? "✅ Enabled" : "❌ Disabled"}`,
          `- Authentication: ${cfg?.logon_enabled ? "✅ Enabled" : "❌ Disabled"}`,
          `- Logon user: ${cfg?.logon_user || "(none)"}`,
          `- Workgroup: ${cfg?.workgroup || "(none)"}`,
          `- SMBv2: ${cfg?.smbv2_enabled ? "✅ Enabled" : "❌ Disabled"}`,
        ];
        return {
          content: [
            {
              type: "text",
              text: `## Samba Configuration\n\n${lines.join("\n")}`,
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

  // Update Samba configuration
  server.registerTool(
    "freebox_samba_config_update",
    {
      title: "Update Samba (Windows Sharing) Configuration",
      description: `Update the Samba (Windows / SMB) network sharing configuration of the Freebox.
Only the provided fields are sent to the Freebox.
Requires 'settings' permission.

Args:
  - file_share_enabled (boolean, optional): Enable Windows file sharing.
  - print_share_enabled (boolean, optional): Enable Windows printer sharing.
  - logon_enabled (boolean, optional): Require authentication to access the shares.
  - logon_user (string, optional): Samba logon user name.
  - logon_password (string, optional): Samba logon password (sensitive, write-only — never returned by the API).
  - workgroup (string, optional): Windows workgroup name.
  - smbv2_enabled (boolean, optional): Enable the SMBv2 protocol.`,
      inputSchema: {
        file_share_enabled: z
          .boolean()
          .optional()
          .describe("Enable Windows file sharing"),
        print_share_enabled: z
          .boolean()
          .optional()
          .describe("Enable Windows printer sharing"),
        logon_enabled: z
          .boolean()
          .optional()
          .describe("Require authentication for the shares"),
        logon_user: z.string().optional().describe("Samba logon user name"),
        logon_password: z
          .string()
          .optional()
          .describe(
            "Samba logon password — SENSITIVE, write-only: it is sent to the Freebox but never returned or displayed"
          ),
        workgroup: z.string().optional().describe("Windows workgroup name"),
        smbv2_enabled: z
          .boolean()
          .optional()
          .describe("Enable the SMBv2 protocol"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: {
      file_share_enabled?: boolean;
      print_share_enabled?: boolean;
      logon_enabled?: boolean;
      logon_user?: string;
      logon_password?: string;
      workgroup?: string;
      smbv2_enabled?: boolean;
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.file_share_enabled !== undefined)
          body.file_share_enabled = params.file_share_enabled;
        if (params.print_share_enabled !== undefined)
          body.print_share_enabled = params.print_share_enabled;
        if (params.logon_enabled !== undefined)
          body.logon_enabled = params.logon_enabled;
        if (params.logon_user !== undefined) body.logon_user = params.logon_user;
        if (params.logon_password !== undefined)
          body.logon_password = params.logon_password;
        if (params.workgroup !== undefined) body.workgroup = params.workgroup;
        if (params.smbv2_enabled !== undefined)
          body.smbv2_enabled = params.smbv2_enabled;

        if (Object.keys(body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Error: no field to update. Provide at least one Samba setting.",
              },
            ],
          };
        }

        const response = await freeboxClient.apiRequest<SambaConfig>(
          "netshare/samba/",
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
        const lines = [
          `- File sharing: ${cfg?.file_share_enabled ? "✅ Enabled" : "❌ Disabled"}`,
          `- Printer sharing: ${cfg?.print_share_enabled ? "✅ Enabled" : "❌ Disabled"}`,
          `- Authentication: ${cfg?.logon_enabled ? "✅ Enabled" : "❌ Disabled"}`,
          `- Logon user: ${cfg?.logon_user || "(none)"}`,
          `- Workgroup: ${cfg?.workgroup || "(none)"}`,
          `- SMBv2: ${cfg?.smbv2_enabled ? "✅ Enabled" : "❌ Disabled"}`,
        ];
        return {
          content: [
            {
              type: "text",
              text: `Samba configuration updated.\n\n${lines.join("\n")}`,
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

  // Get AFP configuration
  server.registerTool(
    "freebox_afp_config_get",
    {
      title: "Get AFP (macOS Sharing) Configuration",
      description: `Get the AFP (legacy macOS file sharing) configuration of the Freebox.

Returns: enabled, guest_allow, server_type, login_name.
The login password is write-only in the Freebox API and is never returned by this tool.`,
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
          await freeboxClient.apiRequest<AfpConfig>("netshare/afp/");
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
        // Never echo login_password back, even if the API unexpectedly returns it.
        const lines = [
          `- Status: ${cfg?.enabled ? "✅ Enabled" : "❌ Disabled"}`,
          `- Guest access: ${cfg?.guest_allow ? "✅ Allowed" : "❌ Denied"}`,
          `- Server type (icon): ${cfg?.server_type || "(unknown)"}`,
          `- Login name: ${cfg?.login_name || "(none)"}`,
        ];
        return {
          content: [
            {
              type: "text",
              text: `## AFP Configuration\n\n${lines.join("\n")}`,
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

  // Update AFP configuration
  server.registerTool(
    "freebox_afp_config_update",
    {
      title: "Update AFP (macOS Sharing) Configuration",
      description: `Update the AFP (legacy macOS file sharing) configuration of the Freebox.
Only the provided fields are sent to the Freebox.
Requires 'settings' permission.

Args:
  - enabled (boolean, optional): Enable AFP file sharing.
  - guest_allow (boolean, optional): Allow guest (unauthenticated) access.
  - server_type (string, optional): Icon shown in the macOS Finder: powerbook, powermac, macmini, imac, macbook, macbookpro, macbookair, macpro, appletv, airport, xserve.
  - login_name (string, optional): AFP login name.
  - login_password (string, optional): AFP login password (sensitive, write-only — never returned by the API).`,
      inputSchema: {
        enabled: z.boolean().optional().describe("Enable AFP file sharing"),
        guest_allow: z
          .boolean()
          .optional()
          .describe("Allow guest (unauthenticated) access"),
        server_type: z
          .enum(AFP_SERVER_TYPES)
          .optional()
          .describe("Server icon type shown in the macOS Finder"),
        login_name: z.string().optional().describe("AFP login name"),
        login_password: z
          .string()
          .optional()
          .describe(
            "AFP login password — SENSITIVE, write-only: it is sent to the Freebox but never returned or displayed"
          ),
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
      guest_allow?: boolean;
      server_type?: AfpServerType;
      login_name?: string;
      login_password?: string;
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.enabled !== undefined) body.enabled = params.enabled;
        if (params.guest_allow !== undefined)
          body.guest_allow = params.guest_allow;
        if (params.server_type !== undefined)
          body.server_type = params.server_type;
        if (params.login_name !== undefined) body.login_name = params.login_name;
        if (params.login_password !== undefined)
          body.login_password = params.login_password;

        if (Object.keys(body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Error: no field to update. Provide at least one AFP setting.",
              },
            ],
          };
        }

        const response = await freeboxClient.apiRequest<AfpConfig>(
          "netshare/afp/",
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
        const lines = [
          `- Status: ${cfg?.enabled ? "✅ Enabled" : "❌ Disabled"}`,
          `- Guest access: ${cfg?.guest_allow ? "✅ Allowed" : "❌ Denied"}`,
          `- Server type (icon): ${cfg?.server_type || "(unknown)"}`,
          `- Login name: ${cfg?.login_name || "(none)"}`,
        ];
        return {
          content: [
            {
              type: "text",
              text: `AFP configuration updated.\n\n${lines.join("\n")}`,
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
