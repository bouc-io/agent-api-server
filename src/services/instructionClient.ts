import axios from "axios";
import https from "https";
import { createComponentLogger } from "../lib/logger";

const log = createComponentLogger("instruction-client");

export interface ConfigInstruction {
  id: string;
  title: string;
  content: string;
  priority: number;
}

/**
 * Fetch the full instruction set for the calling user:
 *   - Admin endpoint: global (org_id=null) + org-level instructions (admin-api-server)
 *   - Portal endpoint: personal (user_id-scoped) instructions (portal-api-server)
 *
 * Both calls run in parallel. If either fails, the other still contributes.
 * Results are deduped by id and sorted by priority ascending.
 */
export async function fetchInstructions(
  accessToken: string,
): Promise<ConfigInstruction[]> {
  const adminUrl = process.env.ADMIN_API_URL;
  const portalUrl = process.env.PORTAL_API_URL;

  if (!adminUrl && !portalUrl) {
    log.debug(
      "ADMIN_API_URL and PORTAL_API_URL not set, skipping instruction fetch",
    );
    return [];
  }

  const allowSelfSigned = process.env.ALLOW_SELF_SIGNED_CERTS === "true";
  const httpsAgent = new https.Agent({ rejectUnauthorized: !allowSelfSigned });
  const headers = { Authorization: `Bearer ${accessToken}` };

  const [adminResult, portalResult] = await Promise.allSettled([
    adminUrl
      ? axios.get<{ instructions: ConfigInstruction[] }>(
          `${adminUrl}/v1/config/instructions`,
          { headers, httpsAgent, timeout: 5000 },
        )
      : Promise.reject(new Error("ADMIN_API_URL not configured")),
    portalUrl
      ? axios.get<{ instructions: ConfigInstruction[] }>(
          `${portalUrl}/v1/portal/config/instructions`,
          { headers, httpsAgent, timeout: 5000 },
        )
      : Promise.reject(new Error("PORTAL_API_URL not configured")),
  ]);

  const instructions: ConfigInstruction[] = [];

  if (adminResult.status === "fulfilled") {
    instructions.push(...(adminResult.value.data.instructions ?? []));
  } else {
    log.warn(
      { err: adminResult.reason?.message },
      "Failed to fetch global/org instructions from admin-api-server",
    );
  }

  if (portalResult.status === "fulfilled") {
    instructions.push(...(portalResult.value.data.instructions ?? []));
  } else {
    log.warn(
      { err: portalResult.reason?.message },
      "Failed to fetch personal instructions from portal-api-server",
    );
  }

  // Dedup by id, sort by priority ascending
  const seen = new Set<string>();
  return instructions
    .filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    })
    .sort((a, b) => a.priority - b.priority);
}
