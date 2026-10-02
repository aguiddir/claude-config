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

A notification when Claude finishes, fails, asks for a permission or asks a question. In [herdr](https://herdr.dev) it names the workspace and the agent session, and stays quiet for the pane you are looking at. Linux only (`notify-send`); needs `jq`.

```
/plugin marketplace add aguiddir/claude-config
/plugin install notify@claude-config
```

Titles are in French: edit the `case` in `plugins/notify/scripts/notify.sh` to change them.

## What's inside

| Path | Installed as | What it does |
|---|---|---|
| `claude/CLAUDE.md` | `~/.claude/CLAUDE.md` (symlink) | Global instructions: autonomy, long sessions, pre-review format |
| `claude/rules/git-commit.md` | `~/.claude/rules/` (symlink) | Commit message rules: why over what, fixup commits for review changes |
| `claude/statusline-command.sh` | `~/.claude/` (symlink) | 3-line status line: repo/git/PR, context/cost, rate limits |
| `claude/settings.json` | merged into `~/.claude/settings.json` | Auto mode, status line, Opus effort, theme |
| `plugins.txt` | `claude plugin install` | Marketplaces and plugins |
| `plugins/notify/` | plugin `notify@claude-config` | Desktop notification (`notify-send`) per hook event: done, error, permission, question |
| `plugins/replay/` | plugin `replay@claude-config` | `/replay` steps through the last turn's `Edit`/`Write` calls as diffs in a pane (a [mod](https://claude.dev/blog/getting-started-with-claude-code-mods/)) |

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
