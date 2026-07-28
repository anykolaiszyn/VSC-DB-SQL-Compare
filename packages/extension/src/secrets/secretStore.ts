import type * as vscode from "vscode";

/**
 * Thin wrapper around VS Code's `SecretStorage` API (`context.secrets`) for
 * connection credentials.
 *
 * Per `DESIGN-SPEC.md`'s security section, credentials are resolved only
 * through VS Code SecretStorage, environment variables, or native cloud/OS
 * credential mechanisms — never inline in parity configuration, and never
 * written to `globalState`, `workspaceState`, or any file. This wrapper is
 * intentionally the *only* credential-shaped read/write path the extension
 * layer exposes: it delegates every operation directly to
 * `vscode.SecretStorage` and holds no other persistence mechanism.
 */
export class SecretStore {
  private readonly secrets: vscode.SecretStorage;

  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  /** Reads a stored credential by key. Returns `undefined` if not set. */
  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  /** Stores a credential by key. */
  async set(key: string, value: string): Promise<void> {
    await this.secrets.store(key, value);
  }

  /** Removes a stored credential by key. */
  async delete(key: string): Promise<void> {
    await this.secrets.delete(key);
  }
}
