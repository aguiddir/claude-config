# Docker helpers, sourced from ~/.zshrc or ~/.bashrc by install.sh.
# Every function takes an optional first argument naming the docker
# command to use (docker, dockersw, dockerbo, dockersw2); default: docker.
#   dockerhosts dockersw    dockerclean dockerbo

alias dco='docker compose'

_docker_cmd() {
  case "$1" in
    docker|dockersw|dockerbo|dockersw2) echo "$1" ;;
    *) echo docker ;;
  esac
}

# Live container monitor on any host
ctop() {
  local d; d=$(_docker_cmd "$1")
  "$d" run --rm -ti --name=ctop \
    --volume /var/run/docker.sock:/var/run/docker.sock:ro quay.io/vektorlab/ctop:latest
}

# Remove stopped containers older than a day
dockerclean() {
  local d; d=$(_docker_cmd "$1")
  "$d" container prune --force --filter 'until=24h'
}

# Remove dangling (untagged) images
dockercleani() {
  local d; d=$(_docker_cmd "$1")
  "$d" image prune --force
}

# Stop every running container
dockerstop() {
  local d ids; d=$(_docker_cmd "$1")
  ids=$("$d" ps -q)
  [ -n "$ids" ] && echo "$ids" | xargs "$d" stop
}

# List containers with their VIRTUAL_HOST / LETSENCRYPT_HOST
dockerhosts() {
  local d; d=$(_docker_cmd "$1")
  "$d" ps -q | xargs -r "$d" inspect | python3 -c '
import json, sys
for c in json.load(sys.stdin):
    env = dict(e.split("=", 1) for e in (c["Config"].get("Env") or []) if "=" in e)
    host = env.get("LETSENCRYPT_HOST") or env.get("VIRTUAL_HOST")
    if host:
        name = c["Name"][1:]
        print(f"{name:<40} {host}")
'
}
