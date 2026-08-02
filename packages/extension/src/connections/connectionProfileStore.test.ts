import { describe, expect, it } from "vitest";
import { ConnectionProfileStore, secretKeyFor } from "./connectionProfileStore";
import { SecretStore } from "../secrets/secretStore";
import type { ConnectionProfile } from "./connectionProfile";

/**
 * In-memory mock of `vscode.SecretStorage`, mirroring
 * `secretStore.test.ts`'s own mock exactly (see that file's header comment)
 * -- purely in-process, never touches disk or a real VS Code host.
 */
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

/** Mock `globalState` (`vscode.Memento`-shaped), backed by a plain in-memory map. */
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

const SAMPLE_PROFILE: ConnectionProfile = {
  id: "profile-1",
  name: "legacy-sql-prod",
  platform: "sqlserver",
  host: "db.example.internal",
  port: 1433,
  database: "CustomerDb",
  user: "parity_reader",
  trustServerCertificate: true
};

describe("ConnectionProfileStore", () => {
  it("adds a connection profile and reads it back: non-secret fields via list()/get(), password only via a separate SecretStore.get() call", async () => {
    const secrets = createMockSecretStorage();
    const globalState = createMockMemento();
    const secretStore = new SecretStore(secrets as never);
    const store = new ConnectionProfileStore(globalState as never, secretStore);

    await store.add(SAMPLE_PROFILE, "s3cr3t-password");

    const roundTripped = store.get(SAMPLE_PROFILE.id);
    expect(roundTripped).toEqual(SAMPLE_PROFILE);
    // The password is never present on the returned profile object.
    expect(roundTripped).not.toHaveProperty("password");

    const listed = store.list();
    expect(listed).toEqual([SAMPLE_PROFILE]);

    // The password is readable only via a separate SecretStore.get() call,
    // keyed by the profile's id.
    const password = await secretStore.get(secretKeyFor(SAMPLE_PROFILE.id));
    expect(password).toBe("s3cr3t-password");
  });

  it("get() returns undefined for an id that was never added", () => {
    const secrets = createMockSecretStorage();
    const globalState = createMockMemento();
    const secretStore = new SecretStore(secrets as never);
    const store = new ConnectionProfileStore(globalState as never, secretStore);

    expect(store.get("never-added")).toBeUndefined();
  });

  it("update() replaces an existing profile's fields and, when a password is supplied, replaces its SecretStore entry", async () => {
    const secrets = createMockSecretStorage();
    const globalState = createMockMemento();
    const secretStore = new SecretStore(secrets as never);
    const store = new ConnectionProfileStore(globalState as never, secretStore);

    await store.add(SAMPLE_PROFILE, "original-password");

    const updated: ConnectionProfile = { ...SAMPLE_PROFILE, host: "db2.example.internal", port: 1434 };
    await store.update(updated, "rotated-password");

    expect(store.get(SAMPLE_PROFILE.id)).toEqual(updated);
    expect(await secretStore.get(secretKeyFor(SAMPLE_PROFILE.id))).toBe("rotated-password");
  });

  it("update() without a password leaves the existing stored password untouched", async () => {
    const secrets = createMockSecretStorage();
    const globalState = createMockMemento();
    const secretStore = new SecretStore(secrets as never);
    const store = new ConnectionProfileStore(globalState as never, secretStore);

    await store.add(SAMPLE_PROFILE, "original-password");
    const updated: ConnectionProfile = { ...SAMPLE_PROFILE, host: "db2.example.internal" };
    await store.update(updated);

    expect(await secretStore.get(secretKeyFor(SAMPLE_PROFILE.id))).toBe("original-password");
  });

  it("delete() removes a profile's metadata AND its matching SecretStore entry — no orphaned credential left behind", async () => {
    const secrets = createMockSecretStorage();
    const globalState = createMockMemento();
    const secretStore = new SecretStore(secrets as never);
    const store = new ConnectionProfileStore(globalState as never, secretStore);

    await store.add(SAMPLE_PROFILE, "s3cr3t-password");
    expect(await secretStore.get(secretKeyFor(SAMPLE_PROFILE.id))).toBe("s3cr3t-password");

    await store.delete(SAMPLE_PROFILE.id);

    expect(store.get(SAMPLE_PROFILE.id)).toBeUndefined();
    expect(store.list()).toEqual([]);
    // The SecretStore entry is gone too -- confirms no orphaned credential.
    expect(await secretStore.get(secretKeyFor(SAMPLE_PROFILE.id))).toBeUndefined();
    expect(secrets.__raw.has(secretKeyFor(SAMPLE_PROFILE.id))).toBe(false);
  });

  it("never writes a credential-shaped property to the raw globalState value for an added profile (mirrors T-10's SecretStore review-gate test)", async () => {
    const secrets = createMockSecretStorage();
    const globalState = createMockMemento();
    const secretStore = new SecretStore(secrets as never);
    const store = new ConnectionProfileStore(globalState as never, secretStore);

    await store.add(SAMPLE_PROFILE, "s3cr3t-password");

    // Inspect the raw value(s) actually written to the mocked globalState.
    const rawStoredProfiles = globalState.__raw.get("paritylens.connectionProfiles") as unknown[];
    expect(rawStoredProfiles).toBeDefined();
    expect(rawStoredProfiles.length).toBe(1);

    const credentialShapedKeyPattern = /password|secret|credential|token/i;
    for (const rawProfile of rawStoredProfiles) {
      for (const key of Object.keys(rawProfile as Record<string, unknown>)) {
        expect(credentialShapedKeyPattern.test(key)).toBe(false);
      }
      // The plaintext password value itself must not appear anywhere on the
      // stored object either.
      expect(Object.values(rawProfile as Record<string, unknown>)).not.toContain("s3cr3t-password");
    }

    // And nothing in the raw globalState map as a whole (any key, not just
    // the profiles array) contains the plaintext password.
    for (const value of globalState.__raw.values()) {
      expect(JSON.stringify(value)).not.toContain("s3cr3t-password");
    }
  });
});
