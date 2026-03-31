import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";

export function registerAuthTools(server: McpServer): void {
  // Discover Freebox on the network
  server.registerTool(
    "freebox_discover",
    {
      title: "Discover Freebox",
      description: `Discover the Freebox on the local network and retrieve its API information (device name, API version, domain, HTTPS availability).
This does not require authentication.

Returns: JSON with uid, device_name, api_version, api_domain, https_available, https_port, device_type.`,
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
        const info = await freeboxClient.getDiscoveryInfo();
        return {
          content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error discovering Freebox: ${msg}. Ensure you are on the Freebox local network.`,
            },
          ],
        };
      }
    }
  );

  // Register app with Freebox
  server.registerTool(
    "freebox_register_app",
    {
      title: "Register App with Freebox",
      description: `Register this MCP server as an authorized application on the Freebox.
This MUST be done from the Freebox local network. A message will appear on the Freebox LCD screen asking the user to grant or deny access.
The user has 60 seconds to accept on the Freebox display.
Once granted, credentials are stored locally and reused for future sessions.

Returns: JSON with app_token, track_id, and authorization status ("granted", "denied", "timeout", "pending").`,
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const result = await freeboxClient.registerApp();
        const statusMessages: Record<string, string> = {
          granted:
            "Application authorized! Credentials saved. You can now use all Freebox tools.",
          denied: "Authorization was denied by the user on the Freebox display.",
          timeout:
            "Authorization timed out. The user did not respond on the Freebox display within 60 seconds.",
          pending: "Authorization is still pending.",
        };
        return {
          content: [
            {
              type: "text",
              text: `${statusMessages[result.status] || `Status: ${result.status}`}\n\n${JSON.stringify({ ...result, app_token: "[REDACTED - stored securely in ~/.freebox-mcp/credentials.json]" }, null, 2)}`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error registering app: ${msg}. Ensure you are on the Freebox local network.`,
            },
          ],
        };
      }
    }
  );

  // Open session
  server.registerTool(
    "freebox_login",
    {
      title: "Login to Freebox",
      description: `Open an authenticated session with the Freebox using stored credentials.
Requires prior registration via freebox_register_app or environment variables (FREEBOX_APP_TOKEN, FREEBOX_APP_ID).

Returns: JSON with session_token and app permissions (settings, contacts, calls, explorer, downloader, parental, pvr).`,
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const session = await freeboxClient.openSession();
        return {
          content: [
            {
              type: "text",
              text: `Logged in successfully.\n\nPermissions: ${JSON.stringify(session.permissions, null, 2)}`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error logging in: ${msg}`,
            },
          ],
        };
      }
    }
  );

  // Close session
  server.registerTool(
    "freebox_logout",
    {
      title: "Logout from Freebox",
      description: `Close the current authenticated session with the Freebox.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        await freeboxClient.closeSession();
        return {
          content: [{ type: "text", text: "Logged out successfully." }],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error logging out: ${msg}` }],
        };
      }
    }
  );
}
