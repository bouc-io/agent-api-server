/**
 * Tool-call loop detection for the executor.
 *
 * The original detector only caught *exact* repeats of the same tool + args.
 * This catches two additional, common small-model failure shapes:
 *   1. Exact repeats (same name + identical args) — N occurrences.
 *   2. Same tool name hammered many times in a row regardless of args
 *      (e.g. web_search with slightly different queries that never converge).
 *
 * Pure and side-effect-free so it is unit-testable; the executor maintains the
 * history array and calls shouldAbortForLoop() after appending each signature.
 */

export interface ToolCallLike {
  name: string;
  arguments: unknown;
}

/** Stable signature for a tool call (name + canonicalized args). */
export function toolCallSignature(tc: ToolCallLike): string {
  return JSON.stringify({ name: tc.name, args: tc.arguments });
}

export interface LoopDetectionOptions {
  /** Max allowed identical (name+args) repeats before aborting. Default 3. */
  maxIdenticalRepeats?: number;
  /** Max allowed consecutive calls to the same tool name before aborting. Default 5. */
  maxConsecutiveSameTool?: number;
}

export interface LoopDecision {
  abort: boolean;
  reason?: 'identical_repeat' | 'consecutive_same_tool';
  toolName?: string;
}

/**
 * Decide whether the run is stuck in a loop, given the full ordered history of
 * tool-call signatures and the matching tool names (same length, same order).
 */
export function detectLoop(
  signatures: string[],
  names: string[],
  options: LoopDetectionOptions = {}
): LoopDecision {
  const maxIdentical = options.maxIdenticalRepeats ?? 3;
  const maxConsecutive = options.maxConsecutiveSameTool ?? 5;

  if (signatures.length === 0) return { abort: false };

  // 1. Identical (name + args) repeats.
  const last = signatures[signatures.length - 1];
  const identicalCount = signatures.filter((s) => s === last).length;
  if (identicalCount >= maxIdentical) {
    return { abort: true, reason: 'identical_repeat' };
  }

  // 2. Consecutive same-tool-name streak (args may differ).
  const lastName = names[names.length - 1];
  let streak = 0;
  for (let i = names.length - 1; i >= 0 && names[i] === lastName; i--) streak++;
  if (streak >= maxConsecutive) {
    return { abort: true, reason: 'consecutive_same_tool', toolName: lastName };
  }

  return { abort: false };
}
