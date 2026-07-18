/**
 * Run status enum values
 */
export type RunStatus =
    | 'queued'
    | 'running'
    | 'pending_approval'
    | 'completed'
    | 'failed'
    | 'cancelled';

/**
 * Plan step structure (output of Planner phase)
 */
export interface PlanStep {
    id: number;
    description: string;
    tool_intent?: string;
}

/**
 * Plan structure (output of Planner phase)
 */
export interface Plan {
    goal: string;
    steps: PlanStep[];
}

/**
 * Request body for creating a new run
 */
export interface CreateRunRequest {
    agent_id?: string;
    trigger_message_id?: string;
}

/**
 * Run response (API response format)
 */
export interface RunResponse {
    id: string;
    assignment_id: string;
    status: RunStatus;
    agent_id: string;
    cancel_requested: boolean;
    plan?: Plan | null;
    snapshot?: Record<string, unknown>;
    created_at: string;
    started_at?: string | null;
    ended_at?: string | null;
    error?: string | null;
    // Token usage (populated for completed runs)
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    llm_calls?: number;
    model_name?: string | null;
}

/**
 * Response when creating a new run (includes stream URL)
 */
export interface CreateRunResponse {
    run: RunResponse;
    stream_url: string;
}

/**
 * Run step response
 */
export interface RunStepResponse {
    id: string;
    run_id: string;
    step_index: number;
    type: 'plan' | 'execution' | 'tool_call';
    input?: Record<string, unknown> | null;
    output?: Record<string, unknown> | null;
    created_at: string;
}

/**
 * Tool call response
 */
export interface ToolCallResponse {
    id: string;
    run_id: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_output?: Record<string, unknown> | null;
    status: 'pending' | 'running' | 'completed' | 'failed';
    created_at: string;
    ended_at?: string | null;
    duration_ms?: number | null;
}

/**
 * Approval request response
 */
export interface ApprovalRequestResponse {
    id: string;
    run_id: string;
    tool_name: string;
    tool_args: Record<string, unknown>;
    status: 'pending' | 'approved' | 'rejected';
    decided_by?: string | null;
    reason?: string | null;
    created_at: string;
    decided_at?: string | null;
}

/**
 * Request body for approving/rejecting a tool execution
 */
export interface ApproveRunRequest {
    approval_request_id: string;
    approved: boolean;
    reason?: string;
}

/**
 * Detailed run response (includes steps, tool calls, and approval requests)
 */
export interface RunFeedbackResponse {
    rating: string;
    comment?: string | null;
}

export interface RunDetailResponse extends RunResponse {
    steps: RunStepResponse[];
    tool_calls: ToolCallResponse[];
    approval_requests: ApprovalRequestResponse[];
    feedback?: RunFeedbackResponse | null;
}

/**
 * Paginated runs list response
 */
export interface RunsListResponse {
    data: RunResponse[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
    };
}
