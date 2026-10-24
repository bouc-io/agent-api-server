/**
 * The promptset drift gate.
 *
 * This is the test that keeps the recorded promptset hash honest. If someone edits a
 * prompt or a fragment under prompts/ and does not run `npm run prompts:build`, the
 * committed generated.ts (and therefore every promptset_hash stamped onto runs and eval
 * rows) describes text that is no longer what ships. Catching that here means it fails in
 * the existing CI unit-test job, with no change to the private ci-templates project.
 */
import { describe, expect, it } from "vitest";
import { buildGenerated, readGenerated } from "./codegen";
import { PROMPTS, PROMPTSET_HASH, PROMPTSET_VERSION } from "./generated";

describe("promptset", () => {
  it("has no drift between prompts/**/*.md and the committed generated.ts", () => {
    const { content } = buildGenerated();
    expect(
      readGenerated(),
      "src/prompts/generated.ts is stale. Run: npm run prompts:build",
    ).toBe(content);
  });

  it("exposes the same set hash and version that codegen computes", () => {
    const { setHash, promptsetVersion, unitCount } = buildGenerated();
    expect(PROMPTSET_HASH).toBe(setHash);
    expect(PROMPTSET_VERSION).toBe(promptsetVersion);
    expect(Object.keys(PROMPTS)).toHaveLength(unitCount);
  });

  it("leaves no unresolved includes in any template", () => {
    for (const [id, entry] of Object.entries(PROMPTS)) {
      expect(
        entry.template,
        `${id} still contains an unresolved {{> ... }} include`,
      ).not.toMatch(/\{\{>/);
    }
  });

  it("declares every placeholder its template actually uses", () => {
    for (const [id, entry] of Object.entries(PROMPTS)) {
      const used = [
        ...new Set(
          [...entry.template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(
            (m) => m[1],
          ),
        ),
      ].sort();
      const declared = [...(entry.meta.variables ?? [])].sort();
      expect(
        used,
        `${id}: frontmatter 'variables' does not match the template`,
      ).toEqual(declared);
    }
  });
});
