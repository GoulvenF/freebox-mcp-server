import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { DownloadTask } from "../types.js";
import { sanitizeDisplay } from "../utils/sanitize.js";

/**
 * Reject URLs pointing at the Freebox itself or at other hosts on the private
 * network — the Freebox downloader runs inside the LAN, so an attacker-supplied
 * URL would otherwise turn this tool into an SSRF pivot.
 *
 * NOTE: this covers IP literals only. A hostname that *resolves* to a private
 * address cannot be reliably blocked client-side without doing the DNS
 * resolution here and pinning it (and even then, DNS rebinding remains
 * possible). Literal IPs are the main practical vector, so that is what is
 * enforced.
 */
function isPrivateHost(hostname: string): boolean {
  // Strip IPv6 brackets, normalise case.
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost")) return true;

  // IPv4 literal
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }

  // IPv6 literal
  if (host.includes(":")) {
    if (host === "::1" || host === "::") return true; // loopback / unspecified
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // fe80::/10 link-local
    // IPv4-mapped (::ffff:127.0.0.1)
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
    if (mapped) return isPrivateHost(mapped[1]);
    return false;
  }

  return false;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return "N/A";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

export function registerDownloadTools(server: McpServer): void {
  // List downloads
  server.registerTool(
    "freebox_downloads_list",
    {
      title: "List Downloads",
      description: `List all download tasks on the Freebox (torrents, HTTP, FTP, NZB).
Shows name, status, progress, speed, and ETA.

Returns: Formatted list of download tasks with id, name, status, size, progress (rx_pct), speeds (rx_rate, tx_rate), eta.`,
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
          await freeboxClient.apiRequest<DownloadTask[]>("downloads/");
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
        const tasks = response.result || [];
        if (tasks.length === 0) {
          return {
            content: [{ type: "text", text: "No download tasks." }],
          };
        }
        const lines = tasks.map((t) => {
          const progress = t.rx_pct / 100;
          return [
            `- **${sanitizeDisplay(t.name)}** (ID: ${t.id})`,
            `  Type: ${t.type} | Status: ${t.status} | Progress: ${progress.toFixed(1)}%`,
            `  Size: ${formatBytes(t.size)} | ↓ ${formatBytes(t.rx_rate)}/s | ↑ ${formatBytes(t.tx_rate)}/s`,
            `  ETA: ${formatEta(t.eta)}${t.error !== "none" ? ` | Error: ${t.error}` : ""}`,
          ].join("\n");
        });
        return {
          content: [
            {
              type: "text",
              text: `## Downloads (${tasks.length})\n\n${lines.join("\n\n")}`,
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

  // Get specific download
  server.registerTool(
    "freebox_download_get",
    {
      title: "Get Download Details",
      description: `Get detailed information about a specific download task.

Args:
  - id (number): Download task ID (get from freebox_downloads_list).

Returns: Full download task details as JSON.`,
      inputSchema: {
        id: z.number().int().describe("Download task ID"),
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
        const response = await freeboxClient.apiRequest<DownloadTask>(
          `downloads/${params.id}`
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
        const t = response.result!;
        // Explicit allowlist: the raw task object can carry the source URL
        // (which may embed HTTP/FTP credentials) and other tracker metadata.
        const safe = {
          id: t.id,
          type: t.type,
          name: sanitizeDisplay(t.name, 200),
          status: t.status,
          io_priority: t.io_priority,
          size: t.size,
          queue_pos: t.queue_pos,
          rx_bytes: t.rx_bytes,
          tx_bytes: t.tx_bytes,
          rx_rate: t.rx_rate,
          tx_rate: t.tx_rate,
          rx_pct: t.rx_pct,
          tx_pct: t.tx_pct,
          eta: t.eta,
          error: t.error,
          created_ts: t.created_ts,
          download_dir: t.download_dir,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(safe, null, 2) }],
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

  // Add download by URL
  server.registerTool(
    "freebox_download_add",
    {
      title: "Add Download",
      description: `Add a new download task to the Freebox downloader.
Supports HTTP/FTP URLs and magnet links. For torrent files, use the file upload API.
Requires 'downloader' permission.

Args:
  - download_url (string): URL to download (HTTP, FTP, or magnet link)
  - download_dir (string, optional): Destination directory (base64-encoded path on Freebox storage). If omitted, uses default directory.
  - filename (string, optional): Override the filename.
  - hash (string, optional): Expected hash for verification.
  - recursive (boolean, optional): Download recursively (for HTTP).`,
      inputSchema: {
        download_url: z
          .string()
          .refine(
            (value) => {
              if (value.toLowerCase().startsWith("magnet:")) return true;
              let parsed: URL;
              try {
                parsed = new URL(value);
              } catch {
                return false;
              }
              if (!["http:", "https:", "ftp:"].includes(parsed.protocol)) {
                return false;
              }
              return !isPrivateHost(parsed.hostname);
            },
            {
              message:
                "URL invalide : seuls les schémas magnet:, http:, https: et ftp: sont acceptés, et les adresses privées / loopback / link-local sont refusées (risque de SSRF vers votre réseau local).",
            }
          )
          .describe("URL to download (HTTP, FTP, magnet)"),
        download_dir: z
          .string()
          .optional()
          .describe("Destination directory (base64-encoded path)"),
        filename: z.string().optional().describe("Override filename"),
        hash: z.string().optional().describe("Expected hash"),
        recursive: z.boolean().optional().describe("Recursive download"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      download_url: string;
      download_dir?: string;
      filename?: string;
      hash?: string;
      recursive?: boolean;
    }) => {
      try {
        const body: Record<string, unknown> = {
          download_url: params.download_url,
        };
        if (params.download_dir) body.download_dir = params.download_dir;
        if (params.filename) body.filename = params.filename;
        if (params.hash) body.hash = params.hash;
        if (params.recursive !== undefined) body.recursive = params.recursive;

        const response = await freeboxClient.apiRequest<{ id: number }>(
          "downloads/add",
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
              text: `Download added (ID: ${response.result?.id}).\n\n${JSON.stringify(response.result, null, 2)}`,
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

  // Control download (pause, resume, delete)
  server.registerTool(
    "freebox_download_control",
    {
      title: "Control Download",
      description: `Control a download task: update status (pause/resume/retry) or delete it.
Requires 'downloader' permission.

Args:
  - id (number): Download task ID.
  - action (string): One of "pause" (set status to stopped), "resume" (set status to downloading), "retry" (retry failed), "delete" (remove task), "delete_with_files" (remove task and files).`,
      inputSchema: {
        id: z.number().int().describe("Download task ID"),
        action: z
          .enum(["pause", "resume", "retry", "delete", "delete_with_files"])
          .describe("Action to perform"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number; action: string }) => {
      try {
        if (
          params.action === "delete" ||
          params.action === "delete_with_files"
        ) {
          const deleteFiles = params.action === "delete_with_files";
          const url = deleteFiles
            ? `downloads/${params.id}/erase`
            : `downloads/${params.id}`;
          const response = await freeboxClient.apiRequest(url, "DELETE");
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
                text: `Download ${params.id} deleted${deleteFiles ? " with files" : ""}.`,
              },
            ],
          };
        }

        // Map action to API status
        const statusMap: Record<string, string> = {
          pause: "stopped",
          resume: "downloading",
          retry: "retry",
        };
        const response = await freeboxClient.apiRequest<DownloadTask>(
          `downloads/${params.id}`,
          "PUT",
          { status: statusMap[params.action] }
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
              text: `Download ${params.id} ${params.action}d.`,
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
