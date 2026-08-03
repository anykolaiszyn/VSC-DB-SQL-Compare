// T-38: runConfirmationWebview tests -- purity and escaping.
import { describe, expect, it } from "vitest";
import { renderRunConfirmationHtml } from "./runConfirmationWebview.js";

describe("renderRunConfirmationHtml", () => {
  it("is pure: the same input rendered twice produces identical output", () => {
    const queries = ["SELECT COUNT(*) AS row_count FROM \"customer_source\"", "SELECT * FROM \"customer_target\""];

    const first = renderRunConfirmationHtml(queries, false);
    const second = renderRunConfirmationHtml(queries, false);

    expect(first).toEqual(second);
  });

  it("renders every query string from the input list (HTML-escaped, matching renderQueryPreviewSection's own escaping)", () => {
    const queries = ["SELECT COUNT(*) AS row_count FROM customer_source", "SELECT COUNT(*) AS row_count FROM customer_target"];

    const html = renderRunConfirmationHtml(queries, false);

    for (const query of queries) {
      expect(html).toContain(query);
    }
  });

  it("escapes HTML-significant characters in a query string rather than injecting them raw", () => {
    const maliciousQuery = "SELECT * FROM \"t\" WHERE x = '<script>alert(1)</script>'";

    const html = renderRunConfirmationHtml([maliciousQuery], false);

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders an empty-state message for an empty query list, and still renders Run/Cancel buttons", () => {
    const html = renderRunConfirmationHtml([], false);

    expect(html).toContain("No queries recorded for this run.");
    expect(html).toContain('id="run-button"');
    expect(html).toContain('id="cancel-button"');
  });

  it("includes acquireVsCodeApi()/postMessage wiring for both run and cancel message types", () => {
    const html = renderRunConfirmationHtml(["SELECT 1"], false);

    expect(html).toContain("acquireVsCodeApi()");
    expect(html).toContain("type: 'run'");
    expect(html).toContain("type: 'cancel'");
  });

  it("never contains a vscode API import beyond markup/script text (renderRunConfirmationHtml is decoupled from the live vscode module)", () => {
    // This is really a compile-time property (no `import * as vscode`/
    // `import type * as vscode` at the top of runConfirmationWebview.ts),
    // asserted here as a smoke check that the rendered output is plain HTML
    // text, not something requiring a live vscode.Webview instance to
    // produce.
    const html = renderRunConfirmationHtml(["SELECT 1"], false);
    expect(typeof html).toBe("string");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  // T-49: resolves finding T-38-01 -- the confirmation panel must
  // distinguish "connection unreachable" from "definition legitimately
  // produces zero queries" rather than rendering the same empty-queries
  // state for both.
  describe("connectionUnreachable (T-49, finding T-38-01)", () => {
    it("renders the distinguishing connectivity-failure notice when connectionUnreachable is true, instead of the normal query-count notice", () => {
      const html = renderRunConfirmationHtml([], true);

      expect(html).toContain("could not be reached");
      expect(html).not.toContain("ParityLens will issue");
    });

    it("still renders Run/Cancel buttons and the normal empty-state query section when connectionUnreachable is true", () => {
      const html = renderRunConfirmationHtml([], true);

      expect(html).toContain('id="run-button"');
      expect(html).toContain('id="cancel-button"');
      expect(html).toContain("No queries recorded for this run.");
    });

    it("renders the original 'no queries' empty-state notice -- not the connectivity-failure message -- for a genuinely legitimately-zero-queries case (reachable connections, all checks disabled)", () => {
      // Adversarial case per TASK-BRIEF.md's Handoff note: an empty query
      // list with connectionUnreachable explicitly false must render
      // exactly as it did before this task, proving the two states stay
      // visually distinguishable in both directions, not just when
      // connectionUnreachable is true.
      const html = renderRunConfirmationHtml([], false);

      expect(html).toContain("ParityLens will issue 0 queries");
      expect(html).not.toContain("could not be reached");
    });

    it("renders the normal query-count notice (not the connectivity-failure message) when connectionUnreachable is false and queries are present", () => {
      const html = renderRunConfirmationHtml(["SELECT 1"], false);

      expect(html).toContain("ParityLens will issue 1 query");
      expect(html).not.toContain("could not be reached");
    });
  });
});
