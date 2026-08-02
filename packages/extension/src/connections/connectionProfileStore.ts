import type * as vscode from "vscode";
import type { ConnectionProfile } from "./connectionProfile";
import type { SecretStore } from "../secrets/secretStore";

/** `globalState` key the full array of profiles (non-secret fields only) is stored under. */
const PROFILES_STATE_KEY = "paritylens.connectionProfiles";

/**
 * Stable per-profile `SecretStore` key for a profile's password, keyed by
 * the profile's `id` -- per TASK-BRIEF.md Scope item 2's example key shape.
 * Exported so callers (e.g. the command handlers, T-30's future resolver
 * call-site) can look up the same secret without duplicating this format.
 */
export function secretKeyFor(profileId: string): string {
  return `paritylens.connection.${profileId}.password`;
}

/**
 * Wraps `context.globalState` for `ConnectionProfile` metadata (non-secret
 * fields only) and delegates the matching password to the existing
 * `SecretStore` (`packages/extension/src/secrets/secretStore.ts`, built by
 * T-10 -- consumed read-only here, never modified), per TASK-BRIEF.md Scope
 * item 2.
 *
 * `globalState` is read fresh on every call rather than cached in an
 * instance field: `vscode.Memento`'s `update()` already persists
 * synchronously-visible-on-next-get within a single extension host, and
 * this avoids this store's own in-memory copy ever drifting from what's
 * actually persisted -- the same reason `SecretStore` itself holds no
 * cache and delegates every operation directly through.
 */
export class ConnectionProfileStore {
  private readonly globalState: vscode.Memento;
  private readonly secretStore: SecretStore;

  constructor(globalState: vscode.Memento, secretStore: SecretStore) {
    this.globalState = globalState;
    this.secretStore = secretStore;
  }

  /** Returns every stored profile's non-secret metadata. */
  list(): ConnectionProfile[] {
    return this.globalState.get<ConnectionProfile[]>(PROFILES_STATE_KEY, []);
  }

  /** Returns a single profile's non-secret metadata by `id`, or `undefined` if not found. */
  get(id: string): ConnectionProfile | undefined {
    return this.list().find((profile) => profile.id === id);
  }

  /**
   * Adds a new profile's non-secret metadata to `globalState` and its
   * password to `SecretStore`, keyed by `profile.id`.
   */
  async add(profile: ConnectionProfile, password: string): Promise<void> {
    const profiles = this.list();
    await this.globalState.update(PROFILES_STATE_KEY, [...profiles, profile]);
    await this.secretStore.set(secretKeyFor(profile.id), password);
  }

  /**
   * Replaces an existing profile's non-secret metadata (matched by
   * `profile.id`) and, if a new password is supplied, replaces its
   * `SecretStore` entry too. Passing `password` as `undefined` leaves the
   * existing stored password untouched (an edit that doesn't change the
   * credential should not require re-entering it).
   */
  async update(profile: ConnectionProfile, password?: string): Promise<void> {
    const profiles = this.list().map((existing) => (existing.id === profile.id ? profile : existing));
    await this.globalState.update(PROFILES_STATE_KEY, profiles);
    if (password !== undefined) {
      await this.secretStore.set(secretKeyFor(profile.id), password);
    }
  }

  /**
   * Removes a profile's non-secret metadata from `globalState` and deletes
   * its matching `SecretStore` entry -- per TASK-BRIEF.md Scope item 2:
   * "Deleting a profile must delete its `SecretStore` entry too -- no
   * orphaned credential left behind."
   */
  async delete(id: string): Promise<void> {
    const profiles = this.list().filter((existing) => existing.id !== id);
    await this.globalState.update(PROFILES_STATE_KEY, profiles);
    await this.secretStore.delete(secretKeyFor(id));
  }
}
