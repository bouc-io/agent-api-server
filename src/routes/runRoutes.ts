import { Router } from 'express';
import {
    createRun,
    getRun,
    listRuns,
    cancelRun,
    submitToolResult,
    approveRun,
    listApprovals,
    submitFeedback,
} from '../controllers/runController';
import { streamRun } from '../controllers/streamController';
import { requireRoles } from '../lib/auth';
import { AI_APP_ROLES } from '../lib/roles';
import { validate } from '../middleware/validate';
import {
    createRunSchema,
    approveRunSchema,
    submitFeedbackSchema,
    submitToolResultSchema,
} from '../schemas';

// Use mergeParams to access :assignmentId from parent router
const router = Router({ mergeParams: true });

router.use(requireRoles(...AI_APP_ROLES));

/**
 * @openapi
 * /v1/assignments/{assignmentId}/runs:
 *   post:
 *     summary: Start a new agent run for an assignment
 *     tags: [Runs]
 *     parameters:
 *       - in: path
 *         name: assignmentId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               agent_id: { type: string }
 *               trigger_message_id: { type: string }
 *               client_type: { type: string, example: cli }
 *     responses:
 *       '202': { description: Run accepted; poll run status or open the SSE stream }
 *       '400': { description: Validation error }
 *       '401': { description: Unauthorized }
 */
router.post('/', validate(createRunSchema), createRun);

// GET /v1/assignments/:assignmentId/runs - List runs for assignment
router.get('/', listRuns);

// GET /v1/assignments/:assignmentId/runs/:runId - Get a specific run
router.get('/:runId', getRun);

// POST /v1/assignments/:assignmentId/runs/:runId/cancel - Cancel a run
router.post('/:runId/cancel', cancelRun);

// POST /v1/assignments/:assignmentId/runs/:runId/approve - Submit HITL approval/rejection
router.post('/:runId/approve', validate(approveRunSchema), approveRun);

// GET /v1/assignments/:assignmentId/runs/:runId/approvals - List approval requests for a run
router.get('/:runId/approvals', listApprovals);

// POST /v1/assignments/:assignmentId/runs/:runId/feedback - Submit thumbs up/down feedback
router.post('/:runId/feedback', validate(submitFeedbackSchema), submitFeedback);

// POST /v1/assignments/:assignmentId/runs/:runId/tool-results - Submit client-side tool result (CLI)
router.post('/:runId/tool-results', validate(submitToolResultSchema), submitToolResult);

// GET /v1/assignments/:assignmentId/runs/:runId/stream - SSE stream for run events
router.get('/:runId/stream', streamRun);

export default router;
