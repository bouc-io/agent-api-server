# Agent System Design V2 (Consolidated)

## 1. System Architecture (Monolith + Queue)

In this V2 design, the **Agent API Server** acts as a unified "Control & Execution Plane". The **Run Orchestrator** is implemented as a background worker (BullMQ) running within the same logical service (Node.js process or sidecar), sharing the database connection and codebase. This simplifies deployment while maintaining the reliability of message queues.

### High-Level Diagram

### Key Architectural Shifts
1.  **Internal Worker**: The Orchestrator is not a separate microservice. It is a processor function running alongside the API, consuming from Redis.
2.  **Direct DB Access**: The Orchestrator does *not* call the Agent API HTTP endpoints. It uses the internal `Repository` layer to read messages and update run status.
3.  **Two-Phase LLM Loop**:
    *   **Phase 1: Planner**: Analyzes context and produces a structured execute plan (JSON). Raw LLM output published as `step.reasoning` for UI visibility.
    *   **Phase 2: Executor**: Iteratively calls tools to fulfill the plan. Every LLM interaction (system prompt, tool-call steps, and final response) published as `step.reasoning`.
4.  **Concurrency**: Strictly **one active run per assignment** to ensure generic safe limits on the message log.

---

## 2. Logic Flow: The Run Lifecycle

### Sequence Diagram (Planner + Executor)

```mermaid
sequenceDiagram
    autonumber

    participant User
    participant UI
    participant AgentAPI as Agent API Server
    participant Queue as BullMQ / Redis Queue
    participant Orchestrator as Run Orchestrator (BullMQ Worker)
    participant Memory as Memory Service
    participant LLM
    participant Tool as Tool Runtime / Tool Router
    participant Distiller as Memory Distiller (memory-extractor)

    %% --- User sends a message (non-blocking) ---
    User ->> UI: Type prompt ("do X")
    UI ->> AgentAPI: POST /assignments (create assignment)
    AgentAPI ->> AgentAPI: Create assignment
    UI ->> AgentAPI: POST /assignments/{id}/messages (user message)
    AgentAPI ->> AgentAPI: Persist user message (append-only)
    AgentAPI ->> AgentAPI: Create run (status=queued, trigger_message_id)
    AgentAPI ->> Queue: Enqueue run.execute(run_id)
    AgentAPI -->> UI: 202 Accepted (run_id, stream_url)

    %% --- UI subscribes to streaming updates ---
    UI ->> AgentAPI: GET /runs/{run_id}/stream (SSE)
    AgentAPI -->> UI: SSE connected
    AgentAPI -->> UI: SSE run.status=queued

    %% --- Cancellation (can happen anytime) ---
    par User cancels (optional)
        User ->> UI: Cancel
        UI ->> AgentAPI: POST /runs/{run_id}/cancel
        AgentAPI ->> AgentAPI: Mark run cancel_requested=true
        AgentAPI -->> UI: 202 Accepted (cancel requested)
        AgentAPI -->> UI: SSE run.cancel_requested
    and Orchestrator continues until it checks cancellation
        Note over Orchestrator: Orchestrator checks cancel_requested between steps
    end

    %% --- Orchestrator starts the run ---
    Queue ->> Orchestrator: Dequeue run.execute(run_id)
    Orchestrator ->> Orchestrator: Acquire lock (e.g., per-assignment or per-run)
    Orchestrator ->> Orchestrator: If cancel_requested then cancel immediately
    alt cancel_requested before start
        Orchestrator ->> Orchestrator: Update run status=cancelled
        Orchestrator -->> AgentAPI: Emit run.status=cancelled
        AgentAPI -->> UI: SSE run.status=cancelled
        Orchestrator ->> Orchestrator: Release lock
    else run proceeds
        Orchestrator ->> Orchestrator: Update run status=running
        Orchestrator -->> AgentAPI: Emit run.status=running
        AgentAPI -->> UI: SSE run.status=running

        %% --- Load context ---
        Orchestrator ->> Orchestrator: Load assignment messages from DB

        %% --- Retrieval + Memory (advisory context) ---
        Orchestrator ->> Memory: POST /v1/memories/search (query=last user msg)
        Memory -->> Orchestrator: Top memories (ids, content, confidence)
        Orchestrator ->> Orchestrator: Persist run snapshot (memories_used)
        Orchestrator -->> AgentAPI: Emit run.snapshot (counts, ids)
        AgentAPI -->> UI: SSE run.snapshot

        %% --- Planner phase (LLM call #1) ---
        Orchestrator ->> Orchestrator: Check cancel_requested
        alt cancel_requested during pre-plan
            Orchestrator ->> Orchestrator: Update run status=cancelled
            Orchestrator -->> AgentAPI: Emit run.status=cancelled
            AgentAPI -->> UI: SSE run.status=cancelled
            Orchestrator ->> Orchestrator: Release lock
        else continue
            Orchestrator ->> LLM: Plan (messages + memories + retrieval hits)
            LLM -->> Orchestrator: Structured plan + raw LLM text
            Note over Orchestrator: Planner returns PlannerResult { plan, rawResponse }
            Orchestrator -->> AgentAPI: Emit step.reasoning (planner raw output, step_index=0)
            AgentAPI -->> UI: SSE step.reasoning → right workspace
            Orchestrator ->> Orchestrator: Persist plan (run_step #1)
            Orchestrator -->> AgentAPI: Emit plan.created
            AgentAPI -->> UI: SSE plan.created
        end

        %% --- Execution loop (LLM call #2, iterative) ---
        Note over Orchestrator: Executor publishes system prompt as reasoning
        Orchestrator -->> AgentAPI: Emit step.reasoning (executor system prompt, step_index=0)
        AgentAPI -->> UI: SSE step.reasoning → right workspace
        loop Until final OR max_steps OR cancelled
            Orchestrator ->> Orchestrator: Check cancel_requested
            alt cancel_requested mid-run
                Orchestrator ->> Orchestrator: Update run status=cancelled
                Orchestrator -->> AgentAPI: Emit run.status=cancelled
                AgentAPI -->> UI: SSE run.status=cancelled
            else continue
                Orchestrator ->> LLM: Execute next step (plan + observations)
                LLM -->> Orchestrator: Response (content + optional tool_calls)
                Note over Orchestrator: step.reasoning fires for EVERY iteration (before branching)
                Orchestrator -->> AgentAPI: Emit step.reasoning (content, summary, tool_names, finish_reason)
                AgentAPI -->> UI: SSE step.reasoning → right workspace
                alt Tool required
                    Orchestrator -->> AgentAPI: Emit tool.call
                    AgentAPI -->> UI: SSE tool.call

                    Orchestrator ->> Tool: Execute tool (policy checked)
                    Tool -->> Orchestrator: Tool output (stdout/stderr/structured)
                    Orchestrator ->> Orchestrator: Persist tool_call + tool_result
                    Orchestrator -->> AgentAPI: Emit tool.result (summary)
                    AgentAPI -->> UI: SSE tool.result
                    Orchestrator ->> Orchestrator: Append observation to context
                else Final answer (no tool calls)
                    Orchestrator ->> Orchestrator: Persist assistant message (with provenance)
                    Orchestrator -->> AgentAPI: Emit message.created (assistant, content)
                    AgentAPI -->> UI: SSE message.created → left chat only
                    Orchestrator ->> Orchestrator: Update run status=completed
                    Orchestrator -->> AgentAPI: Emit run.status=completed
                    AgentAPI -->> UI: SSE run.status=completed
                end
            end
        end

        %% --- Post-run: Distill memories (async, only if completed) ---
        alt run completed
            Orchestrator ->> Distiller: POST /v1/distill (transcript/run metadata)
            Distiller -->> Orchestrator: 202 Accepted (job queued)
            Orchestrator -->> AgentAPI: Emit distill.triggered
            AgentAPI -->> UI: SSE distill.triggered
        else run cancelled or failed
            Note over Orchestrator: Distillation skipped or handled differently (policy choice)
        end

        Orchestrator ->> Orchestrator: Release lock
    end
```

---

## 3. Database Schema (Postgres)

Updated to support the Planner/Executor model and internal references.

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Assignments
CREATE TABLE assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    embedding VECTOR(1536)
);
CREATE INDEX assignments_updated_at_idx ON assignments(updated_at DESC);

-- Messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    user_id TEXT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb, 
    provenance JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX messages_assignment_id_idx ON messages(assignment_id, created_at ASC);

-- Runs (Expanded for Planning)
CREATE TABLE runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    user_id TEXT,
    agent_id TEXT DEFAULT 'default',
    
    -- Status tracking
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    trigger_message_id UUID REFERENCES messages(id),
    
    -- The Plan (Output of Phase 1)
    plan JSONB, -- { "goal": "...", "steps": [{ "id": 1, "desc": "..." }] }
    
    -- Snapshots & Timings
    snapshot JSONB DEFAULT '{}'::jsonb, -- memory IDs, doc IDs used
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    error TEXT
);
CREATE INDEX runs_assignment_id_created_at_idx ON runs(assignment_id, created_at DESC);

-- Run Steps (Audit Log)
CREATE TABLE run_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    step_index INT NOT NULL,
    type TEXT NOT NULL, -- 'plan', 'execution', 'tool_call'
    input JSONB, -- LLM Prompt / Context
    output JSONB, -- LLM Response
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Tool Calls
CREATE TABLE tool_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input JSONB NOT NULL,
    tool_output JSONB,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ,
    duration_ms INT
);

-- Tool Registry
CREATE TABLE tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    schema JSONB NOT NULL,
    policy JSONB DEFAULT '{}'::jsonb,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. API Specification

#### List all assignments
```
GET /v1/assignments
```
**Query params:**
- `page` (int): Page number (default: 1)
- `limit` (int): Items per page (default: 20)
- `sort` (string): Sort by field (default: "updated_at")
- `order` (string): "asc" or "desc" (default: "desc")

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Customer Support Chat",
      "created_at": "2024-01-05T10:30:00Z",
      "updated_at": "2024-01-05T12:45:00Z",
      "message_count": 15,
      "metadata": {
        "tags": ["support", "billing"],
        "starred": false
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "total_pages": 3
  }
}
```

#### Create new assignment
```
POST /v1/assignments
```
**Request body:**
```json
{
  "title": "New conversation",
  "metadata": {
    "tags": ["research"],
    "context": "Product development"
  }
}
```

#### Get assignment by ID
```
GET /v1/assignments/{assignment_id}
```
**Response:**
```json
{
  "id": "uuid",
  "title": "Customer Support Chat",
  "created_at": "2024-01-05T10:30:00Z",
  "updated_at": "2024-01-05T12:45:00Z",
  "message_count": 15,
  "metadata": {
    "tags": ["support", "billing"],
    "starred": false
  }
}
```

#### Update assignment
```
PATCH /v1/assignments/{assignment_id}
```
**Request body:**
```json
{
  "title": "Updated title",
  "metadata": {
    "starred": true
  }
}
```

#### Delete assignment
```
DELETE /v1/assignments/{assignment_id}
```

#### Archive/Unarchive assignment
```
POST /v1/assignments/{assignment_id}/archive
POST /v1/assignments/{assignment_id}/unarchive
```

---

### Messages

#### List messages in assignment
```
GET /v1/assignments/{assignment_id}/messages
```
**Query params:**
- `page` (int): Page number
- `limit` (int): Messages per page
- `before` (string): Get messages before this message ID
- `after` (string): Get messages after this message ID

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "assignment_id": "uuid",
      "role": "user",
      "content": "Hello, I need help",
      "created_at": "2024-01-05T10:30:00Z",
      "metadata": {
        "tokens": 5,
        "model": null
      }
    },
    {
      "id": "uuid",
      "assignment_id": "uuid",
      "role": "assistant",
      "content": "How can I help you?",
      "created_at": "2024-01-05T10:30:15Z",
      "metadata": {
        "tokens": 6,
        "model": "claude-sonnet-4-5",
        "finish_reason": "end_turn"
      }
    }
  ],
  "pagination": {
    "has_more": false
  }
}
```

#### Create message (Non-blocking / Chat-like)
Appends a user message and automatically enqueues a Run to generate a response. Use the returned `stream_url` to listen for progress via SSE.

```
POST /v1/assignments/{assignment_id}/messages
```
**Request body:**
```json
{
  "role": "user",
  "content": "What's the weather like?",
  "options": {
    "agent_id": "default",
    "stream": true
  },
  "idempotency_key": "optional-uuid"
}
```

**Response (202 Accepted):**
```json
{
  "assignment_id": "uuid",
  "user_message": {
    "id": "uuid",
    "role": "user",
    "content": "What's the weather like?",
    "created_at": "2024-01-05T10:30:00Z"
  },
  "run": {
    "id": "run_uuid",
    "status": "queued",
    "stream_url": "/v1/assignments/{assignment_id}/runs/run_uuid/stream"
  }
}
```

#### Get specific message
```
GET /v1/assignments/{assignment_id}/messages/{message_id}
```

#### Delete message
```
DELETE /v1/assignments/{assignment_id}/messages/{message_id}
```

#### Get conversation history summary
```
GET /v1/assignments/{assignment_id}/summary
```

---

### Runs (Execution)

#### Create a Run (Manual)
Triggers an agent execution loop for an existing assignment context. Useful for retries or autonomous agent prompts.

```
POST /v1/assignments/{assignment_id}/runs
```
**Request body:**
```json
{
  "agent_id": "default",
  "trigger_message_id": "msg_uuid" (optional)
}
```

**Response (202 Accepted):**
```json
{
  "run": {
    "id": "run_uuid",
    "status": "queued",
    "created_at": "..."
  },
  "stream_url": "/v1/assignments/{assignment_id}/runs/run_uuid/stream"
}
```

#### Get Run Status
```
GET /v1/assignments/{assignment_id}/runs/{run_id}
```
**Response:**
```json
{
  "id": "run_uuid",
  "assignment_id": "uuid",
  "status": "running", 
  "created_at": "...",
  "started_at": "...",
  "ended_at": null,
  "error": null
}
```

#### Stream Run Progress (SSE)
```
GET /v1/assignments/{assignment_id}/runs/{run_id}/stream
```
**Event Types:**
- `run.status`: `{ "status": "running" }`
- `step.reasoning`: `{ "step_index": 0, "content": "...", "summary": "...", "tool_names": [], "finish_reason": "stop" }` *(all LLM interactions: planner output, executor system prompt, every loop iteration → right workspace)*
- `token`: `{ "token": "Hello" }`
- `tool.call`: `{ "name": "weather", "args": {...} }`
- `tool.result`: `{ "output": "..." }`
- `message.created`: `{ "role": "assistant", "content": "..." }` *(final answer only → left chat)*
- `run.completed`: `{ "run_id": "..." }`
- `run.failed`: `{ "error": "..." }`

#### Cancel Run
```
POST /v1/assignments/{assignment_id}/runs/{run_id}/cancel
```

---

### Tool Management (Registry)

#### List registered tools
```
GET /v1/tools
```
**Response:**
```json
{
  "tools": [
    {
      "name": "code_execution",
      "description": "Execute Python code",
      "schema": { ... },
      "policy": { "requires_approval": true }
    }
  ]
}
```

---

## 5. SSE Event Types

| Event | Data | When |
|-------|------|------|
| `run.status` | `{ status: "queued" \| "running" \| "completed" \| "failed" \| "cancelled" }` | Status changes |
| `run.snapshot` | `{ memories_count, retrieval_count }` | Context/memories loaded |
| `plan.created` | `{ goal, steps_count }` | Planner phase complete |
| `step.reasoning` | `{ step_index, content, tool_names?, finish_reason?, summary }` | Every LLM interaction: planner raw output (step 0), executor system prompt (step 0), and every executor loop iteration (step 1+). Includes synthesized `summary` fallback when `content` is null (e.g., Ollama returns tool_calls without content). |
| `tool.call` | `{ tool_name, args }` | Before tool execution |
| `tool.result` | `{ tool_name, success, output_summary }` | After tool execution |
| `message.created` | `{ role, content }` | Final assistant message (displayed in left chat only, `<think>` tags stripped by UI) |
| `run.completed` | `{ run_id }` | Run finished successfully |
| `run.failed` | `{ error }` | Run encountered error |
| `run.cancelled` | `{ run_id }` | Run was cancelled |
| `distill.triggered` | `{ run_id }` | Distillation job queued |

---

## 6. Implementation Status

### Completed Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **1** | Infrastructure (Redis + BullMQ) | ✅ Complete |
| **2** | Database Schema (Prisma) | ✅ Complete |
| **3** | Run Controller & Routes | ✅ Complete |
| **4** | Run Orchestrator Worker | ✅ Complete |
| **5** | SSE Streaming | ✅ Complete |
| **6** | Two-Phase LLM (Planner + Executor) | ✅ Complete |
| **7** | Tool Execution Framework | ✅ Complete |
| **8** | Memory & Distillation Integration | ✅ Complete |
| **9** | Error Handling & Retry Logic | ✅ Complete |
| **10** | Observability & Logging | ✅ Complete |

### Key Implementation Files

| Category | File | Purpose |
|----------|------|---------|
| **Infrastructure** | `src/lib/redis.ts` | Redis connection singleton |
| | `src/lib/queue.ts` | BullMQ queue with retry config |
| | `src/lib/events.ts` | Redis PubSub event publisher |
| **Run Management** | `src/controllers/runController.ts` | Run CRUD operations |
| | `src/routes/runRoutes.ts` | Run API routes |
| | `src/controllers/streamController.ts` | SSE streaming endpoint |
| | `src/workers/runOrchestrator.ts` | BullMQ worker processor |
| **LLM Integration** | `src/types/llm.ts` | LLM type definitions |
| | `src/services/llm/ollamaClient.ts` | Ollama client with retry |
| | `src/services/planner.ts` | Planner phase (Phase 1) |
| | `src/services/executor.ts` | Executor loop (Phase 2) |
| **Tool Framework** | `src/types/tool.ts` | Tool type definitions |
| | `src/services/tools/registry.ts` | Tool registry with timeout |
| | `src/services/tools/handlers/*.ts` | Built-in tool handlers |
| **Memory Services** | `src/services/memory/memoryClient.ts` | Memory search client |
| | `src/services/memory/distillationClient.ts` | Distillation trigger |
| **Observability** | `src/lib/logger.ts` | Pino structured logging |
| | `src/lib/metrics.ts` | In-memory metrics |
| | `src/routes/healthRoutes.ts` | Health check endpoints |
| **Error Handling** | `src/types/errors.ts` | Structured error types |

---

## 7. Environment Configuration

```env
# Database
DATABASE_URL="postgresql://admin:admin@localhost:5432/agentdb"

# Server
PORT=3000

# Redis (for BullMQ)
REDIS_URL="redis://localhost:6379"

# LLM Configuration
OLLAMA_URL="https://api.pik8s.internal/ollama"
OLLAMA_MODEL="llama3.2:1b"
OLLAMA_API_TOKEN="<jwt-token>"
OLLAMA_REFRESH_TOKEN="<refresh-token>"

# OAuth2 Configuration (for token refresh)
OAUTH_TOKEN_ENDPOINT="https://sso.pik8s.internal/realms/users/protocol/openid-connect/token"
OAUTH_CLIENT_ID="oauth2-proxy"

# SSL/TLS Configuration
ALLOW_SELF_SIGNED_CERTS="true"

# Tool Execution
TOOL_DEFAULT_TIMEOUT_MS="30000"

# Memory Service
MEMORY_SERVICE_URL="https://memory.pik8s.internal"
MEMORY_SERVICE_ENABLED="true"

# Distillation Service
DISTILLATION_SERVICE_URL="https://memory.pik8s.internal"
DISTILLATION_ENABLED="true"

# Logging
LOG_LEVEL="info"
NODE_ENV="development"
```

---

## 8. Error Handling Strategy

### Structured Error Types

| Error Type | Code | Retryable | Description |
|------------|------|-----------|-------------|
| `LLMError` | `LLM_ERROR` | ✅ Yes | LLM request failures |
| `ToolError` | `TOOL_ERROR` | ❌ No | Tool execution failures |
| `TimeoutError` | `TIMEOUT_ERROR` | ✅ Yes | Operation timeouts |
| `MemoryServiceError` | `MEMORY_ERROR` | ✅ Yes | Memory service failures |
| `CancellationError` | `CANCELLED` | ❌ No | Run cancelled by user |

### Retry Configuration

- **BullMQ Jobs**: 3 attempts with exponential backoff (5s, 10s, 20s)
- **LLM Requests**: 3 attempts with exponential backoff (1s, 2s, 4s)
- **Tool Execution**: Configurable timeout (default 30s), no retry

---

## 9. Health Check Endpoints

| Endpoint | Purpose | Response |
|----------|---------|----------|
| `GET /health` | Basic health | `{ "status": "ok" }` |
| `GET /health/detailed` | Full system health | Database, Redis, Ollama, Memory, Distillation status + metrics |
| `GET /health/ready` | Kubernetes readiness | Database connectivity check |
| `GET /health/live` | Kubernetes liveness | Always returns 200 |

### Detailed Health Response

```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "healthy", "latency_ms": 5 },
    "redis": { "status": "healthy" },
    "ollama": { "status": "healthy", "latency_ms": 150 },
    "memory_service": { "status": "degraded", "error": "Not configured" },
    "distillation_service": { "status": "healthy" }
  },
  "metrics": {
    "runs_started": 42,
    "runs_completed": 40,
    "runs_failed": 2,
    "tool_calls_total": 156,
    "tool_calls_success": 152,
    "llm_calls_total": 84
  },
  "timestamp": "2024-01-05T12:00:00.000Z"
}
```
