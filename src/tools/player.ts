import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { Player, PlayerStatus, PlayerVolume } from "../types.js";

// The player API is proxied by the Freebox Server: /player/{id}/api/v{N}/...
// where N is the player's own API version (not the server's). Players that do
// not report one (e.g. the Revolution player, fbx6hd) speak v6.
const DEFAULT_PLAYER_API_VERSION = "6";

const MEDIA_COMMANDS = [
  "play_pause",
  "stop",
  "prev",
  "next",
  "select_stream",
  "select_audio_track",
  "select_srt_track",
] as const;

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
  if (!player.api_available) {
    return { error: `Player ${id} (${player.device_model || player.device_name}) does not expose the player API.` };
  }
  if (!player.reachable) {
    return {
      error: `Player ${id} is not reachable (switched off or in deep standby). Switch it on with its remote control, then retry.`,
    };
  }
  const version =
    (player.api_version || "").split(".")[0] || DEFAULT_PLAYER_API_VERSION;
  return { base: `player/${id}/api/v${version}/` };
}

function formatPlayer(p: Player): string {
  return [
    `- **${p.id}** — ${p.device_name}${p.device_model ? ` (${p.device_model}, ${p.stb_type})` : ""}`,
    `  Reachable: ${p.reachable ? "🟢 yes" : "⚫ no"} | API: ${p.api_available ? `✅ v${p.api_version || DEFAULT_PLAYER_API_VERSION}` : "❌ unavailable"}`,
    p.mac ? `  MAC: ${p.mac}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function registerPlayerTools(server: McpServer): void {
  // List players
  server.registerTool(
    "freebox_player_list",
    {
      title: "List Freebox Players",
      description: `List the Freebox Players (TV boxes) known by the Freebox Server.
Requires the 'Contrôle du Freebox Player' permission, which must be granted by hand in Freebox OS (Paramètres > Gestion des accès > Applications).

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
      description: `Get the state of a Freebox Player: power state, active media player and its capabilities (which freebox_player_media_control commands are available), foreground application.

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
        const lines = [
          `## Player ${params.id} status`,
          `- **Power**: ${s.power_state || "unknown"}`,
          s.player?.name ? `- **Active media player**: ${s.player.name}` : "",
          `- **Capabilities**: ${caps}`,
          s.foreground_app?.package
            ? `- **Foreground app**: ${s.foreground_app.package}${s.foreground_app.cur_url ? ` (${s.foreground_app.cur_url})` : ""}`
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

Args:
  - id (number): Player ID (from freebox_player_list).
  - cmd (string): ${MEDIA_COMMANDS.join(" | ")}.`,
      inputSchema: {
        id: playerIdSchema,
        cmd: z.enum(MEDIA_COMMANDS).describe("Media command"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: { id: number; cmd: (typeof MEDIA_COMMANDS)[number] }) => {
      try {
        const target = await playerBase(params.id);
        if ("error" in target) return errorResult(target.error);
        const response = await freeboxClient.apiRequest(
          `${target.base}control/mediactrl/`,
          "POST",
          { cmd: params.cmd }
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
