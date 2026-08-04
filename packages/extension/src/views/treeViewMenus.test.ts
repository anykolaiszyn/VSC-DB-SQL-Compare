import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * T-41: `contributes.menus["view/item/context"]` shape test for the two new
 * inline "add" buttons on the "Connections" and "Comparisons" tree sections.
 *
 * Per TASK-BRIEF.md Scope item 2, VS Code's `view/title` menu group is
 * view-scoped only — it cannot target one specific top-level tree item
 * inside a single view. The brief's "navigation buttons on the
 * Connections/Comparisons tree sections" (section-scoped, not whole-view)
 * therefore maps to `view/item/context` entries with `"group": "inline"`
 * (VS Code's standard pattern for inline row-level icon buttons, e.g. the
 * built-in Source Control view's per-repository inline `+`), each gated by
 * a `when` clause matching the exact `contextValue` the corresponding
 * `ParityTreeItem` carries (`paritylens.section.connections` /
 * `paritylens.section.comparisons`, per `parityTreeDataProvider.ts`'s
 * `ParityTreeItem` constructor: `this.contextValue =
 * "paritylens.section.${section.id}"`), not a `view/title` entry.
 *
 * `contributes.menus` is declarative JSON with no unit-testable runtime
 * rendering hook (same disclosed approach as T-40's `viewsWelcome` shape
 * test in `hasNoContent.test.ts`) — this test asserts on the manifest shape
 * itself and cross-references referenced command IDs against
 * `contributes.commands`, rather than a documented manual Extension
 * Development Host check. No manual check was performed for this task;
 * this test is the sole green-state evidence for the menu contribution's
 * shape.
 *
 * Per VS Code's extension manifest schema, an individual `contributes.menus`
 * entry (command/when/group/alt) has no `icon` field of its own — a
 * contributed command's icon is declared once on its
 * `contributes.commands` entry (the `icon` field there, either a
 * light/dark path pair or a `"$(codiconName)"` string), and VS Code applies
 * it wherever that command is rendered as a button (including inline
 * `view/item/context` group entries). This test therefore asserts the icon
 * on the `contributes.commands` entries for
 * `paritylens.addConnection`/`paritylens.newComparison`, not on the menu
 * entries themselves.
 */
describe("package.json view/item/context menu contributions (T-41)", () => {
  interface CommandContribution {
    command: string;
    title: string;
    icon?: string | { light: string; dark: string };
  }
  interface MenuContribution {
    command: string;
    when: string;
    group?: string;
  }
  interface ExtensionManifest {
    contributes: {
      commands: CommandContribution[];
      menus?: {
        "view/item/context"?: MenuContribution[];
      };
    };
  }

  function loadManifest(): ExtensionManifest {
    const manifestPath = join(__dirname, "..", "..", "package.json");
    return JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
  }

  it("declares exactly two view/item/context entries", () => {
    const manifest = loadManifest();

    expect(manifest.contributes.menus).toBeDefined();
    expect(manifest.contributes.menus?.["view/item/context"]).toHaveLength(2);
  });

  it("each entry references a real, already-registered command ID", () => {
    const manifest = loadManifest();
    const entries = manifest.contributes.menus?.["view/item/context"] ?? [];
    const registeredCommandIds = new Set(manifest.contributes.commands.map((c) => c.command));

    for (const entry of entries) {
      expect(registeredCommandIds.has(entry.command)).toBe(true);
    }
    expect(entries.map((e) => e.command).sort()).toEqual(
      ["paritylens.addConnection", "paritylens.newComparison"].sort()
    );
  });

  it("scopes the addConnection entry to the view AND the connections section only (not the whole view, not another section)", () => {
    const manifest = loadManifest();
    const entries = manifest.contributes.menus?.["view/item/context"] ?? [];
    const entry = entries.find((e) => e.command === "paritylens.addConnection");

    expect(entry?.when).toBe(
      "view == paritylens.dataParityView && viewItem == paritylens.section.connections"
    );
  });

  it("scopes the newComparison entry to the view AND the comparisons section only (not the whole view, not another section)", () => {
    const manifest = loadManifest();
    const entries = manifest.contributes.menus?.["view/item/context"] ?? [];
    const entry = entries.find((e) => e.command === "paritylens.newComparison");

    expect(entry?.when).toBe(
      "view == paritylens.dataParityView && viewItem == paritylens.section.comparisons"
    );
  });

  it("does not scope either entry to paritylens.comparisonFile or paritylens.recentRun (child row contextValues, which must never match a section button)", () => {
    const manifest = loadManifest();
    const entries = manifest.contributes.menus?.["view/item/context"] ?? [];

    for (const entry of entries) {
      expect(entry.when).not.toContain("paritylens.comparisonFile");
      expect(entry.when).not.toContain("paritylens.recentRun");
    }
  });

  it("renders both entries inline (group: 'inline'), not as context-menu-only items", () => {
    const manifest = loadManifest();
    const entries = manifest.contributes.menus?.["view/item/context"] ?? [];

    for (const entry of entries) {
      expect(entry.group).toBe("inline");
    }
  });

  it("declares the 'add' codicon on both commands' contributes.commands entry (icon is command-level, not menu-level, per VS Code's manifest schema)", () => {
    const manifest = loadManifest();
    const addConnection = manifest.contributes.commands.find(
      (c) => c.command === "paritylens.addConnection"
    );
    const newComparison = manifest.contributes.commands.find(
      (c) => c.command === "paritylens.newComparison"
    );

    expect(addConnection?.icon).toBe("$(add)");
    expect(newComparison?.icon).toBe("$(add)");
  });

  it("does not add an icon field to any other command entry", () => {
    const manifest = loadManifest();
    const others = manifest.contributes.commands.filter(
      (c) => c.command !== "paritylens.addConnection" && c.command !== "paritylens.newComparison"
    );

    for (const command of others) {
      expect(command.icon).toBeUndefined();
    }
  });
});
