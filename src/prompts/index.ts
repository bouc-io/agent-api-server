/**
 * Prompt registry.
 *
 * Every LLM-facing string in this service resolves through here. The text itself lives in
 * `prompts/**\/*.md` and is compiled into `generated.ts` by `npm run prompts:build`.
 *
 * These functions are deliberately pure: no file IO, no clock, no config reads. That is
 * what makes `GET /v1/prompts/:id/rendered` meaningful and what lets the equivalence test
 * compare a render against the pre-extraction builders byte-for-byte. Anything
 * time-dependent (the executor's `now`) is passed in as a variable by the caller.
 */
import type { LLMToolDefinition } from "../types/llm";
import {
  PROMPTS,
  PROMPTSET_HASH,
  PROMPTSET_VERSION,
  type PromptEntry,
  type PromptMeta,
} from "./generated";

export { PROMPTS, PROMPTSET_HASH, PROMPTSET_VERSION };
export type { PromptEntry, PromptMeta };

/** Placeholder syntax is {{name}}. Includes ({{> name }}) are resolved at build time. */
const VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export class UnknownPromptError extends Error {
  constructor(id: string) {
    super(`Unknown prompt id: ${id}`);
    this.name = "UnknownPromptError";
  }
}

export class MissingPromptVariableError extends Error {
  constructor(id: string, variable: string) {
    super(
      `Prompt '${id}' requires variable '${variable}' but none was provided`,
    );
    this.name = "MissingPromptVariableError";
  }
}

export function hasPrompt(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROMPTS, id);
}

export function getPrompt(id: string): PromptEntry {
  if (!hasPrompt(id)) throw new UnknownPromptError(id);
  return PROMPTS[id];
}

/** Metadata for every unit, id-sorted. Used by GET /v1/prompts. */
export function listPrompts(): Array<PromptMeta & { hash: string }> {
  return Object.values(PROMPTS)
    .map((entry) => ({ ...entry.meta, hash: entry.hash }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Reverse index: which prompts pull in a given fragment. This is the question that matters
 * before editing a fragment, since one edit can change several assembled prompts at once.
 */
export function promptsIncluding(fragmentBasename: string): string[] {
  return Object.values(PROMPTS)
    .filter((entry) => (entry.meta.includes ?? []).includes(fragmentBasename))
    .map((entry) => entry.meta.id)
    .sort();
}

/**
 * Substitute {{name}} placeholders.
 *
 * An empty string is a valid value — several callers pass "" for an absent optional block
 * (instruction prefix, knowledge suffix, tool list), and the pre-extraction code relied on
 * that. A missing key, by contrast, throws: it is always a caller bug or a typo.
 */
export function renderPrompt(
  id: string,
  variables: Record<string, string> = {},
): string {
  const entry = getPrompt(id);
  return entry.template.replace(VARIABLE_RE, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new MissingPromptVariableError(id, name);
    }
    return variables[name];
  });
}

/** Convenience for prompts with no placeholders. Throws if the template has any. */
export function staticPrompt(id: string): string {
  return renderPrompt(id, {});
}

/**
 * One line per tool, shared by the planner, executor and direct-path tool lists so the
 * three cannot drift in how they describe a tool.
 */
export function formatToolLines(tools: LLMToolDefinition[]): string {
  return tools
    .map((t) => `- ${t.function.name}: ${t.function.description}`)
    .join("\n");
}

export function promptsetSummary(): {
  promptset_version: string;
  promptset_hash: string;
  unit_count: number;
} {
  return {
    promptset_version: PROMPTSET_VERSION,
    promptset_hash: PROMPTSET_HASH,
    unit_count: Object.keys(PROMPTS).length,
  };
}
