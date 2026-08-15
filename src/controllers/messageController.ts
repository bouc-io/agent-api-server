import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { getUserIdFromRequest, getUserContextFromRequest } from '../lib/auth';
import { enqueueRunExecution } from '../lib/queue';
import { createComponentLogger } from '../lib/logger';

const log = createComponentLogger('message-controller');

export const listMessages = async (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });

    const assignment_id = String(req.params.assignment_id);
    const { page = 1, limit = 20, before, after } = req.query;

    try {
        // Verify assignment ownership
        const assignment = await prisma.assignment.findFirst({ where: { id: assignment_id, user_id: userId } });
        if (!assignment) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
        }

        const messages = await prisma.message.findMany({
            where: { assignment_id: assignment_id },
            orderBy: { created_at: 'asc' },
            take: Number(limit),
            skip: (Number(page) - 1) * Number(limit)
        });

        // Pagination logic using before/after is not fully implemented but structure is here

        res.json({ data: messages, pagination: { has_more: false } });
    } catch (error) {
        log.error({ err: error }, 'Error listing messages');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list messages' } });
    }
};

export const createMessage = async (req: Request, res: Response) => {
    const userContext = getUserContextFromRequest(req);
    if (!userContext) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });
    }
    const { userId, accessToken } = userContext;

    const assignment_id = String(req.params.assignment_id);
    const { content, metadata, role, options } = req.body;

    try {
        // Check if assignment exists and belongs to user
        const assignment = await prisma.assignment.findFirst({ where: { id: assignment_id, user_id: userId } });
        if (!assignment) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
        }

        // Create user message
        const message = await prisma.message.create({
            data: {
                assignment_id: assignment_id,
                role: role || 'user',
                content,
                metadata: metadata || {}
            }
        });

        // Check for existing active run (one active run per assignment)
        const activeRun = await prisma.run.findFirst({
            where: {
                assignment_id: assignment_id,
                status: { in: ['queued', 'running'] },
            },
        });
        if (activeRun) {
            return res.status(409).json({
                error: {
                    code: 'CONFLICT',
                    message: 'Assignment already has an active run',
                },
                active_run_id: activeRun.id,
            });
        }

        // Create a run for this message
        const agent_id = options?.agent_id || 'default';
        const clientType = (options?.client_type as string) || 'web';
        // Headless eval opt-in for HITL auto-approval; only honored when the server
        // sets EVAL_AUTO_APPROVE=true (enforced in the executor). Ignored in production.
        const evalMode = options?.eval_mode === true;
        const run = await prisma.run.create({
            data: {
                assignment_id: assignment_id,
                user_id: userId,
                agent_id,
                trigger_message_id: message.id,
                status: 'queued',
            },
        });

        // Enqueue for processing
        const jobId = await enqueueRunExecution({
            runId: run.id,
            assignmentId: assignment_id,
            userId,
            accessToken,
            clientType,
            evalMode,
        });

        if (!jobId) {
            // Queue not available, update run status to failed
            await prisma.run.update({
                where: { id: run.id },
                data: {
                    status: 'failed',
                    error: 'Queue service unavailable',
                    ended_at: new Date(),
                },
            });
            return res.status(503).json({
                error: {
                    code: 'SERVICE_UNAVAILABLE',
                    message: 'Queue service unavailable',
                },
            });
        }

        // Return V2 response format with both message and run info
        res.status(202).json({
            assignment_id: assignment_id,
            user_message: {
                id: message.id,
                assignment_id: message.assignment_id,
                role: message.role,
                content: message.content,
                created_at: message.created_at.toISOString(),
                metadata: message.metadata || {},
            },
            run: {
                id: run.id,
                status: run.status,
                stream_url: `/v1/assignments/${assignment_id}/runs/${run.id}/stream`,
            },
        });
    } catch (error) {
        log.error({ err: error }, 'Error creating message');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create message' } });
    }
};

export const getMessage = async (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });

    const assignment_id = String(req.params.assignment_id);
    const message_id = String(req.params.message_id);
    try {
        // Verify assignment ownership
        const assignment = await prisma.assignment.findFirst({ where: { id: assignment_id, user_id: userId } });
        if (!assignment) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
        }

        const message = await prisma.message.findUnique({ where: { id: message_id } });
        if (!message) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Message not found' } });
        }
        if (message.assignment_id !== assignment_id) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Message not found in this assignment' } });
        }
        res.json(message);
    } catch (error) {
        log.error({ err: error }, 'Error getting message');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get message' } });
    }
};

export const deleteMessage = async (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });

    const assignment_id = String(req.params.assignment_id);
    const message_id = String(req.params.message_id);
    try {
        // Verify assignment ownership
        const assignment = await prisma.assignment.findFirst({ where: { id: assignment_id, user_id: userId } });
        if (!assignment) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
        }

        const message = await prisma.message.findUnique({ where: { id: message_id } });
        if (!message) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Message not found' } });
        }
        if (message.assignment_id !== assignment_id) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Message not found in this assignment' } });
        }
        await prisma.message.delete({ where: { id: message_id } });
        res.status(204).send();
    } catch (error) {
        log.error({ err: error }, 'Error deleting message');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete message' } });
    }
};

export const getConversationSummary = async (req: Request, res: Response) => {
    // const assignment_id = String(req.params.assignment_id);
    // Placeholder summary logic
    res.json({ summary: "Conversation summary not implemented yet." });
};
