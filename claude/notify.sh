#!/usr/bin/env bash
# Desktop notification for Claude Code hooks; reads the hook JSON on stdin.
# Hooks may run without ~/.local/bin in PATH, where install.sh puts jq
jq=$(command -v jq || echo ~/.local/bin/jq)
in=$(cat)
event=$($jq -r '.hook_event_name // empty' <<<"$in")
type=$($jq -r '.notification_type // empty' <<<"$in")
msg=$($jq -r '.message // .error // empty' <<<"$in")
dir=$(basename "$($jq -r '.cwd // empty' <<<"$in")")
urgency=normal

case "$event:$type" in
  Stop:*)                        title="✅ Travail terminé";           msg="C'est fini"; urgency=critical ;;
  StopFailure:*)                 title="❌ Erreur";                    urgency=critical ;;
  Notification:permission_prompt) title="🔐 Permission demandée";      urgency=critical ;;
  Notification:elicitation_dialog)
                                 title="❓ Claude attend ta réponse";  urgency=critical ;;
  # idle_prompt repeats the Stop notification a minute later; auth_success
  # needs no action
  Notification:idle_prompt|Notification:auth_success) exit 0 ;;
  *)                             title="🔔 Claude Code" ;;
esac

notify-send -u "$urgency" -a "Claude Code" "$title${dir:+ · $dir}" "${msg:-…}"
