// Execute standalone tool entrypoints against temporary homes, stopping before credentials or network access.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFile } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TOOLS = ["t3ctl", "t3listen", "t3q.py", "export.js", "survey.js"];
const CAPTURE = "GETTER_TEST_PATH ";
const WRAPPER_CAPTURE = "GETTER_TEST_WRAPPER ";

function run(command, args, env, timeout = 15000) {
  return new Promise((resolve) => execFile(command, args, { env, encoding: "utf8", timeout },
    (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "getter-home-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home with spaces");
  fs.mkdirSync(home);
  const env = { ...process.env, GETTER_TEST_HOME: home, HOME: home, USERPROFILE: home };
  for (const key of ["GETTER_HOME", "T3_HOME", "T3CODE_HOME", "GETTER_PYTHON", "NODE_OPTIONS"]) delete env[key];
  const nodeHook = path.join(dir, "capture-runtime.cjs");
  fs.writeFileSync(nodeHook, `
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
os.homedir = () => process.env.GETTER_TEST_HOME;
const original = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  if (path.basename(String(file)) === "server-runtime.json") {
    console.log(${JSON.stringify(CAPTURE)} + JSON.stringify({ path: String(file) }));
    process.exit(0);
  }
  return original.call(this, file, ...args);
};
`);
  const pythonHook = path.join(dir, "capture-db.py");
  fs.writeFileSync(pythonHook, `
import atexit, json, os, runpy, sqlite3, sys
seen = []
original = os.path.exists
def exists(file):
    if os.path.basename(str(file)) == "statev2.sqlite": seen.append(str(file))
    return original(file)
os.path.exists = exists
def capture(file, **kwargs):
    readonly = str(file).endswith("?mode=ro")
    filename = str(file)[5:-8] if readonly else str(file)[5:]
    print(${JSON.stringify(CAPTURE)} + json.dumps({"path": filename, "uri": kwargs.get("uri"), "readonly": readonly}))
    seen.clear()
    raise SystemExit(0)
sqlite3.connect = capture
def finish():
    if seen: print(${JSON.stringify(CAPTURE)} + json.dumps({"path": seen[-1]}))
atexit.register(finish)
sys.argv = [sys.argv[1], "projects"]
runpy.run_path(sys.argv[0], run_name="__main__")
`);
  const marker = (folder, name = "statev2.sqlite") => {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, name), name === "server-runtime.json" ? "{}" : "");
  };
  return { dir, home, env, nodeHook, pythonHook, marker };
}

async function discovered(tool, f) {
  const python = process.platform === "win32" ? "py" : "python3";
  const result = tool === "t3q.py"
    ? await run(python, [...(process.platform === "win32" ? ["-3"] : []), f.pythonHook, path.join(ROOT, "tools", tool)], f.env)
    : await run(process.execPath, ["--require", f.nodeHook, path.join(ROOT, "tools", tool), ...(tool === "t3ctl" ? ["projects"] : tool === "t3listen" ? ["--dry-run", "--once", "--timeout", "1"] : [])], f.env);
  assert.equal(result.code, 0, `${tool}: ${result.stdout}\n${result.stderr}`);
  const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith(CAPTURE));
  assert.ok(line, `${tool} did not capture discovery: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(line.slice(CAPTURE.length));
}

async function expectAll(t, f, expected) {
  await Promise.all(TOOLS.map((tool) => t.test(tool, async () => {
    const found = await discovered(tool, f);
    // SQLite URIs use forward slashes even on Windows.
    assert.equal(path.resolve(found.path), path.resolve(expected, tool === "t3q.py" ? "statev2.sqlite" : "server-runtime.json"));
    if (tool === "t3q.py" && found.uri !== undefined) {
      assert.equal(found.uri, true);
      assert.equal(found.readonly, true, "query entrypoint must open the fixture database read-only");
    }
  })));
}

test("GETTER_HOME base wins over both explicit upstream aliases", async (t) => {
  const f = fixture(t), getter = path.join(f.home, "getter base");
  f.env.GETTER_HOME = getter;
  f.env.T3_HOME = path.join(f.home, "upstream one");
  f.env.T3CODE_HOME = path.join(f.home, "upstream two");
  for (const folder of [getter, f.env.T3_HOME, f.env.T3CODE_HOME]) f.marker(path.join(folder, "userdata"));
  await expectAll(t, f, path.join(getter, "userdata"));
});

for (const name of ["statev2.sqlite", "server-runtime.json"]) {
  test(`GETTER_HOME accepts a direct data folder discovered by ${name}`, async (t) => {
    const f = fixture(t), folder = path.join(f.home, "custom data");
    f.env.GETTER_HOME = folder;
    f.marker(folder, name);
    await expectAll(t, f, folder);
  });
}

for (const name of ["userdata", "dev"]) {
  test(`a direct ${name} path stays direct before its marker files exist`, async (t) => {
    const f = fixture(t), folder = path.join(f.home, "fresh base", name);
    f.env.GETTER_HOME = folder;
    await expectAll(t, f, folder);
  });
}

test("explicit T3_HOME remains compatible and wins over T3CODE_HOME", async (t) => {
  const f = fixture(t), folder = path.join(f.home, "explicit old base");
  f.env.T3_HOME = folder;
  f.env.T3CODE_HOME = path.join(f.home, "ignored old base");
  f.marker(path.join(folder, "userdata"));
  f.marker(path.join(f.env.T3CODE_HOME, "userdata"));
  await expectAll(t, f, path.join(folder, "userdata"));
});

test("blank Getter and T3_HOME values allow an explicit T3CODE_HOME", async (t) => {
  const f = fixture(t), folder = path.join(f.home, "old custom data");
  f.env.GETTER_HOME = "   ";
  f.env.T3_HOME = "\t";
  f.env.T3CODE_HOME = folder;
  f.marker(folder);
  await expectAll(t, f, folder);
});

test("default uses only isolated Getter userdata even when upstream and dev data exist", async (t) => {
  const f = fixture(t);
  f.marker(path.join(f.home, ".t3", "userdata"));
  f.marker(path.join(f.home, ".t3", "dev"));
  f.marker(path.join(f.home, ".getter-code", "dev"));
  await expectAll(t, f, path.join(f.home, ".getter-code", "userdata"));
});

test("Getter home expands tilde and trims surrounding whitespace", async (t) => {
  const f = fixture(t), folder = path.join(f.home, "tilde base", "userdata");
  f.env.GETTER_HOME = "  ~/tilde base  ";
  f.marker(folder);
  await expectAll(t, f, folder);
});

function wrapperFixture(t, name) {
  const f = fixture(t), tools = path.join(f.dir, "tools"), scripts = path.join(f.dir, "scripts");
  fs.mkdirSync(tools); fs.mkdirSync(scripts);
  fs.copyFileSync(path.join(ROOT, "tools", name), path.join(tools, name));
  fs.copyFileSync(path.join(ROOT, "scripts", `${name}.ps1`), path.join(scripts, `${name}.ps1`));
  const payload = `{ args: process.argv.slice(2), home: process.env.GETTER_HOME, legacyHome: process.env.T3_HOME, codeHome: process.env.T3CODE_HOME }`;
  fs.writeFileSync(path.join(tools, "t3ctl"), `console.log(${JSON.stringify(WRAPPER_CAPTURE)} + JSON.stringify(${payload})); process.exit(37);`);
  fs.writeFileSync(path.join(tools, "t3q.py"), `import json, os, sys\nprint(${JSON.stringify(WRAPPER_CAPTURE)} + json.dumps({"args": sys.argv[1:], "home": os.environ.get("GETTER_HOME"), "legacyHome": os.environ.get("T3_HOME"), "codeHome": os.environ.get("T3CODE_HOME")}))\nsys.exit(37)\n`);
  return { ...f, wrapper: path.join(tools, name), psWrapper: path.join(scripts, `${name}.ps1`) };
}

function wrapperResult(result) {
  assert.equal(result.code, 37, `${result.stdout}\n${result.stderr}`);
  const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith(WRAPPER_CAPTURE));
  assert.ok(line, `wrapper did not run fixture child: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(line.slice(WRAPPER_CAPTURE.length));
}

test("getterctl defaults to the isolated Getter base and forwards argument values intact", async (t) => {
  const f = wrapperFixture(t, "getterctl"), args = ["send", "--thread", "thread with spaces", "--prompt", 'keep the "quoted value" intact', "--queue"];
  const found = wrapperResult(await run(process.execPath, ["--require", f.nodeHook, f.wrapper, ...args], f.env));
  assert.deepEqual(found.args, args);
  assert.equal(found.home, path.join(f.home, ".getter-code"));
});

test("getterctl keeps an explicit legacy home in the child environment", async (t) => {
  const f = wrapperFixture(t, "getterctl");
  f.env.T3_HOME = path.join(f.home, "chosen old base");
  f.env.T3CODE_HOME = path.join(f.home, "other old base");
  const found = wrapperResult(await run(process.execPath, [f.wrapper, "projects"], f.env));
  assert.equal(found.home, f.env.T3_HOME);
  assert.equal(found.legacyHome, f.env.T3_HOME);
  assert.equal(found.codeHome, f.env.T3CODE_HOME);
});

for (const equals of [false, true]) {
  test(`getterctl --getter-home${equals ? "=value" : " value"} overrides environment and is stripped before forwarding`, async (t) => {
    const f = wrapperFixture(t, "getterctl"), selected = path.join(f.home, 'new home "label"');
    f.env.GETTER_HOME = path.join(f.home, "existing home");
    f.env.T3_HOME = path.join(f.home, "legacy home");
    const homeArgs = equals ? [`--getter-home=${selected}`] : ["--getter-home", selected];
    const args = ["read", "--thread", "a thread", "--last", "6"];
    const found = wrapperResult(await run(process.execPath, [f.wrapper, ...homeArgs, ...args], f.env));
    assert.deepEqual(found.args, args);
    assert.equal(found.home, selected);
    assert.equal(found.legacyHome, f.env.T3_HOME);
  });
}

test("getterctl rejects a missing Getter home before spawning a child", async (t) => {
  const f = wrapperFixture(t, "getterctl");
  for (const value of [[], [""], ["   "]]) {
    const result = await run(process.execPath, [f.wrapper, "--getter-home", ...value], f.env);
    assert.equal(result.code, 2, result.stdout + result.stderr);
    assert.ok(!result.stdout.includes(WRAPPER_CAPTURE));
  }
});

test("getterq uses its platform Python command, forwards values, and propagates exit status", async (t) => {
  const f = wrapperFixture(t, "getterq"), selected = path.join(f.home, "chosen query base"), args = ["thread", "value with spaces", 'a "quoted" value'];
  const found = wrapperResult(await run(process.execPath, [f.wrapper, "--getter-home", selected, ...args], f.env));
  assert.deepEqual(found.args, args);
  assert.equal(found.home, selected);
});

test("getterq accepts an explicit Python executable and reports a missing executable", async (t) => {
  const f = wrapperFixture(t, "getterq"), python = process.platform === "win32" ? "py" : "python3";
  const locate = await run(python, [...(process.platform === "win32" ? ["-3"] : []), "-c", "import sys; print(sys.executable)"], f.env);
  assert.equal(locate.code, 0, locate.stdout + locate.stderr);
  f.env.GETTER_PYTHON = locate.stdout.trim();
  f.env.GETTER_HOME = path.join(f.home, "explicit getter base");
  const found = wrapperResult(await run(process.execPath, [f.wrapper, "health"], f.env));
  assert.deepEqual(found.args, ["health"]);
  assert.equal(found.home, f.env.GETTER_HOME);
  f.env.GETTER_PYTHON = path.join(f.dir, "missing-python-executable");
  const failed = await run(process.execPath, [f.wrapper, "health"], f.env);
  assert.equal(failed.code, 2, failed.stdout + failed.stderr);
  assert.ok(!failed.stdout.includes(WRAPPER_CAPTURE));
});

for (const shell of process.platform === "win32" ? ["pwsh", "powershell.exe"] : ["pwsh"]) {
  for (const name of ["getterctl", "getterq"]) {
    test(`${name}.ps1 under ${shell} forwards -GetterHome and tool arguments without losing quotes`, async (t) => {
      const f = wrapperFixture(t, name), selected = path.join(f.home, "PowerShell selected base");
      const available = await run(shell, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], f.env, 60000);
      if (available.code === "ENOENT") { t.skip(`${shell} is not installed`); return; }
      assert.equal(available.code, 0, available.stdout + available.stderr);
      const args = ["read", "--thread", "thread with spaces", "--text", 'the "quoted" answer', "--literal-marker", "--"];
      const result = await run(shell, ["-NoProfile", "-NonInteractive", "-File", f.psWrapper, "-GetterHome", selected, "--", ...args], f.env, 60000);
      const found = wrapperResult(result);
      assert.deepEqual(found.args, args);
      assert.equal(found.home, selected);
    });
  }
}
