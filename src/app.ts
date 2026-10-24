import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./lib/swagger";
import { register as metricsRegister } from "./lib/promMetrics";
import assignmentRoutes from "./routes/assignmentRoutes";
import messageRoutes from "./routes/messageRoutes";
import toolRoutes from "./routes/toolRoutes";
import runRoutes from "./routes/runRoutes";
import healthRoutes from "./routes/healthRoutes";
import usageRoutes from "./routes/usageRoutes";
import chatRoutes from "./routes/chatRoutes";
import chatMessageRoutes from "./routes/chatMessageRoutes";
import chatStreamRoutes from "./routes/chatStreamRoutes";
import { getChatUsage } from "./controllers/usageController";
import { requireRoles } from "./lib/auth";
import { AI_APP_ROLES } from "./lib/roles";
import promptRoutes from "./routes/promptRoutes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Interactive API docs. Served in every environment: exposure is gated at the edge
// (Istio + oauth2-proxy), not by NODE_ENV, and neither path is routed externally.
// /openapi.json is read in-mesh by apidocs-api-server, which aggregates every
// service's spec at api.<domain>/v1/api-docs.
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get("/openapi.json", (_req, res) => res.json(openApiSpec));

// Prometheus metrics (scraped via the chart's prometheus.io/scrape annotation)
app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", metricsRegister.contentType);
  res.end(await metricsRegister.metrics());
});

// Health routes (before other routes for k8s probes)
app.use("/health", healthRoutes);

// API Routes
// Prompt registry (read-only, bouc.io staff roles only). Must be mounted BEFORE assignmentRoutes:
// its routes are literal ("/prompts", "/promptset") and would otherwise be swallowed by
// assignmentRoutes' "/:id". Unmatched paths fall through to assignmentRoutes.
app.use("/v1/assignments", promptRoutes);
app.use("/v1/assignments", assignmentRoutes);
app.use("/v1/assignments/:assignmentId/runs", runRoutes);
// Chat surface (formerly chatbot-api-server). Mounted before the broad "/v1" mount for
// the same reason promptRoutes precedes assignmentRoutes: literal prefixes first. This is
// the order chatbot-api-server used in production, and it is safe because chatRoutes only
// declares single-segment "/:id" verbs, so ".../messages" and ".../stream" fall through.
app.use("/v1/chats", chatRoutes);
app.use("/v1/chats/:id/messages", chatMessageRoutes);
app.use("/v1/chats/:chatId/stream", chatStreamRoutes);
app.get("/v1/chats/:chatId/usage", requireRoles(...AI_APP_ROLES), getChatUsage);

app.use("/v1", messageRoutes); // Handles /messages and /assignments/:id/messages
app.use("/v1/tools", toolRoutes);
app.use("/v1/usage", usageRoutes);

// 404 + global error handler (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
