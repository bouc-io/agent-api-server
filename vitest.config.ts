import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only. Integration tests need live Postgres/Redis/Ollama and stay local.
    include: ["src/**/*.test.ts"],
    reporters: ["default", "junit"],
    outputFile: {
      junit: "junit.xml",
    },
    coverage: {
      provider: "v8",
      // "cobertura" writes coverage/cobertura-coverage.xml, which the CI template
      // publishes as the merge-request coverage report.
      reporter: ["text", "cobertura"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/scripts/**", "src/types/**"],
    },
  },
});
