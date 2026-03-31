import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { DownloadTask } from "../types.js";

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
            `- **${t.name}** (ID: ${t.id})`,
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
        return {
          content: [
            { type: "text", text: JSON.stringify(response.result, null, 2) },
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
