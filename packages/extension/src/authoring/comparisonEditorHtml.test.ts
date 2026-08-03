import { describe, expect, it } from "vitest";
import { renderComparisonEditorHtml, type ComparisonEditorDraft } from "./comparisonEditorHtml";

const BASE_DRAFT: ComparisonEditorDraft = {
  comparisonName: "Customer Parity",
  source: { kind: "table", connection: "sqlserver-customer", object: "dbo.Customer" },
  target: { kind: "table", connection: "postgres-products", object: "public.customer" },
  keys: ["customer_id"],
  checks: { schema: true, rowCount: false, profile: false, rowLevel: false },
  connectionOptions: [{ name: "sqlserver-customer" }, { name: "postgres-products" }]
};

describe("renderComparisonEditorHtml", () => {
  it("is a pure function: the same input rendered twice produces identical output", () => {
    const first = renderComparisonEditorHtml(BASE_DRAFT);
    const second = renderComparisonEditorHtml(BASE_DRAFT);
    expect(first).toBe(second);
  });

  it("is a pure function even for a fresh, structurally-equal-but-not-identical draft object", () => {
    const draftCopy: ComparisonEditorDraft = JSON.parse(JSON.stringify(BASE_DRAFT));
    const first = renderComparisonEditorHtml(BASE_DRAFT);
    const second = renderComparisonEditorHtml(draftCopy);
    expect(first).toBe(second);
  });

  it("takes only a ComparisonEditorDraft argument (arity 1)", () => {
    expect(renderComparisonEditorHtml.length).toBe(1);
  });

  it("renders all four tabs (Source, Target, Keys, Checks) and a placeholder for the not-yet-built Column Mapping tab", () => {
    const html = renderComparisonEditorHtml(BASE_DRAFT);
    expect(html).toContain(">Source<");
    expect(html).toContain(">Target<");
    expect(html).toContain(">Keys<");
    expect(html).toContain(">Checks<");
    expect(html.toLowerCase()).toContain("column mapping");
  });

  it("does not render an actual Column Mapping tab panel (T-37's scope, not this task's)", () => {
    const html = renderComparisonEditorHtml(BASE_DRAFT);
    expect(html).not.toContain('data-panel="columnMapping"');
    expect(html).not.toContain('data-panel="mapping"');
  });

  it("renders the connection picker with only bare connection name strings, never host/port/user/password fields", () => {
    const html = renderComparisonEditorHtml(BASE_DRAFT);
    expect(html).toContain("sqlserver-customer");
    expect(html).toContain("postgres-products");
    expect(html.toLowerCase()).not.toContain("password");
    expect(html.toLowerCase()).not.toContain("\"host\"");
  });

  it("renders the four Checks toggles with their current enabled state", () => {
    const html = renderComparisonEditorHtml(BASE_DRAFT);
    expect(html).toContain('id="check-schema" data-field="checks.schema" checked');
    expect(html).toContain('id="check-rowCount" data-field="checks.rowCount"');
    expect(html).not.toContain('id="check-rowCount" data-field="checks.rowCount" checked');
  });

  it("renders a Query-mode side's sql field and a SQL-File-mode side's filePath field", () => {
    const draft: ComparisonEditorDraft = {
      ...BASE_DRAFT,
      source: { kind: "query", connection: "sqlserver-customer", sql: "SELECT 1" },
      target: { kind: "sqlFile", connection: "postgres-products", filePath: "queries/target.sql" }
    };
    const html = renderComparisonEditorHtml(draft);
    expect(html).toContain('value="SELECT 1"');
    expect(html).toContain('value="queries/target.sql"');
  });

  it("shows the disclosed parse-error banner (not a crash) when draft.parseError is set", () => {
    const draft: ComparisonEditorDraft = {
      ...BASE_DRAFT,
      parseError: { message: "Unexpected token at line 3", rawText: "not: valid: yaml: at: all" }
    };
    const html = renderComparisonEditorHtml(draft);
    expect(html.toLowerCase()).toContain("this file has a parse error");
    expect(html).toContain("Unexpected token at line 3");
    expect(html).toContain("not: valid: yaml: at: all");
  });

  it("escapes HTML-significant characters in every interpolated draft field (XSS/purity safety)", () => {
    const draft: ComparisonEditorDraft = {
      ...BASE_DRAFT,
      comparisonName: '<img src=x onerror=alert(1)>',
      source: { kind: "table", connection: "sqlserver-customer", object: '"><script>alert(2)</script>' },
      keys: ['<b>key</b>']
    };
    const html = renderComparisonEditorHtml(draft);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).not.toContain("<b>key</b>");
    expect(html).toContain("&lt;img");
  });

  it("embeds the initial draft as static JSON assigned to window.__PARITYLENS_DRAFT__, safely escaping a </script>-like substring", () => {
    const draft: ComparisonEditorDraft = {
      ...BASE_DRAFT,
      source: { kind: "query", connection: "sqlserver-customer", sql: "</script><script>alert(1)</script>" }
    };
    const html = renderComparisonEditorHtml(draft);
    // The literal, unescaped closing-script substring must never appear
    // inside the script-assignment area -- otherwise it would prematurely
    // terminate the <script> tag and inject the remainder as page markup.
    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).toContain("__PARITYLENS_DRAFT__");
  });

  it("embeds the same static client-side <script> body regardless of draft content (script text is deterministic, not built from draft data)", () => {
    const htmlA = renderComparisonEditorHtml(BASE_DRAFT);
    const htmlB = renderComparisonEditorHtml({ ...BASE_DRAFT, comparisonName: "A Totally Different Name" });

    const extractScriptBody = (html: string): string => {
      const marker = "acquireVsCodeApi";
      const start = html.indexOf(marker);
      const scriptEnd = html.indexOf("</script>", start);
      return html.slice(start, scriptEnd);
    };

    expect(extractScriptBody(htmlA)).toBe(extractScriptBody(htmlB));
  });

  it("sets enableScripts-requiring markup: contains a real <script> tag (this editor deliberately differs from resultsWebview.ts)", () => {
    const html = renderComparisonEditorHtml(BASE_DRAFT);
    expect(html).toContain("<script>");
    expect(html).toContain("acquireVsCodeApi()");
  });
});
