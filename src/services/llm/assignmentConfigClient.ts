/**
 * assignmentConfigClient (agent-api-server)
 *
 * Fetches the resolved LLM provider assignment for 'agent_plan' or 'agent_execution'
 * use-cases from admin-api-server's config endpoint. The endpoint applies the
 * org → global override chain based on the caller's JWT org claim.
 *
 * Returns null on any failure so the caller can fall back to env-var BoucioClient.
 */

import axios from "axios";
import https from "https";
import { LLMProviderConfig, createLLMClient } from "./llmClientFactory";
import { LLMClient } from "../../types/llm";
import { BoucioClient } from "./boucioClient";
import { createComponentLogger } from "../../lib/logger";

const log = createComponentLogger("assignment-config-client");

const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === "true";

/**
 * Fetch the LLM assignment config for the given use-case.
 * Uses the caller's Bearer token so the admin API resolves the correct org assignment.
 *
 * @returns LLMProviderConfig if an assignment is found, null otherwise
 */
export async function fetchAssignmentConfig(
  useCase: "agent_plan" | "agent_execution",
  accessToken: string,
): Promise<LLMProviderConfig | null> {
  const adminUrl = process.env.ADMIN_API_URL;
  if (!adminUrl) {
    log.debug(
      { useCase },
      "ADMIN_API_URL not set — using env-var Ollama fallback",
    );
    return null;
  }

  const httpsAgent = new https.Agent({
    rejectUnauthorized: !ALLOW_SELF_SIGNED_CERTS,
  });

  try {
    const response = await axios.get(
      `${adminUrl}/v1/config/llm-assignment/${useCase}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        httpsAgent,
        timeout: 5000,
      },
    );
    // The admin API returns a nested structure:
    //   { model, enable_reasoning, provider: { id, name, provider, api_endpoint, api_key } }
    // Flatten it to the LLMProviderConfig shape the factory expects.
    const raw = response.data;
    const providerInfo = raw.provider;
    if (!providerInfo) {
      log.debug(
        { useCase },
        "Assignment has no provider configured — using env-var Ollama fallback",
      );
      return null;
    }
    const config: LLMProviderConfig = {
      provider: providerInfo.provider,
      api_endpoint: providerInfo.api_endpoint ?? "",
      api_key: providerInfo.api_key ?? null,
      model: raw.model ?? "",
      enable_reasoning: raw.enable_reasoning ?? false,
    };
    log.debug(
      { useCase, provider: config.provider, model: config.model },
      "Assignment config fetched",
    );
    return config;
  } catch (err: any) {
    if (err?.response?.status === 404) {
      log.debug(
        { useCase },
        "No LLM assignment found — using env-var Ollama fallback",
      );
    } else {
      log.warn(
        { useCase, err: err?.message },
        "Failed to fetch LLM assignment config — using env-var Ollama fallback",
      );
    }
    return null;
  }
}

/**
 * Create an LLMClient from the resolved config.
 * If config is null (no assignment or fetch failed), returns a BoucioClient
 * backed by env vars (OLLAMA_URL + OLLAMA_MODEL) — the internal bouc.io Ollama fallback.
 * The env-var BoucioClient uses tokenManager for cluster OAuth (unchanged pre-GAP-6 behavior).
 */
export function createLLMClientFromConfig(
  config: LLMProviderConfig | null,
): LLMClient {
  if (!config) {
    return new BoucioClient(null); // reads OLLAMA_URL / OLLAMA_MODEL, uses tokenManager
  }
  return createLLMClient(config);
}
