/**
 * Prometheus metrics for agent-api-server (exposed at GET /metrics).
 *
 * Scraped by Prometheus via the chart's `prometheus.io/scrape` pod annotation —
 * the same scrape pattern the OTel collector pods use. Traces go to Datadog/Jaeger
 * via the OTel collector (see lib/tracing.ts); these app-level business metrics
 * land in Prometheus. Kept separate from the legacy in-memory lib/metrics.ts
 * (which backs the /health summary) so neither disturbs the other.
 */
import client from "prom-client";

export const register = new client.Registry();
// `environment` mirrors the label the OTel collector stamps on collector-routed
// signals (from ENVIRONMENT_ID), so direct-scraped agent_* metrics line up with
// the otel_* series in Grafana. `service` matches OTEL_SERVICE_NAME.
register.setDefaultLabels({
  service: process.env.OTEL_SERVICE_NAME || "agent-api-server",
  environment: process.env.ENVIRONMENT_ID || "unknown",
});
client.collectDefaultMetrics({ register });

/** Terminal run outcomes by status (completed | failed | cancelled). */
export const runsTotal = new client.Counter({
  name: "agent_runs_total",
  help: "Total agent runs by terminal status",
  labelNames: ["status"],
  registers: [register],
});

/** End-to-end run wall-clock duration in seconds. */
export const runDuration = new client.Histogram({
  name: "agent_run_duration_seconds",
  help: "Agent run wall-clock duration in seconds",
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

/** LLM tokens consumed by kind (prompt | completion). */
export const llmTokensTotal = new client.Counter({
  name: "agent_llm_tokens_total",
  help: "LLM tokens consumed by kind",
  labelNames: ["kind"],
  registers: [register],
});

/**
 * Chat streams the client abandoned mid-flight.
 *
 * A dedicated counter rather than a label on agent_runs_total: adding a label to an
 * existing prom-client Counter changes the series shape and breaks the dashboard
 * queries already built on it. Chat turns are not separable in agent_runs_total by
 * design; use Run.agent_id = 'chat' in SQL when the split matters.
 */
export const chatStreamDisconnectsTotal = new client.Counter({
  name: "agent_chat_stream_disconnects_total",
  help: "Chat SSE streams where the client disconnected before the answer was stored",
  registers: [register],
});

/** Tool invocations by tool name and outcome. */
export const toolCallsTotal = new client.Counter({
  name: "agent_tool_calls_total",
  help: "Tool calls by tool name and success",
  labelNames: ["tool", "success"],
  registers: [register],
});
