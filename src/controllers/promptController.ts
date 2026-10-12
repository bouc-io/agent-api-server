import { Request, Response } from "express";
import { createComponentLogger } from "../lib/logger";
import {
  PROMPTSET_HASH,
  PROMPTSET_VERSION,
  getPrompt,
  hasPrompt,
  listPrompts as listPromptMetadata,
  promptsIncluding,
} from "../prompts";
import {
  ASSEMBLED_PROMPT_IDS,
  renderWithFixture,
} from "../prompts/fixtureRender";

const log = createComponentLogger("prompt-controller");

/* eslint-disable @typescript-eslint/no-require-imports */
const pkg = require("../../package.json") as { version: string; name: string };
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * GET /v1/prompts — every prompt and fragment with its version, hash and fragment graph.
 */
export const listPrompts = async (_req: Request, res: Response) => {
  try {
    res.json({
      promptset_version: PROMPTSET_VERSION,
      promptset_hash: PROMPTSET_HASH,
      count: listPromptMetadata().length,
      prompts: listPromptMetadata().map((meta) => ({
        id: meta.id,
        title: meta.title,
        version: meta.version,
        stage: meta.stage,
        role: meta.role,
        hash: meta.hash,
        includes: meta.includes ?? [],
        variables: meta.variables ?? [],
      })),
    });
  } catch (error) {
    log.error({ err: error }, "Error listing prompts");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to list prompts" },
    });
  }
};

/**
 * GET /v1/prompts/:id — the template as authored, plus which prompts a fragment feeds into.
 */
export const getPromptById = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!hasPrompt(id)) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: `Unknown prompt id: ${id}` },
      });
    }

    const entry = getPrompt(id);
    // For a fragment, the useful question is which assembled prompts it changes.
    const basename = id.startsWith("frag.") ? id.slice("frag.".length) : null;

    res.json({
      id: entry.meta.id,
      title: entry.meta.title,
      version: entry.meta.version,
      stage: entry.meta.stage,
      role: entry.meta.role,
      hash: entry.hash,
      includes: entry.meta.includes ?? [],
      variables: entry.meta.variables ?? [],
      note: entry.meta.note ?? null,
      included_by: basename ? promptsIncluding(basename) : [],
      renderable: true,
      assembled_by_builder: (
        ASSEMBLED_PROMPT_IDS as readonly string[]
      ).includes(id),
      template: entry.template,
      promptset_version: PROMPTSET_VERSION,
      promptset_hash: PROMPTSET_HASH,
    });
  } catch (error) {
    log.error({ err: error }, "Error getting prompt");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to get prompt" },
    });
  }
};

/**
 * GET /v1/prompts/:id/rendered — the fully composed text the model receives, rendered
 * against the frozen fixture so the output is stable and comparable between deploys.
 */
export const getRenderedPrompt = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!hasPrompt(id)) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: `Unknown prompt id: ${id}` },
      });
    }

    const clientType = req.query.client_type === "cli" ? "cli" : "web";
    const rendered = renderWithFixture(id, clientType);

    res.json({
      id,
      client_type: clientType,
      fixture: "default",
      promptset_version: PROMPTSET_VERSION,
      promptset_hash: PROMPTSET_HASH,
      rendered,
      rendered_length: rendered.length,
    });
  } catch (error) {
    log.error({ err: error }, "Error rendering prompt");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to render prompt" },
    });
  }
};

/**
 * GET /v1/promptset — the version handle to record alongside eval results.
 */
export const getPromptset = async (_req: Request, res: Response) => {
  try {
    res.json({
      promptset_version: PROMPTSET_VERSION,
      promptset_hash: PROMPTSET_HASH,
      unit_count: listPromptMetadata().length,
      service: pkg.name,
      service_version: pkg.version,
    });
  } catch (error) {
    log.error({ err: error }, "Error getting promptset");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to get promptset" },
    });
  }
};
