import { describe, expect, it } from "vitest";
import { resolveOpenHandsBridgeConfig } from "./config.js";

describe("resolveOpenHandsBridgeConfig", () => {
  it("defaults to vendored local mode", () => {
    const config = resolveOpenHandsBridgeConfig({} as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe("vendor_local");
    expect(config.vendorPath.endsWith("vendor/openhands")).toBe(true);
  });

  it("supports disabling the integration", () => {
    const config = resolveOpenHandsBridgeConfig({ OPENHANDS_ENABLED: "0" } as NodeJS.ProcessEnv);
    expect(config.mode).toBe("disabled");
  });
});
