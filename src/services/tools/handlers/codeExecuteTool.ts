import { ToolHandler, ToolResult, ToolContext } from "../../../types/tool";
import { getSandboxRunner } from "../../sandbox/dockerSandboxRunner";
import { createComponentLogger } from "../../../lib/logger";

const log = createComponentLogger("tool-code-execute");

const DEFAULT_TIMEOUT_MS = parseInt(
  process.env.SANDBOX_TIMEOUT_MS || "10000",
  10,
);
const MAX_TIMEOUT_MS = 60000;

/**
 * code_execute — runs a short program in an ephemeral, network-isolated sandbox
 * container and returns its stdout/stderr/exit code.
 *
 * Safety: gated by ALLOW_CODE_EXECUTE (the handler is only registered when that is
 * 'true') and, via its DB policy (requires_approval + state_changing), by the human
 * approval gate. Output is tagged 'trusted' because the sandbox has no network
 * access, so the program cannot pull in attacker-controlled remote content.
 */
export const codeExecuteTool: ToolHandler = {
  name: "code_execute",
  trust: "trusted",
  execute: async (
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> => {
    if (process.env.ALLOW_CODE_EXECUTE !== "true") {
      return {
        success: false,
        output: null,
        error:
          "code_execute is disabled on this server (set ALLOW_CODE_EXECUTE=true to enable).",
      };
    }

    const language =
      typeof args.language === "string"
        ? args.language.toLowerCase()
        : "python";
    if (language !== "python" && language !== "node") {
      return {
        success: false,
        output: null,
        error: `Unsupported language '${language}'. Supported: python, node.`,
      };
    }

    const code = typeof args.code === "string" ? args.code : "";
    if (!code.trim()) {
      return { success: false, output: null, error: "No code provided." };
    }

    const stdin = typeof args.stdin === "string" ? args.stdin : undefined;
    const requested =
      typeof args.timeout_ms === "number"
        ? args.timeout_ms
        : DEFAULT_TIMEOUT_MS;
    const timeoutMs = Math.min(Math.max(requested, 1000), MAX_TIMEOUT_MS);

    try {
      const runner = getSandboxRunner();
      const r = await runner.run({ language, code, stdin, timeoutMs });
      const ok = !r.timedOut && r.exitCode === 0;
      return {
        success: ok,
        trust: "trusted",
        output: {
          stdout: r.stdout,
          stderr: r.stderr,
          exit_code: r.exitCode,
          timed_out: r.timedOut,
        },
        error: r.timedOut
          ? `Execution timed out after ${timeoutMs}ms`
          : r.exitCode !== 0
            ? `Process exited with code ${r.exitCode}`
            : undefined,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown sandbox error";
      log.warn({ err: message }, "code_execute: sandbox run failed");
      return {
        success: false,
        output: null,
        error: `Sandbox error: ${message}`,
      };
    }
  },
};
