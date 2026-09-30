#!/usr/bin/env bash
# Desktop notification for Claude Code hooks; reads the hook JSON on stdin.
# Hooks may run without ~/.local/bin in PATH, where install.sh puts jq
jq=$(command -v jq || echo ~/.local/bin/jq)
in=$(cat)
event=$($jq -r '.hook_event_name // empty' <<<"$in")
type=$($jq -r '.notification_type // empty' <<<"$in")
msg=$($jq -r '.message // .error // empty' <<<"$in")
where=$(basename "$($jq -r '.cwd // empty' <<<"$in")")
urgency=normal

# Inside herdr, name the workspace and the agent session instead of the dir
if [ -n "$HERDR_PANE_ID" ]; then
  herdr=${HERDR_BIN_PATH:-herdr}
  ws=$(timeout 2 "$herdr" workspace get "$HERDR_WORKSPACE_ID" 2>/dev/null |
    $jq -r '.result.workspace | "\(.label) (#\(.number))"' 2>/dev/null)
  pane=$(timeout 2 "$herdr" pane get "$HERDR_PANE_ID" 2>/dev/null)
  agent=$($jq -r '.result.pane | [.agent, .terminal_title_stripped] | map(select(. // "" != "")) | join(" · ")' <<<"$pane" 2>/dev/null)
  where=${ws:-$where}

  # Stay quiet when I am already looking at this pane: shown in herdr and
  # the active X11 window is a terminal (xprop cannot tell which one).
  if [ "$($jq -r '.result.pane.focused' <<<"$pane" 2>/dev/null)" = true ]; then
    win=$(xprop -root _NET_ACTIVE_WINDOW 2>/dev/null | awk '{print $NF}')
    xprop -id "$win" WM_CLASS 2>/dev/null | grep -qi terminal && exit 0
  fi
fi

case "$event:$type" in
  Stop:*)                        title="✅ Travail terminé";           urgency=critical ;;
  StopFailure:*)                 title="❌ Erreur";                    urgency=critical ;;
  Notification:permission_prompt) title="🔐 Permission demandée";      urgency=critical ;;
  Notification:elicitation_dialog)
                                 title="❓ Claude attend ta réponse";  urgency=critical ;;
  # idle_prompt repeats the Stop notification a minute later; auth_success
  # needs no action
  Notification:idle_prompt|Notification:auth_success) exit 0 ;;
  *)                             title="🔔 Claude Code" ;;
esac

body=$(printf '%s\n%s' "$agent" "$msg" | sed '/^$/d')
[ "$event" = Stop ] && [ -z "$body" ] && body="C'est fini"
notify-send -u "$urgency" -a "Claude Code" "$title${where:+ · $where}" "${body:-…}"
