import { describe, it, expect } from "vitest";
import { detectLoop, toolCallSignature } from "./loopDetection";

// Helper: build aligned signature + name arrays from a list of {name, args}.
function hist(calls: Array<{ name: string; args: unknown }>) {
  const signatures = calls.map((c) =>
    toolCallSignature({ name: c.name, arguments: c.args }),
  );
  const names = calls.map((c) => c.name);
  return { signatures, names };
}

describe("detectLoop", () => {
  it("does not abort on an empty or short history", () => {
    expect(detectLoop([], []).abort).toBe(false);
    const h = hist([{ name: "calc", args: { e: "1+1" } }]);
    expect(detectLoop(h.signatures, h.names).abort).toBe(false);
  });

  it("aborts on 3 identical (name+args) calls", () => {
    const h = hist([
      { name: "calc", args: { e: "1+1" } },
      { name: "calc", args: { e: "1+1" } },
      { name: "calc", args: { e: "1+1" } },
    ]);
    const d = detectLoop(h.signatures, h.names);
    expect(d.abort).toBe(true);
    expect(d.reason).toBe("identical_repeat");
  });

  it("does not abort on 2 identical calls (under threshold)", () => {
    const h = hist([
      { name: "calc", args: { e: "1+1" } },
      { name: "calc", args: { e: "1+1" } },
    ]);
    expect(detectLoop(h.signatures, h.names).abort).toBe(false);
  });

  it("aborts on 5 consecutive calls to the same tool even with differing args", () => {
    const h = hist([
      { name: "web_search", args: { q: "a" } },
      { name: "web_search", args: { q: "b" } },
      { name: "web_search", args: { q: "c" } },
      { name: "web_search", args: { q: "d" } },
      { name: "web_search", args: { q: "e" } },
    ]);
    const d = detectLoop(h.signatures, h.names);
    expect(d.abort).toBe(true);
    expect(d.reason).toBe("consecutive_same_tool");
    expect(d.toolName).toBe("web_search");
  });

  it("does not abort when different tools interleave", () => {
    const h = hist([
      { name: "web_search", args: { q: "a" } },
      { name: "calc", args: { e: "1" } },
      { name: "web_search", args: { q: "b" } },
      { name: "calc", args: { e: "2" } },
    ]);
    expect(detectLoop(h.signatures, h.names).abort).toBe(false);
  });
});
