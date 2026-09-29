#!/usr/bin/env bash
# Claude Code status line, see https://code.claude.com/docs/en/statusline
# L1: modèle | dossier | git | PR/MR | worktree
# L2: contexte | coût | durée | lignes
# L3: limites 5h / 7j avec reset (split sur 2 lignes si le terminal est étroit)
# Icons: emoji-presentation glyphs only (always 2 cols wide); text-default ones like ↻ ⏱ misalign
IFS=$'\x1f' read -r model effort cwd sid ctx ctxsize cost dur ladd lrem \
  u5 r5 u7 r7 prnum prurl prstate prkind wt < <(python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
def g(*k):
    v=d
    for x in k:
        v=v.get(x) if isinstance(v,dict) else None
    return v
def s(v): return "" if v is None else str(v)
def n(v):
    try: return str(int(round(float(v))))
    except (TypeError,ValueError): return ""
c=g("cost","total_cost_usd")
print("\x1f".join([
  s(g("model","display_name") or "?"), s(g("effort","level")),
  s(g("workspace","current_dir") or g("cwd")), s(g("session_id") or "default"),
  n(g("context_window","used_percentage")), n(g("context_window","context_window_size")),
  "" if c is None else "%.2f" % float(c), n(g("cost","total_duration_ms")),
  n(g("cost","total_lines_added")), n(g("cost","total_lines_removed")),
  n(g("rate_limits","five_hour","used_percentage")), n(g("rate_limits","five_hour","resets_at")),
  n(g("rate_limits","seven_day","used_percentage")), n(g("rate_limits","seven_day","resets_at")),
  n(g("pr","number")), s(g("pr","url")), s(g("pr","review_state")), s(g("pr","kind")),
  s(g("workspace","git_worktree") or g("worktree","name")),
]))
')

E=$'\033'
R="$E[0m"; D="$E[2m"; B="$E[1m"
RED="$E[31m"; GRN="$E[32m"; YEL="$E[33m"; BLU="$E[34m"; MAG="$E[35m"; CYN="$E[36m"
GRY="$E[90m"
SEP=" ${GRY}│${R} "
cols=${COLUMNS:-120}

# Thresholds from the official multi-line example: green < 70, yellow 70-89, red >= 90
color() {
  if [ "$1" -ge 90 ]; then printf '%s' "$RED"
  elif [ "$1" -ge 70 ]; then printf '%s' "$YEL"
  else printf '%s' "$GRN"; fi
}
bar() { # $1 = percent used -> coloured 10-cell bar + percent
  local p=$1 f
  [ "$p" -gt 100 ] && p=100
  f=$(( (p * 10 + 50) / 100 ))
  printf -v FILL "%${f}s"; printf -v PAD "%$((10 - f))s"
  printf '%s%s%s%s%s %s%3d%%%s' "$(color "$p")" "${FILL// /█}" "$GRY" "${PAD// /░}" "$R" "$B" "$1" "$R"
}
human() { # tokens -> 200k / 1M
  if [ "$1" -ge 1000000 ]; then printf '%sM' "$(( $1 / 1000000 ))"
  else printf '%sk' "$(( $1 / 1000 ))"; fi
}
countdown() { # epoch -> "1h58" / "3j11h" / "12min"
  local s=$(( $1 - $(date +%s) ))
  [ "$s" -lt 0 ] && s=0
  local d=$((s/86400)) h=$(((s%86400)/3600)) m=$(((s%3600)/60))
  if [ $d -gt 0 ]; then printf '%dj%02dh' $d $h
  elif [ $h -gt 0 ]; then printf '%dh%02d' $h $m
  else printf '%dmin' $m; fi
}
# Visible width: strip ANSI/OSC 8, emojis count as 2 columns
vislen() {
  local t; t=$(printf '%s' "$1" | sed -E "s/$E\[[0-9;]*m//g; s/$E\]8;;[^$E]*$E\\\\//g")
  local emo; emo=$(printf '%s' "$t" | grep -oP '[\x{1F300}-\x{1FAFF}\x{2705}\x{23F3}\x{26A1}]' | wc -l)
  echo $(( $(printf '%s' "$t" | wc -m) + emo ))
}

# --- Git (cached per session, TTL 5s) ---
branch="" staged=0 modified=0
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  cache="/tmp/statusline-git-${sid//[^A-Za-z0-9_-]/_}"
  if [ -f "$cache" ] && [ $(( $(date +%s) - $(stat -c %Y "$cache" 2>/dev/null || echo 0) )) -lt 5 ] \
     && IFS=$'\t' read -r ccwd branch staged modified < "$cache" && [ "$ccwd" = "$cwd" ]; then
    :
  else
    branch=$(git -C "$cwd" branch --show-current 2>/dev/null)
    [ -z "$branch" ] && branch="detached@$(git -C "$cwd" rev-parse --short HEAD 2>/dev/null)"
    staged=$(git -C "$cwd" diff --cached --numstat 2>/dev/null | wc -l)
    modified=$(git -C "$cwd" diff --numstat 2>/dev/null | wc -l)
    printf '%s\t%s\t%s\t%s\n' "$cwd" "$branch" "$staged" "$modified" > "$cache" 2>/dev/null
  fi
fi

# --- Ligne 1 : modèle, dossier, git, PR/MR ---
l1="${CYN}${B}[${model}]${R}"
[ -n "$effort" ] && l1+=" ${GRY}${effort}${R}"
[ -n "$cwd" ] && l1+="${SEP}📁 ${BLU}${B}${cwd##*/}${R}"
if [ -n "$branch" ]; then
  l1+="${SEP}🌿 ${MAG}${branch}${R}"
  [ "$staged" -gt 0 ] && l1+=" ${GRN}+${staged}${R}"
  [ "$modified" -gt 0 ] && l1+=" ${YEL}~${modified}${R}"
  [ "$staged" -eq 0 ] && [ "$modified" -eq 0 ] && l1+=" ✅"
fi
if [ -n "$prnum" ]; then
  [ "$prkind" = "mr" ] && label="MR !${prnum}" || label="PR #${prnum}"
  case "$prstate" in
    approved) st="${GRN}approuvée${R}" ;; changes_requested) st="${RED}changements demandés${R}" ;;
    draft) st="${GRY}brouillon${R}" ;; pending) st="${YEL}en revue${R}" ;; *) st="" ;;
  esac
  [ -n "$prurl" ] && label="$E]8;;${prurl}$E\\${label}$E]8;;$E\\"
  l1+="${SEP}🔀 ${B}${label}${R}"
  [ -n "$st" ] && l1+=" ${st}"
fi
[ -n "$wt" ] && l1+="${SEP}🌳 ${wt}"

# --- Ligne 2 : contexte + session ---
if [ -n "$ctx" ]; then
  l2="🧠 $(bar "$ctx")"
  [ -n "$ctxsize" ] && [ "$ctxsize" -gt 0 ] && l2+=" ${GRY}de $(human "$ctxsize")${R}"
else
  l2="🧠 ${GRY}░░░░░░░░░░  -- en attente${R}"
fi
[ -n "$cost" ] && l2+="${SEP}💰 ${YEL}${B}\$${cost}${R}"
if [ -n "$dur" ]; then
  secs=$(( dur / 1000 ))
  if [ $secs -ge 3600 ]; then d="$((secs/3600))h$(printf '%02d' $(( (secs%3600)/60 )))"
  else d="$((secs/60))m $(printf '%02d' $((secs%60)))s"; fi
  l2+="${SEP}⏳ ${d}"
fi
if [ "${ladd:-0}" != "0" ] || [ "${lrem:-0}" != "0" ]; then
  l2+="${SEP}📝 ${GRN}+${ladd:-0}${R} ${RED}-${lrem:-0}${R}"
fi

# --- Ligne 3 : limites d'usage (claude.ai Pro/Max uniquement) ---
limit() { # $1 icon+label, $2 percent, $3 reset epoch
  local out="$1 $(bar "$2")"
  if [ -n "$3" ]; then
    local fmt='%H:%M'; [ $(( $3 - $(date +%s) )) -ge 86400 ] && fmt='%d/%m %H:%M'
    out+=" ${GRY}reset dans${R} ${B}$(countdown "$3")${R} ${GRY}($(date -d "@$3" +"$fmt" 2>/dev/null))${R}"
  fi
  printf '%s' "$out"
}
lim5=""; lim7=""
[ -n "$u5" ] && lim5="$(limit "⚡ ${GRY}5h${R}" "$u5" "$r5")"
[ -n "$u7" ] && lim7="$(limit "📅 ${GRY}7j${R}" "$u7" "$r7")"

printf '%s\n' "$l1"
printf '%s\n' "$l2"
if [ -n "$lim5" ] && [ -n "$lim7" ]; then
  both="${lim5}${SEP}${lim7}"
  if [ "$(vislen "$both")" -le "$cols" ]; then printf '%s\n' "$both"
  else printf '%s\n%s\n' "$lim5" "$lim7"; fi
elif [ -n "$lim5$lim7" ]; then
  printf '%s\n' "$lim5$lim7"
fi
