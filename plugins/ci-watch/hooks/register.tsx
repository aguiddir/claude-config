import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Build } from '../types'
import { bar, frameColor, jobUrl, live, minutes, repoOf, short, sonarKeyOf, sonarRan, stageMark, toBuild, toGate } from './jenkins'
import type { GateJson, RunJson, StagesJson } from './jenkins'

const build = atom({ plugin: 'ci-watch', key: 'build' } as const, null)
// The repo /ci points at; null follows the session's own directory.
const dir = atom({ plugin: 'ci-watch', key: 'dir' } as const, null)
// Bumped every second while a build runs, so the band's clock moves between
// polls without asking Jenkins.
const second = atom({ plugin: 'ci-watch', key: 'second' } as const, 0)
const POLL_MS = 10_000
// A finished build stays on the band this long, then the band hides.
const SHOW_DONE_MS = 15 * 60_000
// Sonar processes an analysis a little after the build: the gate is read
// again on every poll this long after the end, then kept.
const GATE_FRESH_MS = 2 * 60_000
// Right after the end, Sonar may still hold the previous analysis's gate.
const GATE_SETTLE_MS = 30_000
const SONAR_GATE = 'mcp__sonarqube__get_project_quality_gate_status'
const RUN_TREE = 'tree=number,building,result,timestamp,estimatedDuration,duration'

const run = async ($: EngineInterface, cwd: string, argv: string[]) => {
  const r = await $.process.run(argv, { cwd }).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout.trim() : ''
}

// `missing` is Jenkins saying the job or build is not there (404); `failed`
// is anything else (network, 5xx, bad JSON), after which state is kept.
type Fetched<T> = { data: T } | 'missing' | 'failed'

const getJson = async <T,>($: EngineInterface, url: string): Promise<Fetched<T>> => {
  const r = await $.http.fetch(url).catch(() => undefined)
  if (r?.status === 404) return 'missing'
  if (!r?.ok) return 'failed'
  try {
    return { data: JSON.parse(r.text) as T }
  } catch {
    return 'failed'
  }
}

// The branch's own job, else the PR job Jenkins builds for it instead; `gh`
// only runs when the branch has no job.
const findRun = async ($: EngineInterface, cwd: string, repo: string, branch: string) => {
  const tryJob = async (job: string) => {
    const url = jobUrl(repo, job)
    const got = await getJson<RunJson>($, `${url}/lastBuild/api/json?${RUN_TREE}`)
    if (typeof got === 'string') return got
    const sonarRef = job.startsWith('PR-') ? { pullRequest: job.slice(3) } : { branch: job }
    return { url, runJson: got.data, label: `${repo} · ${job}`, sonarRef }
  }
  const own = await tryJob(branch)
  if (own !== 'missing') return own
  const pr = await run($, cwd, ['gh', 'pr', 'view', '--json', 'number', '-q', '.number'])
  return pr ? tryJob(`PR-${pr}`) : 'missing'
}

// Through the SonarQube MCP server, so no token lives here; null when it is
// not connected or the project has no analysis for that branch.
const readGate = async ($: EngineInterface, cwd: string, repo: string, ref: { branch?: string; pullRequest?: string }) => {
  const properties = await $.fs.read(`${cwd}/sonar-project.properties`).catch(() => '')
  const projectKey = sonarKeyOf(typeof properties === 'string' ? properties : '') ?? repo
  const r = await $.tool.call({ tool: SONAR_GATE, projectKey, ...ref }).catch(() => undefined)
  if (!r || ('deny' in r && r.deny !== undefined) || r.isError || typeof r.text !== 'string') return null
  try {
    return toGate(JSON.parse(r.text) as GateJson)
  } catch {
    return null
  }
}

const poll = async ($: EngineInterface) => {
  const target = await read($, dir)
  // A poll that outlives a /ci to another repo drops what it found.
  const write = async (value: Build | null) => {
    if ((await read($, dir)) === target) await update($, build, () => value)
  }
  const cwd = target ?? (await $.session.cwd())
  const repo = repoOf(await run($, cwd, ['git', 'remote', 'get-url', 'origin']))
  const branch = await run($, cwd, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
  const found = repo && branch && branch !== 'HEAD' ? await findRun($, cwd, repo, branch) : 'missing'
  if (found === 'failed') return
  if (found === 'missing' || !repo) return write(null)

  const { url, runJson, label, sonarRef } = found
  const before = await read($, build)
  const isSame = before?.label === label && before.number === runJson.number
  // Stages only change while the build runs: a finished one keeps its list.
  let stages: StagesJson = { stages: before?.stages }
  if (!isSame || before.isBuilding || runJson.building) {
    const got = await getJson<StagesJson>($, `${url}/${runJson.number}/wfapi/describe`)
    if (got === 'failed') return
    stages = got === 'missing' ? {} : got.data
  }
  const now = toBuild(label, url, runJson, stages, Date.now())

  const sinceEnd = Date.now() - now.endedAt
  const isFresh = !now.isBuilding && sinceEnd < GATE_FRESH_MS
  if (!now.isBuilding && sonarRan(now.stages) && sinceEnd >= GATE_SETTLE_MS) {
    // Read while fresh, or once for a build first seen already old; then kept.
    now.gate = isSame && !isFresh && before.gate !== undefined ? before.gate : await readGate($, cwd, repo, sonarRef)
  }

  if (isSame && before.isBuilding && !now.isBuilding)
    $.ui.toast(`${now.result === 'SUCCESS' ? '✓' : '✗'} CI ${label} #${now.number} : ${now.result ?? 'terminé'}`)
  // Only for a build that just ended: an old red gate seen at start or after
  // /ci is on the band, never a toast.
  if (isFresh && now.gate?.status === 'ERROR' && (!isSame || before.gate?.status !== 'ERROR'))
    $.ui.toast(`✗ Sonar ${label} : quality gate en échec`)
  await write(now)
}

// One poll at a time, timer and /ci alike; one timer per module, so a second
// session.start replaces it instead of adding a loop.
let isPolling = false
let timer: Timer | undefined
let clockTimer: Timer | undefined
const tick = async ($: EngineInterface) => {
  if (isPolling) return
  isPolling = true
  await poll($).catch(() => undefined)
  isPolling = false
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'ci',
      description: "Follow the Jenkins build of the repo at <path> (no path: the session's directory)",
      argumentHint: '[path]',
    })
    void tick($)
    timer?.cancel()
    timer = $.clock.every(POLL_MS, () => void tick($))
    clockTimer?.cancel()
    clockTimer = $.clock.every(1000, () => {
      void (async () => {
        if ((await read($, build))?.isBuilding) await update($, second, n => n + 1)
      })().catch(() => undefined)
    })
    return r
  })

  on('command.run', { command: 'ci' }, async ($, e) => {
    const path = e.args.trim().replace(/^~(?=\/|$)/, (await $.env.get('HOME')) ?? '~') || null
    await update($, dir, () => path)
    await update($, build, () => null)
    void tick($)
    return { text: path ? `CI suivie : ${path}` : 'CI suivie : le répertoire de la session' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const b: Build | null = await read($, build)
    await read($, second)
    if (e.props.hasSurvey || !b || (!b.isBuilding && Date.now() - b.endedAt > SHOW_DONE_MS)) return below
    const { Box, Text, Link } = $.ui.resolve(e)
    const failed = b.stages.find(s => s.status === 'FAILED' || s.status === 'UNSTABLE')
    const current = b.stages.find(s => s.status === 'IN_PROGRESS' || s.status === 'PAUSED_PENDING_INPUT')
    const color = frameColor(b.isBuilding, b.result)
    const now = live(b, Date.now())

    const head = b.isBuilding ? (
      <Box flexDirection="column">
        <Text>
          <Text color={color}>● CI {b.label} #{b.number}</Text>
          {b.hasEstimate ? (
            <Text>
              {'  '}
              <Text color={color}>{bar(now.percent)}</Text> {now.percent} %
            </Text>
          ) : (
            ''
          )}
        </Text>
        <Text dimColor>
          {'  '}
          {current ? `${current.name} · ` : ''}
          {minutes(now.elapsedMs)}
          {b.hasEstimate ? ` · reste ~${minutes(now.remainingMs)}` : ''}
        </Text>
      </Box>
    ) : (
      <Text>
        <Text color={color}>
          {b.result === 'SUCCESS' ? '✓' : '✗'} CI {b.label} #{b.number} {b.result === 'SUCCESS' ? 'réussi' : (b.result ?? 'terminé').toLowerCase()}
        </Text>
        {failed ? ` à l'étape ${failed.name}` : ''}
        <Text dimColor> en {minutes(b.durationMs)}</Text>
      </Text>
    )

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
          {head}
          {b.stages.length > 0 && (
            <Text wrap="truncate-end">
              {b.stages.map(s => (
                <Text
                  color={s.status === 'SUCCESS' ? 'green' : s.status === 'IN_PROGRESS' ? 'cyan' : s.status === 'FAILED' ? 'red' : undefined}
                  dimColor={s.status === 'NOT_EXECUTED'}
                >
                  {stageMark(s.status)} {s.name}
                  {s.status === 'IN_PROGRESS' || s.status === 'NOT_EXECUTED' || !s.durationMs ? '' : ` ${short(s.durationMs)}`}
                  {'  '}
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
          <Link href={b.url} label={`↗ ouvrir le build #${b.number} dans Jenkins`} />
        </Box>
      </Box>
    )
  })
}
