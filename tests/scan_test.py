#!/usr/bin/env python3
"""tools/cleanup/scan.py --dupes: duplicates are found, and secret, key, .env, .ssh and token files are never opened or hashed."""
import builtins, io, json, os, pathlib, runpy, sys, tempfile, unittest, contextlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCAN = str(ROOT / "tools" / "cleanup" / "scan.py")


class Dupes(unittest.TestCase):
    def test_dupes_skip_sensitive_paths_before_opening(self):
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="t3scan-"))
        body = b"same bytes " * 20000
        plain = ["a/movie.bin", "b/movie copy.bin", "author.md", "docs/authority.bin"]
        sensitive = ["secrets/movie.bin", ".ssh/id_backup", "app/.env", "app/.env.development", "MyToken.bin", "keys/server.pem", "auth/cache.bin", "googleAuth.bin", "x/id_ed25519", "HTTPAuth.bin", "getHTTPAuth.ts", "XMLAuth.bin"]
        for rel in plain + sensitive:
            p = tmp / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(body)
        opened, real_open = [], builtins.open
        def spy(f, *a, **k):
            opened.append(os.fspath(f)) if not isinstance(f, int) else None; return real_open(f, *a, **k)
        out, argv = io.StringIO(), sys.argv
        sys.argv = [SCAN, str(tmp), "--dupes", "--dupe-min-mb", "0.01", "--jobs", "1"]
        try:
            builtins.open = spy
            with contextlib.redirect_stdout(out): runpy.run_path(SCAN, run_name="__main__")
        finally:
            builtins.open = real_open; sys.argv = argv
        dup = [sorted(os.path.relpath(p, tmp).replace(os.sep, "/") for p in g["paths"]) for g in json.loads(out.getvalue())["results"][0]["duplicates"]]
        self.assertEqual(dup, [sorted(plain)])
        touched = {os.path.relpath(p, tmp).replace(os.sep, "/") for p in opened if p.startswith(str(tmp))}
        self.assertFalse(touched & set(sensitive), touched & set(sensitive))


if __name__ == "__main__":
    unittest.main()
