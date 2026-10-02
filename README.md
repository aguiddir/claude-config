# claude-config

My Claude Code setup, tuned for Opus 5.5 / Sonnet 5.5.

```bash
git clone git@github.com:aguiddir/claude-config.git ~/PycharmProjects/claude-config
cd ~/PycharmProjects/claude-config
./install.sh --dry-run   # see what would change
./install.sh             # apply; safe to re-run
```

Needs `claude`, `python3` and `git`. `npm` is optional (Playwright CLI). Skip parts with `--skip-plugins`, `--skip-mcp`, `--skip-playwright`.

## Just the desktop notifications

A notification when Claude finishes, fails, asks for a permission or asks a question. In [herdr](https://herdr.dev) it names the workspace and the agent session, and stays quiet for the pane you are looking at. Each session keeps a single notification, replaced in place, that leaves the screen after a few seconds. Linux only (D-Bus notifications, tested on GNOME); needs `jq`.

```
/plugin marketplace add aguiddir/claude-config
/plugin install notify@claude-config
```

Titles are in French: edit the `case` in `plugins/notify/scripts/notify.sh` to change them.

## Just the replay

After a turn that edited files, a band above the prompt offers to replay them: press `r` in an empty prompt, or type `/replay` any time. The edits show one diff at a time above the prompt; `n` and `p` step, `q` closes, the mouse wheel scrolls a long diff. Only `Edit` and `Write` calls are recorded, not changes made through Bash. Needs Claude Code 2.1.287 or later ([mods](https://claude.dev/blog/getting-started-with-claude-code-mods/)).

```
/plugin marketplace add aguiddir/claude-config
/plugin install replay@claude-config
```

Messages are in French: edit the strings in `plugins/replay/hooks/register.tsx` to change them.

## Just the CI watch

For Vidal repos built on `jenkins.vidal.net`. A band above the prompt follows the Jenkins build of the current branch, or of its PR (`PR-<n>`) when the branch has no job of its own: a progress bar from Jenkins' estimated duration, the stage running, each stage's state, and a link to the build. When the build ends, a toast gives its result. Once the build's own SonarQube stage has run, the band shows the quality gate of the branch or PR with the conditions that failed, read 30 seconds after the end so that it is this build's analysis, and a toast says when it fails. A finished build stays on the band for 15 minutes. When the build fails or its gate is red, `f` in an empty prompt (until the next prompt you send; after that, ctrl+x tab then `f`, or the band's button) puts the failure in the prompt box, to read, edit and send yourself: the failed stage, the console's error lines and the gate's broken conditions. Sending that prompt attaches the last 150 lines of the console, out of the box.

It reads the repo and branch of the directory Claude Code runs in and polls Jenkins every 10 seconds, anonymously, from the Vidal network. `/ci <path>` follows another repo, `/ci` alone goes back to the session's directory. Needs `gh` (to find the PR) and, for the quality gate, the SonarQube MCP server connected in Claude Code. Needs Claude Code 2.1.287 or later.

```
/plugin marketplace add aguiddir/claude-config
/plugin install ci-watch@claude-config
```

The Jenkins host and job folder (`team.software/github`) are set at the top of `plugins/ci-watch/hooks/jenkins.ts`.

## What's inside

| Path | Installed as | What it does |
|---|---|---|
| `claude/CLAUDE.md` | `~/.claude/CLAUDE.md` (symlink) | Global instructions: autonomy, long sessions, pre-review format |
| `claude/rules/git-commit.md` | `~/.claude/rules/` (symlink) | Commit message rules: why over what, fixup commits for review changes |
| `claude/statusline-command.sh` | `~/.claude/` (symlink) | 3-line status line: repo/git/PR, context/cost, rate limits |
| `claude/settings.json` | merged into `~/.claude/settings.json` | Auto mode, status line, Opus effort, theme |
| `plugins.txt` | `claude plugin install` | Marketplaces and plugins |
| `plugins/notify/` | plugin `notify@claude-config` | Desktop notification (D-Bus) per hook event: done, error, permission, question |
| `plugins/replay/` | plugin `replay@claude-config` | `/replay` (or `r` after a turn) steps through the last turn's `Edit`/`Write` calls as diffs above the prompt (a [mod](https://claude.dev/blog/getting-started-with-claude-code-mods/)) |
| `plugins/ci-watch/` | plugin `ci-watch@claude-config` | Band above the prompt following the current branch's Jenkins build stage by stage, with its Sonar quality gate (a mod) |

Symlinked files take effect as soon as you edit them here. `settings.json` is merged instead of linked because Claude Code rewrites it (`/config`, `/model`); existing keys and permission rules are kept, and the previous file is saved as `.bak.<date>`.

The installer also sets up:

- **codebase-memory-mcp**: code knowledge-graph MCP server, from the release tarball after a SHA-256 check, registered for Claude Code only.
- **jq** in `~/.local/bin`, from the release binary after a SHA-256 check, when it is not already installed. The notify plugin needs it.
- **Playwright agent CLI** with its skills, when `npm` is available.

## Sources

- Status line: https://code.claude.com/docs/en/statusline
- Instruction files and rules: https://code.claude.com/docs/en/memory
- Opus 5.5 guidance: https://claude.dev/blog/getting-the-most-out-of-opus-5-5/
- Inspired by https://github.com/jcgay/dotfiles
