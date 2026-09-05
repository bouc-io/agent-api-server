import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Flat config. Named .mjs because this package is CommonJS (no "type": "module"),
// so a plain eslint.config.js would be parsed as CJS and the imports would fail.
export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "coverage",
      "prisma/migrations",
      "*.config.mjs",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Ratchet rules: warnings, counted against --max-warnings in CI and lowered
      // over time. Everything else stays an error and fails immediately.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // CLAUDE.md logging standard: services log structured JSON via pino, not console.
      // The deliberate bootstrap calls in src/lib/tracing.ts carry inline disables.
      "no-console": "warn",
      // `declare global { namespace Express { ... } }` is the only way to augment
      // Express's Request type. allowDeclarations permits exactly that, and still
      // rejects ordinary namespace usage.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
    },
  },
  {
    // Seed and maintenance scripts are CLIs; console is the correct output channel.
    // Locations vary by repo: src/scripts (agent), scripts (memory), prisma (chatbot).
    files: ["src/scripts/**/*.ts", "scripts/**/*.ts", "prisma/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  // Must stay last: turns off every stylistic rule that would fight prettier.
  prettier
);
