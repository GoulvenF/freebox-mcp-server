import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { Player, PlayerStatus, PlayerTrack, PlayerVolume } from "../types.js";
import { sanitizeDisplay } from "../utils/sanitize.js";

// The player API is proxied by the Freebox Server: /player/{id}/api/v{N}/...
// where N is the player's own API version (not the server's). Players that do
// not report one (e.g. the Revolution player, fbx6hd, while switched off)
// speak v6.
const DEFAULT_PLAYER_API_VERSION = "6";

const MEDIA_COMMANDS = [
  "play",
  "pause",
  "play_pause",
  "stop",
  "prev",
  "next",
  "seek_forward",
  "seek_backward",
  "seek_to",
  "repeat_all",
  "repeat_one",
  "repeat_off",
  "repeat_toggle",
  "shuffle_on",
  "shuffle_off",
  "shuffle_toggle",
  "record",
  "record_stop",
  "start_over",
  "select_stream",
  "select_audio_track",
  "select_srt_track",
] as const;
type MediaCommand = (typeof MEDIA_COMMANDS)[number];

type MediaControlArgs =
  | { type: "seek_position"; seek_position: number }
  | { type: "track_id"; track_id: number }
  | { type: "stream"; stream: { quality: string; source: string } };

// tv: opens the TV app, http(s): opens the video player, the browser or YouTube
// depending on the URL/type. Anything else is refused.
const OPEN_URL_PATTERN = /^(tv:\?channel=\d{1,4}|https?:\/\/\S+)$/;

const playerIdSchema = z
  .number()
  .int()
  .min(0)
  .describe("Player ID, as returned by freebox_player_list");

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

/**
 * Resolve the base path of a player's API, checking it is reachable first:
 * an unreachable (switched off / deep standby) player makes the server answer
 * with an HTML 504 instead of a JSON error.
 */
async function playerBase(
  id: number
): Promise<{ base: string } | { error: string }> {
  const response = await freeboxClient.apiRequest<Player[]>("player/");
  if (!response.success) {
    return { error: `Error: ${response.msg || response.error_code}` };
  }
  const player = (response.result || []).find((p) => p.id === id);
  if (!player) {
    return { error: `No player found with ID ${id}. Use freebox_player_list.` };
  }
  // Reachability first: a switched-off player may still be listed with
  // api_available, and "switch it on" is the actionable message.
  if (!player.reachable) {
    return {
      error: `Player ${id} is not reachable (switched off or in deep standby). Switch it on with its remote control, then retry.`,
    };
  }
  if (!player.api_available) {
    return {
      error: `Player ${id} (${sanitizeDisplay(player.device_model || player.device_name)}) does not expose the player API.`,
    };
  }
  return { base: `player/${id}/api/v${playerApiVersion(player)}/` };
}

/** Major version of the player's own API, as used in the request path. */
function playerApiVersion(p: Player): string {
  return (p.api_version || "").split(".")[0] || DEFAULT_PLAYER_API_VERSION;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
}

/** One line per track, with the uid that select_audio_track / select_srt_track take. */
function formatTracks(label: string, tracks: PlayerTrack[] | undefined, current: number | undefined): string {
  if (!tracks || tracks.length === 0) return "";
  const items = tracks.map(
    (t) =>
      `${t.uid === current ? "▶ " : ""}${t.uid}: ${sanitizeDisplay(t.language, 10) || "?"}${t.type ? ` (${sanitizeDisplay(t.type, 30)})` : ""}`
  );
  return `- **${label}** (track_id): ${items.join(", ")}`;
}

function formatPlayer(p: Player): string {
  const model = p.device_model
    ? ` (${sanitizeDisplay(p.device_model)}${p.stb_type ? `, ${sanitizeDisplay(p.stb_type)}` : ""})`
    : "";
  return [
    `- **${p.id}** — ${sanitizeDisplay(p.device_name)}${model}`,
    `  Reachable: ${p.reachable ? "🟢 yes" : "⚫ no"} | API: ${p.api_available ? `✅ v${playerApiVersion(p)}` : "❌ unavailable"}`,
    p.mac ? `  MAC: ${sanitizeDisplay(p.mac)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the 'args' object a media command needs, or an error message.
 * Only seek_to and the select_* commands take arguments.
 */
function mediaControlArgs(params: {
  cmd: MediaCommand;
  seek_position?: number;
  track_id?: number;
  stream_quality?: string;
  stream_source?: string;
}): MediaControlArgs | undefined | string {
  const hasSeek = params.seek_position !== undefined;
  const hasTrack = params.track_id !== undefined;
  const hasStream =
    params.stream_quality !== undefined || params.stream_source !== undefined;
  switch (params.cmd) {
    case "seek_to":
      if (!hasSeek) return "seek_to needs 'seek_position'.";
      if (hasTrack || hasStream) break;
      return { type: "seek_position", seek_position: params.seek_position! };
    case "select_audio_track":
    case "select_srt_track":
      if (!hasTrack) return `${params.cmd} needs 'track_id'.`;
      if (hasSeek || hasStream) break;
      return { type: "track_id", track_id: params.track_id! };
    case "select_stream":
      if (!hasStream) return "select_stream needs 'stream_quality' and/or 'stream_source'.";
      if (hasSeek || hasTrack) break;
      return {
        type: "stream",
        stream: {
          quality: params.stream_quality ?? "",
          source: params.stream_source ?? "",
        },
      };
    default:
      if (!hasSeek && !hasTrack && !hasStream) return undefined;
      return `${params.cmd} takes no argument.`;
  }
  return `only the argument of ${params.cmd} is accepted.`;
}

export function registerPlayerTools(server: McpServer): void {
  // List players
  server.registerTool(
    "freebox_player_list",
    {
      title: "List Freebox Players",
      description: `List the Freebox Players (TV boxes) known by the Freebox Server.
Requires 'player' permission ("Contrôle du Freebox Player", to be granted by hand in Freebox OS: Paramètres > Gestion des accès > Applications).

Returns: id, name, model, reachability and player API version of each player.`,
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
        const response = await freeboxClient.apiRequest<Player[]>("player/");
        if (!response.success) {
          return errorResult(`Error: ${response.msg || response.error_code}`);
        }
        const players = response.result || [];
        if (players.length === 0) {
          return textResult("No Freebox Player found.");
        }
        return textResult(
          `## Freebox Players (${players.length})\n\n${players.map(formatPlayer).join("\n")}`
        );
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Player status
  server.registerTool(
    "freebox_player_status",
    {
      title: "Get Player Status",
      description: `Get the state of a Freebox Player: power state, active media player, playback state and position, its capabilities (which freebox_player_media_control commands are available), audio and subtitle tracks (track_id for select_audio_track / select_srt_track), foreground application.
Requires 'player' permission.

Args:
  - id (number): Player ID (from freebox_player_list).`,
      inputSchema: { id: playerIdSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number }) => {
      try {
        const target = await playerBase(params.id);
        if ("error" in target) return errorResult(target.error);
        const response = await freeboxClient.apiRequest<PlayerStatus>(
          `${target.base}status/`
        );
        if (!response.success || !response.result) {
          return errorResult(`Error: ${response.msg || response.error_code}`);
        }
        const s = response.result;
        const caps = s.player?.capabilities
          ? Object.entries(s.player.capabilities)
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join(", ") || "none"
          : "unknown";
        // Everything below comes from the player (app names, the URL being
        // shown): sanitize it, it is attacker-influenced content.
        const app = s.foreground_app;
        const state = s.player?.state;
        const media = app?.context?.player;
        const lines = [
          `## Player ${params.id} status`,
          `- **Power**: ${sanitizeDisplay(s.power_state) || "unknown"}`,
          s.player?.name ? `- **Active media player**: ${sanitizeDisplay(s.player.name)}` : "",
          state?.playback_state
            ? `- **Playback**: ${sanitizeDisplay(state.playback_state, 20)}${state.position_ms !== undefined && state.duration_ms ? ` (${formatDuration(state.position_ms)} / ${formatDuration(state.duration_ms)})` : ""}`
            : "",
          `- **Capabilities**: ${sanitizeDisplay(caps, 500)}`,
          formatTracks("Audio tracks", media?.audioList, media?.audioIndex),
          formatTracks("Subtitles", media?.subtitleList, media?.subtitleIndex),
          app?.package
            ? `- **Foreground app**: ${sanitizeDisplay(app.package)}${app.cur_url ? ` (${sanitizeDisplay(app.cur_url, 200)})` : ""}`
            : "",
        ];
        return textResult(lines.filter(Boolean).join("\n"));
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Get volume
  server.registerTool(
    "freebox_player_volume_get",
    {
      title: "Get Player Volume",
      description: `Get the playback volume (0-100) and mute state of a Freebox Player.
Requires 'player' permission.

Args:
  - id (number): Player ID (from freebox_player_list).`,
      inputSchema: { id: playerIdSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number }) => {
      try {
        const target = await playerBase(params.id);
        if ("error" in target) return errorResult(target.error);
        const response = await freeboxClient.apiRequest<PlayerVolume>(
          `${target.base}control/volume/`
        );
        if (!response.success || !response.result) {
          return errorResult(`Error: ${response.msg || response.error_code}`);
        }
        const v = response.result;
        return textResult(
          `🔊 Player ${params.id}: volume ${v.volume}${v.mute ? " (🔇 muted)" : ""}`
        );
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Set volume / mute
  server.registerTool(
    "freebox_player_volume_set",
    {
      title: "Set Player Volume",
      description: `Set the playback volume and/or mute state of a Freebox Player.
Some players (e.g. the Revolution player with HDMI-CEC volume control) refuse absolute volume changes with 'notsupp'; mute usually still works.
Requires 'player' permission.

Args:
  - id (number): Player ID (from freebox_player_list).
  - volume (number, optional): 0-100.
  - mute (boolean, optional): true to mute, false to unmute.`,
      inputSchema: {
        id: playerIdSchema,
        volume: z.number().int().min(0).max(100).optional().describe("Volume, 0-100"),
        mute: z.boolean().optional().describe("Mute (true) or unmute (false)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number; volume?: number; mute?: boolean }) => {
      try {
        if (params.volume === undefined && params.mute === undefined) {
          return errorResult("Error: give at least one of 'volume' or 'mute'.");
        }
        const target = await playerBase(params.id);
        if ("error" in target) return errorResult(target.error);
        const body: Partial<PlayerVolume> = {};
        if (params.volume !== undefined) body.volume = params.volume;
        if (params.mute !== undefined) body.mute = params.mute;
        const response = await freeboxClient.apiRequest<PlayerVolume>(
          `${target.base}control/volume/`,
          "PUT",
          body
        );
        if (!response.success) {
          return errorResult(`Error: ${response.msg || response.error_code}`);
        }
        // The PUT answer carries the state from before the change, and the
        // player applies it asynchronously: poll briefly until it matches.
        let v: PlayerVolume | undefined;
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          const after = await freeboxClient.apiRequest<PlayerVolume>(
            `${target.base}control/volume/`
          );
          v = after.success ? after.result : undefined;
          if (
            v &&
            (body.volume === undefined || v.volume === body.volume) &&
            (body.mute === undefined || v.mute === body.mute)
          ) {
            break;
          }
        }
        return textResult(
          v
            ? `🔊 Player ${params.id}: volume ${v.volume}${v.mute ? " (🔇 muted)" : ""}`
            : `🔊 Player ${params.id}: volume change sent (not confirmed yet).`
        );
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Media control
  server.registerTool(
    "freebox_player_media_control",
    {
      title: "Control Player Media",
      description: `Send a command to the active media player of a Freebox Player (live TV, video player...).
Check which commands are available with freebox_player_status (capabilities).
Requires 'player' permission.

Args:
  - id (number): Player ID (from freebox_player_list).
  - cmd (string): ${MEDIA_COMMANDS.join(" | ")}.
  - seek_position (number, seek_to only): position to seek to, in seconds.
  - track_id (number, select_audio_track / select_srt_track only): track ID.
  - stream_quality, stream_source (string, select_stream only): stream to select.`,
      inputSchema: {
        id: playerIdSchema,
        cmd: z.enum(MEDIA_COMMANDS).describe("Media command"),
        seek_position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("seek_to: position in seconds"),
        track_id: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("select_audio_track / select_srt_track: track ID"),
        stream_quality: z
          .string()
          .max(50)
          .optional()
          .describe("select_stream: stream quality (e.g. hd, sd, ld, auto)"),
        stream_source: z
          .string()
          .max(50)
          .optional()
          .describe("select_stream: stream source"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      id: number;
      cmd: MediaCommand;
      seek_position?: number;
      track_id?: number;
      stream_quality?: string;
      stream_source?: string;
    }) => {
      try {
        const args = mediaControlArgs(params);
        if (typeof args === "string") return errorResult(`Error: ${args}`);
        const target = await playerBase(params.id);
        if ("error" in target) return errorResult(target.error);
        const response = await freeboxClient.apiRequest(
          `${target.base}control/mediactrl/`,
          "POST",
          args ? { cmd: params.cmd, args } : { cmd: params.cmd }
        );
        if (!response.success) {
          return errorResult(`Error: ${response.msg || response.error_code}`);
        }
        return textResult(`▶️ Player ${params.id}: '${params.cmd}' sent.`);
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );

  // Open a channel or URL
  server.registerTool(
    "freebox_player_open",
    {
      title: "Open Channel or URL on Player",
      description: `Open a TV channel or a URL on a Freebox Player (switches what is shown on the TV).
Give either 'channel' (opens live TV on that channel number) or 'url':
  - http(s) media URL (with 'type', e.g. video/x-matroska) opens the video player;
  - YouTube URL opens YouTube;
  - http(s) page with type text/html opens the web browser.
URLs are opened by the player itself, so local network media URLs (e.g. a NAS) are allowed.
Requires 'player' permission.

Args:
  - id (number): Player ID (from freebox_player_list).
  - channel (number, optional): TV channel number (e.g. 2 for France 2).
  - url (string, optional): tv:?channel=N or an http(s) URL.
  - type (string, optional): MIME type hint for url (e.g. video/mp4, text/html).`,
      inputSchema: {
        id: playerIdSchema,
        channel: z.number().int().min(0).max(9999).optional().describe("TV channel number"),
        url: z
          .string()
          .max(2048)
          .regex(OPEN_URL_PATTERN, "URL must be tv:?channel=N or http(s)://...")
          .optional()
          .describe("tv:?channel=N or http(s) URL"),
        type: z
          .string()
          .max(100)
          .regex(/^[a-z]+\/[a-z0-9.+-]+$/i, "Invalid MIME type")
          .optional()
          .describe("MIME type hint for url"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number; channel?: number; url?: string; type?: string }) => {
      try {
        if ((params.channel === undefined) === (params.url === undefined)) {
          return errorResult("Error: give exactly one of 'channel' or 'url'.");
        }
        if (params.channel !== undefined && params.type) {
          return errorResult("Error: 'type' only applies to 'url'.");
        }
        const target = await playerBase(params.id);
        if ("error" in target) return errorResult(target.error);
        const url =
          params.channel !== undefined ? `tv:?channel=${params.channel}` : params.url!;
        const body: { url: string; type?: string } = { url };
        if (params.type) body.type = params.type;
        const response = await freeboxClient.apiRequest(
          `${target.base}control/open/`,
          "POST",
          body
        );
        if (!response.success) {
          return errorResult(`Error: ${response.msg || response.error_code}`);
        }
        return textResult(`📺 Player ${params.id}: opened ${url}.`);
      } catch (error: unknown) {
        return catchError(error);
      }
    }
  );
}
