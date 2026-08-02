// T-27 bundling script.
//
// Why this exists: T-25 added `vsce package --no-dependencies` to stop
// `vsce`'s default dependency walk from climbing past the npm-workspaces
// boundary and sweeping the entire monorepo (224 MB / 8,946 files,
// including `.git/`) into the packaged `.vsix`. But `--no-dependencies`
// also means `vsce` never resolves or bundles *any* runtime dependency --
// including `@paritylens/engine`/`@paritylens/shared`, which are npm
// workspaces packages symlinked into the repo-root `node_modules/`, not
// living inside `packages/extension/node_modules/`. The result (found by
// T-27's live smoke test): the shipped `.vsix` had no `node_modules/` at
// all, so `dist/activation/activate.js`'s `require("@paritylens/engine")`
// threw `MODULE_NOT_FOUND` the moment VS Code tried to activate the
// extension -- nothing it registers (tree view, `paritylens.runComparison`)
// ever actually ran.
//
// The fix: bundle `src/index.ts` (the real extension entry point) plus its
// `@paritylens/engine`/`@paritylens/shared` workspace dependencies into a
// single self-contained CommonJS file. This inlines the workspace packages'
// code directly, so the shipped extension no longer depends on
// `node_modules` resolution for them at runtime.
//
// DuckDB native-binary investigation (see IMPLEMENTATION-REPORT.md for the
// full writeup): `@paritylens/engine`'s package entry point
// (`packages/engine/src/index.ts`) re-exports `FixtureConnector`
// (`connector-sdk/fixture/fixture-connector.ts`), which imports
// `@duckdb/node-api` directly. `packages/extension/src/activation/
// activate.ts` imports `FixtureConnector` from `@paritylens/engine` at
// module load time, so DuckDB is genuinely on this bundle's reachable code
// path, not just a theoretical transitive dependency.
//
// `@duckdb/node-api` itself is pure JS (confirmed: no `require()` of any
// `.node` file, no dynamically-computed require specifier anywhere in its
// `lib/**`) -- it bundles normally, same as `yaml`. The actual native
// boundary is one layer down, in `@duckdb/node-api`'s own dependency
// `@duckdb/node-bindings`, whose `duckdb.js` does a *runtime*
// `require(`@duckdb/node-bindings-${platform}-${arch}/duckdb.node`)` keyed
// off `process.platform`/`process.arch` (and conditionally
// `require('detect-libc')` on Linux) to pick the correct prebuilt native
// binary for whichever machine is actually running the code. esbuild
// cannot statically bundle a `.node` binary, and it cannot resolve a
// dynamically-computed `require()` specifier at bundle time -- so
// `@duckdb/node-bindings`, the current platform's
// `@duckdb/node-bindings-<platform>-<arch>`, and `detect-libc` are marked
// `external` below rather than bundled.
//
// Getting the excluded packages into the shipped .vsix turned out to be a
// two-layer problem, not just "put them in node_modules and .vscodeignore
// will sort it out":
//
// 1. `vsce`'s own file-collection code (`@vscode/vsce/out/package.js`,
//    `collectAllFiles`) hardcodes `ignore: 'node_modules/**'` in the glob
//    it walks over `cwd` (= `packages/extension/`) -- confirmed by reading
//    the installed package's compiled source, not assumed, and confirmed
//    NOT overridable via `.vscodeignore` or `--ignoreFile` (both tested).
//    Empirically, this glob only excludes a *top-level*
//    `packages/extension/node_modules/**` -- a `node_modules/` nested one
//    level deeper (e.g. `packages/extension/native/node_modules/`) is
//    NOT excluded (confirmed empirically with `vsce ls`).
// 2. Node's own module resolution for a bare specifier with a `paths`
//    option (`require.resolve(id, { paths: [...] })`, and the equivalent
//    internal mechanism a plain nested `require()` call ends up using) only
//    searches directories that are themselves literally named
//    `node_modules` -- confirmed empirically: passing a non-`node_modules`-
//    named directory as a `paths` entry silently fails to resolve, even
//    when the target file provably exists on disk at the expected relative
//    location under it.
//
// These two constraints combine into an exact answer: the externalized
// packages must be staged into a directory that IS literally named
// `node_modules`, but is NOT `packages/extension/node_modules` itself (the
// one path vsce's hardcoded ignore actually excludes). This script stages
// them into `packages/extension/native/node_modules/` -- survives
// packaging (one level below the excluded top-level directory) and
// resolves correctly (a real `node_modules` directory, exactly the layout
// Node's resolver expects). A small runtime patch (injected as this
// build's esbuild `banner`, so it runs before anything else in the bundle)
// adds that directory as a `require.resolve` search root for every
// subsequent module load in the process, so the bare
// `require("@duckdb/node-bindings-<platform>-<arch>/duckdb.node")` call
// happening deep inside `@duckdb/node-bindings`'s own code resolves
// against it.
//
// Only the current platform's `@duckdb/node-bindings-<platform>-<arch>` is
// staged -- shipping every platform's ~35-40 MB prebuilt binary would
// reintroduce a smaller version of the same "sweep way more than needed
// into the package" problem T-25 fixed. This means today's `.vsix` is only
// verified to run DuckDB-backed comparisons on the platform/arch it was
// packaged on; see IMPLEMENTATION-REPORT.md for this tradeoff written up
// as a disclosed limitation, not a silently dropped one.
//
// `mssql` and `pg` are dependencies of `@paritylens/engine`'s
// `package.json`, but are NOT imported by anything reachable from
// `packages/engine/src/index.ts` (the real SQL Server/PostgreSQL
// connectors that import them are T-17/T-18/T-19, still unscheduled, and
// are not re-exported from the engine's package entry point). esbuild's
// bundle graph confirms this: `mssql`/`pg` do not appear in the output, so
// they need no `external` entry -- there is nothing in the actual bundle
// graph referencing them to exclude.

/* global process */
// The repo's shared eslint.config.mjs uses flat config with no Node
// `globals` environment configured (it lints as plain ECMAScript with no
// ambient globals, and flat config no longer honors `eslint-env` comments),
// so this file's one Node-only global (`process`) needs this local
// `/* global */` opt-in. Scoped to this build script only -- not a change
// to the shared eslint config, which is outside this task's file
// ownership.

import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(extensionDir, "../..");

// A real `node_modules` directory (Node's resolver requires the literal
// name), nested one level under `native/` so vsce's hardcoded
// `ignore: 'node_modules/**'` (which only matches the top-level
// `packages/extension/node_modules`) does not exclude it from the .vsix.
// See the investigation above.
const nativeStageDir = path.join(extensionDir, "native", "node_modules");

// Packages that must be physically present in the packaged .vsix (staged
// here at bundle time, from the npm-workspaces-hoisted repo-root
// node_modules/) for the runtime resolution patch (injected as this
// build's `banner`) to find them.
const duckdbBindingsPkg = `@duckdb/node-bindings-${process.platform}-${process.arch}`;
const packagesToStage = ["@duckdb/node-bindings", duckdbBindingsPkg, "detect-libc"];

rmSync(path.join(extensionDir, "native"), { recursive: true, force: true });
mkdirSync(nativeStageDir, { recursive: true });

for (const pkgName of packagesToStage) {
  const src = path.join(repoRoot, "node_modules", pkgName);
  const dest = path.join(nativeStageDir, pkgName);
  if (!existsSync(src)) {
    throw new Error(
      `T-27 bundle script: expected external package "${pkgName}" at "${src}" but it was not found. ` +
        "This means the DuckDB native-binding staging step is out of date with the actual dependency tree -- " +
        "do not silently skip it; investigate and update the packagesToStage list above."
    );
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

// Runs before any other code in the bundle (esbuild `banner`). Patches
// `Module._resolveFilename` so that when Node's normal resolution can't
// find a bare specifier (the externalized DuckDB packages, which are not
// reachable via the ordinary upward `node_modules` walk once packaged into
// a .vsix and installed into a VS Code extensions folder), it retries once
// against `native/node_modules/` before giving up. This is the standard
// low-level hook published tools like `app-module-path` use for this kind
// of problem; the retry-on-failure shape (rather than unconditionally
// prepending the directory) keeps normal resolution behavior untouched for
// every other module in the process.
const resolutionPatchBanner = `
(function () {
  var path = require("path");
  var Module = require("module");
  // __dirname here is the bundle output's own directory
  // (packages/extension/dist-bundle/ once built, or extension/dist-bundle/
  // once packaged into the .vsix) -- native/node_modules/ is staged as a
  // sibling of dist-bundle/, not inside it.
  var nativeNodeModules = path.join(__dirname, "..", "native", "node_modules");
  var originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    try {
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (err) {
      if (err && err.code === "MODULE_NOT_FOUND") {
        return originalResolveFilename.call(this, request, parent, isMain, {
          paths: [nativeNodeModules]
        });
      }
      throw err;
    }
  };
})();
`;

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist-bundle/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: true,
  banner: {
    js: resolutionPatchBanner
  },
  external: [
    // Provided by the VS Code extension host at runtime -- never bundle it.
    "vscode",
    // Native per-platform binary bindings; see the investigation above.
    // `@duckdb/node-api` itself is bundled normally (pure JS). Only the
    // packages that actually reach a `.node` file via a dynamically
    // computed `require()` specifier are excluded here, and staged into
    // `native/node_modules/` (not `node_modules/` directly) above.
    "@duckdb/node-bindings",
    duckdbBindingsPkg,
    "detect-libc"
  ],
  logLevel: "info"
});
