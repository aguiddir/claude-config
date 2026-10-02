import type { Build, Gate } from '../types'

// ponytail: one Jenkins and one folder for every repo; userConfig fields when
// a second Jenkins or folder shows up.
export const JENKINS = 'https://jenkins.vidal.net'
const FOLDER = 'job/team.software/job/github'
const ORG = 'softwarevidal'

// `git@github.com:softwarevidal/vidal-mcp.git` or the https form → `vidal-mcp`.
export const repoOf = (remote: string): string | undefined =>
  remote.trim().match(new RegExp(`github\\.com[:/]${ORG}/([^/\\s]+?)(?:\\.git)?$`))?.[1]

// `/ci 231`, `/ci #231` or a PR's URL → `#231` or `data-bridge#231`; any
// other argument is a path.
export const prOf = (arg: string): string | undefined => {
  const url = arg.match(new RegExp(`github\\.com/${ORG}/([^/\\s]+)/pull/(\\d+)`))
  if (url) return `${url[1]}#${url[2]}`
  return arg.match(/^#?\d+$/) ? `#${arg.replace('#', '')}` : undefined
}

// A multibranch job is named after the branch with `/` escaped as %2F, and
// that name is escaped again in the URL: feat/x → job/feat%252Fx.
export const jobUrl = (repo: string, job: string) =>
  `${JENKINS}/${FOLDER}/job/${repo}/job/${encodeURIComponent(encodeURIComponent(job))}`

export type RunJson = { number: number; building: boolean; result: string | null; timestamp: number; estimatedDuration: number; duration: number }
export type StagesJson = { stages?: { name: string; status: string; durationMillis?: number }[] }

export const toBuild = (label: string, url: string, run: RunJson, wf: StagesJson, now: number): Build => {
  const estimated = run.estimatedDuration > 0 ? run.estimatedDuration : 0
  const progress = live({ startedAt: run.timestamp, estimatedMs: estimated }, now)
  return {
    label,
    number: run.number,
    url: `${url}/${run.number}/`,
    isBuilding: run.building,
    startedAt: run.timestamp,
    estimatedMs: estimated,
    result: run.result,
    hasEstimate: estimated > 0,
    percent: run.building ? progress.percent : 100,
    remainingMs: run.building ? progress.remainingMs : 0,
    durationMs: run.building ? progress.elapsedMs : run.duration,
    endedAt: run.building ? 0 : run.timestamp + run.duration,
    stages: (wf.stages ?? []).map(s => ({ name: s.name, status: s.status, durationMs: s.durationMillis ?? 0 })),
    gate: undefined,
  }
}

export const bar = (percent: number, width = 20) => {
  const full = Math.round((percent / 100) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

export const minutes = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
}

// wfapi statuses: SUCCESS, FAILED, UNSTABLE, ABORTED, IN_PROGRESS, PAUSED_PENDING_INPUT, NOT_EXECUTED.
export const stageMark = (status: string) =>
  ({ SUCCESS: '✓', FAILED: '✗', UNSTABLE: '!', ABORTED: '■', IN_PROGRESS: '●', PAUSED_PENDING_INPUT: '?' })[status] ?? '○'

// `sonar.projectKey=vidal-mcp` in sonar-project.properties.
export const sonarKeyOf = (properties: string) => properties.match(/^\s*sonar\.projectKey\s*=\s*(\S+)/m)?.[1]

// What the SonarQube MCP tool get_project_quality_gate_status answers.
export type GateJson = { status: string; conditions?: { metricKey: string; status: string; actualValue?: string; errorThreshold?: string }[] }

export const toGate = (json: GateJson): Gate => ({
  status: json.status,
  failed: (json.conditions ?? [])
    .filter(c => c.status === 'ERROR')
    .map(c => ({ metric: c.metricKey, actual: c.actualValue ?? '?', threshold: c.errorThreshold ?? '?' })),
})

// The gate only belongs to this build once its own Sonar stage ran: a build
// that failed earlier would show the previous analysis's gate.
export const sonarRan = (stages: readonly { name: string; status: string }[]) =>
  stages.some(s => /sonar/i.test(s.name) && s.status === 'SUCCESS')

// Where a running build stands at `now`, between two polls.
export function live(b: { startedAt: number; estimatedMs: number }, now: number) {
  const elapsedMs = Math.max(0, now - b.startedAt)
  return {
    elapsedMs,
    // An estimate only: a build that runs past it holds at 99 %.
    percent: b.estimatedMs ? Math.min(99, Math.floor((elapsedMs / b.estimatedMs) * 100)) : 0,
    remainingMs: b.estimatedMs ? Math.max(0, b.estimatedMs - elapsedMs) : 0,
  }
}

// `4s`, `1m12`: a stage's duration, short enough for the stage strip.
export const short = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`
}

// The band's frame: cyan while running, then the result's colour.
export const frameColor = (isBuilding: boolean, result: string | null) =>
  isBuilding ? 'cyan' : result === 'SUCCESS' ? 'green' : result === 'FAILURE' ? 'red' : 'yellow'

// A failed or unstable build, or a red gate: worth handing to Claude. An
// aborted build was stopped by someone, not broken.
export const isFixable = (b: Build) =>
  !b.isBuilding && (b.result === 'FAILURE' || b.result === 'UNSTABLE' || b.gate?.status === 'ERROR')

// ponytail: the whole console, cut to its end, where the error and the
// output leading to it are; per-stage logs (wfapi/log) if consoles get huge.
export const tail = (text: string, lines = 150) => text.trimEnd().split('\n').slice(-lines).join('\n')

// The lines worth reading in the box: those naming an error, each with the
// line before it unless blank or the pipeline's own chatter, the last `max`
// kept; with none, the log's last lines. Jenkins' own echoes of the failure
// (skipped stages, the final status) say nothing new.
const ERROR_LINE = /\b(error|exception|failed|failure|assertionerror|exit code)\b/i
const ECHO_LINE = /skipped due to earlier failure|^Finished: /
export const errorLines = (log: string, max = 10) => {
  const lines = log.split('\n')
  const kept = new Set<number>()
  lines.forEach((line, i) => {
    if (!ERROR_LINE.test(line) || ECHO_LINE.test(line)) return
    const before = lines[i - 1]
    if (before?.trim() && !before.startsWith('[Pipeline]') && !ECHO_LINE.test(before)) kept.add(i - 1)
    kept.add(i)
  })
  const picked = [...kept].sort((a, b) => a - b).map(i => lines[i]!)
  return (picked.length ? picked : lines).slice(-max).join('\n')
}

// The box's first line, also how the submit hook knows the prompt is still
// the one `f` prepared and attaches the log to it.
export const fixHeader = (b: Build) => {
  const failed = b.stages.find(s => s.status === 'FAILED' || s.status === 'UNSTABLE')
  return `Le build Jenkins ${b.label} #${b.number} est en ${b.result}${failed ? ` à l'étape ${failed.name}` : ''} : ${b.url}`
}

// What the band's `f` puts in the box: the failed step with its error lines,
// and the gate's broken conditions, for Claude to read up on and fix.
export const fixPrompt = (b: Build, excerpt: string | undefined) => {
  const parts: string[] = []
  if (b.result === 'FAILURE' || b.result === 'UNSTABLE') {
    parts.push(fixHeader(b), excerpt ? `Erreurs :\n\`\`\`\n${excerpt}\n\`\`\`` : `Log : ${b.url}consoleText`)
  }
  if (b.gate?.status === 'ERROR') {
    const conditions = b.gate.failed.map(c => `${c.metric} ${c.actual} (seuil ${c.threshold})`).join(', ')
    parts.push(
      `La quality gate SonarQube de ${b.label} est en échec : ${conditions || 'conditions inconnues'}. ` +
        'Lis les issues et la couverture concernées avec le MCP SonarQube.',
    )
  }
  return [...parts, 'Trouve la cause et corrige-la.'].join('\n\n')
}

// Attached to the prompt when sent, out of the box: what Claude reads the
// error lines against.
export const logContext = (b: Build, log: string) =>
  `Les dernières lignes du log Jenkins de ${b.label} #${b.number} :\n\`\`\`\n${log}\n\`\`\``
