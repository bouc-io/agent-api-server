// Initialize OpenTelemetry FIRST so auto-instrumentation can patch http/express
// before they are imported below. No-op unless OTEL is configured (see lib/tracing.ts).
import "./lib/tracing";
import app from "./app";
import { closeRedis, isRedisAvailable } from "./lib/redis";
import { closeQueues } from "./lib/queue";
import { createRunOrchestratorWorker } from "./workers/runOrchestrator";
import { registerBuiltinTools } from "./services/tools/handlers";
import { mcpClientManager } from "./services/mcp";
import { createComponentLogger } from "./lib/logger";

const log = createComponentLogger("server");
const port = process.env.PORT || 3000;

// Register built-in tools before starting worker
registerBuiltinTools();

// Connect to configured MCP servers and discover their tools. Fire-and-forget:
// MCP being unavailable at boot is non-fatal and must not block startup.
mcpClientManager
  .initialize()
  .catch((err) =>
    log.warn({ err }, "MCP init failed — continuing without MCP tools"),
  );

// Start the Run Orchestrator worker
const worker = createRunOrchestratorWorker();

const server = app.listen(port, () => {
  log.info({ port }, "Server running");
  if (isRedisAvailable()) {
    log.info("Redis connection available, BullMQ queues initialized");
    if (worker) {
      log.info("Run Orchestrator worker started");
    }
  } else {
    log.warn("Redis not available, queue features disabled");
  }
});

// Graceful shutdown handler
const shutdown = async (signal: string) => {
  log.info({ signal }, "Shutting down gracefully...");

  server.close(async () => {
    log.info("HTTP server closed");

    try {
      // Close worker first
      if (worker) {
        await worker.close();
        log.info("Run Orchestrator worker closed");
      }

      await mcpClientManager.shutdown();
      log.info("MCP client manager closed");

      await closeQueues();
      log.info("BullMQ queues closed");

      await closeRedis();
      log.info("Redis connection closed");
    } catch (error) {
      log.error({ err: error }, "Error during shutdown");
    }

    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    log.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
