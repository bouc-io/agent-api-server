/**
 * Prompt codegen CLI.
 *
 *   npm run prompts:build   # regenerate src/prompts/generated.ts from prompts/**\/*.md
 *   npm run prompts:check   # exit non-zero if the committed file is stale
 *
 * All logic lives in src/prompts/codegen.ts so that src/prompts/drift.test.ts can assert
 * the committed file is current without spawning a subprocess. This file is only argv
 * handling and exit codes.
 *
 * `prompts:build` runs ahead of tsc in the `build` script, including inside the Docker
 * build stage, so generated.ts is always present and current for the compiler.
 */
import {
  PromptBuildError,
  buildGenerated,
  readGenerated,
  writeGenerated,
} from "../src/prompts/codegen";

function main(): void {
  const checkOnly = process.argv.includes("--check");

  let result: ReturnType<typeof buildGenerated>;
  try {
    result = buildGenerated();
  } catch (err) {
    if (err instanceof PromptBuildError) {
      console.error(`prompts: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const { content, unitCount, setHash, promptsetVersion } = result;
  const summary = `${unitCount} units, promptset ${promptsetVersion} (${setHash.slice(0, 12)})`;
  const existing = readGenerated();

  if (checkOnly) {
    if (existing !== content) {
      console.error(
        "prompts: drift detected — src/prompts/generated.ts does not match prompts/**/*.md\n" +
          "         Run: npm run prompts:build",
      );
      process.exit(1);
    }
    console.log(`prompts: ok — ${summary}`);
    return;
  }

  if (existing === content) {
    console.log(`prompts: unchanged — ${summary}`);
    return;
  }

  writeGenerated(content);
  console.log(`prompts: wrote src/prompts/generated.ts — ${summary}`);
}

main();
