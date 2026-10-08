# Henry skills, Claude Code, Codex & Cursor plugin

Henry's agent plugin: gives AI coding agents live commerce tools (product
search, carts, hosted checkout) plus skills that teach them how to integrate
Henry into the apps they build. The one directory ships as a Claude Code
plugin, a Codex plugin, a Cursor plugin, and bare cross-agent skills.

## What's inside

- **`.mcp.json`** — connects installed Claude Code agents to Henry's hosted
  MCP server (`https://mcp.henrylabs.ai/mcp`), sending `HENRY_SDK_API_KEY`
  as the `x-api-key` header, for live commerce tools.
- **`mcp.json`** — the same server under the dotless filename Cursor
  auto-discovers (Claude reads `.mcp.json`), using Cursor's `${env:NAME}`
  interpolation.
- **`.mcp.codex.json`** — the same server in Codex's unwrapped-map format,
  sending the key as `Authorization: Bearer` via `bearer_token_env_var`. The
  lint checks all three point at the same URL and env var.
- **`.codex-plugin/plugin.json`** — Codex plugin manifest; names the bundled
  `skills/` and MCP config inline. Paired with
  `.agents/plugins/marketplace.json` (Codex's marketplace location).
- **`.cursor-plugin/plugin.json`** — Cursor plugin manifest (metadata only;
  Cursor auto-discovers `skills/` and `mcp.json`). Paired with
  `.cursor-plugin/marketplace.json` (Cursor's repo-root registry).
- **`skills/integrate`** — model-invoked skill: triggers when a user asks to
  add commerce/checkout/product search to their app; teaches
  `@henrylabs/sdk` setup, async-job polling, hosted vs headless checkout,
  webhooks, and go-live.
- **`skills/shop`** — user-invoked demo: `/henry:shop white sneakers under
  $100` → real product search → cart → hosted checkout link.

## Five ways to consume this directory

1. **Claude Code plugin** (full bundle: MCP wiring + namespaced skills).
   From the public mirror repo:

   ```bash
   /plugin marketplace add Henry-Social/skills
   /plugin install henry@henrylabs
   ```

   This directory is also its own marketplace
   (`.claude-plugin/marketplace.json` beside `plugin.json`). For local
   development in the monorepo: `claude --plugin-dir ./apps/public-skills`.
   Then `/henry:shop <query>` or just ask Claude to integrate Henry.

2. **Codex plugin** (full bundle: same `skills/` + MCP server, via
   `.codex-plugin/plugin.json`). The marketplace entry lives at
   `.agents/plugins/marketplace.json` and points at the public mirror, so a
   Codex user adds it from there. Self-serve public publishing isn't open
   yet — until it is, distribution is local
   (`~/.codex/plugins/`) or **Codex app → Plugins → Created by you → Share
   with workspace**.

3. **Cursor plugin** (full bundle: same `skills/` + MCP server, via
   `.cursor-plugin/plugin.json`; Cursor auto-discovers `skills/` and
   `mcp.json`). The registry lives at `.cursor-plugin/marketplace.json`.
   Publish by submitting the public mirror repo at
   <https://cursor.com/marketplace/publish>.

4. **Cross-agent skills via the Agent Skills standard** — the same
   `skills/*/SKILL.md` files work in Codex CLI, Cursor, ChatGPT's skills
   beta, and 30+ other agents:

   ```bash
   npx skills add Henry-Social/skills
   ```

   Skills installed this way don't include the MCP wiring — the shop skill
   walks users through adding the hosted Henry MCP server manually.

5. **ChatGPT App** — a hosted in-chat app is a different artifact: it
   connects to the remote server's `/mcp/apps` endpoint with OAuth; see
   <https://docs.henrylabs.ai>.

This directory is developed in the (private) henry monorepo and mirrored to
the public [Henry-Social/skills](https://github.com/Henry-Social/skills)
repo by CI on every change to `main`. Don't edit the mirror directly —
changes there are overwritten by the next sync. Found a problem? Open an
issue on Henry-Social/skills or email support@henrylabs.ai; pull requests
against the mirror are clobbered by the next sync.

## Requirements

- A Henry API key: create an app at <https://app.henrylabs.ai> → Developer
  settings. Start with a sandbox key.
- `export HENRY_SDK_API_KEY="<key>"` in the shell that launches the agent.
  Without it, Claude Code and Cursor fall back to the server's OAuth sign-in;
  if that isn't completed, the Henry tools are missing and the shop skill
  walks the user through onboarding.

## Development

From this directory (or the mirror repo root):

```bash
# Structural validation (manifests, MCP config, skill frontmatter)
bun run lint

# Full plugin + marketplace validation via the Claude Code CLI
claude plugin validate .

# Live-test in a session; /reload-plugins picks up edits without restarting
claude --plugin-dir .
```

From the henry monorepo root the same commands are
`bun run --filter @henry/public-skills lint`,
`claude plugin validate ./apps/public-skills`, and
`claude --plugin-dir ./apps/public-skills`.

Skill content is distilled from <https://docs.henrylabs.ai> and Henry's v1
OpenAPI spec (which lives in the private henry monorepo, not in this repo —
the live API reference at <https://docs.henrylabs.ai> covers the same
surface). When endpoints change, update `skills/integrate/references/` to
match.
