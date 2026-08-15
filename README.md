# Agent API Server

A Node.js RESTful API server for building AI Agent applications with PostgreSQL database integration (including `pgvector` for semantic memory), Prisma ORM, BullMQ job queues, and real-time SSE streaming.

## Features

- **Two-Phase LLM Loop**: Planner analyzes context, Executor iteratively calls tools
- **Async Run Execution**: BullMQ job queues with Redis for reliable processing
- **Real-Time Streaming**: Server-Sent Events (SSE) for run progress updates
- **Tool Execution Framework**: Extensible tool registry with timeout handling
- **Memory Integration**: Context retrieval from external Memory Service
- **Distillation Support**: Post-run memory extraction via Distillation Service
- **Robust Error Handling**: Structured errors with automatic retry logic
- **Observability**: Structured logging (Pino) and metrics collection
- **Health Checks**: Kubernetes-ready liveness and readiness probes
- **PostgreSQL database** with Prisma ORM and `pgvector` support
- **Docker containerization** for easy deployment

## Architecture

```mermaid
graph TD
    subgraph "Client Application"
        A[Agent UI]
    end

    subgraph "Agent API Server (Node.js)"
        B[Routes/Controllers]
        C[Run Orchestrator Worker]
        D[Prisma ORM]
        E[Tool Registry]
        F[SSE Streaming]
    end

    subgraph "Infrastructure"
        G[Redis + BullMQ]
        H[PostgreSQL + pgvector]
    end

    subgraph "External Services"
        I[Ollama LLM]
        J[Memory Service]
        K[Distillation Service]
    end

    A -- API Requests --> B
    A -- SSE Subscribe --> F
    B -- Enqueue Job --> G
    G -- Dequeue --> C
    C -- Query/Persist --> D
    C -- Execute Tools --> E
    C -- LLM Calls --> I
    C -- Context Retrieval --> J
    C -- Post-Run --> K
    D -- Database --> H
    C -- Publish Events --> G
    G -- Subscribe --> F
```

## Project Structure

```
agent-api-server/
├── src/
│   ├── controllers/              # Request handlers
│   │   ├── assignmentController.ts
│   │   ├── messageController.ts
│   │   ├── runController.ts      # Run management
│   │   ├── streamController.ts   # SSE streaming
│   │   └── toolController.ts
│   ├── routes/                   # API routes
│   │   ├── assignmentRoutes.ts
│   │   ├── messageRoutes.ts
│   │   ├── runRoutes.ts          # Run & stream routes
│   │   ├── healthRoutes.ts       # Health check endpoints
│   │   └── toolRoutes.ts
│   ├── workers/                  # Background workers
│   │   └── runOrchestrator.ts    # BullMQ job processor
│   ├── services/                 # Business logic
│   │   ├── planner.ts            # LLM Phase 1 - Planning
│   │   ├── executor.ts           # LLM Phase 2 - Execution
│   │   ├── llm/
│   │   │   └── ollamaClient.ts   # Ollama LLM client
│   │   ├── tools/
│   │   │   ├── registry.ts       # Tool registry
│   │   │   └── handlers/         # Built-in tool handlers
│   │   └── memory/
│   │       ├── memoryClient.ts   # Memory search client
│   │       └── distillationClient.ts
│   ├── types/                    # TypeScript definitions
│   │   ├── run.ts
│   │   ├── llm.ts
│   │   ├── tool.ts
│   │   └── errors.ts
│   ├── lib/                      # Shared utilities
│   │   ├── prisma.ts
│   │   ├── redis.ts
│   │   ├── queue.ts
│   │   ├── events.ts
│   │   ├── logger.ts
│   │   ├── metrics.ts
│   │   └── tokenManager.ts
│   ├── app.ts                    # Express app setup
│   └── index.ts                  # Main server entry
├── prisma/
│   └── schema.prisma             # Database schema
├── Dockerfile                    # Container configuration
└── package.json                  # Dependencies and scripts
```

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ with `pgvector` extension
- Redis 7+
- Ollama (or compatible LLM API)

### Using Docker (Recommended)

1. Clone the repository and navigate to the project directory.
2. Build the Docker image:
   ```bash
   docker build -t agent-api .
   ```
3. Run with required services:
   ```bash
   docker run -p 3000:3000 \
     -e DATABASE_URL="postgresql://user:password@host.docker.internal:5432/agentdb" \
     -e REDIS_URL="redis://host.docker.internal:6379" \
     -e OLLAMA_URL="http://host.docker.internal:11434" \
     agent-api
   ```

The API will be available at `http://localhost:3000`.

### Manual Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables in `.env`:
   ```bash
   # Database
   DATABASE_URL="postgresql://user:password@localhost:5432/agentdb"

   # Redis
   REDIS_URL="redis://localhost:6379"

   # LLM
   OLLAMA_URL="http://localhost:11434"
   OLLAMA_MODEL="llama3.2"

   # Optional: Memory/Distillation services
   MEMORY_SERVICE_URL="https://memory.example.com"
   MEMORY_SERVICE_ENABLED="true"
   DISTILLATION_SERVICE_URL="https://memory.example.com"
   DISTILLATION_ENABLED="true"
   ```

3. Set up the database:
   ```bash
   npx prisma migrate dev --name init
   npm run db:seed  # Seed tools into database
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

## API Endpoints

### Assignments
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/assignments` | Create new assignment |
| `GET` | `/v1/assignments` | List all assignments |
| `GET` | `/v1/assignments/:id` | Get assignment by ID |
| `PATCH` | `/v1/assignments/:id` | Update assignment |
| `DELETE` | `/v1/assignments/:id` | Delete assignment |
| `POST` | `/v1/assignments/:id/archive` | Archive assignment |
| `POST` | `/v1/assignments/:id/unarchive` | Unarchive assignment |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/assignments/:id/messages` | List messages |
| `POST` | `/v1/assignments/:id/messages` | Create message & trigger run |
| `GET` | `/v1/assignments/:id/messages/:msgId` | Get specific message |
| `DELETE` | `/v1/assignments/:id/messages/:msgId` | Delete message |
| `GET` | `/v1/assignments/:id/summary` | Get conversation summary |

### Runs
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/assignments/:id/runs` | Create new run |
| `GET` | `/v1/assignments/:id/runs` | List runs |
| `GET` | `/v1/assignments/:id/runs/:runId` | Get run details |
| `POST` | `/v1/assignments/:id/runs/:runId/cancel` | Cancel run |
| `GET` | `/v1/assignments/:id/runs/:runId/stream` | SSE stream |

### Tools
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/tools` | List available tools |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Basic health check |
| `GET` | `/health/detailed` | Detailed health with metrics |
| `GET` | `/health/ready` | Kubernetes readiness probe |
| `GET` | `/health/live` | Kubernetes liveness probe |

## SSE Event Types

When streaming run progress via `/v1/assignments/:id/runs/:runId/stream`:

| Event | Data | Description |
|-------|------|-------------|
| `run.status` | `{ status }` | Run status changed |
| `run.snapshot` | `{ memories_count }` | Context loaded |
| `plan.created` | `{ goal, steps_count }` | Planning complete |
| `tool.call` | `{ tool_name, args }` | Tool being called |
| `tool.result` | `{ tool_name, success }` | Tool execution done |
| `message.created` | `{ message_id, role }` | Message created |
| `run.completed` | `{ run_id }` | Run finished |
| `run.failed` | `{ error }` | Run failed |
| `run.cancelled` | `{ run_id }` | Run cancelled |
| `distill.triggered` | `{ run_id }` | Distillation queued |

## API Examples

### Create an Assignment and Send a Message
```bash
# Create assignment
ASSIGNMENT_ID=$(curl -s -X POST http://localhost:3000/v1/assignments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"title": "Research Task"}' | jq -r '.id')

# Send message (automatically triggers a run)
curl -X POST "http://localhost:3000/v1/assignments/${ASSIGNMENT_ID}/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"role": "user", "content": "What is the capital of France?"}'
```

### Stream Run Progress
```bash
# Get run ID from message creation response, then stream
curl -N "http://localhost:3000/v1/assignments/${ASSIGNMENT_ID}/runs/${RUN_ID}/stream" \
  -H "Authorization: Bearer <token>"
```

### Cancel a Running Run
```bash
curl -X POST "http://localhost:3000/v1/assignments/${ASSIGNMENT_ID}/runs/${RUN_ID}/cancel" \
  -H "Authorization: Bearer <token>"
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | - | PostgreSQL connection string |
| `PORT` | ❌ | `3000` | Server port |
| `REDIS_URL` | ✅ | - | Redis connection string |
| `OLLAMA_URL` | ✅ | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_MODEL` | ❌ | `llama3.2` | LLM model name |
| `OLLAMA_API_TOKEN` | ❌ | - | JWT token for Ollama |
| `OLLAMA_REFRESH_TOKEN` | ❌ | - | Refresh token |
| `OAUTH_TOKEN_ENDPOINT` | ❌ | - | OAuth token endpoint |
| `OAUTH_CLIENT_ID` | ❌ | - | OAuth client ID |
| `ALLOW_SELF_SIGNED_CERTS` | ❌ | `false` | Allow self-signed SSL |
| `TOOL_DEFAULT_TIMEOUT_MS` | ❌ | `30000` | Tool execution timeout |
| `MEMORY_SERVICE_URL` | ❌ | - | Memory service URL |
| `MEMORY_SERVICE_ENABLED` | ❌ | `false` | Enable memory integration |
| `DISTILLATION_SERVICE_URL` | ❌ | - | Distillation service URL |
| `DISTILLATION_ENABLED` | ❌ | `false` | Enable distillation |
| `EVAL_AUTO_APPROVE` | ❌ | `false` | Master switch for HITL auto-approval. When `true`, runs that opt in via `options.eval_mode=true` auto-approve tools behind the approval gate instead of parking for a human (for headless eval harnesses). Keep `false` in production. |
| `LOG_LEVEL` | ❌ | `info` | Logging level |
| `NODE_ENV` | ❌ | `development` | Environment mode |

## Database Schema

- **Assignment**: Represents a task or conversation context
- **Message**: Individual interactions within an assignment
- **Run**: Execution instance tracking status, plan, and timestamps
- **RunStep**: Audit log for each step in a run
- **ToolCall**: Individual tool invocation records
- **Tool**: Registry of available tools with schemas and policies

## Tool Execution Setup

The tool execution system uses a **dual-registry architecture** that requires both in-memory handlers and database records to function properly.

### Architecture Overview

1. **In-Memory Handler Registry**
   - Tool handlers (`echoTool`, `webSearchTool`) are registered on server startup
   - Location: `src/services/tools/handlers/`
   - Registered in: `src/index.ts:10` via `registerBuiltinTools()`

2. **Database Tool Registry**
   - Tool metadata stored in PostgreSQL `Tool` table
   - Required for LLM to know what tools are available
   - Queried via `getToolDefinitionsFromDB()` during run execution

**Important:** Both registries must be synchronized. If the database `Tool` table is empty, the LLM will have no tools available even though handlers are registered in memory!

### Initial Setup: Seeding Tools

After running database migrations, you must seed the Tool table:

**Local Development:**
```bash
npm run db:seed
```

**Kubernetes/Production:**
```bash
# After deployment, exec into the pod
kubectl exec -it <agent-api-pod> -- npm run db:seed

# Or add to your deployment/init container in Helm chart
```

**Using Prisma directly:**
```bash
npx prisma db seed
```

### Verify Tools Are Loaded

**Via API:**
```bash
curl http://localhost:3000/v1/tools \
  -H "Authorization: Bearer <token>"
```

Expected response:
```json
{
  "tools": [
    {
      "name": "echo",
      "description": "A simple echo tool that returns the input message...",
      "enabled": true,
      "parameters": { ... }
    },
    {
      "name": "web_search",
      "description": "Search the web for information...",
      "enabled": true,
      "parameters": { ... }
    }
  ]
}
```

**Via Database:**
```bash
psql $DATABASE_URL -c "SELECT name, enabled, description FROM \"Tool\";"
```

**Via Prisma Studio (local only):**
```bash
npm run db:studio
```

### Built-in Tools

The following tools are included and seeded by default:

| Tool | Description | Parameters |
|------|-------------|------------|
| `echo` | Simple echo tool for testing | `message` (string, required) |
| `web_search` | Web search placeholder | `query` (string, required), `max_results` (number, optional, default: 5) |

### Tool Execution Flow

```
User sends message
  ↓
createMessage → creates Run → enqueues to BullMQ
  ↓
Worker processes run:
  1. Planner analyzes context and creates execution plan
  2. Executor calls getToolDefinitions()
     ↓
     Queries database for enabled tools (Tool table)
     ↓
     Filters to tools with registered in-memory handlers
     ↓
     Returns tool definitions to LLM in JSON schema format
  3. LLM decides which tools to call based on available tools
  4. Executor executes tools via in-memory registry
  5. Tool results are added to context
  6. Loop continues until task complete
  7. Final response returned to user
```

### Adding New Tools

To add a custom tool:

1. **Create handler** in `src/services/tools/handlers/yourTool.ts`:
   ```typescript
   import { ToolHandler, ToolContext, ToolResult } from '../../../types/tool';

   export const yourTool: ToolHandler = {
       name: 'your_tool',
       async execute(args, context): Promise<ToolResult> {
           const param = args.param as string;

           // Your implementation here

           return {
               success: true,
               output: { result: 'Success' }
           };
       }
   };
   ```

2. **Register handler** in `src/services/tools/handlers/index.ts`:
   ```typescript
   import { yourTool } from './yourTool';

   export const builtinHandlers = [
       echoTool,
       webSearchTool,
       yourTool  // Add here
   ];
   ```

3. **Add to seed script** in `src/scripts/seed.ts`:
   ```typescript
   const yourTool = await prisma.tool.upsert({
       where: { name: 'your_tool' },
       update: {},
       create: {
           name: 'your_tool',
           description: 'Description that LLM will see',
           enabled: true,
           schema: {
               type: 'object',
               properties: {
                   param: {
                       type: 'string',
                       description: 'Parameter description for LLM'
                   }
               },
               required: ['param']
           },
           policy: {
               max_calls_per_run: 10,
               requires_approval: false
           }
       }
   });
   ```

4. **Re-run seed** to update database:
   ```bash
   npm run db:seed
   ```

### Troubleshooting Tools

**"No tools available" / LLM doesn't use tools:**
- Verify tools are in database: `npm run db:studio` or query `/v1/tools` endpoint
- Run seed script if Tool table is empty: `npm run db:seed`
- Check server logs for tool registration messages on startup

**"Tool X not found in registry":**
- Tool exists in database but handler not registered in memory
- Check `src/services/tools/handlers/index.ts`
- Ensure handler is imported and added to `builtinHandlers` array
- Restart server after adding handler

**"Can't reach database server" during seed:**
- Verify `DATABASE_URL` environment variable is correct
- Ensure PostgreSQL is running and accessible
- For Kubernetes, check service/pod networking and secrets

## Error Handling

The server uses structured error types with automatic retry logic:

| Error | Retryable | Description |
|-------|-----------|-------------|
| `LLMError` | ✅ | LLM request failures |
| `ToolError` | ❌ | Tool execution failures |
| `TimeoutError` | ✅ | Operation timeouts |
| `MemoryServiceError` | ✅ | Memory service failures |
| `CancellationError` | ❌ | User-initiated cancellation |

BullMQ jobs retry up to 3 times with exponential backoff (5s, 10s, 20s).

## Deployment

Deployment is standard Docker-based. Ensure your PostgreSQL instance has the `vector` extension enabled, and Redis is available for BullMQ job processing.

### Kubernetes

The server includes health endpoints compatible with Kubernetes probes:
- **Readiness**: `GET /health/ready` - Checks database connectivity
- **Liveness**: `GET /health/live` - Always returns 200

## Design Documentation

See [agent_api_design_v2.md](./agent_api_design_v2.md) for detailed architecture documentation including:
- System architecture diagrams
- Sequence diagrams for run lifecycle
- Database schema details
- Complete API specification
- Implementation status

## Observability

Telemetry flows through the cluster's single OpenTelemetry pipeline — the app does
**not** talk to Datadog directly (that would double-count).

- **Traces** — `lib/tracing.ts` emits OTLP traces (auto-instrumented HTTP/Express)
  to the OTel collector, which routes them to **Jaeger** (the Datadog APM export path
  is present but commented `# DATADOG-PAID`). The collector is a `hostNetwork` daemonset,
  so the endpoint is the **node IP** — `OTEL_EXPORTER_OTLP_ENDPOINT=http://$(HOST_IP):4318`,
  with `HOST_IP` injected by the chart via the downward API (`status.hostIP`), **not** a
  ClusterIP service. Enabled only when `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_ENABLED=true`)
  is set — a no-op locally. Service name via `OTEL_SERVICE_NAME` (default `agent-api-server`).
- **Metrics** — two intended paths (see `OBSERVABILITY_DESIGN.md`):
  - **Direct scrape** — `lib/promMetrics.ts` exposes Prometheus metrics at `GET /metrics`
    (`agent_runs_total`, `agent_run_duration_seconds`, `agent_llm_tokens_total`,
    `agent_tool_calls_total`), scraped via the chart's `prometheus.io/scrape` pod annotation.
    These carry an `environment` label sourced from `ENVIRONMENT_ID`.
  - **OTLP** — `lib/tracing.ts` also exports runtime/HTTP metrics over OTLP to the collector,
    which re-exposes them to Prometheus `otel_`-prefixed and `environment`-tagged.

See `infrastructure/opentelemetry/` and `infrastructure/datadog/` for the pipeline config.
