// Structural validator for the Claude Code plugin. Deliberately ignores argv:
// in the henry monorepo, the root lint/lint:fix tasks append eslint flags to
// every package's lint script, and this package has nothing eslint can check.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Prints a validation failure and exits non-zero.
 */
function fail(msg: string): never {
  console.error(`skills: ${msg}`);
  process.exit(1);
}

/**
 * Reads and parses a JSON file, failing validation when unreadable.
 */
function readJson(relPath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(root, relPath), "utf8")) as Record<
      string,
      unknown
    >;
  } catch (error) {
    return fail(`${relPath} is missing or invalid JSON: ${String(error)}`);
  }
}

/**
 * Serializes a value with object keys sorted, so two configs that differ only
 * in key order still compare equal.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// ─── Plugin manifest ──────────────────────────────────────────────────────────

const manifest = readJson(".claude-plugin/plugin.json");
if (manifest.name !== "henry") {
  fail(
    'plugin.json "name" must be "henry" (it namespaces the /henry:* skills)',
  );
}
if (
  typeof manifest.description !== "string" ||
  manifest.description.length === 0
) {
  fail("plugin.json needs a non-empty description");
}
// version is optional: when omitted, Claude Code keys plugin updates off the
// git commit SHA, so every CI mirror sync reaches installed users. A pinned
// value freezes updates until bumped — which is why we now leave it unset.
if (
  manifest.version !== undefined &&
  (typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version))
) {
  fail("plugin.json version, when set, must be semver (x.y.z)");
}

// ─── Marketplace catalog ──────────────────────────────────────────────────────
// This directory is its own single-repo marketplace: marketplace.json sits
// beside plugin.json and the sole entry's source is the repo root ("./").

// Names Anthropic reserves for its own marketplaces.
const RESERVED_MARKETPLACE_NAMES = new Set([
  "claude-code-marketplace",
  "claude-code-plugins",
  "claude-plugins-official",
  "claude-plugins-community",
  "claude-community",
  "anthropic-marketplace",
  "anthropic-plugins",
  "agent-skills",
  "anthropic-agent-skills",
]);

const marketplace = readJson(".claude-plugin/marketplace.json");
if (
  typeof marketplace.name !== "string" ||
  !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(marketplace.name)
) {
  fail("marketplace.json needs a kebab-case name");
}
if (RESERVED_MARKETPLACE_NAMES.has(marketplace.name)) {
  fail(`marketplace.json name "${marketplace.name}" is reserved by Anthropic`);
}
if (marketplace.description !== undefined) {
  fail(
    'marketplace.json must not set top-level "description" — the claude CLI validator rejects it; put it under metadata.description',
  );
}
const owner = marketplace.owner as { name?: unknown } | undefined;
if (typeof owner?.name !== "string" || owner.name.length === 0) {
  fail("marketplace.json needs owner.name");
}
const entries = marketplace.plugins as
  | {
      name?: unknown;
      source?: unknown;
      version?: unknown;
      description?: unknown;
    }[]
  | undefined;
const entry = Array.isArray(entries) ? entries[0] : undefined;
if (entries === undefined || entry === undefined) {
  fail("marketplace.json needs a non-empty plugins array");
}
if (entry.name !== manifest.name) {
  fail(
    `marketplace.json plugins[0].name must match plugin.json name ("${String(manifest.name)}")`,
  );
}
if (entry.source !== "./") {
  fail('marketplace.json plugins[0].source must be "./" (single-repo pattern)');
}
if (entry.version !== undefined) {
  fail(
    "marketplace.json plugins[0] must not set version — plugin.json's version silently wins, so a second copy can only drift",
  );
}
// The entry description powers pre-install marketplace browsing while
// plugin.json wins post-install — keep the two copies identical.
if (
  entry.description !== undefined &&
  entry.description !== manifest.description
) {
  fail("marketplace.json plugins[0].description has drifted from plugin.json");
}

// ─── MCP server config ────────────────────────────────────────────────────────

const mcp = readJson(".mcp.json");
const servers = Object.entries(
  (mcp.mcpServers ?? {}) as Record<
    string,
    { command?: unknown; args?: unknown }
  >,
);
if (servers.length === 0) fail(".mcp.json defines no mcpServers");
for (const [name, cfg] of servers) {
  if (typeof cfg.command !== "string" || !Array.isArray(cfg.args)) {
    fail(`.mcp.json server "${name}" needs a command string and args array`);
  }
}

// ─── Skills ───────────────────────────────────────────────────────────────────
// `name` + `description` are required by both the Claude Code plugin spec and
// the Agent Skills standard installers (e.g. the npx-skills CLI).

// Directories only — a stray file like .DS_Store must not fail the lint
// (the pre-commit hook runs this repo-wide).
const skillDirs = readdirSync(join(root, "skills"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
if (skillDirs.length === 0) fail("skills/ is empty");
for (const dir of skillDirs) {
  const file = join(root, "skills", dir, "SKILL.md");
  if (!existsSync(file)) fail(`skills/${dir}/ is missing SKILL.md`);
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(
    readFileSync(file, "utf8"),
  )?.[1];
  if (frontmatter === undefined) {
    fail(`skills/${dir}/SKILL.md is missing YAML frontmatter`);
  }
  if (!/^name:\s*[a-z0-9][a-z0-9-]*\s*$/m.test(frontmatter)) {
    fail(
      `skills/${dir}/SKILL.md frontmatter needs a lowercase kebab-case name`,
    );
  }
  if (!/^description:\s*\S/m.test(frontmatter)) {
    fail(`skills/${dir}/SKILL.md frontmatter needs a description`);
  }
}

// ─── Codex plugin manifest ──────────────────────────────────────────────────
// Codex consumes the same skills/ + MCP server as the Claude plugin, but via a
// parallel .codex-plugin/plugin.json that names its component paths inline
// (skills, mcpServers) rather than relying on convention.

const codex = readJson(".codex-plugin/plugin.json");
if (codex.name !== manifest.name) {
  fail(
    `.codex-plugin/plugin.json "name" must match the Claude plugin ("${String(manifest.name)}")`,
  );
}
if (typeof codex.description !== "string" || codex.description.length === 0) {
  fail(".codex-plugin/plugin.json needs a non-empty description");
}
if (
  typeof codex.version !== "string" ||
  !/^\d+\.\d+\.\d+$/.test(codex.version)
) {
  fail(".codex-plugin/plugin.json version must be semver (x.y.z)");
}
if (codex.skills !== "./skills/") {
  fail('.codex-plugin/plugin.json "skills" must be "./skills/"');
}
if (codex.mcpServers !== "./.mcp.codex.json") {
  fail(
    '.codex-plugin/plugin.json "mcpServers" must point at "./.mcp.codex.json"',
  );
}

// ─── Codex MCP config ───────────────────────────────────────────────────────
// Codex's .mcp.json is an unwrapped server map (server name → config), whereas
// Claude wraps the same map under "mcpServers". The two files therefore can't be
// shared — so we instead assert the Codex map carries the exact same server
// definition as .mcp.json, failing the lint the moment they drift.

const codexMcp = readJson(".mcp.codex.json");
if ("mcpServers" in codexMcp || "mcp_servers" in codexMcp) {
  fail(
    ".mcp.codex.json must be an unwrapped server map (no mcpServers/mcp_servers key) — Codex reads the server name as the top-level key",
  );
}
const claudeServers = (mcp.mcpServers ?? {}) as Record<string, unknown>;
const codexServerNames = Object.keys(codexMcp);
const claudeServerNames = Object.keys(claudeServers);
if (
  canonical(codexServerNames.sort()) !==
  canonical([...claudeServerNames].sort())
) {
  fail(
    ".mcp.codex.json must define the same servers as .mcp.json (keep the two MCP configs in sync)",
  );
}
for (const name of codexServerNames) {
  if (canonical(codexMcp[name]) !== canonical(claudeServers[name])) {
    fail(
      `.mcp.codex.json server "${name}" has drifted from .mcp.json — the command, args, and env must match`,
    );
  }
}

// ─── Codex marketplace catalog ──────────────────────────────────────────────
// Lives at .agents/plugins/marketplace.json (Codex's fixed location), the Codex
// analog of .claude-plugin/marketplace.json.

const codexMarket = readJson(".agents/plugins/marketplace.json");
if (
  typeof codexMarket.name !== "string" ||
  !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(codexMarket.name)
) {
  fail(".agents/plugins/marketplace.json needs a kebab-case name");
}
const codexIface = codexMarket.interface as
  | { displayName?: unknown }
  | undefined;
if (
  typeof codexIface?.displayName !== "string" ||
  codexIface.displayName.length === 0
) {
  fail(".agents/plugins/marketplace.json needs interface.displayName");
}
const codexEntries = codexMarket.plugins as
  | { name?: unknown; source?: { source?: unknown } }[]
  | undefined;
const codexEntry = Array.isArray(codexEntries) ? codexEntries[0] : undefined;
if (codexEntries === undefined || codexEntry === undefined) {
  fail(".agents/plugins/marketplace.json needs a non-empty plugins array");
}
if (codexEntry.name !== manifest.name) {
  fail(
    `.agents/plugins/marketplace.json plugins[0].name must match the plugin ("${String(manifest.name)}")`,
  );
}
if (typeof codexEntry.source?.source !== "string") {
  fail(
    ".agents/plugins/marketplace.json plugins[0].source.source must name a source type",
  );
}

// ─── Cursor plugin manifest ─────────────────────────────────────────────────
// Cursor auto-discovers components from default dirs (skills/ + mcp.json), so
// the manifest carries only metadata — no component paths. The required field
// is a kebab-case name.

const cursor = readJson(".cursor-plugin/plugin.json");
if (cursor.name !== manifest.name) {
  fail(
    `.cursor-plugin/plugin.json "name" must match the Claude plugin ("${String(manifest.name)}")`,
  );
}
if (typeof cursor.description !== "string" || cursor.description.length === 0) {
  fail(".cursor-plugin/plugin.json needs a non-empty description");
}
if (
  typeof cursor.version !== "string" ||
  !/^\d+\.\d+\.\d+$/.test(cursor.version)
) {
  fail(".cursor-plugin/plugin.json version must be semver (x.y.z)");
}

// ─── Cursor MCP config ──────────────────────────────────────────────────────
// Cursor uses the same "mcpServers"-wrapped shape as Claude, but auto-discovers
// the dotless "mcp.json" filename (Claude reads ".mcp.json"). The two files are
// therefore byte-twins — assert they stay identical so they can't drift.

const cursorMcp = readJson("mcp.json");
if (canonical(cursorMcp) !== canonical(mcp)) {
  fail(
    "mcp.json (Cursor) must stay identical to .mcp.json (Claude) — same mcpServers wrapper, just a different filename Cursor auto-discovers",
  );
}

// ─── Cursor marketplace catalog ─────────────────────────────────────────────
// Lives at .cursor-plugin/marketplace.json (Cursor's repo-root location), the
// Cursor analog of .claude-plugin/marketplace.json. Single-repo pattern: the
// sole entry's source is the repo root ("./").

const cursorMarket = readJson(".cursor-plugin/marketplace.json");
if (
  typeof cursorMarket.name !== "string" ||
  !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(cursorMarket.name)
) {
  fail(".cursor-plugin/marketplace.json needs a kebab-case name");
}
const cursorOwner = cursorMarket.owner as { name?: unknown } | undefined;
if (typeof cursorOwner?.name !== "string" || cursorOwner.name.length === 0) {
  fail(".cursor-plugin/marketplace.json needs owner.name");
}
const cursorEntries = cursorMarket.plugins as
  | { name?: unknown; source?: unknown; description?: unknown }[]
  | undefined;
const cursorEntry = Array.isArray(cursorEntries) ? cursorEntries[0] : undefined;
if (cursorEntries === undefined || cursorEntry === undefined) {
  fail(".cursor-plugin/marketplace.json needs a non-empty plugins array");
}
if (cursorEntry.name !== manifest.name) {
  fail(
    `.cursor-plugin/marketplace.json plugins[0].name must match the plugin ("${String(manifest.name)}")`,
  );
}
if (cursorEntry.source !== "./") {
  fail(
    '.cursor-plugin/marketplace.json plugins[0].source must be "./" (single-repo pattern)',
  );
}

console.log(
  `skills: ok (${servers.length} MCP server${servers.length === 1 ? "" : "s"}, ${skillDirs.length} skill${skillDirs.length === 1 ? "" : "s"}, claude + codex + cursor plugins)`,
);
