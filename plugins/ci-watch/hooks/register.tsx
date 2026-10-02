import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Build } from '../types'
import { bar, jobUrl, minutes, repoOf, sonarKeyOf, stageMark, toBuild, toGate } from './jenkins'
import type { GateJson, RunJson, StagesJson } from './jenkins'

const build = atom({ plugin: 'ci-watch', key: 'build' } as const, null)
// The repo /ci points at; null follows the session's own directory.
const dir = atom({ plugin: 'ci-watch', key: 'dir' } as const, null)
const POLL_MS = 10_000
// A finished build stays on the band this long, then the band hides.
const SHOW_DONE_MS = 15 * 60_000
// Sonar processes an analysis a little after the build: the gate is read
// again on every poll this long after the end, then kept.
const GATE_FRESH_MS = 2 * 60_000
const SONAR_GATE = 'mcp__sonarqube__get_project_quality_gate_status'
const RUN_TREE = 'tree=number,building,result,timestamp,estimatedDuration,duration'

const run = async ($: EngineInterface, cwd: string, argv: string[]) => {
  const r = await $.process.run(argv, { cwd }).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout.trim() : ''
}

const getJson = async <T,>($: EngineInterface, url: string): Promise<T | undefined> => {
  const r = await $.http.fetch(url).catch(() => undefined)
  if (!r?.ok) return undefined
  try {
    return JSON.parse(r.text) as T
  } catch {
    return undefined
  }
}

// The branch's own job, else the PR job Jenkins builds for it instead.
const findRun = async ($: EngineInterface, cwd: string, repo: string, branch: string) => {
  for (const job of [branch, `PR-${await run($, cwd, ['gh', 'pr', 'view', '--json', 'number', '-q', '.number'])}`]) {
    if (job === 'PR-') continue
    const url = jobUrl(repo, job)
    const runJson = await getJson<RunJson>($, `${url}/lastBuild/api/json?${RUN_TREE}`)
    if (runJson) return { url, runJson, label: `${repo} · ${job}`, sonarRef: job.startsWith('PR-') ? { pullRequest: job.slice(3) } : { branch: job } }
  }
  return undefined
}

// Through the SonarQube MCP server, so no token lives here; absent when it
// is not connected or the project has no analysis for that branch.
const readGate = async ($: EngineInterface, cwd: string, repo: string, ref: { branch?: string; pullRequest?: string }) => {
  const properties = await $.fs.read(`${cwd}/sonar-project.properties`).catch(() => '')
  const projectKey = sonarKeyOf(typeof properties === 'string' ? properties : '') ?? repo
  const r = await $.tool.call({ tool: SONAR_GATE, projectKey, ...ref }).catch(() => undefined)
  if (!r || 'deny' in r && r.deny !== undefined || r.isError || typeof r.text !== 'string') return null
  try {
    return toGate(JSON.parse(r.text) as GateJson)
  } catch {
    return null
  }
}

const poll = async ($: EngineInterface) => {
  const cwd = (await read($, dir)) ?? (await $.session.cwd())
  const repo = repoOf(await run($, cwd, ['git', 'remote', 'get-url', 'origin']))
  const branch = await run($, cwd, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
  const found = repo && branch && branch !== 'HEAD' ? await findRun($, cwd, repo, branch) : undefined
  if (!found || !repo) return update($, build, () => null)

  const { url, runJson, label, sonarRef } = found
  const before = await read($, build)
  const isSame = before?.label === label && before.number === runJson.number
  // Stages only change while the build runs: a finished one keeps its list.
  const stages: StagesJson =
    isSame && !before.isBuilding && !runJson.building
      ? { stages: before.stages }
      : ((await getJson<StagesJson>($, `${url}/${runJson.number}/wfapi/describe`)) ?? {})
  const now = toBuild(label, url, runJson, stages, Date.now())
  if (!now.isBuilding) {
    const isFresh = Date.now() - now.endedAt < GATE_FRESH_MS
    now.gate = isSame && before.gate && !isFresh ? before.gate : await readGate($, cwd, repo, sonarRef)
  }

  if (isSame && before.isBuilding && !now.isBuilding)
    $.ui.toast(`${now.result === 'SUCCESS' ? '✓' : '✗'} CI ${label} #${now.number} : ${now.result ?? 'terminé'}`)
  if (now.gate?.status === 'ERROR' && (!isSame || before.gate?.status !== 'ERROR'))
    $.ui.toast(`✗ Sonar ${label} : quality gate en échec`)
  await update($, build, () => now)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'ci',
      description: "Follow the Jenkins build of the repo at <path> (no path: the session's directory)",
      argumentHint: '[path]',
    })
    let isPolling = false
    const tick = async () => {
      if (isPolling) return
      isPolling = true
      await poll($).catch(() => undefined)
      isPolling = false
    }
    void tick()
    $.clock.every(POLL_MS, () => void tick())
    return r
  })

  on('command.run', { command: 'ci' }, async ($, e) => {
    const path = e.args.trim().replace(/^~(?=\/|$)/, (await $.env.get('HOME')) ?? '~') || null
    await update($, dir, () => path)
    await update($, build, () => null)
    void poll($).catch(() => undefined)
    return { text: path ? `CI suivie : ${path}` : 'CI suivie : le répertoire de la session' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const b: Build | null = await read($, build)
    if (e.props.hasSurvey || !b || (!b.isBuilding && Date.now() - b.endedAt > SHOW_DONE_MS)) return below
    const { Box, Text, Link } = $.ui.resolve(e)
    const failed = b.stages.find(s => s.status === 'FAILED' || s.status === 'UNSTABLE')
    const current = b.stages.find(s => s.status === 'IN_PROGRESS' || s.status === 'PAUSED_PENDING_INPUT')

    const head = b.isBuilding ? (
      <Text>
        <Text color="cyan">● CI {b.label} #{b.number} </Text>
        <Text color="cyan">{bar(b.percent)}</Text> {b.percent} %{current ? ` · ${current.name}` : ''}
        <Text dimColor> · reste ~{minutes(b.remainingMs)}</Text>
      </Text>
    ) : (
      <Text>
        <Text color={b.result === 'SUCCESS' ? 'green' : 'red'}>
          {b.result === 'SUCCESS' ? '✓' : '✗'} CI {b.label} #{b.number} {b.result === 'SUCCESS' ? 'réussi' : (b.result ?? 'terminé').toLowerCase()}
        </Text>
        {failed ? ` à l'étape ${failed.name}` : ''}
        <Text dimColor> en {minutes(b.durationMs)}</Text>
      </Text>
    )

    return (
      <Box flexDirection="column">
        {below}
        {head}
        {b.stages.length > 0 && (
          <Text wrap="truncate-end">
            {b.stages.map(s => (
              <Text color={s.status === 'SUCCESS' ? 'green' : s.status === 'IN_PROGRESS' ? 'cyan' : s.status === 'FAILED' ? 'red' : undefined} dimColor={s.status === 'NOT_EXECUTED'}>
                {stageMark(s.status)} {s.name}{'  '}
              </Text>
            ))}
          </Text>
        )}
        {b.gate && (
          <Text wrap="truncate-end">
            <Text color={b.gate.status === 'OK' ? 'green' : b.gate.status === 'ERROR' ? 'red' : undefined}>
              Sonar {b.gate.status === 'OK' ? '✓' : b.gate.status === 'ERROR' ? '✗' : '○'} quality gate {b.gate.status}
            </Text>
            {b.gate.failed.map(c => ` · ${c.metric} ${c.actual} (seuil ${c.threshold})`).join('')}
          </Text>
        )}
        <Link href={b.url} label={`ouvrir le build #${b.number} dans Jenkins`} />
      </Box>
    )
  })
}
