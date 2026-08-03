import { describe, expect, it, vi } from "vitest";
import { parseDefinition } from "@paritylens/engine";
import { runNewComparisonWizard, runNewComparisonCommand, type NewComparisonWizardDeps } from "./newComparisonWizard";
import { buildComparisonYaml, type NewComparisonAnswers } from "./buildComparisonYaml";
import { ConnectionProfileStore } from "../connections/connectionProfileStore";
import { SecretStore } from "../secrets/secretStore";

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
    onDidChange: () => undefined
  };
}

function createMockMemento() {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T) => (store.has(key) ? (store.get(key) as T) : (defaultValue as T)),
    update: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    keys: () => Array.from(store.keys())
  };
}

function createConnectionProfileStore() {
  const secretStore = new SecretStore(createMockSecretStorage() as never);
  return new ConnectionProfileStore(createMockMemento() as never, secretStore);
}

/** Builds mock deps that answer a fixed sequence of input-box/quick-pick
 * prompts, in call order -- same queue-based mocking pattern
 * `connectionCommands.test.ts`'s `createDeps` already uses. */
function createDeps(options: {
  inputBoxes?: Array<string | undefined>;
  quickPicks?: Array<string | undefined>;
  connectionProfileStore?: ConnectionProfileStore;
  existingFiles?: Set<string>;
}): NewComparisonWizardDeps & {
  showInformationMessage: ReturnType<typeof vi.fn>;
  showErrorMessage: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  writtenFiles: Map<string, string>;
} {
  const inputQueue = [...(options.inputBoxes ?? [])];
  const quickPickQueue = [...(options.quickPicks ?? [])];
  const existingFiles = options.existingFiles ?? new Set<string>();
  const writtenFiles = new Map<string, string>();

  return {
    showInputBox: vi.fn(async () => inputQueue.shift()),
    showQuickPick: vi.fn(async () => quickPickQueue.shift()),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    connectionProfileStore: options.connectionProfileStore ?? createConnectionProfileStore(),
    fileExists: vi.fn(async (path: string) => existingFiles.has(path)),
    writeFile: vi.fn(async (path: string, contents: string) => {
      writtenFiles.set(path, contents);
    }),
    resolveTargetPath: vi.fn((fileName: string) => `/workspace/${fileName}`),
    writtenFiles
  };
}

describe("runNewComparisonWizard", () => {
  it("collects answers for a full wizard run, offering fixture pair names when no profiles are saved", async () => {
    const deps = createDeps({
      inputBoxes: [
        "Customer Parity", // comparison name
        "dbo.Customer", // source object
        "", // source where (blank -> omitted)
        "public.customer", // target object
        "region = 'US'", // target where
        "customer_id, region" // keys
      ],
      quickPicks: ["sqlserver-customer", "postgres-products"]
    });

    const answers = await runNewComparisonWizard(deps);

    expect(answers).toEqual<NewComparisonAnswers>({
      comparisonName: "Customer Parity",
      sourceConnection: "sqlserver-customer",
      sourceObject: "dbo.Customer",
      targetConnection: "postgres-products",
      targetObject: "public.customer",
      targetWhere: "region = 'US'",
      keys: ["customer_id", "region"]
    });

    // The connection quick picks were offered the fixture pair fallback
    // names even though no ConnectionProfile is saved (TASK-BRIEF.md Scope
    // item 2: "do not require a saved profile to exist").
    const quickPickCalls = (deps.showQuickPick as ReturnType<typeof vi.fn>).mock.calls;
    expect(quickPickCalls[0]?.[0]).toEqual(
      expect.arrayContaining(["sqlserver-customer", "snowflake-orders", "postgres-products"])
    );
  });

  it("offers saved ConnectionProfile names ahead of the fixture pair fallback names", async () => {
    const store = createConnectionProfileStore();
    await store.add(
      {
        id: "profile-1",
        name: "prod-sqlserver",
        platform: "sqlserver",
        host: "db.example.internal",
        port: 1433,
        database: "CustomerDb",
        user: "parity_reader"
      },
      "s3cr3t"
    );

    const deps = createDeps({
      connectionProfileStore: store,
      inputBoxes: ["Name", "obj", "", "obj2", "", "id"],
      quickPicks: ["prod-sqlserver", "prod-sqlserver"]
    });

    await runNewComparisonWizard(deps);

    const quickPickCalls = (deps.showQuickPick as ReturnType<typeof vi.fn>).mock.calls;
    expect(quickPickCalls[0]?.[0]).toEqual(
      expect.arrayContaining(["prod-sqlserver", "sqlserver-customer", "snowflake-orders", "postgres-products"])
    );
  });

  it("aborts and returns undefined if the user cancels the comparison-name prompt", async () => {
    const deps = createDeps({ inputBoxes: [undefined] });
    const answers = await runNewComparisonWizard(deps);
    expect(answers).toBeUndefined();
  });

  it("aborts if the user cancels the source connection quick pick", async () => {
    const deps = createDeps({ inputBoxes: ["Name"], quickPicks: [undefined] });
    const answers = await runNewComparisonWizard(deps);
    expect(answers).toBeUndefined();
  });

  it("aborts if the user cancels the source object prompt", async () => {
    const deps = createDeps({ inputBoxes: ["Name", undefined], quickPicks: ["sqlserver-customer"] });
    const answers = await runNewComparisonWizard(deps);
    expect(answers).toBeUndefined();
  });

  it("aborts if the user cancels the target connection quick pick", async () => {
    const deps = createDeps({
      inputBoxes: ["Name", "obj", ""],
      quickPicks: ["sqlserver-customer", undefined]
    });
    const answers = await runNewComparisonWizard(deps);
    expect(answers).toBeUndefined();
  });

  it("aborts if the user cancels the keys prompt", async () => {
    const deps = createDeps({
      inputBoxes: ["Name", "obj", "", "obj2", "", undefined],
      quickPicks: ["sqlserver-customer", "postgres-products"]
    });
    const answers = await runNewComparisonWizard(deps);
    expect(answers).toBeUndefined();
  });

  it("errors and returns undefined if the keys input is blank/only commas", async () => {
    const deps = createDeps({
      inputBoxes: ["Name", "obj", "", "obj2", "", " , , "],
      quickPicks: ["sqlserver-customer", "postgres-products"]
    });
    const answers = await runNewComparisonWizard(deps);
    expect(answers).toBeUndefined();
    expect(deps.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("key column"));
  });
});

describe("runNewComparisonCommand", () => {
  const fullAnswerInputs = [
    "Customer Parity", // comparison name
    "dbo.Customer", // source object
    "", // source where
    "public.customer", // target object
    "", // target where
    "customer_id", // keys
    "customer-parity.paritylens" // file name
  ];

  it("writes a scaffolded file whose contents parseDefinition accepts (round-trips with the actual answers)", async () => {
    const deps = createDeps({
      inputBoxes: fullAnswerInputs,
      quickPicks: ["sqlserver-customer", "postgres-products"]
    });

    const resultPath = await runNewComparisonCommand(deps);

    expect(resultPath).toBe("/workspace/customer-parity.paritylens");
    expect(deps.writeFile).toHaveBeenCalledTimes(1);

    const writtenYaml = deps.writtenFiles.get("/workspace/customer-parity.paritylens");
    expect(writtenYaml).toBeDefined();

    const parsed = parseDefinition(writtenYaml!);
    expect(parsed.version).toBe(1);
    expect(parsed.name).toBe("Customer Parity");
    expect(parsed.source).toEqual({ connection: "sqlserver-customer", object: "dbo.Customer" });
    expect(parsed.target).toEqual({ connection: "postgres-products", object: "public.customer" });
    expect(parsed.keys).toEqual(["customer_id"]);

    expect(deps.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("scaffolded new comparison"));
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
  });

  it("never overwrites an existing file at the target path -- aborts without writing", async () => {
    const deps = createDeps({
      inputBoxes: fullAnswerInputs,
      quickPicks: ["sqlserver-customer", "postgres-products"],
      existingFiles: new Set(["/workspace/customer-parity.paritylens"])
    });

    const resultPath = await runNewComparisonCommand(deps);

    expect(resultPath).toBeUndefined();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });

  it("aborts without writing a file if the wizard is cancelled partway through", async () => {
    const deps = createDeps({
      inputBoxes: ["Name", "obj", "", undefined], // cancels at target connection prompt (via undefined quick pick below not reached)
      quickPicks: ["sqlserver-customer"]
    });

    const resultPath = await runNewComparisonCommand(deps);

    expect(resultPath).toBeUndefined();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("aborts without writing a file if the user cancels the file-name prompt", async () => {
    const deps = createDeps({
      inputBoxes: [
        "Customer Parity",
        "dbo.Customer",
        "",
        "public.customer",
        "",
        "customer_id",
        undefined // cancel file name
      ],
      quickPicks: ["sqlserver-customer", "postgres-products"]
    });

    const resultPath = await runNewComparisonCommand(deps);

    expect(resultPath).toBeUndefined();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("never emits a credential-shaped field even if the user free-types one as a connection name", async () => {
    // The connection quick-pick items are drawn from ConnectionProfile
    // names / fixture pair names, but the wizard has no code path that lets
    // a free-typed input box answer land in `source.connection`/
    // `target.connection` as anything other than the picked string itself
    // -- this test exercises buildComparisonYaml directly (the pure
    // builder TASK-BRIEF.md's Handoff note asks a reviewer to adversarially
    // check) with a deliberately credential-shaped connection "name" to
    // confirm it is only ever emitted as a bare scalar string, never
    // structured data.
    const yamlText = buildComparisonYaml({
      comparisonName: "Suspicious",
      sourceConnection: 'password: hunter2\nsecret',
      sourceObject: "dbo.Customer",
      targetConnection: "postgres-products",
      targetObject: "public.customer",
      keys: ["customer_id"]
    });

    // parseDefinition must still accept it (it's a quoted scalar, not a
    // nested mapping) and the parsed connection field must equal the
    // literal string, not be interpreted as a nested "password" key.
    const parsed = parseDefinition(yamlText);
    expect(parsed.source.connection).toBe('password: hunter2\nsecret');
    expect(typeof parsed.source.connection).toBe("string");
  });
});
