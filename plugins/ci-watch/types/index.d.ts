export type Stage = { name: string; status: string }

// The SonarQube quality gate of the build's branch or PR; failed lists the
// conditions that broke it.
export type Gate = { status: string; failed: { metric: string; actual: string; threshold: string }[] }

// The last build of the current branch's job, as the band draws it.
export type Build = {
  label: string
  number: number
  url: string
  isBuilding: boolean
  result: string | null
  percent: number
  remainingMs: number
  durationMs: number
  endedAt: number
  stages: Stage[]
  gate: Gate | null
}

declare module 'claude-code' {
  interface PluginState {
    'ci-watch': { build: Build | null; dir: string | null }
  }
}
