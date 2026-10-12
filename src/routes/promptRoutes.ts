import { Router } from "express";
import {
  getPromptById,
  getPromptset,
  getRenderedPrompt,
  listPrompts,
} from "../controllers/promptController";
import { requireRoles } from "../lib/auth";
import { BOUC_ROLES } from "../lib/roles";

const router = Router();

// Mounted at /v1/assignments, AHEAD of assignmentRoutes in app.ts, so these paths resolve
// before assignmentRoutes' `/:id` can match the literal segment "prompts". Anything this
// router does not declare falls through to assignmentRoutes untouched.
//
// Two constraints shape the guard:
//
// 1. It is applied PER ROUTE, never via router.use(). A router-level guard would reject
//    every /v1/assignments/* request (including ordinary assignment reads) before it could
//    fall through to assignmentRoutes.
// 2. It allows any bouc.io staff role (BOUC_ROLES: bouc_admin, bouc_finance, bouc_ops,
//    bouc_engineer, bouc_sre, bouc_user). Deliberately NOT ADMIN_PORTAL_ROLES, which
//    includes ORG_ADMIN and ORG_ADMIN_ENTERPRISE: those are customer administrators, and
//    prompt text carries the injection-defense and tool-policy rules.
//    AI_APP_ROLES, the blanket guard on assignmentRoutes, overlaps BOUC_ROLES only at
//    bouc_user. The other five staff roles would be rejected by it, which is why these
//    routes live in their own router mounted ahead of it rather than inside it.
const promptGuard = requireRoles(...BOUC_ROLES);

/**
 * @openapi
 * /v1/assignments/prompts:
 *   get:
 *     summary: List every prompt and fragment with its version, hash and fragment graph
 *     tags: [Prompts]
 *     responses:
 *       '200':
 *         description: The full promptset inventory
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 promptset_version: { type: string }
 *                 promptset_hash: { type: string }
 *                 count: { type: integer }
 *                 prompts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       title: { type: string }
 *                       version: { type: integer }
 *                       stage: { type: string }
 *                       role: { type: string }
 *                       hash: { type: string }
 *                       includes: { type: array, items: { type: string } }
 *                       variables: { type: array, items: { type: string } }
 *       '401': { description: Unauthorized }
 *       '403': { description: Forbidden — requires a bouc.io staff role }
 */
router.get("/prompts", promptGuard, listPrompts);

/**
 * @openapi
 * /v1/assignments/prompts/{id}/rendered:
 *   get:
 *     summary: Render a prompt against the frozen fixture (the text the model receives)
 *     tags: [Prompts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Prompt id, e.g. executor.system or frag.formatting
 *       - in: query
 *         name: client_type
 *         required: false
 *         schema: { type: string, enum: [web, cli] }
 *         description: Selects the completion-instruction variant (default web)
 *     responses:
 *       '200':
 *         description: Fully composed prompt text, fragments resolved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 client_type: { type: string }
 *                 fixture: { type: string }
 *                 promptset_version: { type: string }
 *                 promptset_hash: { type: string }
 *                 rendered: { type: string }
 *                 rendered_length: { type: integer }
 *       '401': { description: Unauthorized }
 *       '403': { description: Forbidden — requires a bouc.io staff role }
 *       '404': { description: Unknown prompt id }
 */
router.get("/prompts/:id/rendered", promptGuard, getRenderedPrompt);

/**
 * @openapi
 * /v1/assignments/prompts/{id}:
 *   get:
 *     summary: Get one prompt's template and metadata
 *     tags: [Prompts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Template as authored, plus which prompts a fragment feeds into
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 title: { type: string }
 *                 version: { type: integer }
 *                 stage: { type: string }
 *                 role: { type: string }
 *                 hash: { type: string }
 *                 includes: { type: array, items: { type: string } }
 *                 variables: { type: array, items: { type: string } }
 *                 note: { type: string, nullable: true }
 *                 included_by: { type: array, items: { type: string } }
 *                 assembled_by_builder: { type: boolean }
 *                 template: { type: string }
 *       '401': { description: Unauthorized }
 *       '403': { description: Forbidden — requires a bouc.io staff role }
 *       '404': { description: Unknown prompt id }
 */
router.get("/prompts/:id", promptGuard, getPromptById);

/**
 * @openapi
 * /v1/assignments/promptset:
 *   get:
 *     summary: Promptset version and hash — the handle to record against eval results
 *     tags: [Prompts]
 *     responses:
 *       '200':
 *         description: Version handle for this deployment
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 promptset_version: { type: string }
 *                 promptset_hash: { type: string }
 *                 unit_count: { type: integer }
 *                 service: { type: string }
 *                 service_version: { type: string }
 *       '401': { description: Unauthorized }
 *       '403': { description: Forbidden — requires a bouc.io staff role }
 */
router.get("/promptset", promptGuard, getPromptset);

export default router;
