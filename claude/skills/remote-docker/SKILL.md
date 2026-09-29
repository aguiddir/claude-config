---
name: remote-docker
description: Inspect or operate containers on the shared VIDAL Docker hosts (dockersw, dockerbo, dockersw2). Use when the user mentions one of these hosts, a *.dockersw.vidal.net URL, or asks about containers, logs or deployments that don't run locally.
---

# Shared Docker hosts

These hosts are shared with the whole team. Other people's containers run there.

| Command | Host | Engine / API | Notes |
|---|---|---|---|
| `dockersw` | `dockersw.vidal.net:4243` | 20.10 / 1.41 | Most dev deployments, `*.dockersw.vidal.net` |
| `dockerbo` | `dockerbo.vidal.net:4243` | 18.09 / 1.39 | Old engine: recent flags may not exist |
| `dockersw2` | `dockersw2.vidal.net:2376` | TLS | Needs certs in `~/.dockersw2`; compose via `dockersw2 compose` |

Use the wrapper, never plain `docker` with `DOCKER_HOST` exported: an exported variable leaks into every later command.

## Safe without asking

Read-only commands: `ps`, `logs`, `inspect`, `images`, `stats --no-stream`, `top`, `version`, `info`, `compose ps`, `compose logs`.

- Always pass `--tail` (and `--since` if useful) to `logs`, never stream a full log.
- `dockerhosts dockersw` maps each container to its public host name.

## Ask first, naming the host and the containers

Anything that changes state: `run`, `start`, `stop`, `restart`, `rm`, `kill`, `exec`, `pull`, `build`, `compose up/down/restart`, `prune`, `rmi`, `volume rm`, `network rm`.

- Before stopping or removing, list what is affected and who likely owns it (container name prefix, compose project label).
- Only touch containers whose name or compose project the user named. Never run a broad `prune` or `stop $(ps -q)` on a shared host.

## When a command fails

- `client version X is too new`: the pin in the wrapper is wrong for this daemon; check `curl -s http://<host>:4243/version`.
- dockersw2 `missing ... .pem`: the certificates are not installed on this machine; ask the user, don't look for them elsewhere.
