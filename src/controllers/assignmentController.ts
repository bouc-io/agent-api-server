import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { getUserContextFromRequest } from '../lib/auth';
import { createComponentLogger } from '../lib/logger';

const log = createComponentLogger('assignment-controller');

export const createAssignment = async (req: Request, res: Response) => {
    const ctx = getUserContextFromRequest(req);
    if (!ctx) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });

    const { title, metadata } = req.body;
    try {
        const assignment = await prisma.assignment.create({
            data: {
                title: title || 'New Conversation',
                metadata: metadata || {},
                user_id: ctx.userId,
                org_id: ctx.orgId,
            }
        });
        res.json(assignment);
    } catch (error) {
        log.error({ err: error }, 'Error creating assignment');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create assignment' } });
    }
};

export const listAssignments = async (req: Request, res: Response) => {
    const ctx = getUserContextFromRequest(req);
    if (!ctx) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });

    const { userId, orgId } = ctx;
    const { page = 1, limit = 20, sort = 'updated_at', order = 'desc' } = req.query;
    const where = {
        user_id: userId,
        ...(orgId && { org_id: orgId }),
    };
    try {
        const assignments = await prisma.assignment.findMany({
            where,
            take: Number(limit),
            skip: (Number(page) - 1) * Number(limit),
            orderBy: { [String(sort)]: String(order) }
        });

        // Get total count for pagination
        const total = await prisma.assignment.count({ where });

        res.json({
            data: assignments,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                total_pages: Math.ceil(total / Number(limit))
            }
        });
    } catch (error) {
        log.error({ err: error }, 'Error listing assignments');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list assignments' } });
    }
};

export const getAssignment = async (req: Request, res: Response) => {
    const ctx = getUserContextFromRequest(req);
    if (!ctx) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });

    const id = String(req.params.id);
    const where = { id, user_id: ctx.userId, ...(ctx.orgId && { org_id: ctx.orgId }) };
    try {
        const assignment = await prisma.assignment.findFirst({ where });
        if (!assignment) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
        }
        res.json(assignment);
    } catch (error) {
        log.error({ err: error }, 'Error getting assignment');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get assignment' } });
    }
};

export const updateAssignment = async (req: Request, res: Response) => {
    const ctx = getUserContextFromRequest(req);
    if (!ctx) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });

    const id = String(req.params.id);
    const { title, metadata } = req.body;
    const where = { id, user_id: ctx.userId, ...(ctx.orgId && { org_id: ctx.orgId }) };
    try {
        const assignment = await prisma.assignment.updateMany({
            where,
            data: { title, metadata }
        });
        if (assignment.count === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
        res.json({ success: true });
    } catch (error) {
        log.error({ err: error }, 'Error updating assignment');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update assignment' } });
    }
};

export const deleteAssignment = async (req: Request, res: Response) => {
    const ctx = getUserContextFromRequest(req);
    if (!ctx) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });

    const id = String(req.params.id);
    const where = { id, user_id: ctx.userId, ...(ctx.orgId && { org_id: ctx.orgId }) };
    try {
        const result = await prisma.assignment.deleteMany({ where });
        if (result.count === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
        res.status(204).send();
    } catch (error) {
        log.error({ err: error }, 'Error deleting assignment');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete assignment' } });
    }
};

export const archiveAssignment = async (req: Request, res: Response) => {
    const ctx = getUserContextFromRequest(req);
    if (!ctx) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });

    const id = String(req.params.id);
    const where = { id, user_id: ctx.userId, ...(ctx.orgId && { org_id: ctx.orgId }) };
    try {
        const result = await prisma.assignment.updateMany({ where, data: { is_archived: true } });
        if (result.count === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
        res.json({ success: true });
    } catch (error) {
        log.error({ err: error }, 'Error archiving assignment');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to archive assignment' } });
    }
};

export const unarchiveAssignment = async (req: Request, res: Response) => {
    const ctx = getUserContextFromRequest(req);
    if (!ctx) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });

    const id = String(req.params.id);
    const where = { id, user_id: ctx.userId, ...(ctx.orgId && { org_id: ctx.orgId }) };
    try {
        const result = await prisma.assignment.updateMany({ where, data: { is_archived: false } });
        if (result.count === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Assignment not found' } });
        res.json({ success: true });
    } catch (error) {
        log.error({ err: error }, 'Error unarchiving assignment');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to unarchive assignment' } });
    }
};
