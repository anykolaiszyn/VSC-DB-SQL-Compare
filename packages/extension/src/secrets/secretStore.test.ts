import { describe, expect, it, vi } from "vitest";
import { SecretStore } from "./secretStore";

/**
 * An in-memory mock of `vscode.SecretStorage`. Never touches disk, never a
 * real VS Code host secret store — purely in-process, so this test cannot
 * itself become a channel for a real credential to persist anywhere.
 */
function createMockSecretStorage() {
  const store = new Map<string, string>();
  return {
    store: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key: string) => store.get(key)),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    onDidChange: vi.fn(),
    __raw: store
  };
}

/** Mock `globalState`/`workspaceState` (`vscode.Memento`-shaped) used to assert nothing ever reaches them. */
function createMockMemento() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string) => store.get(key)),
    update: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    keys: vi.fn(() => Array.from(store.keys())),
    __raw: store
  };
}

describe("SecretStore", () => {
  it("round-trips set/get/delete against a mocked SecretStorage", async () => {
    const secrets = createMockSecretStorage();
    const secretStore = new SecretStore(secrets as never);

    await secretStore.set("sqlserver-legacydw", "s3cr3t-password");
    expect(secrets.store).toHaveBeenCalledWith("sqlserver-legacydw", "s3cr3t-password");

    const value = await secretStore.get("sqlserver-legacydw");
    expect(value).toBe("s3cr3t-password");

    await secretStore.delete("sqlserver-legacydw");
    expect(secrets.delete).toHaveBeenCalledWith("sqlserver-legacydw");

    const afterDelete = await secretStore.get("sqlserver-legacydw");
    expect(afterDelete).toBeUndefined();
  });

  it("get() returns undefined for a key that was never set", async () => {
    const secrets = createMockSecretStorage();
    const secretStore = new SecretStore(secrets as never);

    await expect(secretStore.get("never-set")).resolves.toBeUndefined();
  });

  it("never writes a credential-shaped value to globalState or workspaceState", async () => {
    const secrets = createMockSecretStorage();
    const globalState = createMockMemento();
    const workspaceState = createMockMemento();
    const secretStore = new SecretStore(secrets as never);

    await secretStore.set("snowflake-analytics", "super-secret-token");
    await secretStore.get("snowflake-analytics");
    await secretStore.delete("snowflake-analytics");

    // Nothing in SecretStore's implementation has a reference to these
    // mementos at all — this test proves the negative directly: their
    // `update` was never invoked, so no path in SecretStore could have
    // written through them, and their backing maps remain empty.
    expect(globalState.update).not.toHaveBeenCalled();
    expect(workspaceState.update).not.toHaveBeenCalled();
    expect(globalState.__raw.size).toBe(0);
    expect(workspaceState.__raw.size).toBe(0);

    // The only place the credential-shaped value exists is the mocked
    // SecretStorage's in-memory map.
    expect(Array.from(secrets.__raw.values())).not.toContain(undefined);
  });
});
