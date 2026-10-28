// export.js against a stub T3 server: --key=value parsing, exact matches first, AMBIGUOUS, NOT_FOUND, USAGE
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), { execFile } = require("child_process");

test("export.js: --project=Foo exports only Foo; two exact matches are AMBIGUOUS; bad options are USAGE", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3export-"));
  for (const f of ["export.js", "survey.js"]) fs.copyFileSync(path.join(__dirname, "..", "tools", f), path.join(tmp, f));
  fs.writeFileSync(path.join(tmp, "token"), "test-fixture");
  const now = new Date().toISOString();
  const projects = [["p-foo", "Foo", "/w/foo"], ["p-foobar", "FooBar", "/w/foobar"], ["p-d1", "Dup", "/w/d1"], ["p-d2", "dup", "/w/d2"], ["p-s", "key " + "sk-" + "ant-abcdefghijklmnopqrstuvwxyz0123", "/w/s"]]
    .map(([id, title, workspaceRoot]) => ({ id, title, workspaceRoot: path.resolve(workspaceRoot) }));
  const threads = projects.map((p) => ({ id: "t-" + p.id, projectId: p.id, title: "work on " + p.title, updatedAt: now, createdAt: now, status: "idle" }));
  const srv = http.createServer((req, res) => {
    if (req.url === "/api/orchestration/shell") return res.end(JSON.stringify({ projects, threads }));
    if (req.url.startsWith("/api/orchestration/threads/")) return res.end(JSON.stringify({ projection: { turnItems: [], runs: [], checkpoints: [] } }));
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  fs.mkdirSync(path.join(tmp, "t3")); fs.writeFileSync(path.join(tmp, "t3", "server-runtime.json"), JSON.stringify({ host: "127.0.0.1", port: srv.address().port }));
  const run = (script, ...args) => new Promise((r) => execFile(process.execPath, [path.join(tmp, script), ...args], { env: { ...process.env, T3_HOME: path.join(tmp, "t3") } },
    (err, out, errOut) => r({ code: err ? err.code : 0, out, err: errOut })));
  const titles = (r) => JSON.parse(r.out).projects.map((p) => p.title);
  try {
    let r = await run("export.js", "--project=Foo"); assert.equal(r.code, 0, r.err); assert.deepEqual(titles(r), ["Foo"]);
    r = await run("export.js", "--project", "foo", "--days=3"); assert.deepEqual(titles(r), ["Foo"]); assert.equal(JSON.parse(r.out).days, 3);
    r = await run("export.js", "--project=" + projects[1].workspaceRoot + path.sep); assert.deepEqual(titles(r), ["FooBar"]);
    r = await run("export.js", "--project=p-d2"); assert.deepEqual(titles(r), ["dup"]);
    r = await run("export.js", "--project=P-D2"); assert.equal(r.code, 1); assert.match(r.err, /NOT_FOUND/); // ids match exactly
    r = await run("export.js", "--project=Dup"); assert.equal(r.code, 1); assert.match(r.err, /AMBIGUOUS/); assert.match(r.err, /p-d1/); assert.match(r.err, /p-d2/);
    r = await run("export.js", "--project=fo"); assert.equal(r.code, 0); assert.deepEqual(titles(r), ["Foo", "FooBar"]); assert.match(r.err, /note: 2 projects contain/);
    r = await run("export.js", "--project=zzz"); assert.equal(r.code, 1); assert.match(r.err, /NOT_FOUND/);
    r = await run("export.js"); assert.equal(r.code, 0); assert.equal(titles(r).length, 5); assert.ok(!r.out.includes("sk-ant-"), "secrets in titles are redacted");
    for (const bad of [["--project="], ["--project"], ["--projet=Foo"], ["--days"], ["--days=0"], ["--out"]]) {
      r = await run("export.js", ...bad); assert.equal(r.code, 1, bad.join(" ")); assert.match(r.err, /USAGE/, bad.join(" "));
    }
    r = await run("survey.js"); assert.equal(r.code, 0, r.err); assert.ok(!r.out.includes("sk-ant-"), "survey redacts titles and project names"); assert.match(r.out, /\[redacted\]/);
  } finally { srv.close(); }
});
