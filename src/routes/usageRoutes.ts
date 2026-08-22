import { Router } from 'express';
import { getUserUsage, getAssignmentUsage } from '../controllers/usageController';
import { requireRoles } from '../lib/auth';

const router = Router();

// Any authenticated user may view their own usage
router.use(requireRoles());

// GET /v1/usage — aggregate token usage for the authenticated user
router.get('/', getUserUsage);

// GET /v1/usage/assignments/:assignmentId — per-assignment breakdown
router.get('/assignments/:assignmentId', getAssignmentUsage);

export default router;
