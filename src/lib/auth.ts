import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createComponentLogger } from "./logger";

const log = createComponentLogger("auth");

export interface UserContext {
  userId: string;
  orgId: string | null;
  roles: string[];
  accessToken: string;
}

/**
 * Extract user context (userId, orgId, roles, accessToken) from request.
 * org_id comes from the Keycloak JWT claim (oidc-usermodel-attribute-mapper on user attribute "org_id").
 * Roles come from realm_access.roles in the JWT.
 * Falls back to OAuth2-Proxy injected headers (x-auth-request-org, x-auth-request-roles).
 */
export const getUserContextFromRequest = (req: Request): UserContext | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const token = authHeader
    .split(",")
    .map((s) => s.trim())
    .find((s) => s.startsWith("Bearer "))
    ?.split(" ")[1];

  if (!token) return null;

  try {
    const decoded = jwt.decode(token) as Record<string, any> | null;
    const userId = decoded?.preferred_username || null;
    if (!userId) return null;

    const orgId: string | null =
      decoded?.org_id || (req.headers["x-auth-request-org"] as string) || null;

    const roles: string[] =
      decoded?.realm_access?.roles ||
      ((req.headers["x-auth-request-roles"] as string) || "")
        .split(",")
        .filter(Boolean);

    return { userId, orgId, roles, accessToken: token };
  } catch (error) {
    log.error({ err: error }, "Failed to decode token");
    return null;
  }
};

/**
 * Extract userId from request (backward compatible wrapper).
 */
export const getUserIdFromRequest = (req: Request): string | null => {
  const context = getUserContextFromRequest(req);
  return context?.userId || null;
};

/**
 * Middleware: require at least one of the specified roles.
 * Pass no roles to require only a valid token (any authenticated user).
 * Ready for GAP 3 RBAC enforcement — not wired to routes in GAP 2.
 */
export const requireRoles =
  (...allowed: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const ctx = getUserContextFromRequest(req);
    if (!ctx) {
      return res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
      });
    }
    if (allowed.length > 0 && !ctx.roles.some((r) => allowed.includes(r))) {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: "Insufficient permissions" },
      });
    }
    next();
  };
