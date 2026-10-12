import { spawn } from "child_process";
import {
  SandboxRunner,
  SandboxRunInput,
  SandboxRunResult,
} from "./sandboxRunner";
import { createComponentLogger } from "../../lib/logger";

const log = createComponentLogger("docker-sandbox");

const DOCKER_BIN = process.env.SANDBOX_DOCKER_BIN || "docker";
const IMAGE = process.env.SANDBOX_IMAGE || "python:3.11-slim";
const MEMORY = process.env.SANDBOX_MEMORY || "256m";
const CPUS = process.env.SANDBOX_CPUS || "1";
const PIDS = process.env.SANDBOX_PIDS || "128";
const TMPFS_SIZE = process.env.SANDBOX_TMPFS_SIZE || "64m";
// Hard cap on captured output per stream to avoid unbounded memory growth.
const MAX_OUTPUT = parseInt(
  process.env.SANDBOX_MAX_OUTPUT_BYTES || "1000000",
  10,
);

/**
 * Runs code inside a hardened, ephemeral container:
 *   --rm                : removed after exit
 *   --network none      : no network access (egress isolation)
 *   --memory / --cpus   : resource limits
 *   --pids-limit        : fork-bomb protection
 *   --read-only         : immutable root filesystem
 *   --tmpfs /tmp        : the only writable area (size-capped), holds the program file
 *   --user 65534:65534  : runs as 'nobody', never root
 *
 * The program source is passed base64-encoded via an env var and materialised into
 * the tmpfs at runtime, so arbitrary code (quotes, newlines) needs no shell escaping.
 * The caller's stdin is piped straight through to the program.
 *
 * If the container runtime is unavailable (binary missing or daemon down), this
 * resolves with a non-zero exit code and an explanatory stderr rather than throwing,
 * so a misconfigured host degrades gracefully instead of crashing the worker.
 */
class DockerSandboxRunner implements SandboxRunner {
  async run(input: SandboxRunInput): Promise<SandboxRunResult> {
    const interpreter = input.language === "node" ? "node" : "python3";
    const ext = input.language === "node" ? "js" : "py";
    const b64 = Buffer.from(input.code, "utf8").toString("base64");
    const bootstrap = `printf '%s' "$CODE_B64" | base64 -d > /tmp/prog.${ext} && exec ${interpreter} /tmp/prog.${ext}`;
    const timeoutMs = input.timeoutMs ?? 10000;

    const args = [
      "run",
      "--rm",
      "-i",
      "--network",
      "none",
      "--memory",
      MEMORY,
      "--cpus",
      CPUS,
      "--pids-limit",
      PIDS,
      "--read-only",
      "--tmpfs",
      `/tmp:exec,size=${TMPFS_SIZE}`,
      "--user",
      "65534:65534",
      "--workdir",
      "/tmp",
      "--stop-timeout",
      "1",
      "--env",
      `CODE_B64=${b64}`,
      IMAGE,
      "sh",
      "-c",
      bootstrap,
    ];

    return new Promise<SandboxRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const child = spawn(DOCKER_BIN, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (d: Buffer) => {
        if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf8");
      });
      child.stderr.on("data", (d: Buffer) => {
        if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf8");
      });

      child.on("error", (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        log.warn(
          { err: err.message },
          "sandbox spawn failed (is the container runtime available?)",
        );
        resolve({
          stdout,
          stderr: `${stderr}\n[sandbox error: ${err.message}]`,
          exitCode: 127,
          timedOut,
        });
      });

      child.on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: stdout.slice(0, MAX_OUTPUT),
          stderr: stderr.slice(0, MAX_OUTPUT),
          exitCode: code ?? -1,
          timedOut,
        });
      });

      if (input.stdin) child.stdin.write(input.stdin);
      child.stdin.end();
    });
  }
}

let singleton: SandboxRunner | null = null;

/** Returns the process-wide sandbox runner (swap the implementation here later). */
export function getSandboxRunner(): SandboxRunner {
  if (!singleton) singleton = new DockerSandboxRunner();
  return singleton;
}
