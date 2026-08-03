import { describe, expect, it } from "vitest";
import { renderComparisonEditorHtml, type ComparisonEditorDraft } from "./comparisonEditorHtml";

const BASE_DRAFT: ComparisonEditorDraft = {
  comparisonName: "Customer Parity",
  source: { kind: "table", connection: "sqlserver-customer", object: "dbo.Customer" },
  target: { kind: "table", connection: "postgres-products", object: "public.customer" },
  keys: ["customer_id"],
  checks: { schema: true, rowCount: false, profile: false, rowLevel: false },
  connectionOptions: [{ name: "sqlserver-customer" }, { name: "postgres-products" }],
  columnMapping: { mode: "manual", rows: [{ source: "", target: "", targetOptions: [] }] }
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

  it("renders all five tabs (Source, Target, Keys, Checks, Column Mapping)", () => {
    const html = renderComparisonEditorHtml(BASE_DRAFT);
    expect(html).toContain(">Source<");
    expect(html).toContain(">Target<");
    expect(html).toContain(">Keys<");
    expect(html).toContain(">Checks<");
    expect(html.toLowerCase()).toContain("column mapping");
  });

  it("renders an actual Column Mapping tab panel (T-37)", () => {
    const html = renderComparisonEditorHtml(BASE_DRAFT);
    expect(html).toContain('data-panel="columnMapping"');
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

describe("renderComparisonEditorHtml -- Column Mapping tab (T-37)", () => {
  it("renders a populated dropdown row per source column with the fetched target options, in fetched mode", () => {
    const draft: ComparisonEditorDraft = {
      ...BASE_DRAFT,
      columnMapping: {
        mode: "fetched",
        rows: [
          { source: "customer_id", target: "customer_id", targetOptions: ["customer_id", "name", "email"] },
          { source: "full_name", target: "", targetOptions: ["customer_id", "name", "email"] }
        ]
      }
    };
    const html = renderComparisonEditorHtml(draft);
    expect(html).toContain("customer_id");
    expect(html).toContain("full_name");
    // Every target option should appear as a <select> option somewhere.
    expect(html).toContain(">email<");
    // A "no mapping / same name" default option must exist for the unmapped row.
    expect(html.toLowerCase()).toContain("no mapping");
  });

  it("renders plain text inputs (not populated dropdowns) with Add/Remove row affordances in manual mode", () => {
    const draft: ComparisonEditorDraft = {
      ...BASE_DRAFT,
      columnMapping: { mode: "manual", rows: [{ source: "a", target: "b", targetOptions: [] }] }
    };
    const html = renderComparisonEditorHtml(draft);
    expect(html).toContain('data-mapping-add-row');
    expect(html).toContain('data-mapping-remove-row');
  });

  it("shows an inline mapping-tab error without affecting the rest of the document when columnMapping.fetchError is set", () => {
    const draft: ComparisonEditorDraft = {
      ...BASE_DRAFT,
      columnMapping: { mode: "manual", rows: [{ source: "", target: "", targetOptions: [] }], fetchError: "getSchema failed: connection refused" }
    };
    const html = renderComparisonEditorHtml(draft);
    expect(html).toContain("getSchema failed: connection refused");
    // The Source/Target/Keys/Checks tabs must still render normally alongside the error.
    expect(html).toContain(">Source<");
    expect(html).toContain(">Checks<");
  });

  it("escapes HTML-significant characters in fetched column names (untrusted database-originated data)", () => {
    const draft: ComparisonEditorDraft = {
      ...BASE_DRAFT,
      columnMapping: {
        mode: "fetched",
        rows: [{ source: '<script>alert(1)</script>', target: "", targetOptions: ['"><img src=x onerror=alert(2)>'] }]
      }
    };
    const html = renderComparisonEditorHtml(draft);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(2)>");
  });

  it("is pure with a populated columnMapping sub-state: same draft input twice produces identical output", () => {
    const draft: ComparisonEditorDraft = {
      ...BASE_DRAFT,
      columnMapping: {
        mode: "fetched",
        rows: [{ source: "customer_id", target: "customer_id", targetOptions: ["customer_id", "name"] }]
      }
    };
    const first = renderComparisonEditorHtml(draft);
    const second = renderComparisonEditorHtml(JSON.parse(JSON.stringify(draft)));
    expect(first).toBe(second);
  });
});
