/**
 * SandboxRunner — abstraction over an isolated code-execution backend.
 *
 * v1 ships a Docker/containerd ephemeral-container backend (dockerSandboxRunner).
 * A future Kubernetes-Job backend (or gVisor, firecracker, etc.) can implement
 * this same interface with no changes to callers (the code_execute tool handler).
 */

export type SandboxLanguage = 'python' | 'node';

export interface SandboxRunInput {
    language: SandboxLanguage;
    code: string;
    /** Optional data piped to the program's stdin. */
    stdin?: string;
    /** Wall-clock timeout in milliseconds. */
    timeoutMs?: number;
}

export interface SandboxRunResult {
    stdout: string;
    stderr: string;
    /** Process exit code; -1 if unknown, 127 if the runtime could not be launched. */
    exitCode: number;
    /** True when the run was killed for exceeding its timeout. */
    timedOut: boolean;
}

export interface SandboxRunner {
    run(input: SandboxRunInput): Promise<SandboxRunResult>;
}
