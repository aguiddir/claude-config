import type { Build, Gate } from '../types'

// ponytail: one Jenkins and one folder for every repo; userConfig fields when
// a second Jenkins or folder shows up.
export const JENKINS = 'https://jenkins.vidal.net'
const FOLDER = 'job/team.software/job/github'
const ORG = 'softwarevidal'

// `git@github.com:softwarevidal/vidal-mcp.git` or the https form → `vidal-mcp`.
export const repoOf = (remote: string): string | undefined =>
  remote.trim().match(new RegExp(`github\\.com[:/]${ORG}/([^/\\s]+?)(?:\\.git)?$`))?.[1]

// A multibranch job is named after the branch with `/` escaped as %2F, and
// that name is escaped again in the URL: feat/x → job/feat%252Fx.
export const jobUrl = (repo: string, job: string) =>
  `${JENKINS}/${FOLDER}/job/${repo}/job/${encodeURIComponent(encodeURIComponent(job))}`

export type RunJson = { number: number; building: boolean; result: string | null; timestamp: number; estimatedDuration: number; duration: number }
export type StagesJson = { stages?: { name: string; status: string }[] }

export const toBuild = (label: string, url: string, run: RunJson, wf: StagesJson, now: number): Build => {
  const elapsed = Math.max(0, now - run.timestamp)
  const estimated = run.estimatedDuration > 0 ? run.estimatedDuration : 0
  return {
    label,
    number: run.number,
    url: `${url}/${run.number}/`,
    isBuilding: run.building,
    result: run.result,
    // An estimate only: a build that runs past it holds at 99 %.
    percent: run.building ? (estimated ? Math.min(99, Math.floor((elapsed / estimated) * 100)) : 0) : 100,
    remainingMs: run.building && estimated ? Math.max(0, estimated - elapsed) : 0,
    durationMs: run.building ? elapsed : run.duration,
    endedAt: run.building ? 0 : run.timestamp + run.duration,
    stages: (wf.stages ?? []).map(s => ({ name: s.name, status: s.status })),
    gate: null,
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
