import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type {
  CallAccount,
  CallEntry,
  CallType,
  VoicemailEntry,
} from "../types.js";
import { sanitizeDisplay } from "../utils/sanitize.js";

const CALL_TYPE_EMOJI: Record<CallType, string> = {
  missed: "❌",
  accepted: "📥",
  outgoing: "📤",
};

// Call log ids are integers; voicemail ids are file names such as
// "20221215_154135_r0334371508.au". Both are interpolated into an API path, so
// keep them tightly constrained.
const callIdSchema = z.number().int().nonnegative().describe("Call entry ID");

const voicemailIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9._-]{1,128}$/,
    "Identifiant de message vocal invalide (attendu : lettres, chiffres, '.', '_' ou '-')"
  )
  .describe("Voicemail entry ID");

function formatDate(timestamp: number): string {
  if (!timestamp) return "unknown";
  return new Date(timestamp * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function formatDuration(seconds: number): string {
  const m = Math.floor((seconds || 0) / 60);
  const s = (seconds || 0) % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

function formatCall(call: CallEntry): string {
  const emoji = CALL_TYPE_EMOJI[call.type] || "📞";
  const name = sanitizeDisplay(call.name);
  const number = sanitizeDisplay(call.number, 40);
  return [
    `- ${emoji} **${name || number || "unknown"}** — ${number}`,
    `  - id: ${call.id}, type: ${call.type}, ${formatDate(call.datetime)}`,
    `  - durée: ${formatDuration(call.duration)}${call.new ? ", 🔵 non lu" : ""}${
      call.contact_id ? `, contact_id: ${call.contact_id}` : ""
    }`,
  ].join("\n");
}

function formatVoicemail(vm: VoicemailEntry): string {
  const number = sanitizeDisplay(vm.phone_number, 40);
  const cc = sanitizeDisplay(vm.country_code, 8);
  return [
    `- 📼 **${cc ? `+${cc} ` : ""}${number || "unknown"}** — ${formatDate(vm.date)}`,
    `  - id: ${sanitizeDisplay(vm.id, 128)}, durée: ${formatDuration(vm.duration)}${
      vm.read ? "" : ", 🔵 non lu"
    }`,
  ].join("\n");
}

export function registerCallTools(server: McpServer): void {
  // List call log
  server.registerTool(
    "freebox_call_log_list",
    {
      title: "List Call Log",
      description: `List the Freebox call log entries (incoming, missed and outgoing calls).
The Freebox API returns the whole collection at once; 'start'/'limit' paginate the result locally, newest call first.
Requires 'calls' permission.

Args:
  - start (number, optional): Offset in the (newest-first) list. Default 0.
  - limit (number, optional): Max entries to return. Default 50, max 500.
  - type (string, optional): Only return calls of this type: "missed", "accepted" or "outgoing".
  - only_new (boolean, optional): Only return entries not yet acknowledged.

Returns: Array of call entries with id, type, datetime, number, name, duration, new, contact_id.`,
      inputSchema: {
        start: z.number().int().nonnegative().optional().describe("Offset"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max entries to return"),
        type: z
          .enum(["missed", "accepted", "outgoing"])
          .optional()
          .describe("Filter by call type"),
        only_new: z
          .boolean()
          .optional()
          .describe("Only unacknowledged entries"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: {
      start?: number;
      limit?: number;
      type?: CallType;
      only_new?: boolean;
    }) => {
      try {
        const response =
          await freeboxClient.apiRequest<CallEntry[]>("call/log/");
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
        let calls = response.result || [];
        if (params.type) calls = calls.filter((c) => c.type === params.type);
        if (params.only_new) calls = calls.filter((c) => c.new);
        calls = [...calls].sort((a, b) => b.datetime - a.datetime);

        const total = calls.length;
        const start = params.start ?? 0;
        const limit = params.limit ?? 50;
        const page = calls.slice(start, start + limit);

        if (page.length === 0) {
          return {
            content: [{ type: "text", text: "No call log entry found." }],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Call Log (${page.length}/${total}, offset ${start})\n\n${page
                .map(formatCall)
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

  // Get one call log entry
  server.registerTool(
    "freebox_call_log_get",
    {
      title: "Get Call Log Entry",
      description: `Get a single call log entry by its ID.
Requires 'calls' permission.

Args:
  - id (number): Call entry ID.`,
      inputSchema: {
        id: callIdSchema,
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
        const response = await freeboxClient.apiRequest<CallEntry>(
          `call/log/${encodeURIComponent(String(params.id))}`
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
        const call = response.result;
        if (!call) {
          return {
            content: [
              { type: "text", text: `No call entry found with ID ${params.id}.` },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Call Entry ${call.id}\n\n${formatCall(call)}`,
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

  // Mark one entry as read / unread
  server.registerTool(
    "freebox_call_log_mark_read",
    {
      title: "Mark Call Log Entry As Read",
      description: `Mark a call log entry as read (acknowledged) or back as new.
Requires 'calls' permission.

Args:
  - id (number): Call entry ID.
  - read (boolean, optional): true (default) marks the entry as read, false marks it as new again.`,
      inputSchema: {
        id: callIdSchema,
        read: z
          .boolean()
          .default(true)
          .describe("true = mark as read, false = mark as new"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number; read: boolean }) => {
      try {
        const response = await freeboxClient.apiRequest<CallEntry>(
          `call/log/${encodeURIComponent(String(params.id))}`,
          "PUT",
          { new: !params.read }
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
              text: `Call entry ${params.id} marked as ${params.read ? "read" : "new"}.`,
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

  // Mark all as read
  server.registerTool(
    "freebox_call_log_mark_all_as_read",
    {
      title: "Mark All Calls As Read",
      description: `Mark every call log entry as read (acknowledged).
Requires 'calls' permission.`,
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
        const response = await freeboxClient.apiRequest(
          "call/log/mark_all_as_read/",
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
            { type: "text", text: "All call log entries marked as read." },
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

  // Delete a call entry
  server.registerTool(
    "freebox_call_log_delete",
    {
      title: "Delete Call Log Entry",
      description: `Delete a single call log entry. This is irreversible.
Requires 'calls' permission.

Args:
  - id (number): Call entry ID.
  - confirm (string): REQUIRED. Deleting a call log entry destroys the record permanently. To proceed, pass confirm="JE-CONFIRME-LA-SUPPRESSION-APPEL".`,
      inputSchema: {
        id: callIdSchema,
        confirm: z
          .string()
          .optional()
          .describe(
            "Pass the exact confirmation phrase shown in the tool description to execute this action."
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number; confirm?: string }) => {
      try {
        if (params.confirm !== "JE-CONFIRME-LA-SUPPRESSION-APPEL") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: 'Refusé : cette action est irréversible. Supprimer une entrée du journal d\'appels efface définitivement la trace de cet appel. Confirmez avec confirm="JE-CONFIRME-LA-SUPPRESSION-APPEL".',
              },
            ],
          };
        }
        const response = await freeboxClient.apiRequest(
          `call/log/${encodeURIComponent(String(params.id))}`,
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
          content: [{ type: "text", text: `Call entry ${params.id} deleted.` }],
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

  // Delete all call entries
  server.registerTool(
    "freebox_call_log_delete_all",
    {
      title: "Delete All Call Log Entries",
      description: `Delete the entire call log. This is irreversible and affects every entry.
Requires 'calls' permission.

Args:
  - confirm (string): REQUIRED. This wipes the whole call history of the household. To proceed, pass confirm="JE-CONFIRME-LA-SUPPRESSION-DU-JOURNAL".`,
      inputSchema: {
        confirm: z
          .string()
          .optional()
          .describe(
            "Pass the exact confirmation phrase shown in the tool description to execute this action."
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { confirm?: string }) => {
      try {
        if (params.confirm !== "JE-CONFIRME-LA-SUPPRESSION-DU-JOURNAL") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: 'Refusé : cette action est irréversible. Elle efface la totalité du journal d\'appels du foyer (appels reçus, manqués et émis). Confirmez avec confirm="JE-CONFIRME-LA-SUPPRESSION-DU-JOURNAL".',
              },
            ],
          };
        }
        const response = await freeboxClient.apiRequest(
          "call/log/delete_all/",
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
          content: [{ type: "text", text: "All call log entries deleted." }],
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

  // Phone account
  server.registerTool(
    "freebox_call_account",
    {
      title: "Get Phone Account",
      description: `Get the phone number associated with the Freebox subscription.
Requires 'calls' permission.

Returns: JSON with phone_number.`,
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
          await freeboxClient.apiRequest<CallAccount>("call/account");
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
        const account = response.result;
        return {
          content: [
            {
              type: "text",
              text: `## Phone Account\n\n- **Numéro**: ${sanitizeDisplay(account?.phone_number, 40) || "unknown"}`,
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

  // List voicemails
  server.registerTool(
    "freebox_voicemail_list",
    {
      title: "List Voicemails",
      description: `List the voicemail messages stored on the Freebox.
Requires 'calls' permission.

Args:
  - only_unread (boolean, optional): Only return messages not yet read.

Returns: Array of voicemail entries with id, country_code, phone_number, date, read, duration.`,
      inputSchema: {
        only_unread: z
          .boolean()
          .optional()
          .describe("Only unread voicemails"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { only_unread?: boolean }) => {
      try {
        const response =
          await freeboxClient.apiRequest<VoicemailEntry[]>("call/voicemail/");
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
        let entries = response.result || [];
        if (params.only_unread) entries = entries.filter((v) => !v.read);
        if (entries.length === 0) {
          return { content: [{ type: "text", text: "No voicemail found." }] };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Voicemails (${entries.length})\n\n${entries
                .map(formatVoicemail)
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

  // Get one voicemail
  server.registerTool(
    "freebox_voicemail_get",
    {
      title: "Get Voicemail Entry",
      description: `Get a single voicemail entry by its ID.
The audio file itself is not returned (binary WAV); it can be fetched from /api/call/voicemail/{id}/audio_file.
Requires 'calls' permission.

Args:
  - id (string): Voicemail ID (e.g. "20221215_154135_r0334371508.au").`,
      inputSchema: {
        id: voicemailIdSchema,
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
        const response = await freeboxClient.apiRequest<VoicemailEntry>(
          `call/voicemail/${encodeURIComponent(params.id)}`
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
        const vm = response.result;
        if (!vm) {
          return {
            content: [
              {
                type: "text",
                text: `No voicemail found with ID ${sanitizeDisplay(params.id, 128)}.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Voicemail\n\n${formatVoicemail(vm)}`,
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

  // Mark voicemail as read
  server.registerTool(
    "freebox_voicemail_mark_read",
    {
      title: "Mark Voicemail As Read",
      description: `Mark a voicemail message as read or unread.
Requires 'calls' permission.

Args:
  - id (string): Voicemail ID.
  - read (boolean, optional): true (default) marks it read, false marks it unread.`,
      inputSchema: {
        id: voicemailIdSchema,
        read: z
          .boolean()
          .default(true)
          .describe("true = mark as read, false = mark as unread"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: string; read: boolean }) => {
      try {
        const response = await freeboxClient.apiRequest<VoicemailEntry>(
          `call/voicemail/${encodeURIComponent(params.id)}`,
          "PUT",
          { read: params.read }
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
              text: `Voicemail ${sanitizeDisplay(params.id, 128)} marked as ${params.read ? "read" : "unread"}.`,
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

  // Delete a voicemail
  server.registerTool(
    "freebox_voicemail_delete",
    {
      title: "Delete Voicemail",
      description: `Delete a voicemail message. This is irreversible: the audio recording is lost.
Requires 'calls' permission.

Args:
  - id (string): Voicemail ID.
  - confirm (string): REQUIRED. To proceed, pass confirm="JE-CONFIRME-LA-SUPPRESSION-MESSAGE".`,
      inputSchema: {
        id: voicemailIdSchema,
        confirm: z
          .string()
          .optional()
          .describe(
            "Pass the exact confirmation phrase shown in the tool description to execute this action."
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: string; confirm?: string }) => {
      try {
        if (params.confirm !== "JE-CONFIRME-LA-SUPPRESSION-MESSAGE") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: 'Refusé : cette action est irréversible. Supprimer un message vocal efface définitivement l\'enregistrement audio. Confirmez avec confirm="JE-CONFIRME-LA-SUPPRESSION-MESSAGE".',
              },
            ],
          };
        }
        const response = await freeboxClient.apiRequest(
          `call/voicemail/${encodeURIComponent(params.id)}`,
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
              text: `Voicemail ${sanitizeDisplay(params.id, 128)} deleted.`,
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
