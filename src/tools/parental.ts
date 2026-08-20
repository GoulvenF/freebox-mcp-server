import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type {
  NetworkControl,
  NetworkControlMode,
  NetworkControlRule,
  Profile,
} from "../types.js";

const MODE_EMOJI: Record<NetworkControlMode, string> = {
  allowed: "🟢",
  denied: "🔴",
  webonly: "🟡",
};

const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Ranges",
];

const modeSchema = z.enum(["allowed", "denied", "webonly"]);

const timeOfDaySchema = z
  .number()
  .int()
  .refine(
    (v) => v >= 0 && v <= 86100 && v % 300 === 0,
    "Must be between 0 and 86100 seconds since midnight and a multiple of 300 (5 minutes)"
  );

const weekdaysSchema = z
  .array(z.boolean())
  .refine(
    (v) => v.length === 8,
    "Must contain exactly 8 booleans (Sunday..Saturday + cdayranges flag)"
  );

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatWeekdays(weekdays: boolean[]): string {
  const active = (weekdays || [])
    .map((on, i) => (on ? WEEKDAY_LABELS[i] : null))
    .filter((label): label is string => label !== null);
  return active.length > 0 ? active.join(", ") : "none";
}

function formatNetworkControl(nc: NetworkControl): string {
  const overrideInfo = nc.override
    ? `⏱️ override ${MODE_EMOJI[nc.override_mode]} ${nc.override_mode}${
        nc.override_until
          ? ` until ${new Date(nc.override_until * 1000).toISOString()}`
          : " (unlimited)"
      }`
    : "no override";
  return [
    `- **Profile ${nc.profile_id}**: ${MODE_EMOJI[nc.current_mode]} ${nc.current_mode}`,
    `  Rule mode: ${MODE_EMOJI[nc.rule_mode]} ${nc.rule_mode} — ${overrideInfo}`,
    `  MACs: ${(nc.macs || []).length}`,
  ].join("\n");
}

function formatRule(rule: NetworkControlRule): string {
  return [
    `- ${rule.enabled ? "✅" : "❌"} **${rule.name || "Unnamed"}** (ID: ${rule.id}) — ${MODE_EMOJI[rule.mode]} ${rule.mode}`,
    `  ${formatTime(rule.start_time)} → ${formatTime(rule.end_time)} on ${formatWeekdays(rule.weekdays)}`,
  ].join("\n");
}

export function registerParentalTools(server: McpServer): void {
  // ---------------------------------------------------------------- Profiles

  server.registerTool(
    "freebox_profile_list",
    {
      title: "List Parental Control Profiles",
      description: `List all parental control profiles configured on the Freebox.

Returns: Array of profiles with id, name and url (profile picture).`,
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
        const response = await freeboxClient.apiRequest<Profile[]>("profile");
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
        const profiles = response.result || [];
        if (profiles.length === 0) {
          return {
            content: [{ type: "text", text: "No profile configured." }],
          };
        }
        const lines = profiles.map(
          (p) =>
            `- 👤 **${p.name}** (ID: ${p.id})${p.url ? ` — ${p.url}` : ""}`
        );
        return {
          content: [
            {
              type: "text",
              text: `## Parental Control Profiles (${profiles.length})\n\n${lines.join("\n")}`,
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

  server.registerTool(
    "freebox_profile_get",
    {
      title: "Get Parental Control Profile",
      description: `Get a single parental control profile by its ID.

Args:
  - id (number): Profile ID.`,
      inputSchema: {
        id: z.number().int().describe("Profile ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number }) => {
      try {
        const response = await freeboxClient.apiRequest<Profile>(
          `profile/${params.id}`
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
        const profile = response.result;
        if (!profile) {
          return {
            content: [
              { type: "text", text: `No profile found with ID ${params.id}.` },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Profile ${profile.id}\n\n- 👤 **${profile.name}**\n- URL: ${profile.url || "none"}`,
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

  server.registerTool(
    "freebox_profile_add",
    {
      title: "Add Parental Control Profile",
      description: `Create a new parental control profile.
Requires 'parental' permission.

Args:
  - name (string): Profile name.
  - url (string, optional): Profile picture URL.`,
      inputSchema: {
        name: z.string().describe("Profile name"),
        url: z.string().optional().describe("Profile picture URL (optional)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: { name: string; url?: string }) => {
      try {
        const body: Record<string, unknown> = { name: params.name };
        if (params.url) body.url = params.url;

        const response = await freeboxClient.apiRequest<Profile>(
          "profile/",
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
              text: `Profile "${params.name}" created (ID: ${response.result?.id}).`,
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

  server.registerTool(
    "freebox_profile_update",
    {
      title: "Update Parental Control Profile",
      description: `Update an existing parental control profile.
Requires 'parental' permission.

Args:
  - id (number): Profile ID.
  - name (string, optional): New profile name.
  - url (string, optional): New profile picture URL.`,
      inputSchema: {
        id: z.number().int().describe("Profile ID"),
        name: z.string().optional().describe("New profile name"),
        url: z.string().optional().describe("New profile picture URL"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number; name?: string; url?: string }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.name !== undefined) body.name = params.name;
        if (params.url !== undefined) body.url = params.url;

        const response = await freeboxClient.apiRequest<Profile>(
          `profile/${params.id}`,
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
        return {
          content: [
            {
              type: "text",
              text: `Profile ${params.id} updated.\n\n${JSON.stringify(response.result, null, 2)}`,
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

  server.registerTool(
    "freebox_profile_delete",
    {
      title: "Delete Parental Control Profile",
      description: `Delete a parental control profile by its ID.
Requires 'parental' permission.

Args:
  - id (number): Profile ID.`,
      inputSchema: {
        id: z.number().int().describe("Profile ID"),
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
          `profile/${params.id}`,
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
          content: [{ type: "text", text: `Profile ${params.id} deleted.` }],
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

  // --------------------------------------------------------- Network control

  server.registerTool(
    "freebox_network_control_list",
    {
      title: "List Network Control States",
      description: `List the network control (parental control) state of every profile.

Returns: For each profile, its current mode (🟢 allowed / 🔴 denied / 🟡 webonly), the rule mode, override information and the number of associated MAC addresses.`,
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
          await freeboxClient.apiRequest<NetworkControl[]>("network_control");
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
        const controls = response.result || [];
        if (controls.length === 0) {
          return {
            content: [
              { type: "text", text: "No network control configuration found." },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Network Control (${controls.length} profile(s))\n\n${controls
                .map(formatNetworkControl)
                .join("\n")}`,
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

  server.registerTool(
    "freebox_network_control_get",
    {
      title: "Get Network Control State",
      description: `Get the network control (parental control) state of a single profile.

Args:
  - profile_id (number): Profile ID.`,
      inputSchema: {
        profile_id: z.number().int().describe("Profile ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { profile_id: number }) => {
      try {
        const response = await freeboxClient.apiRequest<NetworkControl>(
          `network_control/${params.profile_id}`
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
        const control = response.result;
        if (!control) {
          return {
            content: [
              {
                type: "text",
                text: `No network control found for profile ${params.profile_id}.`,
              },
            ],
          };
        }
        const macs = (control.macs || []).join(", ") || "none";
        const hosts =
          (control.hosts || [])
            .map((h) => h.primary_name || h.id)
            .join(", ") || "none";
        return {
          content: [
            {
              type: "text",
              text: `## Network Control — Profile ${control.profile_id}\n\n${formatNetworkControl(control)}\n  Next change: ${control.next_change ? new Date(control.next_change * 1000).toISOString() : "none"}\n  MAC list: ${macs}\n  Hosts: ${hosts}`,
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

  server.registerTool(
    "freebox_network_control_override",
    {
      title: "Override Network Control",
      description: `Set or clear a network control override for a profile.
⚠️ This immediately changes the profile's network access: setting override=true with mode "denied" cuts internet access for every device of the profile right away.
Requires 'parental' permission.

Args:
  - profile_id (number): Profile ID.
  - override (boolean): true to activate the override, false to clear it and fall back to the scheduled rules.
  - override_mode (string, optional): "allowed", "denied" or "webonly". Required when override is true.
  - override_until (number, optional): Unix timestamp at which the override expires. 0 (default) means unlimited.`,
      inputSchema: {
        profile_id: z.number().int().describe("Profile ID"),
        override: z
          .boolean()
          .describe("Activate (true) or clear (false) the override"),
        override_mode: modeSchema
          .optional()
          .describe("Override mode (required when override is true)"),
        override_until: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Unix timestamp of override expiry (0 = unlimited)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      profile_id: number;
      override: boolean;
      override_mode?: NetworkControlMode;
      override_until?: number;
    }) => {
      try {
        if (params.override && !params.override_mode) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Error: override_mode is required when override is true.",
              },
            ],
          };
        }
        const body: Record<string, unknown> = {
          profile_id: params.profile_id,
          override: params.override,
        };
        if (params.override_mode !== undefined)
          body.override_mode = params.override_mode;
        if (params.override_until !== undefined)
          body.override_until = params.override_until;

        const response = await freeboxClient.apiRequest<NetworkControl>(
          `network_control/${params.profile_id}`,
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
        const control = response.result;
        const summary = control
          ? formatNetworkControl(control)
          : params.override
            ? `Override set to ${params.override_mode}.`
            : "Override cleared.";
        return {
          content: [
            {
              type: "text",
              text: `Network control updated for profile ${params.profile_id}.\n\n${summary}`,
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

  // --------------------------------------------------- Network control rules

  server.registerTool(
    "freebox_network_control_rules_list",
    {
      title: "List Network Control Rules",
      description: `List the network control (parental control) schedule rules of a profile.

Args:
  - profile_id (number): Profile ID.

Returns: Array of rules with id, name, mode, start/end time and active weekdays.`,
      inputSchema: {
        profile_id: z.number().int().describe("Profile ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { profile_id: number }) => {
      try {
        const response = await freeboxClient.apiRequest<NetworkControlRule[]>(
          `network_control/${params.profile_id}/rules`
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
              {
                type: "text",
                text: `No network control rule for profile ${params.profile_id}.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Network Control Rules — Profile ${params.profile_id} (${rules.length})\n\n${rules
                .map(formatRule)
                .join("\n")}`,
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

  server.registerTool(
    "freebox_network_control_rule_get",
    {
      title: "Get Network Control Rule",
      description: `Get a single network control schedule rule.

Args:
  - profile_id (number): Profile ID.
  - rule_id (number): Rule ID.`,
      inputSchema: {
        profile_id: z.number().int().describe("Profile ID"),
        rule_id: z.number().int().describe("Rule ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { profile_id: number; rule_id: number }) => {
      try {
        const response = await freeboxClient.apiRequest<NetworkControlRule>(
          `network_control/${params.profile_id}/rules/${params.rule_id}`
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
        const rule = response.result;
        if (!rule) {
          return {
            content: [
              {
                type: "text",
                text: `No rule ${params.rule_id} for profile ${params.profile_id}.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Network Control Rule ${rule.id}\n\n${formatRule(rule)}`,
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

  server.registerTool(
    "freebox_network_control_rule_add",
    {
      title: "Add Network Control Rule",
      description: `Add a network control (parental control) schedule rule to a profile.
Requires 'parental' permission.

Args:
  - profile_id (number): Profile ID.
  - name (string): Rule name.
  - mode (string): "allowed", "denied" or "webonly".
  - start_time (number): Start, in seconds since midnight (0-86100, multiple of 300).
  - end_time (number): End, in seconds since midnight (0-86100, multiple of 300).
  - weekdays (boolean[]): Exactly 8 booleans (Sunday..Saturday, 8th entry is the cdayranges flag).
  - enabled (boolean, optional): Enable the rule (default: true).`,
      inputSchema: {
        profile_id: z.number().int().describe("Profile ID"),
        name: z.string().describe("Rule name"),
        mode: modeSchema.describe("Network access mode"),
        start_time: timeOfDaySchema.describe(
          "Start time in seconds since midnight (multiple of 300)"
        ),
        end_time: timeOfDaySchema.describe(
          "End time in seconds since midnight (multiple of 300)"
        ),
        weekdays: weekdaysSchema.describe("Exactly 8 booleans"),
        enabled: z.boolean().default(true).describe("Enable rule"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      profile_id: number;
      name: string;
      mode: NetworkControlMode;
      start_time: number;
      end_time: number;
      weekdays: boolean[];
      enabled: boolean;
    }) => {
      try {
        const body: Record<string, unknown> = {
          name: params.name,
          mode: params.mode,
          start_time: params.start_time,
          end_time: params.end_time,
          weekdays: params.weekdays,
          enabled: params.enabled,
        };

        const response = await freeboxClient.apiRequest<NetworkControlRule>(
          `network_controlr/${params.profile_id}/rules/`,
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
              text: `Network control rule "${params.name}" created for profile ${params.profile_id} (ID: ${response.result?.id}).`,
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

  server.registerTool(
    "freebox_network_control_rule_update",
    {
      title: "Update Network Control Rule",
      description: `Update an existing network control schedule rule. Only the provided fields are sent.
Requires 'parental' permission.

Args:
  - profile_id (number): Profile ID.
  - rule_id (number): Rule ID.
  - name (string, optional): New rule name.
  - mode (string, optional): "allowed", "denied" or "webonly".
  - start_time (number, optional): Start, in seconds since midnight (0-86100, multiple of 300).
  - end_time (number, optional): End, in seconds since midnight (0-86100, multiple of 300).
  - weekdays (boolean[], optional): Exactly 8 booleans.
  - enabled (boolean, optional): Enable or disable the rule.`,
      inputSchema: {
        profile_id: z.number().int().describe("Profile ID"),
        rule_id: z.number().int().describe("Rule ID"),
        name: z.string().optional().describe("New rule name"),
        mode: modeSchema.optional().describe("Network access mode"),
        start_time: timeOfDaySchema
          .optional()
          .describe("Start time in seconds since midnight (multiple of 300)"),
        end_time: timeOfDaySchema
          .optional()
          .describe("End time in seconds since midnight (multiple of 300)"),
        weekdays: weekdaysSchema.optional().describe("Exactly 8 booleans"),
        enabled: z.boolean().optional().describe("Enable or disable the rule"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: {
      profile_id: number;
      rule_id: number;
      name?: string;
      mode?: NetworkControlMode;
      start_time?: number;
      end_time?: number;
      weekdays?: boolean[];
      enabled?: boolean;
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.name !== undefined) body.name = params.name;
        if (params.mode !== undefined) body.mode = params.mode;
        if (params.start_time !== undefined) body.start_time = params.start_time;
        if (params.end_time !== undefined) body.end_time = params.end_time;
        if (params.weekdays !== undefined) body.weekdays = params.weekdays;
        if (params.enabled !== undefined) body.enabled = params.enabled;

        const response = await freeboxClient.apiRequest<NetworkControlRule>(
          `network_control/${params.profile_id}/rules/${params.rule_id}`,
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
        const rule = response.result;
        return {
          content: [
            {
              type: "text",
              text: `Network control rule ${params.rule_id} updated for profile ${params.profile_id}.${rule ? `\n\n${formatRule(rule)}` : ""}`,
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

  server.registerTool(
    "freebox_network_control_rule_delete",
    {
      title: "Delete Network Control Rule",
      description: `Delete a network control schedule rule.
Requires 'parental' permission.

Args:
  - profile_id (number): Profile ID.
  - rule_id (number): Rule ID.`,
      inputSchema: {
        profile_id: z.number().int().describe("Profile ID"),
        rule_id: z.number().int().describe("Rule ID"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { profile_id: number; rule_id: number }) => {
      try {
        const response = await freeboxClient.apiRequest(
          `network_control/${params.profile_id}/rules/${params.rule_id}`,
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
              text: `Network control rule ${params.rule_id} deleted from profile ${params.profile_id}.`,
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
