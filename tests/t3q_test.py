"""Tests for t3q.py against a tiny fake T3 database. Run: python3 tests/t3q_test.py"""
import json, os, sqlite3, subprocess, sys, tempfile, datetime as dt, unittest

HERE = os.path.dirname(os.path.abspath(__file__)); T3Q = os.path.join(HERE, "..", "tools", "t3q.py")
NOW = dt.datetime.now(dt.timezone.utc)
iso = lambda h=0: (NOW - dt.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

def make_db(folder, legacy_approvals=False, extra_threads=False):
    db = sqlite3.connect(os.path.join(folder, "statev2.sqlite"))
    db.executescript("""
    create table projection_projects (project_id text, title text, workspace_root text, deleted_at text);
    create table orchestration_v2_projection_threads (thread_id text, project_id text, title text, created_at text, updated_at text, archived_at text, deleted_at text, payload_json text);
    create table orchestration_v2_projection_runs (run_id text, thread_id text, ordinal int, status text, requested_at text, completed_at text, payload_json text);
    create table orchestration_v2_projection_runtime_requests (thread_id text, kind text, status text, created_at text, payload_json text);
    create table orchestration_v2_projection_messages (thread_id text, role text, created_at text, payload_json text);""")
    if legacy_approvals: db.execute("create table projection_pending_approvals (thread_id text, status text)")
    db.execute("insert into projection_projects values ('p1', 'Demo', '/tmp/demo', null)")
    def thread(tid, title, run_status, held=False, reply="Done.", age=1, updated=None, source="web", **extra):
        db.execute("insert into orchestration_v2_projection_threads values (?,?,?,?,?,null,null,?)", (tid, "p1", title, iso(age + 4), iso(updated if updated is not None else age), json.dumps({"creationSource": source, **extra})))
        db.execute("insert into orchestration_v2_projection_runs values (?,?,1,?,?,null,?)", ("r-" + tid, tid, run_status, iso(age + 2), json.dumps({"queueHeld": held})))
        db.execute("insert into orchestration_v2_projection_messages values (?,?,?,?)", (tid, "assistant", iso(age), json.dumps({"text": reply})))
    thread("t-held", "Held queue", "queued", held=True)
    thread("t-queued", "Behind a run", "queued")
    thread("t-done", "Finished work", "completed")
    thread("t-ask", "Asks a question", "completed", reply="Should I merge it?")
    if extra_threads:
        thread("t-settled", "Settled question", "completed", reply="Want me to open the PR?", settledAt=iso(0))
        thread("t-old", "Old work touched today", "completed", age=24 * 20, updated=0)  # settled or renamed today; last real activity 20 days ago
        thread("t-pm", "Notchbot PM", "completed", age=2)
        thread("t-pm2", "Notchbot release notes", "completed", age=3)
        thread("t-snig-a", "Snig review round", "completed", age=2)
        thread("t-snig-b", "Snig review pass", "completed", age=2)
        thread("t-spawn", "Spawned helper task", "completed", source="mcp")
    db.execute("insert into orchestration_v2_projection_runtime_requests values ('t-done', 'command', 'pending', ?, '{}')", (iso(2),))
    db.commit(); db.close()

def run(folder, cmd, rc=False, **env_extra):
    env = {**os.environ, "T3_HOME": folder, **env_extra}
    r = subprocess.run([sys.executable, T3Q, cmd], capture_output=True, text=True, env=env, timeout=60)
    return (r.stdout, r.returncode) if rc else r.stdout

class T3qTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup); self.dir = tmp.name

    def test_waiting_works_without_the_old_approvals_table(self):
        make_db(self.dir)
        out = run(self.dir, "waiting")
        self.assertNotIn("T3_SCHEMA_CHANGED", out)
        self.assertIn("pending command", out)          # approvals now live in runtime_requests
        self.assertIn("Asks a question", out)
        self.assertIn("3 thread(s) waiting on you", out)

    def test_waiting_still_reads_the_old_approvals_table(self):
        make_db(self.dir, legacy_approvals=True)
        self.assertNotIn("T3_SCHEMA_CHANGED", run(self.dir, "waiting"))

    def test_held_queue_is_waiting_not_running(self):
        make_db(self.dir)
        out = run(self.dir, "waiting")
        self.assertIn("Held queue", out); self.assertIn("queue held", out)
        self.assertNotIn("Behind a run", out)            # an ordinary queued run is still live
        ov = run(self.dir, "overview")
        self.assertIn("Held queue | needs you", ov); self.assertIn("Behind a run | running", ov)

    def test_health_reports_held_queue_not_stuck(self):
        make_db(self.dir)
        out = run(self.dir, "health")
        self.assertIn("queue held: Held queue", out)
        self.assertNotIn("STUCK? live run: Held queue", out)
        self.assertNotIn("\u2014", out)                  # no em dashes in output
        if sys.platform != "darwin": self.assertNotIn("diskutil", out)  # the macOS disk note only on macOS
        with open(os.path.join(self.dir, "server-runtime.json"), "w") as f: json.dump({"host": "0.0.0.0", "port": 1, "pid": 999999}, f)
        out = run(self.dir, "health")                      # T3 closed: the binding is from its last run
        self.assertIn("last run was bound to all interfaces", out); self.assertNotIn("WARNING: T3 is bound", out)

    def test_settled_thread_is_not_waiting(self):
        make_db(self.dir, extra_threads=True)
        self.assertNotIn("Settled question", run(self.dir, "waiting"))
        self.assertIn("Settled question | settled", run(self.dir, "overview"))

    def test_activity_time_ignores_updated_at(self):
        make_db(self.dir, extra_threads=True)
        self.assertNotIn("Old work touched today", run(self.dir, "overview", T3_DAYS="3"))
        self.assertIn("Old work touched today", run(self.dir, "overview", T3_DAYS="30"))

    def test_projects_last_uses_activity(self):
        make_db(self.dir, extra_threads=True)
        out = run(self.dir, "projects")
        self.assertIn("Demo", out); self.assertNotIn("T3_SCHEMA_CHANGED", out)

    def test_thread_picks_clear_match(self):
        make_db(self.dir, extra_threads=True)
        out = run(self.dir, "thread", T3_Q="notchbot pm")
        self.assertIn("THREAD Notchbot PM", out); self.assertNotIn("AMBIGUOUS", out)

    def test_thread_by_id(self):
        make_db(self.dir, extra_threads=True)
        self.assertIn("THREAD Settled question", run(self.dir, "thread", T3_Q="t-settled"))

    def test_thread_close_matches_are_ambiguous(self):
        make_db(self.dir, extra_threads=True)
        out = run(self.dir, "thread", T3_Q="snig review")
        self.assertIn("AMBIGUOUS", out); self.assertIn("Snig review round", out); self.assertIn("Snig review pass", out)
        self.assertNotIn("THREAD ", out)

    def test_thread_no_good_match(self):
        make_db(self.dir, extra_threads=True)
        out, code = run(self.dir, "thread", rc=True, T3_Q="zzz nonexistent thread")
        self.assertIn("NO_GOOD_MATCH", out); self.assertNotIn("THREAD ", out); self.assertEqual(code, 1)

    def test_unknown_command_exits_nonzero(self):
        make_db(self.dir)
        self.assertEqual(run(self.dir, "bogus", rc=True)[1], 2)
        self.assertEqual(run(self.dir, "help", rc=True)[1], 0)

    def test_thread_skips_spawned_unless_all(self):
        make_db(self.dir, extra_threads=True)
        self.assertNotIn("THREAD Spawned helper task", run(self.dir, "thread", T3_Q="spawned helper task"))
        self.assertIn("THREAD Spawned helper task", run(self.dir, "thread", T3_Q="spawned helper task", T3_ALL="1"))

    def test_health_size_skips_secret_folders_and_files_in_any_case(self):
        make_db(self.dir)
        sizes = {}
        for rel in ("Secrets/blob", "SECRETS2/blob", "Auth.json", "MyToken.txt", "x/Credentials.db", "oauth/blob", "AuthSessions/blob", ".env", "keys/id_rsa", "x/server.pem", ".ssh/blob", ".gnupg/blob", "HTTPAuth.json", "getHTTPAuth.ts", "XMLAuth.json"):
            p = os.path.join(self.dir, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as f: f.write(b"fixture")
            sizes[p] = 5 * 10**9  # simulated size: truncation allocates real disk space on Windows
        def health_with_sizes():
            hook = """import json, os, runpy, sys
sizes = json.loads(sys.argv[2]); actual = os.path.getsize
os.path.getsize = lambda p: sizes[str(p)] if str(p) in sizes else actual(p)
sys.argv = [sys.argv[1], 'health']; runpy.run_path(sys.argv[0], run_name='__main__')
"""
            result = subprocess.run([sys.executable, "-c", hook, T3Q, json.dumps(sizes)],
                                    capture_output=True, text=True, env={**os.environ, "GETTER_HOME": self.dir}, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return result.stdout
        out = health_with_sizes()
        self.assertIn("T3 data folder: 0.00 GB", out)
        author = os.path.join(self.dir, "author.md")
        with open(author, "wb") as f: f.write(b"fixture")
        sizes[author] = 2 * 10**9  # "auth" is a whole word: author.md is counted
        self.assertIn("T3 data folder: 2.00 GB", health_with_sizes())

    def test_health_never_runs_the_runtime_port_through_a_shell(self):
        make_db(self.dir)
        canary = os.path.join(self.dir, "pwned")
        for port in (f"1; touch {canary}", f"$(touch {canary})", [1], True, 70000):
            with open(os.path.join(self.dir, "server-runtime.json"), "w") as f: json.dump({"host": "127.0.0.1", "port": port, "pid": f"1; touch {canary}"}, f)
            out, code = run(self.dir, "health", rc=True)
            self.assertFalse(os.path.exists(canary), port); self.assertEqual(code, 0, out)
            self.assertIn("port None reachable: False", out)

    def test_bad_number_settings_stop_with_a_status_word(self):
        make_db(self.dir, extra_threads=True)
        for cmd, env in (("overview", {"T3_DAYS": "abc"}), ("waiting", {"T3_DAYS": "-3"}), ("thread", {"T3_Q": "Finished work", "T3_LAST": "x"})):
            out, code = run(self.dir, cmd, rc=True, **env)
            self.assertIn("BAD_SETTING", out); self.assertNotIn("Traceback", out); self.assertEqual(code, 1)
        self.assertEqual(run(self.dir, "overview", rc=True, T3_DAYS="3")[1], 0)

    def test_schema_change_and_busy_database_exit_1(self):
        db = sqlite3.connect(os.path.join(self.dir, "statev2.sqlite")); db.execute("create table other (x)"); db.commit(); db.close()
        out, code = run(self.dir, "overview", rc=True)
        self.assertIn("T3_SCHEMA_CHANGED", out); self.assertEqual(code, 1)
        make_db(self.dir)
        lock = sqlite3.connect(os.path.join(self.dir, "statev2.sqlite"), isolation_level=None); lock.execute("pragma journal_mode=delete"); lock.execute("begin exclusive")
        try:
            out, code = run(self.dir, "overview", rc=True)
            self.assertIn("T3_DB_BUSY", out); self.assertEqual(code, 1)
        finally: lock.execute("rollback"); lock.close()

if __name__ == "__main__": unittest.main(verbosity=1)
