import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type {
  TvBouquetChannel,
  TvChannel,
  TvProgram,
} from "../types.js";
import { sanitizeDisplay } from "../utils/sanitize.js";

// Freebox TV is a French service: the guide is shown in French time.
const TIME_ZONE = "Europe/Paris";
const DEFAULT_BOUQUET = "freeboxtv";
// tv/epg/by_channel/{uuid}/{ts} answers with the programs that overlap the
// 2-hour slot containing ts (slots aligned on UTC).
const EPG_SLOT_SECONDS = 2 * 3600;
const CHANNEL_UUID_PATTERN = /^uuid-webtv-\d{1,6}$/;

const channelSchema = z
  .union([
    z.number().int().min(0).max(9999),
    z.string().regex(CHANNEL_UUID_PATTERN, "Expected a channel number or uuid-webtv-N"),
  ])
  .describe("Channel number (e.g. 2 for France 2) or channel UUID (uuid-webtv-201)");

const timeSchema = z
  .string()
  .max(40)
  .describe(
    "ISO 8601 date-time, e.g. 2026-09-28T21:00 (French time when no offset is given) or 2026-09-28T19:00Z"
  );

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

const timeFormat = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

function formatTime(ts: number): string {
  return timeFormat.format(new Date(ts * 1000));
}

function formatDay(ts: number): string {
  return dayFormat.format(new Date(ts * 1000));
}

/** Offset of French time from UTC at the given instant, in seconds. */
function parisOffsetSeconds(ts: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ts * 1000));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round(asUtc / 1000 - ts);
}

/**
 * Parse an ISO 8601 date-time into a Unix timestamp. Without an explicit
 * offset, the time is read as French time.
 */
function parseTime(value: string | undefined): number | string {
  if (value === undefined) return Math.floor(Date.now() / 1000);
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const ms = Date.parse(hasOffset ? value : `${value}Z`);
  if (Number.isNaN(ms)) return `invalid date-time '${sanitizeDisplay(value, 40)}'.`;
  let ts = Math.floor(ms / 1000);
  if (!hasOffset) ts -= parisOffsetSeconds(ts);
  return ts;
}

async function getBouquetChannels(): Promise<TvBouquetChannel[] | string> {
  const response = await freeboxClient.apiRequest<TvBouquetChannel[]>(
    `tv/bouquets/${DEFAULT_BOUQUET}/channels/`
  );
  if (!response.success) return `Error: ${response.msg || response.error_code}`;
  return response.result || [];
}

async function getChannels(): Promise<Record<string, TvChannel> | string> {
  const response = await freeboxClient.apiRequest<Record<string, TvChannel>>("tv/channels/");
  if (!response.success) return `Error: ${response.msg || response.error_code}`;
  return response.result || {};
}

/** Lowest main number (sub_number 0 first) of each channel UUID. */
function numbersByUuid(bouquet: TvBouquetChannel[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const c of [...bouquet].sort((a, b) => a.sub_number - b.sub_number || a.number - b.number)) {
    if (!numbers.has(c.uuid)) numbers.set(c.uuid, c.number);
  }
  return numbers;
}

/** Resolve a channel number or UUID to a UUID and its number. */
async function resolveChannel(
  channel: number | string
): Promise<{ uuid: string; number?: number } | { error: string }> {
  const bouquet = await getBouquetChannels();
  if (typeof bouquet === "string") return { error: bouquet };
  if (typeof channel === "string") {
    return { uuid: channel, number: numbersByUuid(bouquet).get(channel) };
  }
  const match =
    bouquet.find((c) => c.number === channel && c.sub_number === 0) ||
    bouquet.find((c) => c.number === channel);
  if (!match) {
    return { error: `No channel number ${channel} in the Freebox TV bouquet. Use freebox_tv_channels.` };
  }
  return { uuid: match.uuid, number: match.number };
}

function formatProgramLine(p: TvProgram, withDay = false): string {
  const end = p.date + (p.duration || 0);
  const sub = p.sub_title ? ` — ${sanitizeDisplay(p.sub_title)}` : "";
  const cat = p.category_name ? ` [${sanitizeDisplay(p.category_name, 40)}]` : "";
  const day = withDay ? `${formatDay(p.date)} ` : "";
  return `- ${day}${formatTime(p.date)}–${formatTime(end)} **${sanitizeDisplay(p.title)}**${sub}${cat} (id: ${sanitizeDisplay(p.id, 40)})`;
}

export function registerTvTools(server: McpServer): void {
  // Channel list
  server.registerTool(
    "freebox_tv_channels",
    {
      title: "List TV Channels",
      description: `List the channels of the Freebox TV bouquet with their number, name and UUID.
Use it to find a channel number for freebox_tv_epg or freebox_player_open.
Requires 'tv' permission.

Args:
  - query (string, optional): case-insensitive filter on the channel name.
  - include_unavailable (boolean, optional): also list channels not included in the subscription (default false).
  - limit (number, optional): maximum number of channels, 1-500 (default 100).

Returns: number (with sub-number for regional variants), name and UUID, sorted by number.`,
      inputSchema: {
        query: z.string().max(100).optional().describe("Filter on the channel name"),
        include_unavailable: z.boolean().optional().describe("Include channels outside the subscription"),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum channels (default 100)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { query?: string; include_unavailable?: boolean; limit?: number }) => {
      try {
        const [bouquet, channels] = await Promise.all([getBouquetChannels(), getChannels()]);
        if (typeof bouquet === "string") return errorResult(bouquet);
        if (typeof channels === "string") return errorResult(channels);
        const query = params.query?.toLowerCase();
        const rows = bouquet
          .filter((c) => params.include_unavailable || c.available)
          .map((c) => ({ ...c, name: channels[c.uuid]?.name || c.uuid }))
          .filter((c) => !query || c.name.toLowerCase().includes(query))
          .sort((a, b) => a.number - b.number || a.sub_number - b.sub_number);
        if (rows.length === 0) return textResult("No matching channel.");
        const limit = params.limit ?? 100;
        const lines = rows
          .slice(0, limit)
          .map(
            (c) =>
              `- **${c.number}${c.sub_number ? `.${c.sub_number}` : ""}** ${sanitizeDisplay(c.name)} (${c.uuid})${c.available ? "" : " — not in subscription"}`
          );
        const more = rows.length > limit ? `\n\n…${rows.length - limit} more, refine with 'query' or raise 'limit'.` : "";
        return textResult(`## Freebox TV channels (${rows.length})\n\n${lines.join("\n")}${more}`);
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Guide of one channel
  server.registerTool(
    "freebox_tv_epg",
    {
      title: "Get TV Guide for a Channel",
      description: `Get the TV guide (EPG) of one channel over a time window. The guide covers about the next 10 days.
Requires 'tv' permission.

Args:
  - channel (number | string): channel number (e.g. 2) or UUID (uuid-webtv-201).
  - from (string, optional): start of the window, ISO 8601 (default now; French time when no offset is given).
  - hours (number, optional): length of the window, 1-24 (default 6).

Returns: programs with start–end (French time), title, subtitle, category and program id (for freebox_tv_program).`,
      inputSchema: {
        channel: channelSchema,
        from: timeSchema.optional(),
        hours: z.number().int().min(1).max(24).optional().describe("Window length in hours (default 6)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { channel: number | string; from?: string; hours?: number }) => {
      try {
        const from = parseTime(params.from);
        if (typeof from === "string") return errorResult(`Error: ${from}`);
        const to = from + (params.hours ?? 6) * 3600;
        const target = await resolveChannel(params.channel);
        if ("error" in target) return errorResult(target.error);

        const programs = new Map<string, TvProgram>();
        const firstSlot = Math.floor(from / EPG_SLOT_SECONDS) * EPG_SLOT_SECONDS;
        for (let slot = firstSlot; slot < to; slot += EPG_SLOT_SECONDS) {
          const response = await freeboxClient.apiRequest<Record<string, TvProgram>>(
            `tv/epg/by_channel/${target.uuid}/${slot}`
          );
          if (!response.success) {
            return errorResult(`Error: ${response.msg || response.error_code}`);
          }
          for (const p of Object.values(response.result || {})) {
            if (p.date < to && p.date + (p.duration || 0) > from) programs.set(p.id, p);
          }
        }
        const list = [...programs.values()].sort((a, b) => a.date - b.date);
        const label = target.number !== undefined ? `channel ${target.number}` : target.uuid;
        if (list.length === 0) return textResult(`No program found on ${label} in this window.`);
        const multiDay = formatDay(list[0].date) !== formatDay(list[list.length - 1].date);
        return textResult(
          `## TV guide — ${label}, ${formatDay(from)} ${formatTime(from)}–${formatTime(to)}\n\n` +
            list.map((p) => formatProgramLine(p, multiDay)).join("\n")
        );
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // What is on at a given time, across channels
  server.registerTool(
    "freebox_tv_on_air",
    {
      title: "Get Programs On Air",
      description: `Get what is on air at a given time on the main channels (e.g. "what's on TV tonight at 21:00").
Requires 'tv' permission.

Args:
  - at (string, optional): ISO 8601 date-time (default now; French time when no offset is given).
  - channels (number[], optional): channel numbers to include (max 50). Default: channels 1 to max_number.
  - max_number (number, optional): highest channel number when 'channels' is not given, 1-999 (default 30).

Returns: for each channel, the program on air at that time (start–end, title, category, program id).`,
      inputSchema: {
        at: timeSchema.optional(),
        channels: z.array(z.number().int().min(0).max(9999)).max(50).optional().describe("Channel numbers"),
        max_number: z.number().int().min(1).max(999).optional().describe("Highest channel number (default 30)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { at?: string; channels?: number[]; max_number?: number }) => {
      try {
        const at = parseTime(params.at);
        if (typeof at === "string") return errorResult(`Error: ${at}`);
        const [bouquet, channels, epg] = await Promise.all([
          getBouquetChannels(),
          getChannels(),
          freeboxClient.apiRequest<Record<string, Record<string, TvProgram>>>(`tv/epg/by_time/${at}`),
        ]);
        if (typeof bouquet === "string") return errorResult(bouquet);
        if (typeof channels === "string") return errorResult(channels);
        if (!epg.success) return errorResult(`Error: ${epg.msg || epg.error_code}`);

        const wanted = params.channels
          ? (n: number) => params.channels!.includes(n)
          : (n: number) => n >= 1 && n <= (params.max_number ?? 30);
        const numbers = numbersByUuid(bouquet.filter((c) => c.available));
        const rows: string[] = [];
        for (const [uuid, number] of [...numbers.entries()].sort((a, b) => a[1] - b[1])) {
          if (!wanted(number)) continue;
          const onAir = Object.values(epg.result?.[uuid] || {}).find(
            (p) => p.date <= at && at < p.date + (p.duration || 0)
          );
          const name = sanitizeDisplay(channels[uuid]?.name || uuid);
          rows.push(
            onAir
              ? `### ${number} ${name}\n${formatProgramLine(onAir)}`
              : `### ${number} ${name}\n- (no guide data)`
          );
        }
        if (rows.length === 0) return textResult("No matching channel.");
        return textResult(`## On air — ${formatDay(at)} ${formatTime(at)}\n\n${rows.join("\n")}`);
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Program details
  server.registerTool(
    "freebox_tv_program",
    {
      title: "Get TV Program Details",
      description: `Get the details of a TV program: description, cast, season/episode.
Requires 'tv' permission.

Args:
  - id (string): program id, as returned by freebox_tv_epg or freebox_tv_on_air.`,
      inputSchema: {
        id: z
          .string()
          .max(100)
          .regex(/^[A-Za-z0-9_.-]+$/, "Invalid program id")
          .describe("Program id"),
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
        const response = await freeboxClient.apiRequest<TvProgram>(
          `tv/epg/programs/${encodeURIComponent(params.id)}`
        );
        if (!response.success || !response.result) {
          return errorResult(`Error: ${response.msg || response.error_code}`);
        }
        const p = response.result;
        const episode =
          p.season_number || p.episode_number
            ? `S${p.season_number ?? "?"}E${p.episode_number ?? "?"}`
            : "";
        const cast = (p.cast || [])
          .slice(0, 15)
          .map((c) => `${sanitizeDisplay(`${c.first_name || ""} ${c.last_name || ""}`.trim())}${c.job ? ` (${sanitizeDisplay(c.job, 40)}${c.role ? `: ${sanitizeDisplay(c.role, 60)}` : ""})` : ""}`)
          .join(", ");
        const lines = [
          `## ${sanitizeDisplay(p.title)}${p.sub_title ? ` — ${sanitizeDisplay(p.sub_title)}` : ""}`,
          p.date ? `- **When**: ${formatDay(p.date)} ${formatTime(p.date)}–${formatTime(p.date + (p.duration || 0))}` : "",
          p.category_name ? `- **Category**: ${sanitizeDisplay(p.category_name, 40)}` : "",
          episode ? `- **Episode**: ${episode}` : "",
          p.year ? `- **Year**: ${p.year}` : "",
          cast ? `- **Cast**: ${cast}` : "",
          p.desc || p.short_desc ? `\n${sanitizeDisplay(p.desc || p.short_desc, 1500)}` : "",
        ];
        return textResult(lines.filter(Boolean).join("\n"));
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );
}
