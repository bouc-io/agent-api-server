import swaggerJSDoc from "swagger-jsdoc";

/* eslint-disable @typescript-eslint/no-require-imports */
const pkg = require("../../package.json") as { version: string };
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * OpenAPI spec built from @openapi JSDoc blocks on the route files.
 * Served at /api-docs in non-production (see app.ts). The globs scan TypeScript
 * sources in dev (ts-node/nodemon); /api-docs is not mounted in production.
 */
export const openApiSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "agent-api-server",
      version: pkg.version,
      description:
        "Agentic backend for the bouc.io AI assistant platform — two-phase " +
        "planner/executor loop with tool calling, memory retrieval, and SSE streaming.",
      license: {
        name: "Elastic-2.0",
        url: "https://www.elastic.co/licensing/elastic-license",
      },
    },
    servers: [{ url: "/", description: "Current host" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ["./src/routes/*.ts", "./dist/routes/*.js"],
});
