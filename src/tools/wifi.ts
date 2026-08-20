import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { WifiGlobalConfig, WifiStation } from "../types.js";
import { sanitizeDisplay } from "../utils/sanitize.js";

/**
 * The raw wifi/bss/ payload contains `config.key`: the WPA passphrase in
 * cleartext. Never let it reach the MCP client / LLM context — build the
 * response from an explicit allowlist of non-secret display fields instead of
 * dumping the API object.
 */
interface WifiBssRaw {
  id?: unknown;
  phy_id?: unknown;
  status?: { state?: unknown; sta_count?: unknown };
  config?: {
    enabled?: unknown;
    ssid?: unknown;
    encryption?: unknown;
    hide_ssid?: unknown;
    eapol_version?: unknown;
    use_default_config?: unknown;
  };
}

interface WifiApRaw {
  id?: unknown;
  name?: unknown;
  status?: {
    state?: unknown;
    channel_width?: unknown;
    primary_channel?: unknown;
    secondary_channel?: unknown;
  };
  config?: {
    band?: unknown;
    channel_width?: unknown;
    primary_channel?: unknown;
    secondary_channel?: unknown;
    dfs_enabled?: unknown;
    ht?: unknown;
  };
}

export function registerWifiTools(server: McpServer): void {
  // Get WiFi global config
  server.registerTool(
    "freebox_wifi_status",
    {
      title: "Get WiFi Status",
      description: `Get the current WiFi global configuration: whether WiFi is enabled and MAC filter state (disabled/whitelist/blacklist).

Returns: JSON with enabled (boolean) and mac_filter_state.`,
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
          await freeboxClient.apiRequest<WifiGlobalConfig>("wifi/config/");
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
        const config = response.result!;
        return {
          content: [
            {
              type: "text",
              text: `WiFi is **${config.enabled ? "enabled" : "disabled"}**. MAC filter: ${config.mac_filter_state}.`,
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

  // Enable/Disable WiFi
  server.registerTool(
    "freebox_wifi_toggle",
    {
      title: "Toggle WiFi",
      description: `Enable or disable WiFi on the Freebox. Requires 'settings' permission.
WARNING: Disabling WiFi will disconnect all wireless devices.

Args:
  - enabled (boolean): true to enable WiFi, false to disable it.`,
      inputSchema: {
        enabled: z.boolean().describe("true to enable WiFi, false to disable"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { enabled: boolean }) => {
      try {
        const response = await freeboxClient.apiRequest<WifiGlobalConfig>(
          "wifi/config/",
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
              text: `WiFi has been ${params.enabled ? "enabled" : "disabled"}.`,
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

  // List WiFi Access Points
  server.registerTool(
    "freebox_wifi_access_points",
    {
      title: "List WiFi Access Points",
      description: `List all WiFi access points on the Freebox with their configuration, status, and capabilities (band, channel, width, state).

Returns: JSON array of access points with id, name, config (band, channel_width, primary_channel, dfs_enabled), and status (state, channel_width).`,
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
        const response = await freeboxClient.apiRequest<WifiApRaw[]>(
          "wifi/ap/"
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
        const aps = (response.result || []).map((ap) => ({
          id: ap.id,
          name: sanitizeDisplay(ap.name),
          config: {
            band: ap.config?.band,
            channel_width: ap.config?.channel_width,
            primary_channel: ap.config?.primary_channel,
            secondary_channel: ap.config?.secondary_channel,
            dfs_enabled: ap.config?.dfs_enabled,
            ht: ap.config?.ht,
          },
          status: {
            state: ap.status?.state,
            channel_width: ap.status?.channel_width,
            primary_channel: ap.status?.primary_channel,
            secondary_channel: ap.status?.secondary_channel,
          },
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(aps, null, 2) }],
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

  // List connected WiFi stations
  server.registerTool(
    "freebox_wifi_stations",
    {
      title: "List WiFi Connected Stations",
      description: `List all devices currently connected via WiFi to a specific access point.
Shows MAC address, hostname, signal strength, connection duration, data rates, and bytes transferred.

Args:
  - ap_id (number): Access point ID (get from freebox_wifi_access_points, typically 0 for 2.4GHz, 1 for 5GHz).

Returns: Array of connected stations with mac, hostname, signal, conn_duration, rx_bytes, tx_bytes, rx_rate, tx_rate, state.`,
      inputSchema: {
        ap_id: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Access point ID (0 for first AP, 1 for second, etc.)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { ap_id: number }) => {
      try {
        const response = await freeboxClient.apiRequest<WifiStation[]>(
          `wifi/ap/${params.ap_id}/stations/`
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
        const stations = response.result || [];
        if (stations.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No devices currently connected to WiFi AP ${params.ap_id}.`,
              },
            ],
          };
        }
        const lines = stations.map((s) => {
          return [
            `- **${sanitizeDisplay(s.hostname) || s.mac}** (${s.mac})`,
            `  Signal: ${s.signal} dB, State: ${s.state}`,
            `  Connected: ${Math.round(s.conn_duration / 60)} min`,
            `  RX: ${(s.rx_bytes / 1024 / 1024).toFixed(1)} MB @ ${(s.rx_rate / 1024).toFixed(1)} KB/s`,
            `  TX: ${(s.tx_bytes / 1024 / 1024).toFixed(1)} MB @ ${(s.tx_rate / 1024).toFixed(1)} KB/s`,
          ].join("\n");
        });
        return {
          content: [
            {
              type: "text",
              text: `## WiFi Stations on AP ${params.ap_id} (${stations.length} connected)\n\n${lines.join("\n\n")}`,
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

  // List BSS (Wi-Fi networks)
  server.registerTool(
    "freebox_wifi_bss_list",
    {
      title: "List WiFi Networks (BSS)",
      description: `List all WiFi BSS (Basic Service Set / networks) configured on the Freebox, including SSID, encryption, state, and station count.

Returns: JSON array of BSS with id, phy_id, config (enabled, ssid, encryption, hide_ssid), and status (state, sta_count).
Note: the WPA passphrase (config.key) is intentionally never returned.`,
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
        const response = await freeboxClient.apiRequest<WifiBssRaw[]>(
          "wifi/bss/"
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
        // NOTE: config.key (the WPA passphrase, in cleartext) is deliberately
        // omitted — it must never enter the LLM context.
        const bssList = (response.result || []).map((bss) => ({
          id: bss.id,
          phy_id: bss.phy_id,
          config: {
            enabled: bss.config?.enabled,
            ssid: sanitizeDisplay(bss.config?.ssid),
            encryption: bss.config?.encryption,
            hide_ssid: bss.config?.hide_ssid,
            eapol_version: bss.config?.eapol_version,
            use_default_config: bss.config?.use_default_config,
          },
          status: {
            state: bss.status?.state,
            sta_count: bss.status?.sta_count,
          },
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(bssList, null, 2) }],
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
