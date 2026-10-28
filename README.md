# Getter Tots

Getter Tots is the local companion for [Getter Code](https://github.com/SamirCarneiro/getter-code), derived from [T3 Tots by Deepusleepy](https://github.com/Deepusleepy/t3-tots). It keeps the upstream MIT license, skill names, read-only database access, and approval controls.

## Getter local usage

This repository ships local commands rather than a separate desktop application. Start Getter Code first, then run these commands from this checkout with Node 22+ and Python 3.8+:

```powershell
node tools/getterctl
node tools/getterq projects
node tools/getterq health
```

For an explicitly selected server home, use the same folder passed to Getter Code:

```powershell
node tools/getterq --getter-home 'D:\GetterData' projects
node tools/getterctl --getter-home 'D:\GetterData' projects

# PowerShell launchers preserve each argument, including paths with spaces.
./scripts/getterq.ps1 -GetterHome 'D:\GetterData' projects
./scripts/getterctl.ps1 -GetterHome 'D:\GetterData' projects
```

The discovery order is `GETTER_HOME`, explicit `T3_HOME`, explicit `T3CODE_HOME`, then `~/.getter-code/userdata`. A base folder resolves to its `userdata` subfolder; a folder containing `server-runtime.json` or `statev2.sqlite`, or explicitly named `userdata` or `dev`, is used directly. No command silently falls back to the upstream `~/.t3` installation. Set `GETTER_HOME` for `t3listen`, `export.js`, and `survey.js` too. Windows `getterq` uses `py -3`; `GETTER_PYTHON` can select a Python executable by its full path.

`getterq` needs no token and opens the database read-only. Authenticated `getterctl` commands use only the existing `tools/token` file; the wrappers do not issue tokens, install skills, enable listeners, or send prompts on startup. An absent token is reported as `NO_TOKEN`. Upstream approval guards remain in place, including `--user-approved` for an accepted approval.

The local `manifest.json` identifies the Getter revision and verifies its modified tools. `upstream-manifest.json` preserves the original v1.4.29 hashes, and all 22 upstream skills retain their original bytes. Their release installer still refers to the original T3 Tots release; use the local Getter launchers above for this fork. Getter releases must be tagged before remote installation.

The protocol remains the T3 orchestration protocol 2, with `server-runtime.json`, `statev2.sqlite`, and `/api/orchestration/*`. It is an internal interface and must be checked alongside Getter Code updates. Optional listeners use their own Getter service identity (`com.getter.tots.listen` / `Getter Tots listener`); `GETTER_LISTEN_LABEL` or the explicit legacy `T3LISTEN_LABEL` overrides it. Listener installation on Windows does not retain a home variable set only in the calling shell; use the default Getter home or supply that environment again when starting the listener manually.

## Upstream T3 Tots documentation

Grok Bot / chat companion for [T3 Code](https://github.com/pingdotgg/t3code), with skills and helper tools. Thread status, waiting items, new threads, answers, reports, watches, and updates.

T3 Tots is unofficial. `t3ctl` and `t3listen` use T3 Code's internal local websocket API, which isn't public or stable, and `t3q.py` reads its database read-only. A T3 Code update can break them. T3 Tots will move to the official API when T3 ships one.

[MIT](LICENSE). No accounts or telemetry. The only outbound send is optional `t3listen` to a webhook you set up.

Start with [t3-getting-started](skills/t3-getting-started/SKILL.md). Install and verify by following [AGENTS.md](AGENTS.md). Shared rules: [t3-tots-rules](skills/t3-tots-rules/SKILL.md).

## What's here

| Path | What it is |
|---|---|
| `skills/` | One folder per skill. |
| `tools/` | Scripts, installed flat into one folder per computer. |
| `manifest.json` | Version, dest path, size, SHA-256, and which OS gets each file. |
| `scripts/`, `tests/` | Checks, manifest builder, skill sync. |
| `assets/avatar.png` | Official face, 1024x1024 PNG. First setup downloads it from the pinned release. |

| Tool | Where | What |
|---|---|---|
| `t3q.py` | all | Read-only T3 DB queries. No token. |
| `t3ctl` | all | Local API client and `skills` installer. `node t3ctl` prints usage. |
| `t3listen` | all | Optional. Pushes questions and run ends to your webhook. |
| `export.js`, `survey.js` | all | Redacted export and activity survey. |
| `t3ui` + `ui-*.applescript` | macOS | UI fallback if the local API is down (needs Accessibility). |
| `cleanup/scan.py` | all | Read-only disk-usage scan. |
| `cleanup/make_report.py`, `report/report.py` | Grok Bot box | HTML cleanup report and briefing. |
| `t3ctl.cmd`, `t3listen.cmd` | Windows | `cmd` wrappers. From PowerShell use `node t3ctl`. |

## Install

Install from a release tag, not from `main`. Every file is checked against that tag's `manifest.json` before it is used.

**Grok Bot.** Skills are built in. Say "set up T3 Tots". After your yes it installs the tools on each computer. The template card uses a geometric mark. First setup sets the official face from [`assets/avatar.png`](assets/avatar.png) when that download works.

**Other agents** (Claude Code, Codex, Cursor, Hermes). Download a release or clone the tag, then install the skills:

```sh
gh release download -R Deepusleepy/t3-tots --archive tar.gz
tar xzf t3-tots-*.tar.gz && cd t3-tots-*/
node tools/t3ctl skills install --to ~/.claude/skills --dry-run
node tools/t3ctl skills install --to ~/.claude/skills
```

Clone the same tag:

```sh
git clone --branch <tag> --depth 1 https://github.com/Deepusleepy/t3-tots.git
cd t3-tots
node tools/t3ctl skills install --to ~/.claude/skills --dry-run
node tools/t3ctl skills install --to ~/.claude/skills
```

Windows: `gh release download -R Deepusleepy/t3-tots --archive zip`, expand, then `--to "$env:USERPROFILE\.claude\skills"`.

Skill folders: Claude Code `~/.claude/skills`, Codex `~/.agents/skills`, Cursor `~/.cursor/skills`, Hermes `~/.hermes/skills` (same paths under `%USERPROFILE%` on Windows). Install into one folder only. Cursor also loads the other three, so a second copy is listed twice.

Then ask the agent to set up T3 Tots. It follows [AGENTS.md](AGENTS.md) (hash-check against `manifest.json`. Grok Bot-only steps: `t3-tots-rules` "Grok Bot only"). Updates use the same commands. Edited skills are kept unless you pass `--force` (the old copy goes to `out/skills-backup/<timestamp>/`).

## Phone answers (optional)

`t3listen` POSTs live T3 events to a webhook you set up (`setup`, then `install` at login). Events: `request.opened` / `request.resolved`, and `thread.finished` / `failed` / `cancelled`. Approvals only if you turn them on. Usage-limit stops can arm T3's Resume at reset.

Setup, events, approvals, and autoresume: [t3-phone-answers](skills/t3-phone-answers/SKILL.md). Who may answer: [t3-tots-rules "Decisions"](skills/t3-tots-rules/SKILL.md).

## Delegated mode and approvals

Delegated mode starts only when you hand over control, for example "I'm away, keep it moving". The agent then answers routine questions, nudges stalled threads, and resumes threads after a usage limit.

Even a full-access thread can stop on "Allow running this command?" when a safety check flags it, for example a git hook that asks before `git reset --hard`. In delegated mode the agent never says yes to these. It declines them with `t3ctl answer --decision decline --redirect`, which tells the thread not to retry or work around it, to use a safer way or skip that step, and to keep going. You get the list of what was declined and why when you're back.

When you're around, each approval comes to you as a card with the reason it asks, and the agent accepts it only after your yes for that request. `t3ctl answer` backs this up. An accept without `--user-approved` is refused with `NEEDS_USER_APPROVAL`, and nothing is sent.

Threads that `t3ctl new` and `t3ctl tasks --upsert` start run in full access unless you pass `--runtime`.

## Requirements

- **Python 3.8+** for `t3q.py` and `cleanup/scan.py` (3.9+ for `report/report.py`). Windows: `py -3`.
- **Node 22+** for `t3ctl` and `t3listen` (Node 18+ for `export.js` and `survey.js`).
- **T3 Code** installed and opened at least once.

## Security

- `t3q.py` opens `statev2.sqlite` read-only. From `server-runtime.json` it reads only `host`, `port` and `pid`.
- Scripts never open T3's `secrets/` or other credentials. The only token they read sits next to them, after your yes, with a 90-day TTL, and is never printed. Issue and revoke: [t3-tots-rules "Token"](skills/t3-tots-rules/SKILL.md).
- Traffic stays on `127.0.0.1` except optional `t3listen` POSTs to your webhook. Exports redact API-key patterns and your home path.
- No token: read-only. With one, `t3ctl answer` sends only the answer you chose, and accepts an approval only with `--user-approved`. `t3ctl skills` writes only into `--to` and its own `out/`.

Report issues in [SECURITY.md](SECURITY.md).

## Developing

- `scripts/check.sh`. Syntax, tests, manifest freshness, CRLF on the Windows wrappers, private-word scan. Never-ship words go one per line in `~/.config/t3-tots/private-words.txt` (do not commit it). No list fails the check. `T3TOTS_NO_PRIVATE_WORDS=1` skips it on purpose.
- After changing a tool, add it to `TOOLS` in `scripts/make-manifest.py` and run that script. It rewrites `manifest.json` from `VERSION`.
- `scripts/sync-skills --from <folder>` (or `T3TOTS_SKILLS_SRC`) copies live skills into `skills/`, scans for private details, and updates the manifest. It copies nothing if the scan fails.
- Never decide an approval by reading its text. T3 often shows a description instead of the command. Approval decisions go through `approvalAuthority`.
- Release only from a tag. Installers download by tag and check every hash.
