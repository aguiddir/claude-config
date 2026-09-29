# claude-config

My Claude Code setup, tuned for Opus 5.5 / Sonnet 5.5, plus helpers for the shared VIDAL Docker hosts.

```bash
git clone git@github.com:aguiddir/claude-config.git ~/PycharmProjects/claude-config
cd ~/PycharmProjects/claude-config
./install.sh --dry-run   # see what would change
./install.sh             # apply; safe to re-run
```

Needs `claude`, `python3` and `git`. `npm` is optional (Playwright CLI). Skip parts with `--skip-plugins`, `--skip-mcp`, `--skip-playwright`.

## What's inside

| Path | Installed as | What it does |
|---|---|---|
| `claude/CLAUDE.md` | `~/.claude/CLAUDE.md` (symlink) | Global instructions: autonomy, long sessions, pre-review format |
| `claude/rules/git-commit.md` | `~/.claude/rules/` (symlink) | Commit message rules: why over what, fixup commits for review changes |
| `claude/skills/remote-docker/` | `~/.claude/skills/` (symlink) | Tells Claude how to use the shared Docker hosts safely |
| `claude/statusline-command.sh` | `~/.claude/` (symlink) | 3-line status line: repo/git/PR, context/cost, rate limits |
| `claude/settings.json` | merged into `~/.claude/settings.json` | Status line, effort, and `ask` rules for state changes on shared hosts |
| `plugins.txt` | `claude plugin install` | Marketplaces and plugins |
| `bin/` | `~/.local/bin/` (symlink) | `dockersw`, `dockerbo`, `dockersw2` wrappers |
| `shell/docker.sh` | sourced from `~/.zshrc` / `~/.bashrc` | `dco`, `ctop`, `dockerclean`, `dockercleani`, `dockerstop`, `dockerhosts` |

Symlinked files take effect as soon as you edit them here. `settings.json` is merged instead of linked because Claude Code rewrites it (`/config`, `/model`); existing keys and permission rules are kept, and the previous file is saved as `.bak.<date>`.

The installer also sets up:

- **codebase-memory-mcp**: code knowledge-graph MCP server, from the release tarball after a SHA-256 check, registered for Claude Code only.
- **Playwright agent CLI** with its skills, when `npm` is available.

## Docker hosts

| Command | Host | Notes |
|---|---|---|
| `dockersw` | `dockersw.vidal.net:4243` | API pinned to 1.41 |
| `dockerbo` | `dockerbo.vidal.net:4243` | API pinned to 1.39 |
| `dockersw2` | `dockersw2.vidal.net:2376` | TLS, certs in `~/.dockersw2` (`ca.pem`, `client-jenkins-cert.pem`, `client-jenkins-key.pem`); compose via `dockersw2 compose` |

Every helper takes the host as an optional first argument: `dockerhosts dockersw`, `dockerclean dockerbo`. Hosts, API versions and the cert directory can be overridden with `DOCKERSW_HOST`, `DOCKERSW_API_VERSION`, `DOCKERBO_HOST`, `DOCKERBO_API_VERSION`, `DOCKERSW2_HOST`, `DOCKERSW2_CERT_DIR`.

Claude may run read-only commands on these hosts freely. Anything that changes state (`run`, `stop`, `rm`, `compose up/down`, `prune`...) asks for confirmation, even in auto mode.

## Sources

- Status line: https://code.claude.com/docs/en/statusline
- Instruction files and rules: https://code.claude.com/docs/en/memory
- Permission rules: https://code.claude.com/docs/en/permissions
- Opus 5.5 guidance: https://claude.dev/blog/getting-the-most-out-of-opus-5-5/
- Inspired by https://github.com/jcgay/dotfiles
