# freebox-mcp-server — project instructions

## Release checklist

Whenever a new version is released (tag pushed / GitHub Release created), always:

1. Update `README.md` — "Fonctionnalités Principales (Outils)" section must list every new
   tool group added in that release (grouped by domain, with a `*(depuis vX.Y.Z)*` marker),
   and the security section must reflect any new safeguards added.
2. Update `ROADMAP.md` — move shipped domains from "À planifier" to "Fait", keep the
   remaining backlog current.
3. Bump `package.json` version to match the tag before tagging, and bump `version` in
   `manifest.json` to the same value.
4. Rebuild the `.mcpb` Desktop Extension bundle for the new version:
   - `npm run build` (fresh `dist/`)
   - `mcpb pack . freebox-mcp-server-X.Y.Z.mcpb` from repo root (the CLI is
     `@anthropic-ai/mcpb`; install globally with `npm install -g @anthropic-ai/mcpb` if the
     `mcpb` binary isn't on PATH — check common alt install locations too, e.g. under a
     custom Node prefix, before assuming it's missing)
   - `mcpb validate manifest.json` before packing
5. Create the git tag (`vX.Y.Z`, annotated, with a summary of what shipped) and push it.
6. Create the GitHub Release (`gh release create`) with notes derived from the tag message —
   grouped by feature area and, when relevant, security fixes.
7. Attach the `.mcpb` file to that release **twice**, so the README's stable download link
   keeps working:
   - `gh release upload vX.Y.Z freebox-mcp-server-X.Y.Z.mcpb` (versioned filename, for the
     release page itself)
   - `cp freebox-mcp-server-X.Y.Z.mcpb freebox-mcp-server-latest.mcpb && gh release upload
     vX.Y.Z freebox-mcp-server-latest.mcpb --clobber` (stable filename — this is what the
     README's "Add to Claude Desktop" button and permanent download link point at, via
     `releases/latest/download/freebox-mcp-server-latest.mcpb`)
   Every release from now on must carry the `-latest.mcpb` asset or the README's one-click
   install link breaks.

Do this proactively as part of finishing a release, without waiting to be asked each time.
