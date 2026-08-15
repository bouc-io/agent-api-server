import { Router } from 'express';
import {
    listMessages,
    createMessage,
    getMessage,
    deleteMessage,
    getConversationSummary
} from '../controllers/messageController';
import { requireRoles } from '../lib/auth';
import { AI_APP_ROLES } from '../lib/roles';
import { validate } from '../middleware/validate';
import { createMessageSchema } from '../schemas';

const router = Router();

router.use(requireRoles(...AI_APP_ROLES));

// Nested routes under assignments handled by mounting in app.ts or here?
// In app.ts: app.use('/v1', messageRoutes)
// So we need:
// POST /assignments/:assignment_id/messages
// GET /assignments/:assignment_id/messages
// GET /assignments/:assignment_id/summary
// GET /messages/:message_id
// DELETE /messages/:message_id

router.get('/assignments/:assignment_id/messages', listMessages);
router.post('/assignments/:assignment_id/messages', validate(createMessageSchema), createMessage);
router.get('/assignments/:assignment_id/summary', getConversationSummary);

router.get('/assignments/:assignment_id/messages/:message_id', getMessage);
router.delete('/assignments/:assignment_id/messages/:message_id', deleteMessage);

export default router;
