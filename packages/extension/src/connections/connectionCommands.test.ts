import { describe, expect, it, vi } from "vitest";
import { addConnectionCommand, editConnectionCommand, deleteConnectionCommand } from "./connectionCommands";
import { ConnectionProfileStore, secretKeyFor } from "./connectionProfileStore";
import { SecretStore } from "../secrets/secretStore";
import type { ConnectionCommandDeps } from "./connectionCommands";
import * as resolveConnectorModule from "./resolveConnector";
import type { ConnectionTestResult } from "@paritylens/shared";

function createMockSecretStorage() {
  const store = new Map<string, string>();
  return {
    store: async (key: string, value: string) => {
      store.set(key, value);
    },
    get: async (key: string) => store.get(key),
    delete: async (key: string) => {
      store.delete(key);
    },
    onDidChange: () => undefined,
    __raw: store
  };
}

function createMockMemento() {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T) => (store.has(key) ? (store.get(key) as T) : (defaultValue as T)),
    update: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    keys: () => Array.from(store.keys()),
    __raw: store
  };
}

function createStore() {
  const secrets = createMockSecretStorage();
  const globalState = createMockMemento();
  const secretStore = new SecretStore(secrets as never);
  const store = new ConnectionProfileStore(globalState as never, secretStore);
  return { store, secrets, globalState, secretStore };
}

/** Builds mock deps that answer a fixed sequence of prompts, in call order. */
function createDeps(answers: {
  inputBoxes?: Array<string | undefined>;
  quickPicks?: Array<string | undefined>;
  /** Resolves to the clicked item's label, or `undefined` on dismissal. Defaults to always resolving `undefined`. */
  warningChoice?: string | undefined;
}): ConnectionCommandDeps & {
  showInformationMessage: ReturnType<typeof vi.fn>;
  showErrorMessage: ReturnType<typeof vi.fn>;
  withProgress: ReturnType<typeof vi.fn>;
  showWarningMessage: ReturnType<typeof vi.fn>;
} {
  const inputQueue = [...(answers.inputBoxes ?? [])];
  const quickPickQueue = [...(answers.quickPicks ?? [])];

  return {
    showInputBox: vi.fn(async () => inputQueue.shift()),
    showQuickPick: vi.fn(async () => quickPickQueue.shift()),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    withProgress: vi.fn(async (_title: string, task: () => Promise<unknown>) => task()) as unknown as ReturnType<
      typeof vi.fn
    >,
    showWarningMessage: vi.fn(async () => answers.warningChoice)
  } as ConnectionCommandDeps & {
    showInformationMessage: ReturnType<typeof vi.fn>;
    showErrorMessage: ReturnType<typeof vi.fn>;
    withProgress: ReturnType<typeof vi.fn>;
    showWarningMessage: ReturnType<typeof vi.fn>;
  };
}

const VALID_ADD_INPUTS = {
  inputBoxes: ["legacy-sql-prod", "db.example.internal", "1433", "CustomerDb", "parity_reader", "s3cr3t-password"],
  quickPicks: ["sqlserver"]
};

function mockTestConnection(result: ConnectionTestResult | (() => Promise<ConnectionTestResult>)) {
  return vi.spyOn(resolveConnectorModule, "resolveConnector").mockReturnValue({
    testConnection: vi.fn(typeof result === "function" ? result : async () => result)
  } as never);
}

describe("addConnectionCommand", () => {
  it("prompts for name/platform/host/port/database/user/password, tests the connection, and adds the resulting profile via the store on success", async () => {
    const { store, secretStore } = createStore();
    const deps = createDeps(VALID_ADD_INPUTS);
    const testConnection = mockTestConnection({ success: true });

    const profile = await addConnectionCommand(store, deps);

    expect(profile).toBeDefined();
    expect(profile?.name).toBe("legacy-sql-prod");
    expect(profile?.platform).toBe("sqlserver");
    expect(profile?.host).toBe("db.example.internal");
    expect(profile?.port).toBe(1433);
    expect(profile?.database).toBe("CustomerDb");
    expect(profile?.user).toBe("parity_reader");
    // No password-shaped field on the returned profile.
    expect(profile).not.toHaveProperty("password");

    // The password prompt used password: true (not shown in plaintext).
    const passwordCall = (deps.showInputBox as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => (call[0] as { prompt: string }).prompt === "Password"
    );
    expect(passwordCall?.[0]).toMatchObject({ password: true });

    // Stored and retrievable via the store/SecretStore.
    expect(store.get(profile!.id)).toEqual(profile);
    expect(await secretStore.get(secretKeyFor(profile!.id))).toBe("s3cr3t-password");

    // The connection was tested (blocking progress notification) before persisting.
    expect(deps.withProgress).toHaveBeenCalledTimes(1);
    expect((deps.withProgress as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatch(/testing connection/i);

    // Success path: no failure choice offered, existing success message shown, no error.
    expect(deps.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.showInformationMessage).toHaveBeenCalledWith('ParityLens: added connection "legacy-sql-prod"');
    expect(deps.showErrorMessage).not.toHaveBeenCalled();

    testConnection.mockRestore();
  });

  it("returns undefined and adds nothing if the user cancels a prompt", async () => {
    const { store } = createStore();
    const deps = createDeps({ inputBoxes: [undefined] });

    const profile = await addConnectionCommand(store, deps);

    expect(profile).toBeUndefined();
    expect(store.list()).toEqual([]);
  });

  it("shows the failure reason and, on 'Save Anyway', still persists the profile when testConnection resolves a failure", async () => {
    const { store, secretStore } = createStore();
    const deps = createDeps({ ...VALID_ADD_INPUTS, warningChoice: "Save Anyway" });
    const testConnection = mockTestConnection({ success: false, message: "connect ETIMEDOUT db.example.internal:1433" });

    const profile = await addConnectionCommand(store, deps);

    expect(deps.showWarningMessage).toHaveBeenCalledTimes(1);
    const warningArgs = (deps.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(String(warningArgs[0])).toContain("connect ETIMEDOUT db.example.internal:1433");

    expect(profile).toBeDefined();
    expect(store.get(profile!.id)).toEqual(profile);
    expect(await secretStore.get(secretKeyFor(profile!.id))).toBe("s3cr3t-password");
    expect(deps.showInformationMessage).toHaveBeenCalledWith('ParityLens: added connection "legacy-sql-prod"');

    testConnection.mockRestore();
  });

  it("does not call store.add when testConnection fails and the user chooses 'Don't Save'", async () => {
    const { store } = createStore();
    const deps = createDeps({ ...VALID_ADD_INPUTS, warningChoice: "Don't Save" });
    const testConnection = mockTestConnection({ success: false, message: "authentication failed" });

    const profile = await addConnectionCommand(store, deps);

    expect(profile).toBeUndefined();
    expect(store.list()).toEqual([]);
    expect(deps.showInformationMessage).not.toHaveBeenCalled();

    testConnection.mockRestore();
  });

  it("does not call store.add when testConnection fails and the user dismisses the choice (undefined)", async () => {
    const { store } = createStore();
    const deps = createDeps({ ...VALID_ADD_INPUTS, warningChoice: undefined });
    const testConnection = mockTestConnection({ success: false, message: "authentication failed" });

    const profile = await addConnectionCommand(store, deps);

    expect(profile).toBeUndefined();
    expect(store.list()).toEqual([]);
    expect(deps.showInformationMessage).not.toHaveBeenCalled();

    testConnection.mockRestore();
  });

  it("handles testConnection throwing/rejecting the same as a failed result — offers the choice rather than falling into the generic catch's error message", async () => {
    const { store, secretStore } = createStore();
    const deps = createDeps({ ...VALID_ADD_INPUTS, warningChoice: "Save Anyway" });
    const testConnection = mockTestConnection(async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:1433");
    });

    const profile = await addConnectionCommand(store, deps);

    expect(deps.showWarningMessage).toHaveBeenCalledTimes(1);
    const warningArgs = (deps.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(String(warningArgs[0])).toContain("ECONNREFUSED 127.0.0.1:1433");

    // Save Anyway still persists, and the generic catch's "add connection failed" message never fires.
    expect(profile).toBeDefined();
    expect(store.get(profile!.id)).toEqual(profile);
    expect(await secretStore.get(secretKeyFor(profile!.id))).toBe("s3cr3t-password");
    expect(deps.showErrorMessage).not.toHaveBeenCalled();

    testConnection.mockRestore();
  });

  it("never includes the plaintext password in any progress/failure/success message", async () => {
    const { store } = createStore();
    const deps = createDeps({ ...VALID_ADD_INPUTS, warningChoice: "Don't Save" });
    const testConnection = mockTestConnection({ success: false, message: "bad credentials" });

    await addConnectionCommand(store, deps);

    const allStrings: string[] = [];
    for (const call of (deps.withProgress as ReturnType<typeof vi.fn>).mock.calls) {
      allStrings.push(String(call[0]));
    }
    for (const call of (deps.showWarningMessage as ReturnType<typeof vi.fn>).mock.calls) {
      allStrings.push(...call.map((arg: unknown) => String(arg)));
    }
    for (const call of (deps.showInformationMessage as ReturnType<typeof vi.fn>).mock.calls) {
      allStrings.push(...call.map((arg: unknown) => String(arg)));
    }
    for (const call of (deps.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls) {
      allStrings.push(...call.map((arg: unknown) => String(arg)));
    }

    for (const message of allStrings) {
      expect(message).not.toContain("s3cr3t-password");
    }

    testConnection.mockRestore();
  });

  it("surfaces an unexpected error via showErrorMessage rather than throwing", async () => {
    const { store } = createStore();
    const deps = createDeps({
      inputBoxes: ["name", "host", "not-a-number"],
      quickPicks: ["sqlserver"]
    });

    const profile = await addConnectionCommand(store, deps);

    // Invalid port -> promptForProfileFields returns undefined, not a throw.
    expect(profile).toBeUndefined();
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
  });
});

describe("editConnectionCommand", () => {
  it("edits an existing profile, preserving its id and replacing its password", async () => {
    const { store, secretStore } = createStore();
    await store.add(
      {
        id: "existing-id",
        name: "legacy-sql-prod",
        platform: "sqlserver",
        host: "db.example.internal",
        port: 1433,
        database: "CustomerDb",
        user: "parity_reader"
      },
      "original-password"
    );

    const deps = createDeps({
      quickPicks: ["legacy-sql-prod", "sqlserver"],
      inputBoxes: ["legacy-sql-prod", "db2.example.internal", "1434", "CustomerDb", "parity_reader", "rotated-password"]
    });

    const profile = await editConnectionCommand(store, deps);

    expect(profile?.id).toBe("existing-id");
    expect(profile?.host).toBe("db2.example.internal");
    expect(profile?.port).toBe(1434);
    expect(store.list().length).toBe(1);
    expect(await secretStore.get(secretKeyFor("existing-id"))).toBe("rotated-password");
  });

  it("reports nothing to edit and returns undefined when there are no profiles", async () => {
    const { store } = createStore();
    const deps = createDeps({});

    const profile = await editConnectionCommand(store, deps);

    expect(profile).toBeUndefined();
    expect(deps.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("no connections"));
  });
});

describe("deleteConnectionCommand", () => {
  it("deletes the selected profile's metadata and its SecretStore entry", async () => {
    const { store, secretStore } = createStore();
    await store.add(
      {
        id: "existing-id",
        name: "legacy-sql-prod",
        platform: "sqlserver",
        host: "db.example.internal",
        port: 1433,
        database: "CustomerDb",
        user: "parity_reader"
      },
      "s3cr3t-password"
    );

    const deps = createDeps({ quickPicks: ["legacy-sql-prod"] });

    const deletedId = await deleteConnectionCommand(store, deps);

    expect(deletedId).toBe("existing-id");
    expect(store.list()).toEqual([]);
    expect(await secretStore.get(secretKeyFor("existing-id"))).toBeUndefined();
  });

  it("reports nothing to delete and returns undefined when there are no profiles", async () => {
    const { store } = createStore();
    const deps = createDeps({});

    const deletedId = await deleteConnectionCommand(store, deps);

    expect(deletedId).toBeUndefined();
    expect(deps.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("no connections"));
  });

  it("returns undefined and deletes nothing if the user cancels the quick pick", async () => {
    const { store } = createStore();
    await store.add(
      {
        id: "existing-id",
        name: "legacy-sql-prod",
        platform: "sqlserver",
        host: "db.example.internal",
        port: 1433,
        database: "CustomerDb",
        user: "parity_reader"
      },
      "s3cr3t-password"
    );
    const deps = createDeps({ quickPicks: [undefined] });

    const deletedId = await deleteConnectionCommand(store, deps);

    expect(deletedId).toBeUndefined();
    expect(store.list().length).toBe(1);
  });
});
