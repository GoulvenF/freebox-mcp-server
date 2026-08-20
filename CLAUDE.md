# freebox-mcp-server — project instructions

## Release checklist

Whenever a new version is released (tag pushed / GitHub Release created), always:

1. Update `README.md` — "Fonctionnalités Principales (Outils)" section must list every new
   tool group added in that release (grouped by domain, with a `*(depuis vX.Y.Z)*` marker),
   and the security section must reflect any new safeguards added.
2. Update `ROADMAP.md` — move shipped domains from "À planifier" to "Fait", keep the
   remaining backlog current.
3. Bump `package.json` version to match the tag before tagging.
4. Create the git tag (`vX.Y.Z`, annotated, with a summary of what shipped) and push it.
5. Create the GitHub Release (`gh release create`) with notes derived from the tag message —
   grouped by feature area and, when relevant, security fixes.

Do this proactively as part of finishing a release, without waiting to be asked each time.
