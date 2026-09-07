/**
 * Minimal circuit breaker for outbound dependency calls (LLM, memory, distiller).
 *
 * States:
 *   closed    — calls flow through; consecutive failures are counted.
 *   open       — calls fail fast (no downstream request) until cooldown elapses.
 *   half-open  — a single trial call is allowed; success closes, failure re-opens.
 *
 * This prevents a dead dependency (e.g. Ollama crashed) from being hammered by
 * every run + BullMQ retry. It is deliberately dependency-free and time-injectable
 * for testing.
 */

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit "${name}" is open — failing fast`);
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. Default 5. */
  failureThreshold?: number;
  /** Milliseconds the circuit stays open before allowing a half-open trial. Default 30000. */
  cooldownMs?: number;
  /** Injectable clock for tests. Default Date.now. */
  now?: () => number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(
    public readonly name: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.threshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    // Lazily transition open -> half-open once the cooldown has elapsed.
    if (
      this.state === "open" &&
      this.now() - this.openedAt >= this.cooldownMs
    ) {
      this.state = "half-open";
    }
    return this.state;
  }

  /**
   * Run `fn` through the breaker. Throws CircuitOpenError without calling `fn`
   * when the circuit is open and still cooling down.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();
    if (state === "open") {
      throw new CircuitOpenError(this.name);
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures += 1;
    // A failed half-open trial, or crossing the threshold, opens the circuit.
    if (this.state === "half-open" || this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }
}
