// T-38: runConfirmationWebview tests -- purity and escaping.
import { describe, expect, it } from "vitest";
import { renderRunConfirmationHtml } from "./runConfirmationWebview.js";

describe("renderRunConfirmationHtml", () => {
  it("is pure: the same input rendered twice produces identical output", () => {
    const queries = ["SELECT COUNT(*) AS row_count FROM \"customer_source\"", "SELECT * FROM \"customer_target\""];

    const first = renderRunConfirmationHtml(queries);
    const second = renderRunConfirmationHtml(queries);

    expect(first).toEqual(second);
  });

  it("renders every query string from the input list (HTML-escaped, matching renderQueryPreviewSection's own escaping)", () => {
    const queries = ["SELECT COUNT(*) AS row_count FROM customer_source", "SELECT COUNT(*) AS row_count FROM customer_target"];

    const html = renderRunConfirmationHtml(queries);

    for (const query of queries) {
      expect(html).toContain(query);
    }
  });

  it("escapes HTML-significant characters in a query string rather than injecting them raw", () => {
    const maliciousQuery = "SELECT * FROM \"t\" WHERE x = '<script>alert(1)</script>'";

    const html = renderRunConfirmationHtml([maliciousQuery]);

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders an empty-state message for an empty query list, and still renders Run/Cancel buttons", () => {
    const html = renderRunConfirmationHtml([]);

    expect(html).toContain("No queries recorded for this run.");
    expect(html).toContain('id="run-button"');
    expect(html).toContain('id="cancel-button"');
  });

  it("includes acquireVsCodeApi()/postMessage wiring for both run and cancel message types", () => {
    const html = renderRunConfirmationHtml(["SELECT 1"]);

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
    const html = renderRunConfirmationHtml(["SELECT 1"]);
    expect(typeof html).toBe("string");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });
});
