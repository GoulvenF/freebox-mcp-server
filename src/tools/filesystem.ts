import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type { FsTask } from "../types.js";
import { sanitizeDisplay } from "../utils/sanitize.js";

/**
 * Baseline traversal guard + optional confinement to a set of allowed roots.
 *
 * `FREEBOX_FS_ALLOWED_ROOTS` (comma-separated absolute paths) is opt-in: when
 * unset, only the unconditional ".." rejection applies, so existing setups keep
 * working. Throws on violation.
 */
function assertPathAllowed(path: string, label = "path"): void {
  if (path.includes("..")) {
    throw new Error(
      `Refusé : le ${label} "${sanitizeDisplay(path)}" contient "..", ce qui permettrait de sortir du répertoire visé.`
    );
  }

  const raw = process.env.FREEBOX_FS_ALLOWED_ROOTS;
  if (!raw) return;

  const roots = raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => (r.endsWith("/") ? r : `${r}/`));
  if (roots.length === 0) return;

  const normalized = path.endsWith("/") ? path : `${path}/`;
  const allowed = roots.some((root) => normalized.startsWith(root));
  if (!allowed) {
    throw new Error(
      `Refusé : le ${label} "${sanitizeDisplay(path)}" est hors des racines autorisées par FREEBOX_FS_ALLOWED_ROOTS (${roots.join(", ")}).`
    );
  }
}

function toBase64(path: string): string {
  return Buffer.from(path, "utf-8").toString("base64");
}

function fromBase64(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf-8");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

interface FsEntry {
  path: string;
  name: string;
  type: string;
  size: number;
  modification: number;
  mimetype?: string;
  index?: number;
  link?: boolean;
  hidden?: boolean;
}

export function registerFilesystemTools(server: McpServer): void {
  // List files in a directory
  server.registerTool(
    "freebox_fs_list",
    {
      title: "List Files",
      description: `List files and directories on the Freebox storage.
Paths are regular filesystem paths (e.g., "/Disque dur/Photos"). They will be automatically base64-encoded as required by the API.
Requires 'explorer' permission.

Args:
  - path (string): Directory path (e.g., "/Disque dur/" or "/Freebox/").
  - show_hidden (boolean, optional): Show hidden files (default: false).

Returns: List of files with name, type (dir/file), size, and modification date.`,
      inputSchema: {
        path: z
          .string()
          .default("/")
          .describe('Directory path (e.g., "/Disque dur/")'),
        show_hidden: z
          .boolean()
          .default(false)
          .describe("Show hidden files"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { path: string; show_hidden: boolean }) => {
      try {
        assertPathAllowed(params.path);
        const b64Path = toBase64(params.path);
        const response = await freeboxClient.apiRequest<FsEntry[]>(
          `fs/ls/${b64Path}?onlyFolder=0&countSubFolder=0&removeHidden=${params.show_hidden ? 0 : 1}`
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
        const entries = response.result || [];
        if (entries.length === 0) {
          return {
            content: [
              { type: "text", text: `Directory "${params.path}" is empty.` },
            ],
          };
        }

        // Sort: dirs first, then by name
        const sorted = [...entries].sort((a, b) => {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        const lines = sorted.map((e) => {
          const icon = e.type === "dir" ? "📁" : "📄";
          const date = new Date(e.modification * 1000)
            .toISOString()
            .slice(0, 10);
          return `${icon} **${sanitizeDisplay(e.name)}** — ${e.type === "dir" ? "directory" : formatBytes(e.size)} — ${date}`;
        });

        return {
          content: [
            {
              type: "text",
              text: `## Files in ${params.path} (${entries.length} items)\n\n${lines.join("\n")}`,
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

  // Get file/dir info
  server.registerTool(
    "freebox_fs_info",
    {
      title: "Get File Info",
      description: `Get detailed information about a file or directory on the Freebox storage.
Requires 'explorer' permission.

Args:
  - path (string): File or directory path.

Returns: JSON with name, type, size, mimetype, modification timestamp, and other metadata.`,
      inputSchema: {
        path: z.string().describe("File or directory path"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { path: string }) => {
      try {
        assertPathAllowed(params.path);
        const b64Path = toBase64(params.path);
        const response = await freeboxClient.apiRequest<FsEntry>(
          `fs/info/${b64Path}`
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

  // Create directory
  server.registerTool(
    "freebox_fs_mkdir",
    {
      title: "Create Directory",
      description: `Create a new directory on the Freebox storage.
Requires 'explorer' permission.

Args:
  - parent (string): Parent directory path (e.g., "/Disque dur/").
  - dirname (string): Name of the new directory.`,
      inputSchema: {
        parent: z.string().describe("Parent directory path"),
        dirname: z.string().describe("New directory name"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { parent: string; dirname: string }) => {
      try {
        assertPathAllowed(params.parent, "parent");
        assertPathAllowed(params.dirname, "dirname");
        const response = await freeboxClient.apiRequest(
          `fs/mkdir/`,
          "POST",
          {
            parent: toBase64(params.parent),
            dirname: params.dirname,
          }
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
              text: `Directory "${params.dirname}" created in ${params.parent}.`,
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

  // Rename file/directory
  server.registerTool(
    "freebox_fs_rename",
    {
      title: "Rename File/Directory",
      description: `Rename a file or directory on the Freebox storage.
Requires 'explorer' permission.

Args:
  - src (string): Full path of the file/directory to rename.
  - dst (string): New name (just the filename, not the full path).`,
      inputSchema: {
        src: z.string().describe("Full path of file/directory to rename"),
        dst: z.string().describe("New name"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { src: string; dst: string }) => {
      try {
        assertPathAllowed(params.src, "src");
        assertPathAllowed(params.dst, "dst");
        const response = await freeboxClient.apiRequest(
          `fs/rename/`,
          "POST",
          {
            src: toBase64(params.src),
            dst: params.dst,
          }
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
              text: `Renamed successfully.`,
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

  // Move files
  server.registerTool(
    "freebox_fs_move",
    {
      title: "Move Files",
      description: `Move one or more files to a destination directory on the Freebox.
This creates an asynchronous task. Requires 'explorer' permission.

Args:
  - files (string[]): Array of file paths to move.
  - dst (string): Destination directory path.
  - mode (string, optional): Conflict mode: "overwrite", "skip", or "both" (default: "skip" — existing files are left untouched unless you explicitly ask for "overwrite").`,
      inputSchema: {
        files: z.array(z.string()).min(1).describe("File paths to move"),
        dst: z.string().describe("Destination directory path"),
        mode: z
          .enum(["overwrite", "skip", "both"])
          .default("skip")
          .describe("Conflict resolution mode"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: { files: string[]; dst: string; mode: string }) => {
      try {
        params.files.forEach((f) => assertPathAllowed(f, "chemin de fichier"));
        assertPathAllowed(params.dst, "dst");
        const response = await freeboxClient.apiRequest<FsTask>(
          `fs/mv/`,
          "POST",
          {
            files: params.files.map(toBase64),
            dst: toBase64(params.dst),
            mode: params.mode,
          }
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
              text: `Move task created (ID: ${response.result?.id}). State: ${response.result?.state}`,
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

  // Copy files
  server.registerTool(
    "freebox_fs_copy",
    {
      title: "Copy Files",
      description: `Copy one or more files to a destination directory on the Freebox.
This creates an asynchronous task. Requires 'explorer' permission.

Args:
  - files (string[]): Array of file paths to copy.
  - dst (string): Destination directory path.
  - mode (string, optional): Conflict mode: "overwrite", "skip", or "both" (default: "skip" — existing files are left untouched unless you explicitly ask for "overwrite").`,
      inputSchema: {
        files: z.array(z.string()).min(1).describe("File paths to copy"),
        dst: z.string().describe("Destination directory path"),
        mode: z
          .enum(["overwrite", "skip", "both"])
          .default("skip")
          .describe("Conflict resolution mode"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: { files: string[]; dst: string; mode: string }) => {
      try {
        params.files.forEach((f) => assertPathAllowed(f, "chemin de fichier"));
        assertPathAllowed(params.dst, "dst");
        const response = await freeboxClient.apiRequest<FsTask>(
          `fs/cp/`,
          "POST",
          {
            files: params.files.map(toBase64),
            dst: toBase64(params.dst),
            mode: params.mode,
          }
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
              text: `Copy task created (ID: ${response.result?.id}). State: ${response.result?.state}`,
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

  // Delete files
  server.registerTool(
    "freebox_fs_delete",
    {
      title: "Delete Files",
      description: `Delete one or more files from the Freebox storage.
This creates an asynchronous task. Requires 'explorer' permission.
WARNING: This permanently deletes files with no recycle bin.

Args:
  - files (string[]): Array of file paths to delete.
  - confirm (string): REQUIRED. Deletion is permanent and there is no recycle bin. To proceed, pass confirm="JE-CONFIRME-LA-SUPPRESSION".`,
      inputSchema: {
        files: z.array(z.string()).min(1).describe("File paths to delete"),
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
    async (params: { files: string[]; confirm?: string }) => {
      try {
        if (params.confirm !== "JE-CONFIRME-LA-SUPPRESSION") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: 'Refusé : cette action est sensible. La suppression est définitive et sans corbeille sur le stockage de la Freebox. Confirmez avec confirm="JE-CONFIRME-LA-SUPPRESSION".',
              },
            ],
          };
        }
        params.files.forEach((f) => assertPathAllowed(f, "chemin de fichier"));
        const response = await freeboxClient.apiRequest<FsTask>(
          `fs/rm/`,
          "POST",
          {
            files: params.files.map(toBase64),
          }
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
              text: `Delete task created (ID: ${response.result?.id}). State: ${response.result?.state}`,
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

  // Get task status
  server.registerTool(
    "freebox_fs_task",
    {
      title: "Get Filesystem Task Status",
      description: `Get the status of an asynchronous filesystem task (move, copy, delete).

Args:
  - id (number): Task ID (returned when creating move/copy/delete operations).

Returns: JSON with task state, progress, rate, ETA, bytes transferred, and error info.`,
      inputSchema: {
        id: z.number().int().describe("Task ID"),
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
        const response = await freeboxClient.apiRequest<FsTask>(
          `fs/tasks/${params.id}`
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
        const text = [
          `## FS Task ${t.id} (${t.type})`,
          `- **State**: ${t.state}`,
          `- **Progress**: ${t.progress}%`,
          `- **Files**: ${t.nfiles_done}/${t.nfiles}`,
          `- **Bytes**: ${formatBytes(t.total_bytes_done)} / ${formatBytes(t.total_bytes)}`,
          `- **Rate**: ${formatBytes(t.rate)}/s`,
          `- **ETA**: ${t.eta > 0 ? `${Math.round(t.eta / 60)} min` : "N/A"}`,
          ...(t.error !== "none" ? [`- **Error**: ${t.error}`] : []),
        ].join("\n");
        return { content: [{ type: "text", text }] };
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
