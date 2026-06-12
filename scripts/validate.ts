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
if (
  typeof manifest.version !== "string" ||
  !/^\d+\.\d+\.\d+$/.test(manifest.version)
) {
  fail("plugin.json version must be semver (x.y.z)");
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

console.log(
  `skills: ok (${servers.length} MCP server${servers.length === 1 ? "" : "s"}, ${skillDirs.length} skill${skillDirs.length === 1 ? "" : "s"})`,
);
