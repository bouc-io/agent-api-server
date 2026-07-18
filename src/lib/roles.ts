/** Canonical Keycloak realm role strings. Source of truth: biz_model_usr_access_model.md */
export const ROLES = {
    BOUC_ADMIN:           'bouc_admin',
    BOUC_FINANCE:         'bouc_finance',
    BOUC_OPS:             'bouc_ops',
    BOUC_ENGINEER:        'bouc_engineer',
    BOUC_SRE:             'bouc_sre',
    BOUC_USER:            'bouc_user',
    ORG_ADMIN:            'org_admin',
    ORG_ADMIN_ENTERPRISE: 'org_admin_enterprise',
    ORG_USER:             'org_user',
    PUBLIC_USER:          'public_user',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

/** All internal bouc.io staff roles — these get unrestricted cross-org read access */
export const BOUC_ROLES: Role[] = [
    ROLES.BOUC_ADMIN, ROLES.BOUC_FINANCE, ROLES.BOUC_OPS,
    ROLES.BOUC_ENGINEER, ROLES.BOUC_SRE, ROLES.BOUC_USER,
];

/** Any role with Admin Portal access — used as global /v1/admin guard */
export const ADMIN_PORTAL_ROLES: Role[] = [
    ROLES.BOUC_ADMIN, ROLES.BOUC_FINANCE, ROLES.BOUC_OPS,
    ROLES.BOUC_ENGINEER, ROLES.BOUC_SRE,
    ROLES.ORG_ADMIN, ROLES.ORG_ADMIN_ENTERPRISE,
];

/** Roles that can use AI apps (Chatbot / Agent / Memory) */
export const AI_APP_ROLES: Role[] = [
    ROLES.BOUC_USER, ROLES.ORG_ADMIN, ROLES.ORG_ADMIN_ENTERPRISE,
    ROLES.ORG_USER, ROLES.PUBLIC_USER,
];
