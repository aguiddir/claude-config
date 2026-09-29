#!/usr/bin/env bash
# Install this Claude Code config on the current machine. Safe to re-run.
#
#   ./install.sh            everything
#   ./install.sh --dry-run  print what would change, change nothing
#   ./install.sh --skip-plugins --skip-mcp --skip-playwright
#
# Files are symlinked into ~/.claude, so editing them in this repo takes
# effect immediately. settings.json is merged, never replaced: Claude Code
# writes to it too (/config, /model...).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
BIN_DIR="$HOME/.local/bin"
DRY_RUN=false SKIP_PLUGINS=false SKIP_MCP=false SKIP_PLAYWRIGHT=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --skip-plugins) SKIP_PLUGINS=true ;;
    --skip-mcp) SKIP_MCP=true ;;
    --skip-playwright) SKIP_PLAYWRIGHT=true ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
run()  { if $DRY_RUN; then info "[dry-run] $*"; else "$@"; fi; }
has()  { command -v "$1" >/dev/null 2>&1; }

# Symlink $1 (in repo) to $2, backing up whatever real file was there.
link() {
  local src="$1" dest="$2"
  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
    info "ok       ${dest/#$HOME/\~}"; return
  fi
  if [ -f "$dest" ] && [ ! -L "$dest" ] && cmp -s "$src" "$dest"; then
    info "replace  ${dest/#$HOME/\~} (identical copy)"
    run rm "$dest"
  elif [ -e "$dest" ] || [ -L "$dest" ]; then
    local bak="$dest.bak.$(date +%Y%m%d%H%M%S)"
    info "backup   ${dest/#$HOME/\~} -> ${bak##*/}"
    run mv "$dest" "$bak"
  fi
  info "link     ${dest/#$HOME/\~}"
  run mkdir -p "$(dirname "$dest")"
  run ln -s "$src" "$dest"
}

for cmd in claude python3 git; do
  has "$cmd" || { echo "missing required command: $cmd" >&2; exit 1; }
done

# --- Claude Code files --------------------------------------------------
step "Claude Code files"
link "$REPO/claude/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
link "$REPO/claude/statusline-command.sh" "$CLAUDE_DIR/statusline-command.sh"
# Link rules and skills one by one so ones added outside this repo survive
for f in "$REPO"/claude/rules/*.md; do link "$f" "$CLAUDE_DIR/rules/${f##*/}"; done
for d in "$REPO"/claude/skills/*/; do d="${d%/}"; link "$d" "$CLAUDE_DIR/skills/${d##*/}"; done

# --- settings.json --------------------------------------------------------
step "Merge settings.json"
DRY_RUN=$DRY_RUN python3 - "$REPO/claude/settings.json" "$CLAUDE_DIR/settings.json" <<'PY'
import json, os, shutil, sys, time
src, dest = sys.argv[1:]
ours = json.load(open(src))
ours.pop("$schema", None)
theirs = json.load(open(dest)) if os.path.exists(dest) else {}

def merge(a, b):
    """Merge b into a: dicts recurse, lists union (a's order first), scalars from b."""
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            merge(a[k], v)
        elif isinstance(v, list) and isinstance(a.get(k), list):
            a[k] += [x for x in v if x not in a[k]]
        else:
            a[k] = v
    return a

before = json.dumps(theirs, sort_keys=True)
merged = merge(json.loads(before), ours)
if json.dumps(merged, sort_keys=True) == before:
    print("    ok       settings.json already up to date")
elif os.environ["DRY_RUN"] == "true":
    print("    [dry-run] would update settings.json")
else:
    if os.path.exists(dest):
        shutil.copy2(dest, f"{dest}.bak.{time.strftime('%Y%m%d%H%M%S')}")
    with open(dest, "w") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("    updated  settings.json (previous copy kept as .bak)")
PY

# --- Plugins --------------------------------------------------------------
if ! $SKIP_PLUGINS; then
  step "Plugins"
  # The official index is not fetched until claude has run once
  run claude plugin marketplace update claude-plugins-official >/dev/null || true
  known_mkt=$(claude plugin marketplace list 2>/dev/null || true)
  installed=$(claude plugin list 2>/dev/null || true)
  while read -r kind name; do
    case "$kind" in
      marketplace)
        if grep -qF "$name" <<<"$known_mkt"; then info "ok       marketplace $name"
        else info "add      marketplace $name"; run claude plugin marketplace add "$name" || true; fi ;;
      plugin)
        if grep -qF "❯ $name" <<<"$installed"; then info "ok       $name"
        else info "install  $name"; run claude plugin install "$name" || true; fi ;;
    esac
  done < <(grep -Ev '^\s*(#|$)' "$REPO/plugins.txt")
fi

# --- codebase-memory-mcp --------------------------------------------------
# Installed from the release tarball after checking its SHA-256, with
# --skip-config: the upstream installer would otherwise edit the config of
# every coding agent it detects. Only Claude Code is registered, below.
if ! $SKIP_MCP; then
  step "MCP server: codebase-memory-mcp"
  if has codebase-memory-mcp || [ -x "$BIN_DIR/codebase-memory-mcp" ]; then
    info "ok       binary $("$BIN_DIR/codebase-memory-mcp" --version 2>/dev/null || codebase-memory-mcp --version)"
  elif $DRY_RUN; then
    info "[dry-run] would download and install codebase-memory-mcp"
  else
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m); case "$arch" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; esac
    # The standard Linux build needs glibc 2.38+; the portable one runs on older distros
    asset="codebase-memory-mcp-$os-$arch"; [ "$os" = linux ] && asset+="-portable"
    asset+=".tar.gz"
    url="https://github.com/DeusData/codebase-memory-mcp/releases/latest/download"
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    curl -fsSL -o "$tmp/$asset" "$url/$asset"
    curl -fsSL -o "$tmp/checksums.txt" "$url/checksums.txt"
    (cd "$tmp" && grep " $asset\$" checksums.txt | sha256sum -c --quiet -)
    tar xzf "$tmp/$asset" -C "$tmp"
    "$tmp/codebase-memory-mcp" install -y --dir="$BIN_DIR" --skip-config
  fi
  if claude mcp get codebase-memory-mcp >/dev/null 2>&1; then
    info "ok       registered in Claude Code"
  else
    info "register in Claude Code (user scope)"
    run claude mcp add -s user codebase-memory-mcp "$BIN_DIR/codebase-memory-mcp"
  fi
fi

# --- Playwright agent CLI -------------------------------------------------
if ! $SKIP_PLAYWRIGHT; then
  step "Playwright agent CLI (https://playwright.dev/agent-cli/installation)"
  if ! has npm; then
    info "skip: npm not found"
  elif has playwright-cli; then
    info "ok       $(playwright-cli --version 2>/dev/null | head -1)"
  else
    run npm install -g @playwright/cli@latest
    # `install --skills` must be run from $HOME (see the link above)
    $DRY_RUN || (cd "$HOME" && playwright-cli install --skills)
  fi
fi

step "Done. Restart Claude Code, then check /context and /plugin."
