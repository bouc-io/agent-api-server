import { describe, it, expect } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "./circuitBreaker";

const ok = () => Promise.resolve("ok");
const boom = () => Promise.reject(new Error("fail"));

describe("CircuitBreaker", () => {
  it("stays closed and passes results through on success", async () => {
    const cb = new CircuitBreaker("t");
    await expect(cb.execute(ok)).resolves.toBe("ok");
    expect(cb.getState()).toBe("closed");
  });

  it("opens after the failure threshold and then fails fast", async () => {
    const cb = new CircuitBreaker("t", {
      failureThreshold: 3,
      cooldownMs: 1000,
      now: () => 0,
    });
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(boom)).rejects.toThrow("fail");
    }
    expect(cb.getState()).toBe("open");
    // Now fails fast WITHOUT invoking fn
    let called = false;
    await expect(
      cb.execute(async () => {
        called = true;
        return "x";
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(called).toBe(false);
  });

  it("transitions to half-open after cooldown and closes on a successful trial", async () => {
    let t = 0;
    const cb = new CircuitBreaker("t", {
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => t,
    });
    await expect(cb.execute(boom)).rejects.toThrow();
    expect(cb.getState()).toBe("open");
    t = 150; // cooldown elapsed
    expect(cb.getState()).toBe("half-open");
    await expect(cb.execute(ok)).resolves.toBe("ok");
    expect(cb.getState()).toBe("closed");
  });

  it("re-opens if the half-open trial fails", async () => {
    let t = 0;
    const cb = new CircuitBreaker("t", {
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => t,
    });
    await expect(cb.execute(boom)).rejects.toThrow();
    t = 150;
    expect(cb.getState()).toBe("half-open");
    await expect(cb.execute(boom)).rejects.toThrow("fail");
    expect(cb.getState()).toBe("open");
  });

  it("resets the failure count after an intervening success", async () => {
    const cb = new CircuitBreaker("t", { failureThreshold: 3, now: () => 0 });
    await expect(cb.execute(boom)).rejects.toThrow();
    await expect(cb.execute(boom)).rejects.toThrow();
    await expect(cb.execute(ok)).resolves.toBe("ok"); // resets
    await expect(cb.execute(boom)).rejects.toThrow();
    expect(cb.getState()).toBe("closed"); // only 1 failure since reset
  });
});
