import { toolRegistry } from "../registry";
import { echoTool } from "./echoTool";
import { webSearchTool } from "./webSearchTool";
import { calculatorTool } from "./calculatorTool";
import { timeDateTool } from "./timeDateTool";
import { httpRequestTool } from "./httpRequestTool";
import { fetchPageTool } from "./fetchPageTool";
import { jsonQueryTool } from "./jsonQueryTool";
import { textExtractTool } from "./textExtractTool";
import { memorySearchTool } from "./memorySearchTool";
import { codeExecuteTool } from "./codeExecuteTool";
import { scratchpadWriteTool, scratchpadReadTool } from "./scratchpadTool";
import { spawnSubagentTool } from "./spawnSubagentTool";
import { createComponentLogger } from "../../../lib/logger";

const log = createComponentLogger("tool-handlers");

/**
 * All built-in tool handlers
 */
export const builtinHandlers = [
  echoTool,
  webSearchTool,
  calculatorTool,
  timeDateTool,
  httpRequestTool,
  fetchPageTool,
  jsonQueryTool,
  textExtractTool,
  memorySearchTool,
  scratchpadWriteTool,
  scratchpadReadTool,
  spawnSubagentTool,
  // code_execute is opt-in: only registered (and thus exposed to the model) when
  // ALLOW_CODE_EXECUTE=true, since it needs a container runtime on the host.
  ...(process.env.ALLOW_CODE_EXECUTE === "true" ? [codeExecuteTool] : []),
];

/**
 * Register all built-in tools with the registry
 */
export function registerBuiltinTools(): void {
  for (const handler of builtinHandlers) {
    toolRegistry.register(handler);
  }
  log.info(
    {
      count: builtinHandlers.length,
      tools: builtinHandlers.map((h) => h.name),
    },
    "Registered built-in tools",
  );
}

// Re-export individual tools for direct access
export { echoTool } from "./echoTool";
export { webSearchTool } from "./webSearchTool";
export { calculatorTool } from "./calculatorTool";
export { timeDateTool } from "./timeDateTool";
export { httpRequestTool } from "./httpRequestTool";
export { fetchPageTool } from "./fetchPageTool";
export { jsonQueryTool } from "./jsonQueryTool";
export { textExtractTool } from "./textExtractTool";
export { memorySearchTool } from "./memorySearchTool";
export { codeExecuteTool } from "./codeExecuteTool";
export { scratchpadWriteTool, scratchpadReadTool } from "./scratchpadTool";
export { spawnSubagentTool } from "./spawnSubagentTool";
