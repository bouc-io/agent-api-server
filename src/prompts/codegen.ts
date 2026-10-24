/**
 * Prompt codegen logic.
 *
 * BUILD TOOLING, not runtime code. Nothing under src/ outside this file and its test should
 * import it: it reads `prompts/**\/*.md` from disk, and those files are not present in the
 * production image. It is compiled into dist/ as a side effect of living under src/, which
 * is harmless because no runtime path imports it.
 *
 * It lives here rather than in scripts/ for two reasons: tsc's rootDir is src/, so a src
 * file cannot import from scripts/; and keeping it importable lets drift.test.ts assert the
 * committed generated.ts is current without shelling out to a subprocess.
 *
 * Driven by scripts/buildPrompts.ts (`npm run prompts:build` / `prompts:check`).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/** Repo root, i.e. the directory holding package.json. */
export const repoRoot = path.resolve(__dirname, "..", "..");
export const promptsDir = path.join(repoRoot, "prompts");
export const generatedFile = path.join(
  repoRoot,
  "src",
  "prompts",
  "generated.ts",
);

const fragmentsDir = path.join(promptsDir, "fragments");
const INCLUDE_RE = /\{\{>\s*([a-z0-9-]+)\s*\}\}/g;

export class PromptBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptBuildError";
  }
}

interface PromptMeta {
  id: string;
  title: string;
  version: number;
  stage: string;
  role: string;
  includes?: string[];
  variables?: string[];
  note?: string;
}

interface ParsedFile {
  /** Repo-relative path, for error messages. */
  source: string;
  /** Basename without .md; fragments are resolved by this. */
  basename: string;
  meta: PromptMeta;
  body: string;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Strip exactly one trailing newline. Prompt files end with a newline because text files
 * should, but the prompt text itself must not carry it: the pre-extraction template
 * literals had none, and byte-equality with them is the point of the extraction.
 */
function stripOneTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function listMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(dir, e.name))
    .sort();
}

function parseFile(file: string): ParsedFile {
  const raw = fs.readFileSync(file, "utf8");
  const source = path.relative(repoRoot, file);

  if (!raw.startsWith("---\n")) {
    throw new PromptBuildError(
      `${source}: missing YAML frontmatter (file must start with '---')`,
    );
  }
  const end = raw.indexOf("\n---\n", 3);
  if (end === -1) {
    throw new PromptBuildError(
      `${source}: unterminated YAML frontmatter (no closing '---')`,
    );
  }

  let meta: PromptMeta;
  try {
    meta = parseYaml(raw.slice(4, end + 1)) as PromptMeta;
  } catch (err) {
    throw new PromptBuildError(
      `${source}: invalid frontmatter YAML — ${(err as Error).message}`,
    );
  }

  for (const key of ["id", "title", "version", "stage", "role"] as const) {
    if (meta?.[key] === undefined || meta[key] === null) {
      throw new PromptBuildError(
        `${source}: frontmatter is missing required key '${key}'`,
      );
    }
  }
  if (typeof meta.version !== "number") {
    throw new PromptBuildError(
      `${source}: frontmatter 'version' must be a number`,
    );
  }

  return {
    source,
    basename: path.basename(file, ".md"),
    meta,
    body: stripOneTrailingNewline(raw.slice(end + 5)),
  };
}

/**
 * Read every prompt file and return the exact contents that belong in generated.ts.
 * Throws PromptBuildError on any malformed or inconsistent input.
 */
export function buildGenerated(): {
  content: string;
  unitCount: number;
  setHash: string;
  promptsetVersion: string;
} {
  const promptsetPath = path.join(promptsDir, "promptset.json");
  if (!fs.existsSync(promptsetPath)) {
    throw new PromptBuildError(
      `missing ${path.relative(repoRoot, promptsetPath)}`,
    );
  }
  const promptsetVersion = (
    JSON.parse(fs.readFileSync(promptsetPath, "utf8")) as { version?: string }
  ).version;
  if (!promptsetVersion) {
    throw new PromptBuildError(
      "prompts/promptset.json is missing a 'version' field",
    );
  }

  const fixturePath = path.join(promptsDir, "fixtures", "default.json");
  if (!fs.existsSync(fixturePath)) {
    throw new PromptBuildError(
      `missing ${path.relative(repoRoot, fixturePath)}`,
    );
  }
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as unknown;

  const fragments = listMarkdown(fragmentsDir).map(parseFile);
  const prompts = listMarkdown(promptsDir).map(parseFile);
  const all = [...fragments, ...prompts];

  if (all.length === 0) {
    throw new PromptBuildError(
      `no prompt files found under ${path.relative(repoRoot, promptsDir)}`,
    );
  }

  const byBasename = new Map(fragments.map((f) => [f.basename, f]));

  // One level of includes only — nesting would make resolution order non-obvious.
  for (const fragment of fragments) {
    INCLUDE_RE.lastIndex = 0;
    if (INCLUDE_RE.test(fragment.body)) {
      INCLUDE_RE.lastIndex = 0;
      throw new PromptBuildError(
        `${fragment.source}: fragments may not contain '{{> ... }}' includes (nesting is not supported)`,
      );
    }
  }
  INCLUDE_RE.lastIndex = 0;

  const entries: Array<{ meta: PromptMeta; template: string; hash: string }> =
    [];
  const seenIds = new Map<string, string>();

  for (const file of all) {
    const previous = seenIds.get(file.meta.id);
    if (previous) {
      throw new PromptBuildError(
        `duplicate prompt id '${file.meta.id}' in ${previous} and ${file.source}`,
      );
    }
    seenIds.set(file.meta.id, file.source);

    const used: string[] = [];
    let missing: string | null = null;
    const template = file.body.replace(INCLUDE_RE, (_match, name: string) => {
      const fragment = byBasename.get(name);
      if (!fragment) {
        missing = name;
        return "";
      }
      used.push(name);
      return fragment.body;
    });
    if (missing) {
      throw new PromptBuildError(
        `${file.source}: include '{{> ${missing} }}' has no matching file at prompts/fragments/${missing}.md`,
      );
    }

    // Declared includes must match what the body actually pulls in, so the fragment graph
    // reported by the API (and "which prompts does this fragment affect") stays truthful.
    const declared = [...(file.meta.includes ?? [])].sort();
    const actual = [...new Set(used)].sort();
    if (declared.join(",") !== actual.join(",")) {
      throw new PromptBuildError(
        `${file.source}: frontmatter 'includes' is [${declared.join(", ")}] but the body uses [${actual.join(", ")}]`,
      );
    }

    entries.push({ meta: file.meta, template, hash: sha256(template) });
  }

  entries.sort((a, b) => a.meta.id.localeCompare(b.meta.id));

  // The set hash covers the promptset version, every id, every declared version and every
  // resolved template hash. Editing a fragment therefore moves the set hash even when no
  // individual prompt file's version was bumped — which is the bump-forgetting case.
  const setHash = sha256(
    [
      `promptset:${promptsetVersion}`,
      ...entries.map((e) => `${e.meta.id}@${e.meta.version}:${e.hash}`),
    ].join("\n"),
  );

  const body = entries
    .map(
      (e) =>
        `  ${JSON.stringify(e.meta.id)}: {\n` +
        `    meta: ${JSON.stringify(e.meta)},\n` +
        `    template: ${JSON.stringify(e.template)},\n` +
        `    hash: ${JSON.stringify(e.hash)},\n` +
        `  },`,
    )
    .join("\n");

  const content =
    `/* eslint-disable */\n` +
    `// GENERATED FILE — do not edit by hand.\n` +
    `// Source: prompts/**/*.md\n` +
    `// Regenerate: npm run prompts:build\n` +
    `//\n` +
    `// Committed on purpose: this file is the promptset lock. 'npm run prompts:check' and\n` +
    `// src/prompts/drift.test.ts fail when it no longer matches the .md sources, which is\n` +
    `// what keeps the recorded promptset hash honest about what actually shipped.\n` +
    `\n` +
    `export interface PromptMeta {\n` +
    `  id: string;\n` +
    `  title: string;\n` +
    `  version: number;\n` +
    `  stage: string;\n` +
    `  role: string;\n` +
    `  includes?: string[];\n` +
    `  variables?: string[];\n` +
    `  note?: string;\n` +
    `}\n` +
    `\n` +
    `export interface PromptEntry {\n` +
    `  meta: PromptMeta;\n` +
    `  /** Include-resolved template. Placeholders are {{name}}. */\n` +
    `  template: string;\n` +
    `  /** sha256 of template. */\n` +
    `  hash: string;\n` +
    `}\n` +
    `\n` +
    `export const PROMPTSET_VERSION = ${JSON.stringify(promptsetVersion)};\n` +
    `export const PROMPTSET_HASH = ${JSON.stringify(setHash)};\n` +
    `\n` +
    `/**\n` +
    ` * prompts/fixtures/default.json, embedded because the production image copies only\n` +
    ` * dist/, node_modules/ and prisma/ — the prompts/ directory is not present at runtime,\n` +
    ` * and GET /v1/prompts/:id/rendered needs these inputs. Deliberately excluded from\n` +
    ` * PROMPTSET_HASH: it is test data, not prompt text. Editing it still shows up as drift\n` +
    ` * in this file and as a diff in the committed goldens.\n` +
    ` */\n` +
    `export const PROMPT_FIXTURE = ${JSON.stringify(fixture, null, 2)} as const;\n` +
    `\n` +
    `export const PROMPTS: Record<string, PromptEntry> = {\n` +
    `${body}\n` +
    `};\n`;

  return { content, unitCount: entries.length, setHash, promptsetVersion };
}

/** Current on-disk generated.ts, or null when it has never been generated. */
export function readGenerated(): string | null {
  return fs.existsSync(generatedFile)
    ? fs.readFileSync(generatedFile, "utf8")
    : null;
}

export function writeGenerated(content: string): void {
  fs.mkdirSync(path.dirname(generatedFile), { recursive: true });
  fs.writeFileSync(generatedFile, content, "utf8");
}
