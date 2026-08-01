// T-22: direct evidence that @paritylens/engine's package entry point
// (packages/engine/src/index.ts) actually re-exports the real engine API,
// not just T-01's original `PLACEHOLDER = true`. Without this test, a
// missing export here would only surface indirectly as a downstream import
// failure inside packages/extension -- this test asserts the four required
// symbols directly, importing from "./index.js" (this package's own entry
// point) rather than any deep relative path, mirroring how an external
// consumer of @paritylens/engine would import.
import { describe, expect, it } from "vitest";
import {
  parseDefinition,
  InvalidDefinitionError,
  runComparison,
  UnresolvedConnectionError,
  FixtureConnector,
} from "./index.js";
import type { ConnectorRegistry } from "./index.js";

describe("@paritylens/engine package entry point (index.ts)", () => {
  it("exports parseDefinition and InvalidDefinitionError", () => {
    expect(parseDefinition).toBeDefined();
    expect(typeof parseDefinition).toBe("function");
    expect(InvalidDefinitionError).toBeDefined();
  });

  it("exports runComparison and UnresolvedConnectionError", () => {
    expect(runComparison).toBeDefined();
    expect(typeof runComparison).toBe("function");
    expect(UnresolvedConnectionError).toBeDefined();
  });

  it("exports FixtureConnector", () => {
    expect(FixtureConnector).toBeDefined();
    expect(typeof FixtureConnector).toBe("function");
  });

  it("ConnectorRegistry type is usable from the package entry point (compile-time check)", () => {
    const registry: ConnectorRegistry = new Map();
    expect(registry).toBeInstanceOf(Map);
  });
});
