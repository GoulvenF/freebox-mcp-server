import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { SfpConfig, SfpStatus, SfpType } from "../types.js";

const SFP_TYPES = [
  "p2p_1g",
  "p2p_2d5g_no_aneg",
  "p2p_10g",
  "copper_1g",
  "copper_sgmii_1g",
  "copper_sgmii_10g",
  "copper_usxgmii_10g",
] as const;

// The SFP endpoints are only served under API version 11, while
// `freeboxClient.apiRequest()` hardcodes the default version in the URL
// (`${baseUrl}/v${DEFAULT_API_VERSION}/${path}`, currently v4). The client has no
// per-call version override, so we escape the hardcoded version segment with a
// relative `../v11/` prefix — Node's URL parser normalizes the dot segment away,
// producing `/api/v11/sfp/...`. Changing the shared client is out of scope here.
const SFP_STATUS_PATH = "../v11/sfp/status";
const SFP_CONFIG_PATH = "../v11/sfp/config/";

export function registerSfpTools(server: McpServer): void {
  // Get SFP module status
  server.registerTool(
    "freebox_sfp_status",
    {
      title: "Get SFP Module Status",
      description: `Get the status of the SFP module plugged into the Freebox LAN SFP port.
Only available on Freebox models featuring a LAN SFP port (has_lan_sfp in the system config);
other models return an API error.

Returns: present, eeprom_valid, supported, type, power_good, link, vendor_name, part_number, hardware_rev, serial_number.`,
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
          await freeboxClient.apiRequest<SfpStatus>(SFP_STATUS_PATH);
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
        const status = response.result;
        if (!status?.present) {
          return {
            content: [
              {
                type: "text",
                text: `## SFP Module Status\n\n- ⚫ No SFP module present in the LAN SFP port.`,
              },
            ],
          };
        }
        const lines = [
          `- Module: 🟢 Present`,
          `- Link: ${status.link ? "🟢 UP" : "⚫ DOWN"}`,
          `- Supported: ${status.supported ? "✅ Yes" : "❌ No"}`,
          `- EEPROM: ${status.eeprom_valid ? "✅ Valid" : "❌ Invalid"}`,
          `- Power: ${status.power_good ? "✅ OK" : "❌ Fault"}`,
          `- Type: ${status.type || "(unknown)"}`,
          `- Vendor: ${status.vendor_name || "(unknown)"}`,
          `- Part number: ${status.part_number || "(unknown)"}`,
          `- Hardware revision: ${status.hardware_rev || "(unknown)"}`,
          `- Serial number: ${status.serial_number || "(unknown)"}`,
        ];
        return {
          content: [
            {
              type: "text",
              text: `## SFP Module Status\n\n${lines.join("\n")}`,
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

  // Get SFP configuration
  server.registerTool(
    "freebox_sfp_config_get",
    {
      title: "Get SFP Configuration",
      description: `Get the SFP port configuration of the Freebox.

Returns: sfp_type_forced (whether the SFP mode is forced instead of auto-detected),
sfp_type_forced_value (the forced mode), available_sfp_types (modes supported by the box).`,
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
          await freeboxClient.apiRequest<SfpConfig>(SFP_CONFIG_PATH);
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
          `- Forced mode: ${cfg?.sfp_type_forced ? "✅ Enabled" : "❌ Disabled (auto-detect)"}`,
          `- Forced type: ${cfg?.sfp_type_forced_value || "(none)"}`,
          `- Available types: ${(cfg?.available_sfp_types || []).join(", ") || "(none)"}`,
        ];
        return {
          content: [
            {
              type: "text",
              text: `## SFP Configuration\n\n${lines.join("\n")}`,
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

  // Update SFP configuration
  server.registerTool(
    "freebox_sfp_config_update",
    {
      title: "Update SFP Configuration",
      description: `Update the SFP port configuration of the Freebox.
Requires 'settings' permission.

Args:
  - sfp_type_forced (boolean): Force the SFP mode instead of auto-detecting it.
  - sfp_type_forced_value (string, optional): SFP mode to force — required when sfp_type_forced is true.
    One of: p2p_1g, p2p_2d5g_no_aneg, p2p_10g, copper_1g, copper_sgmii_1g, copper_sgmii_10g, copper_usxgmii_10g.
    Use freebox_sfp_config_get to see the modes supported by your Freebox.`,
      inputSchema: {
        sfp_type_forced: z
          .boolean()
          .describe("Force the SFP mode instead of auto-detecting it"),
        sfp_type_forced_value: z
          .enum(SFP_TYPES)
          .optional()
          .describe("SFP mode to force (required when sfp_type_forced is true)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: {
      sfp_type_forced: boolean;
      sfp_type_forced_value?: SfpType;
    }) => {
      try {
        // Cross-field validation: registerTool takes a raw Zod shape, which cannot
        // carry an object-level .refine(), so the dependency is checked here.
        const validation = z
          .object({
            sfp_type_forced: z.boolean(),
            sfp_type_forced_value: z.enum(SFP_TYPES).optional(),
          })
          .refine(
            (v) => !v.sfp_type_forced || v.sfp_type_forced_value !== undefined,
            {
              message:
                "sfp_type_forced_value is required when sfp_type_forced is true",
              path: ["sfp_type_forced_value"],
            }
          )
          .safeParse(params);
        if (!validation.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${validation.error.issues[0]?.message || "invalid parameters"}`,
              },
            ],
          };
        }

        const body: Record<string, unknown> = {
          sfp_type_forced: params.sfp_type_forced,
        };
        if (params.sfp_type_forced_value !== undefined) {
          body.sfp_type_forced_value = params.sfp_type_forced_value;
        }

        const response = await freeboxClient.apiRequest<SfpConfig>(
          SFP_CONFIG_PATH,
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
          `- Forced mode: ${cfg?.sfp_type_forced ? "✅ Enabled" : "❌ Disabled (auto-detect)"}`,
          `- Forced type: ${cfg?.sfp_type_forced_value || "(none)"}`,
          `- Available types: ${(cfg?.available_sfp_types || []).join(", ") || "(none)"}`,
        ];
        return {
          content: [
            {
              type: "text",
              text: `SFP configuration updated.\n\n${lines.join("\n")}`,
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
