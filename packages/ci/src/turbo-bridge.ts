export interface TurboFile {
  readonly path: string
  readonly data: string
  readonly mode: number
  readonly owner: string
}

export interface TurboTask {
  readonly taskId: string
  readonly hash: string
  readonly dependencies: ReadonlyArray<string>
  readonly command: string
  readonly directory: string
  readonly resolvedTaskDefinition: {
    readonly cache: boolean
    readonly persistent: boolean
    readonly interactive: boolean
  }
  readonly with: ReadonlyArray<string>
}

export interface TurboPlan {
  readonly version: string
  readonly turboVersion: string
  readonly tasks: ReadonlyArray<TurboTask>
}

export interface TurboBridgeRequest {
  readonly operation: "plan" | "run" | "restore"
  readonly file: string
  readonly tags?: ReadonlyArray<string>
  readonly task?: TurboTask
  readonly hashes?: Readonly<Record<string, string>>
  readonly files?: ReadonlyArray<TurboFile>
}

export const turboBridge = String.raw`
async function turboBridge(request) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { createRequire } = await import("node:module");
    const { spawnSync } = await import("node:child_process");
    const root = fs.realpathSync(process.cwd());
    const cache = ".effect-ci/turbo/cache";
    const limit = 48 * 1024;
    const safePath = (value, cacheFile = false) => {
        if (!value || path.isAbsolute(value) || /[\\\x00-\x1f]/.test(value) ||
            value.split("/").some(part => !part || part === "." || part === ".." || part === ".git" || part === "node_modules") ||
            (value.split("/").includes(".effect-ci") && !(cacheFile && value.startsWith(cache + "/")))) {
            throw Error(("Unsupported Turbo output path: " + value));
        }
        let current = root;
        for (const part of value.split("/")) {
            current = path.join(current, part);
            if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
                throw Error("Turbo output symlinks are unsupported");
        }
        return path.join(root, value);
    };
    const save = (value) => {
        const body = JSON.stringify(value);
        if (Buffer.byteLength(body) > limit)
            throw Error("Turbo prototype result exceeds 48 KiB");
        fs.mkdirSync(path.dirname(request.file), { recursive: true });
        fs.writeFileSync(request.file, body);
    };
    const restore = () => {
        if (Buffer.byteLength(JSON.stringify(request.files ?? [])) > limit)
            throw Error("Turbo prototype inputs exceed 48 KiB");
        for (const file of request.files ?? []) {
            const target = safePath(file.path, true);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, Buffer.from(file.data, "base64"), { mode: file.mode });
            fs.chmodSync(target, file.mode);
        }
    };
    if (request.operation === "restore") {
        restore();
        return;
    }
    const require = createRequire(path.join(root, "package.json"));
    const turbo = require.resolve("turbo/bin/turbo");
    const execute = (args, echo = false) => {
        const result = spawnSync(process.execPath, [turbo, ...args], {
            cwd: root,
            encoding: "utf8",
            env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
            maxBuffer: 16 * 1024 * 1024,
        });
        if (echo || result.status !== 0) {
            process.stdout.write(result.stdout ?? "");
            process.stderr.write(result.stderr ?? "");
        }
        if (result.error)
            throw result.error;
        if (result.status !== 0)
            throw Error(("Native Turbo failed (" + result.status + ")"));
        return JSON.parse(result.stdout);
    };
    const flags = ["--cache=local:rw", ("--cache-dir=" + cache)];
    if (request.operation === "plan") {
        const tags = request.tags ?? [];
        const include = tags.map(tag => ("{has: {field: TAG, value: " + JSON.stringify(tag) + "}}"));
        const exclude = tags.map(tag => ("{not: {has: {field: TAG, value: " + JSON.stringify("!" + tag) + "}}}"));
        const query = execute(["query", ("query { packages { items {\n      tasks(filter: {and: [{or: [" + include.join(",") + "]}, " + exclude.join(",") + "]}) {\n        items { fullName }\n      }\n    } } }")]);
        if (query.errors?.length || !Array.isArray(query.data?.packages?.items))
            throw Error("Native Turbo tag query failed");
        const targets = query.data.packages.items.flatMap((item) => item.tasks.items.map(task => task.fullName)).sort();
        if (!targets.length)
            throw Error("No Turbo tasks matched the requested tags");
        save(execute(["run", ...targets, ...flags, "--dry=json"]));
        return;
    }
    restore();
    const task = request.task;
    const planned = execute(["run", task.taskId, ...flags, "--dry=json"]);
    for (const item of planned.tasks) {
        if (request.hashes?.[item.taskId] !== item.hash)
            throw Error(("Turbo task identity changed: " + item.taskId));
        if (item.taskId !== task.taskId && (item.cache.status !== "HIT" || item.cache.source !== "LOCAL")) {
            throw Error(("Required native Turbo cache is missing: " + item.taskId + "; task admission refused"));
        }
    }
    if (!planned.tasks.some(item => item.taskId === task.taskId))
        throw Error("Native Turbo omitted the requested task");
    const summaries = ".turbo/runs";
    const before = new Set(fs.existsSync(summaries) ? fs.readdirSync(summaries) : []);
    const run = spawnSync(process.execPath, [turbo, "run", task.taskId, ...flags, "--summarize"], {
        cwd: root, encoding: "utf8", env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
        maxBuffer: 16 * 1024 * 1024,
    });
    process.stdout.write(run.stdout ?? "");
    process.stderr.write(run.stderr ?? "");
    if (run.error)
        throw run.error;
    if (run.status !== 0)
        throw Error(("Native Turbo task failed: " + task.taskId));
    const created = fs.readdirSync(summaries).filter(name => !before.has(name) && name.endsWith(".json"));
    const [summaryFile] = created;
    if (created.length !== 1 || !summaryFile)
        throw Error("Expected one native Turbo run summary");
    const summary = JSON.parse(fs.readFileSync(path.join(summaries, summaryFile), "utf8"));
    const result = summary.tasks.find((item) => item.taskId === task.taskId);
    if (!result || result.hash !== task.hash || result.execution?.exitCode !== 0)
        throw Error("Invalid native Turbo task result");
    for (const item of summary.tasks) {
        if (item.taskId !== task.taskId && (item.cache.status !== "HIT" || item.hash !== request.hashes?.[item.taskId])) {
            throw Error(("Native Turbo reran a prerequisite: " + item.taskId));
        }
    }
    const owned = [];
    let encodedSize = Buffer.byteLength(JSON.stringify({ taskId: task.taskId, hash: task.hash, files: request.files ?? [] }));
    const append = (output, target, mode) => {
        const info = fs.lstatSync(target);
        if (!info.isFile()) throw Error("Only regular Turbo files are supported");
        const file = { path: output, data: "", mode, owner: task.taskId };
        encodedSize += Buffer.byteLength(JSON.stringify(file)) + 4 * Math.ceil(info.size / 3) + 1;
        if (encodedSize > limit) throw Error("Turbo result exceeds the prototype byte limit");
        owned.push({ ...file, data: Buffer.from(fs.readFileSync(target)).toString("base64") });
    };
    if (!Array.isArray(result.expandedOutputs) || result.expandedOutputs.length > 1000)
        throw Error("Turbo output inventory exceeds the prototype limit");
    for (const output of result.expandedOutputs) {
        const target = safePath(output);
        const info = fs.lstatSync(target);
        if (info.isDirectory())
            continue;
        if (!info.isFile() || info.size > limit)
            throw Error("Only regular Turbo output files are supported");
        append(output, target, info.mode & 0o777);
    }
    const cacheFiles = fs.readdirSync(cache).filter(name => name === ("" + task.hash + "-meta.json") || name === ("" + task.hash + ".tar.zst"));
    if (cacheFiles.length !== 2)
        throw Error(("Native Turbo did not publish a complete local cache: " + task.taskId));
    for (const name of cacheFiles) {
        const output = ("" + cache + "/" + name);
        const target = safePath(output, true);
        if (fs.statSync(target).size > limit)
            throw Error("Turbo cache entry exceeds the prototype limit");
        append(output, target, 0o600);
    }
    const files = new Map((request.files ?? []).map(file => [file.path, file]));
    for (const file of owned) {
        const previous = files.get(file.path);
        if (previous && previous.owner !== file.owner)
            throw Error(("Turbo tasks claim the same output: " + file.path));
        files.set(file.path, file);
    }
    save({ taskId: task.taskId, hash: task.hash, files: [...files.values()] });
}
`
