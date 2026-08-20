import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { SystemInfo } from "../types.js";

export function registerSystemTools(server: McpServer): void {
  // Get system info
  server.registerTool(
    "freebox_system_info",
    {
      title: "Get Freebox System Info",
      description: `Get Freebox system information including temperatures, uptime, firmware version, fan speed, MAC address, disk status, and serial number.

Returns: JSON with mac, firmware_version, uptime, uptime_val, temp_cpub, temp_cpum, temp_sw, fan_rpm, board_name, box_flavor, disk_status, serial.`,
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
        const response = await freeboxClient.apiRequest<SystemInfo>(
          "system/"
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
        const info = response.result!;
        const text = [
          `## Freebox System Info`,
          `- **Firmware**: ${info.firmware_version}`,
          `- **Uptime**: ${info.uptime}`,
          `- **MAC**: ${info.mac}`,
          `- **Serial**: ${info.serial}`,
          `- **Board**: ${info.board_name} (${info.box_flavor})`,
          `- **CPU B temp**: ${info.temp_cpub}°C`,
          `- **CPU M temp**: ${info.temp_cpum}°C`,
          `- **Switch temp**: ${info.temp_sw}°C`,
          `- **Fan**: ${info.fan_rpm} RPM`,
          `- **Disk status**: ${info.disk_status}`,
          `- **Main storage**: ${info.user_main_storage}`,
        ].join("\n");
        return {
          content: [{ type: "text", text }],
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

  // Reboot
  server.registerTool(
    "freebox_reboot",
    {
      title: "Reboot Freebox",
      description: `Reboot the Freebox server. This will disconnect all devices temporarily. Use with caution.
Requires 'settings' permission.

Args:
  - confirm (string): REQUIRED. Rebooting cuts internet, WiFi and telephony for every device in the home for several minutes. To proceed, pass confirm="JE-CONFIRME-LE-REBOOT".`,
      inputSchema: {
        confirm: z
          .string()
          .optional()
          .describe(
            'Pass the exact confirmation phrase shown in the tool description to execute this action.'
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: { confirm?: string }) => {
      try {
        if (params.confirm !== "JE-CONFIRME-LE-REBOOT") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: 'Refusé : cette action est sensible. Redémarrer la Freebox coupe Internet, le WiFi et la téléphonie pour tous les appareils du foyer pendant plusieurs minutes. Confirmez avec confirm="JE-CONFIRME-LE-REBOOT".',
              },
            ],
          };
        }
        const response = await freeboxClient.apiRequest("system/reboot/", "POST");
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
              text: "Freebox is rebooting. It will be unavailable for a few minutes.",
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
