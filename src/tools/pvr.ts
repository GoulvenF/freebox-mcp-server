import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type {
  PvrConfig,
  PvrFinishedRecord,
  PvrMedia,
  PvrProgrammedRecord,
  PvrQuota,
} from "../types.js";
import { sanitizeDisplay } from "../utils/sanitize.js";

// Recordings are French TV: show times in French time.
const TIME_ZONE = "Europe/Paris";
const DEFAULT_RECORD_PATH = "Enregistrements";
const CHANNEL_UUID_PATTERN = /^uuid-webtv-\d{1,6}$/;

const recordIdSchema = z.number().int().min(0).describe("Record ID");

function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function catchError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  return errorResult(`Error: ${msg}`);
}

const dateTimeFormat = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const dateTimeYearFormat = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const yearFormat = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

function formatSpan(start: number, end: number): string {
  // Show the year only when it is not the current one: old recordings are common.
  const date = new Date(start * 1000);
  const thisYear = yearFormat.format(date) === yearFormat.format(new Date());
  return `${(thisYear ? dateTimeFormat : dateTimeYearFormat).format(date)}–${timeFormat.format(new Date(end * 1000))}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

function recordTitle(r: { name?: string; subname?: string }): string {
  return `**${sanitizeDisplay(r.name) || "(untitled)"}**${r.subname ? ` — ${sanitizeDisplay(r.subname)}` : ""}`;
}

function formatProgrammed(r: PvrProgrammedRecord): string {
  const flags = [
    r.has_record_gen ? "recurring" : "",
    r.conflict ? `⚠️ conflicts with ${(r.overlap_list || []).join(", ")}` : "",
    r.enabled === false ? "skipped" : "",
    r.error && r.error !== "none" ? `error: ${sanitizeDisplay(r.error, 40)}` : "",
  ].filter(Boolean);
  return `- **${r.id}** ${formatSpan(r.start, r.end)} ${sanitizeDisplay(r.channel_name) || r.channel_uuid} — ${recordTitle(r)} [${sanitizeDisplay(r.state, 30)}]${flags.length ? ` (${flags.join(", ")})` : ""}`;
}

function formatFinished(r: PvrFinishedRecord): string {
  const flags = [
    r.secure ? "DRM" : "",
    r.altered ? "incomplete" : "",
    r.error && r.error !== "none" ? `error: ${sanitizeDisplay(r.error, 40)}` : "",
  ].filter(Boolean);
  return `- **${r.id}** ${formatSpan(r.start, r.end)} ${sanitizeDisplay(r.channel_name) || r.channel_uuid} — ${recordTitle(r)} [${sanitizeDisplay(r.state, 30)}${r.byte_size ? `, ${formatBytes(r.byte_size)}` : ""}]${flags.length ? ` (${flags.join(", ")})` : ""}`;
}

/** Parse an ISO 8601 date-time that carries an explicit offset. */
function parseIsoWithOffset(value: string): number | undefined {
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

export function registerPvrTools(server: McpServer): void {
  // Recorder status: storage, quota, default margins
  server.registerTool(
    "freebox_pvr_status",
    {
      title: "Get Recorder Status",
      description: `Get the state of the Freebox TV recorder: storage media with free space and estimated recording time, quota, default margins.
Requires 'pvr' permission.`,
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
        const [media, quota, config] = await Promise.all([
          freeboxClient.apiRequest<PvrMedia[]>("pvr/media/"),
          freeboxClient.apiRequest<PvrQuota>("pvr/quota/"),
          freeboxClient.apiRequest<PvrConfig>("pvr/config/"),
        ]);
        const failed = [media, quota, config].find((r) => !r.success);
        if (failed) return errorResult(`Error: ${failed.msg || failed.error_code}`);
        const lines = ["## TV recorder"];
        for (const m of media.result || []) {
          const hd = m.record_time?.iptv?.hd;
          lines.push(
            `- **${sanitizeDisplay(m.media)}**: ${formatBytes(m.free_bytes)} free of ${formatBytes(m.total_bytes)}${hd ? `, ~${Math.floor(hd / 3600)} h of HD recording left` : ""}`
          );
        }
        if ((media.result || []).length === 0) lines.push("- No storage medium available for recording.");
        const q = quota.result;
        if (q) {
          lines.push(`- **Quota**: ${q.quota_exceeded ? `⚠️ exceeded (needs ${q.needed_tresh}, current ${q.cur_tresh})` : "ok"}`);
        }
        const c = config.result;
        if (c) lines.push(`- **Default margins**: ${c.margin_before} min before, ${c.margin_after} min after`);
        return textResult(lines.join("\n"));
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Programmed records
  server.registerTool(
    "freebox_pvr_programmed_list",
    {
      title: "List Programmed Recordings",
      description: `List the programmed TV recordings, with their state and conflicts. By default only the upcoming and running ones: the box keeps past ones in this list too.
Requires 'pvr' permission.

Args:
  - include_past (boolean, optional): also list past (finished, failed) programmed recordings (default false).`,
      inputSchema: {
        include_past: z.boolean().optional().describe("Also list past programmed recordings"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { include_past?: boolean }) => {
      try {
        const response = await freeboxClient.apiRequest<PvrProgrammedRecord[]>("pvr/programmed/");
        if (!response.success) return errorResult(`Error: ${response.msg || response.error_code}`);
        const now = Math.floor(Date.now() / 1000);
        const records = (response.result || [])
          .filter((r) => params.include_past || r.end > now)
          .sort((a, b) => a.start - b.start);
        if (records.length === 0) {
          return textResult(params.include_past ? "No programmed recording." : "No upcoming recording.");
        }
        const title = params.include_past ? "Programmed recordings" : "Upcoming recordings";
        return textResult(`## ${title} (${records.length})\n\n${records.map(formatProgrammed).join("\n")}`);
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Finished records
  server.registerTool(
    "freebox_pvr_finished_list",
    {
      title: "List Recordings",
      description: `List the finished (and in-progress) TV recordings, newest first.
Requires 'pvr' permission.

Args:
  - limit (number, optional): maximum number of recordings, 1-200 (default 50).`,
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("Maximum recordings (default 50)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { limit?: number }) => {
      try {
        const response = await freeboxClient.apiRequest<PvrFinishedRecord[]>("pvr/finished/");
        if (!response.success) return errorResult(`Error: ${response.msg || response.error_code}`);
        const records = (response.result || []).sort((a, b) => b.start - a.start);
        if (records.length === 0) return textResult("No recording.");
        const limit = params.limit ?? 50;
        const more = records.length > limit ? `\n\n…${records.length - limit} older recordings not shown.` : "";
        return textResult(
          `## Recordings (${records.length})\n\n${records.slice(0, limit).map(formatFinished).join("\n")}${more}`
        );
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Programme a recording
  server.registerTool(
    "freebox_pvr_record",
    {
      title: "Programme a Recording",
      description: `Programme a TV recording on the Freebox disk.
Give either 'program_id' (a program from the TV guide: channel, times and title are taken from it) or 'channel_uuid' + 'start' + 'end' (+ 'name').
The default margins of the recorder apply unless margins are given.
Requires 'pvr' permission.

Args:
  - program_id (string, optional): TV guide program id (e.g. from freebox_tv_epg).
  - channel_uuid (string, optional): channel UUID (uuid-webtv-N).
  - start, end (string, optional): ISO 8601 date-times with an offset (e.g. 2026-09-28T21:10+02:00).
  - name (string, optional): recording name (default: program title).
  - margin_before, margin_after (number, optional): margins in minutes, 0-60.
  - media (string, optional): storage medium (default: the first one of freebox_pvr_status).`,
      inputSchema: {
        program_id: z
          .string()
          .max(100)
          .regex(/^[A-Za-z0-9_.-]+$/, "Invalid program id")
          .optional()
          .describe("TV guide program id"),
        channel_uuid: z.string().regex(CHANNEL_UUID_PATTERN, "Expected uuid-webtv-N").optional().describe("Channel UUID"),
        start: z.string().max(40).optional().describe("Start, ISO 8601 with offset"),
        end: z.string().max(40).optional().describe("End, ISO 8601 with offset"),
        name: z.string().min(1).max(200).optional().describe("Recording name"),
        margin_before: z.number().int().min(0).max(60).optional().describe("Minutes before"),
        margin_after: z.number().int().min(0).max(60).optional().describe("Minutes after"),
        media: z.string().min(1).max(100).optional().describe("Storage medium"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      program_id?: string;
      channel_uuid?: string;
      start?: string;
      end?: string;
      name?: string;
      margin_before?: number;
      margin_after?: number;
      media?: string;
    }) => {
      try {
        const manual = params.channel_uuid !== undefined || params.start !== undefined || params.end !== undefined;
        if ((params.program_id !== undefined) === manual) {
          return errorResult("Error: give either 'program_id', or 'channel_uuid' + 'start' + 'end'.");
        }

        let record: { channel_uuid: string; start: number; end: number; name: string; subname: string };
        if (params.program_id !== undefined) {
          const program = await freeboxClient.apiRequest<{
            channel_id?: string;
            date: number;
            duration: number;
            title?: string;
            sub_title?: string;
          }>(`tv/epg/programs/${encodeURIComponent(params.program_id)}`);
          if (!program.success || !program.result) {
            return errorResult(`Error: ${program.msg || program.error_code}`);
          }
          const p = program.result;
          if (!p.channel_id || !CHANNEL_UUID_PATTERN.test(p.channel_id)) {
            return errorResult("Error: this program has no channel; use channel_uuid + start + end.");
          }
          record = {
            channel_uuid: p.channel_id,
            start: p.date,
            end: p.date + p.duration,
            name: params.name ?? p.title ?? "",
            subname: p.sub_title ?? "",
          };
        } else {
          if (!params.channel_uuid || !params.start || !params.end) {
            return errorResult("Error: 'channel_uuid', 'start' and 'end' are all needed.");
          }
          const start = parseIsoWithOffset(params.start);
          const end = parseIsoWithOffset(params.end);
          if (start === undefined || end === undefined) {
            return errorResult("Error: 'start' and 'end' must be ISO 8601 date-times with an offset (e.g. 2026-09-28T21:10+02:00).");
          }
          if (end <= start) return errorResult("Error: 'end' must be after 'start'.");
          record = { channel_uuid: params.channel_uuid, start, end, name: params.name ?? "", subname: "" };
        }

        let media = params.media;
        if (media === undefined) {
          const list = await freeboxClient.apiRequest<PvrMedia[]>("pvr/media/");
          if (!list.success) return errorResult(`Error: ${list.msg || list.error_code}`);
          media = list.result?.[0]?.media;
          if (!media) return errorResult("Error: no storage medium available for recording.");
        }

        const body: Record<string, unknown> = {
          ...record,
          media,
          path: DEFAULT_RECORD_PATH,
          broadcast_type: "tv",
          channel_type: "",
          channel_quality: "auto",
        };
        if (params.margin_before !== undefined) body.margin_before = params.margin_before;
        if (params.margin_after !== undefined) body.margin_after = params.margin_after;

        const response = await freeboxClient.apiRequest<PvrProgrammedRecord>("pvr/programmed/", "POST", body);
        if (!response.success || !response.result) {
          return errorResult(`Error: ${response.msg || response.error_code}`);
        }
        return textResult(`⏺️ Recording programmed:\n${formatProgrammed(response.result)}`);
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Cancel a programmed record
  server.registerTool(
    "freebox_pvr_programmed_delete",
    {
      title: "Cancel a Programmed Recording",
      description: `Cancel a programmed recording. A recurring (generated) recording cannot be deleted here: it can only be skipped from Freebox OS.
Requires 'pvr' permission.

Args:
  - id (number): programmed recording ID (from freebox_pvr_programmed_list).`,
      inputSchema: { id: recordIdSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number }) => {
      try {
        const response = await freeboxClient.apiRequest(`pvr/programmed/${params.id}`, "DELETE");
        if (!response.success) return errorResult(`Error: ${response.msg || response.error_code}`);
        return textResult(`Programmed recording ${params.id} cancelled.`);
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Delete a finished record
  server.registerTool(
    "freebox_pvr_finished_delete",
    {
      title: "Delete a Recording",
      description: `Delete a finished recording and its video file. This is irreversible.
Requires 'pvr' permission.

Args:
  - id (number): recording ID (from freebox_pvr_finished_list).
  - confirm (string): REQUIRED. To proceed, pass confirm="JE-CONFIRME-LA-SUPPRESSION-ENREGISTREMENT".`,
      inputSchema: {
        id: recordIdSchema,
        confirm: z
          .string()
          .optional()
          .describe("Pass the exact confirmation phrase shown in the tool description to execute this action."),
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
        if (params.confirm !== "JE-CONFIRME-LA-SUPPRESSION-ENREGISTREMENT") {
          return errorResult(
            'Refusé : cette action est irréversible. Supprimer un enregistrement efface définitivement le fichier vidéo. Confirmez avec confirm="JE-CONFIRME-LA-SUPPRESSION-ENREGISTREMENT".'
          );
        }
        const response = await freeboxClient.apiRequest(`pvr/finished/${params.id}`, "DELETE");
        if (!response.success) return errorResult(`Error: ${response.msg || response.error_code}`);
        return textResult(`Recording ${params.id} deleted.`);
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );
}
