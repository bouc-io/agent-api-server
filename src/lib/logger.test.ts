import { describe, it, expect } from "vitest";
import pino from "pino";
import { AxiosError } from "axios";
import { loggerOptions } from "./logger";

// Build a logger with the production options, writing to memory instead of stdout.
const capture = () => {
  const lines: string[] = [];
  const log = pino(
    { ...loggerOptions, level: "debug" },
    { write: (line: string) => lines.push(line) },
  );
  return { log, output: () => lines.join("") };
};

const axiosErrorWithBearer = () =>
  new AxiosError("Request failed with status code 401", "ERR_BAD_REQUEST", {
    method: "get",
    url: "https://admin.example/v1/config/instructions",
    headers: { Authorization: "Bearer secret-xyz" },
  } as never);

describe("logger credential safety", () => {
  it("never prints the Authorization header of an axios error logged as err", () => {
    const { log, output } = capture();
    log.error({ err: axiosErrorWithBearer() }, "call failed");
    expect(output()).not.toContain("secret-xyz");
    expect(output()).toContain("Request failed with status code 401");
    expect(output()).toContain("admin.example/v1/config/instructions");
  });

  it("never prints the Authorization header of an axios error logged as error", () => {
    const { log, output } = capture();
    log.warn({ error: axiosErrorWithBearer() }, "call failed");
    expect(output()).not.toContain("secret-xyz");
  });

  it("redacts accessToken nested one level deep (e.g. job data)", () => {
    const { log, output } = capture();
    log.debug({ jobData: { runId: "r1", accessToken: "eyJ.secret" } }, "job");
    expect(output()).not.toContain("eyJ.secret");
    expect(output()).toContain("[REDACTED]");
    expect(output()).toContain("r1");
  });

  it("keeps regular errors fully serialized", () => {
    const { log, output } = capture();
    log.error({ err: new Error("plain failure") }, "boom");
    expect(output()).toContain("plain failure");
    expect(output()).toContain('"stack"');
  });
});
