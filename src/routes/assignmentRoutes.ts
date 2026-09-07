import { Router, Request, Response } from "express";
import {
  createAssignment,
  getAssignment,
  listAssignments,
  updateAssignment,
  deleteAssignment,
  archiveAssignment,
  unarchiveAssignment,
} from "../controllers/assignmentController";
import { requireRoles } from "../lib/auth";
import { AI_APP_ROLES } from "../lib/roles";
import { validate } from "../middleware/validate";
import { createAssignmentSchema, updateAssignmentSchema } from "../schemas";

const router = Router();

/* eslint-disable @typescript-eslint/no-require-imports */
const pkg = require("../../package.json") as { version: string; name: string };
/* eslint-enable @typescript-eslint/no-require-imports */

// /health is unguarded (k8s probe / UI version check)
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    version: pkg.version,
    name: pkg.name,
    model_name: process.env.OLLAMA_MODEL || "unknown",
  });
});

router.use(requireRoles(...AI_APP_ROLES));

router.post("/", validate(createAssignmentSchema), createAssignment);
router.get("/", listAssignments);
router.get("/:id", getAssignment);
router.patch("/:id", validate(updateAssignmentSchema), updateAssignment);
router.delete("/:id", deleteAssignment);
router.post("/:id/archive", archiveAssignment);
router.post("/:id/unarchive", unarchiveAssignment);

export default router;
