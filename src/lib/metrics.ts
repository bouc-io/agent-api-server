/**
 * Simple in-memory metrics collection
 * For production, integrate with Prometheus client (prom-client)
 */

export interface MetricsData {
  // Run metrics
  runsTotal: number;
  runsCompleted: number;
  runsFailed: number;
  runsCancelled: number;
  runsInProgress: number;

  // Tool metrics
  toolCallsTotal: number;
  toolCallsSucceeded: number;
  toolCallsFailed: number;

  // LLM metrics
  llmCallsTotal: number;
  llmCallsSucceeded: number;
  llmCallsFailed: number;

  // Duration histograms (simplified - just track last N values)
  runDurationsMs: number[];
  toolCallDurationsMs: number[];
  llmCallDurationsMs: number[];

  // Last updated timestamp
  lastUpdated: string;
}

const MAX_HISTOGRAM_SIZE = 100;

/**
 * Metrics singleton
 */
class Metrics {
  private data: MetricsData = {
    runsTotal: 0,
    runsCompleted: 0,
    runsFailed: 0,
    runsCancelled: 0,
    runsInProgress: 0,

    toolCallsTotal: 0,
    toolCallsSucceeded: 0,
    toolCallsFailed: 0,

    llmCallsTotal: 0,
    llmCallsSucceeded: 0,
    llmCallsFailed: 0,

    runDurationsMs: [],
    toolCallDurationsMs: [],
    llmCallDurationsMs: [],

    lastUpdated: new Date().toISOString(),
  };

  /**
   * Increment run started
   */
  incRunStarted(): void {
    this.data.runsTotal++;
    this.data.runsInProgress++;
    this.data.lastUpdated = new Date().toISOString();
  }

  /**
   * Record run completion
   */
  incRunCompleted(durationMs: number): void {
    this.data.runsCompleted++;
    this.data.runsInProgress = Math.max(0, this.data.runsInProgress - 1);
    this.addToHistogram(this.data.runDurationsMs, durationMs);
    this.data.lastUpdated = new Date().toISOString();
  }

  /**
   * Record run failure
   */
  incRunFailed(): void {
    this.data.runsFailed++;
    this.data.runsInProgress = Math.max(0, this.data.runsInProgress - 1);
    this.data.lastUpdated = new Date().toISOString();
  }

  /**
   * Record run cancellation
   */
  incRunCancelled(): void {
    this.data.runsCancelled++;
    this.data.runsInProgress = Math.max(0, this.data.runsInProgress - 1);
    this.data.lastUpdated = new Date().toISOString();
  }

  /**
   * Record tool call
   */
  incToolCall(success: boolean, durationMs: number): void {
    this.data.toolCallsTotal++;
    if (success) {
      this.data.toolCallsSucceeded++;
    } else {
      this.data.toolCallsFailed++;
    }
    this.addToHistogram(this.data.toolCallDurationsMs, durationMs);
    this.data.lastUpdated = new Date().toISOString();
  }

  /**
   * Record LLM call
   */
  incLLMCall(success: boolean, durationMs: number): void {
    this.data.llmCallsTotal++;
    if (success) {
      this.data.llmCallsSucceeded++;
    } else {
      this.data.llmCallsFailed++;
    }
    this.addToHistogram(this.data.llmCallDurationsMs, durationMs);
    this.data.lastUpdated = new Date().toISOString();
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): MetricsData {
    return { ...this.data };
  }

  /**
   * Get summary statistics for health endpoint
   */
  getSummary(): Record<string, unknown> {
    return {
      runs: {
        total: this.data.runsTotal,
        completed: this.data.runsCompleted,
        failed: this.data.runsFailed,
        cancelled: this.data.runsCancelled,
        in_progress: this.data.runsInProgress,
        avg_duration_ms: this.average(this.data.runDurationsMs),
      },
      tool_calls: {
        total: this.data.toolCallsTotal,
        succeeded: this.data.toolCallsSucceeded,
        failed: this.data.toolCallsFailed,
        avg_duration_ms: this.average(this.data.toolCallDurationsMs),
      },
      llm_calls: {
        total: this.data.llmCallsTotal,
        succeeded: this.data.llmCallsSucceeded,
        failed: this.data.llmCallsFailed,
        avg_duration_ms: this.average(this.data.llmCallDurationsMs),
      },
      last_updated: this.data.lastUpdated,
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.data = {
      runsTotal: 0,
      runsCompleted: 0,
      runsFailed: 0,
      runsCancelled: 0,
      runsInProgress: 0,

      toolCallsTotal: 0,
      toolCallsSucceeded: 0,
      toolCallsFailed: 0,

      llmCallsTotal: 0,
      llmCallsSucceeded: 0,
      llmCallsFailed: 0,

      runDurationsMs: [],
      toolCallDurationsMs: [],
      llmCallDurationsMs: [],

      lastUpdated: new Date().toISOString(),
    };
  }

  private addToHistogram(arr: number[], value: number): void {
    arr.push(value);
    if (arr.length > MAX_HISTOGRAM_SIZE) {
      arr.shift();
    }
  }

  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }
}

// Export singleton instance
export const metrics = new Metrics();
