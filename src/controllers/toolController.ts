import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export const listTools = async (_req: Request, res: Response) => {
    try {
        const tools = await prisma.tool.findMany();
        // If no tools exist, we might want to seed default ones or return empty.
        // Design has hardcoded examples, but we are using DB.
        res.json({ tools });
    } catch (error) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list tools' } });
    }
};
