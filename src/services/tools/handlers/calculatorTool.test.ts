import { describe, it, expect } from "vitest";
import { calculatorTool } from "./calculatorTool";
import { ToolContext } from "../../../types/tool";

const ctx = {} as ToolContext;
const run = (args: Record<string, unknown>) =>
  calculatorTool.execute(args, ctx);

describe("calculatorTool", () => {
  it("evaluates basic arithmetic with operator precedence", async () => {
    const r = await run({ expression: "2 + 2 * 3 + 10" });
    expect(r.success).toBe(true);
    expect((r.output as { result: number }).result).toBe(18);
  });

  it('strips a trailing "= ?" answer hint the LLM sometimes appends', async () => {
    const r = await run({ expression: "(2 + 2) * 3 = ?" });
    expect(r.success).toBe(true);
    expect((r.output as { result: number }).result).toBe(12);
  });

  it("accepts ** as exponentiation (normalized to ^)", async () => {
    const r = await run({ expression: "2 ** 10" });
    expect(r.success).toBe(true);
    expect((r.output as { result: number }).result).toBe(1024);
  });

  it("formats to requested precision and strips trailing zeros", async () => {
    const r = await run({ expression: "1/4", precision: 5 });
    expect(r.success).toBe(true);
    expect((r.output as { formatted: string }).formatted).toBe("0.25");
  });

  it("rounds to an integer when precision is 0", async () => {
    const r = await run({ expression: "10/3", precision: 0 });
    expect((r.output as { formatted: string }).formatted).toBe("3");
  });

  it("formats a repeating decimal to the requested precision", async () => {
    const r = await run({ expression: "22/7", precision: 4 });
    expect(r.success).toBe(true);
    expect((r.output as { formatted: string }).formatted).toBe("3.1429");
  });

  it("rejects a missing expression", async () => {
    const r = await run({});
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/expression/i);
  });

  it("rejects an out-of-range precision", async () => {
    const r = await run({ expression: "1+1", precision: 99 });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/precision/i);
  });

  it("rejects an expression over 500 characters", async () => {
    const r = await run({ expression: "1+".repeat(300) + "1" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/too long/i);
  });

  it("returns an error (not a crash) for division by zero", async () => {
    const r = await run({ expression: "100/0" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/finite|infinity|nan/i);
  });

  it("returns a structured error for an invalid expression", async () => {
    const r = await run({ expression: "2 +* 3" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/calculation error/i);
  });
});
