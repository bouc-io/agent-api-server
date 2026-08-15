import { Router } from 'express';
import { listTools } from '../controllers/toolController';
import { requireRoles } from '../lib/auth';

const router = Router();

/**
 * @openapi
 * /v1/tools:
 *   get:
 *     summary: List available tool definitions (DB metadata + registered handlers)
 *     tags: [Tools]
 *     responses:
 *       '200':
 *         description: Tool definitions visible to the LLM
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name: { type: string }
 *                   description: { type: string }
 *                   schema: { type: object }
 *       '401': { description: Unauthorized }
 */
// Any authenticated user may read tool definitions
router.get('/', requireRoles(), listTools);
// NOTE: "Enable/disable tools for assignment" -> PATCH /v1/assignments/{assignment_id}/tools
// This might logically belong in assignmentRoutes, but design puts it under tool system section.
// However URL is /assignments/...
// I should probably put it in assignmentRoutes or handle here.
// If I handle here, I need to mount correctly. 
// "PATCH /v1/assignments/{assignment_id}/tools"
// If I put it here, I would need a route like:
// router.patch('/assignments/:assignment_id/tools', ...) 
// But this router is mounted at /v1/tools.
// So URL would be /v1/tools/assignments/... which is wrong.
// The URL is /v1/assignments/...
// So I should move `updateAssignmentTools` to `assignmentRoutes`.

export default router;
