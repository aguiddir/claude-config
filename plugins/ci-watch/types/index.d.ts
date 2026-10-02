// durationMs: as Jenkins reports it, so far for a running stage.
export type Stage = { name: string; status: string; durationMs: number }

// The SonarQube quality gate of the build's branch or PR; failed lists the
// conditions that broke it.
export type Gate = { status: string; failed: { metric: string; actual: string; threshold: string }[] }

// The last build of the current branch's job, as the band draws it.
export type Build = {
  label: string
  number: number
  url: string
  isBuilding: boolean
  // Kept so the band can move the clock every second between polls.
  startedAt: number
  estimatedMs: number
  result: string | null
  hasEstimate: boolean
  percent: number
  remainingMs: number
  durationMs: number
  endedAt: number
  stages: Stage[]
  // undefined until read; null when read and there is none.
  gate?: Gate | null
  // A failed or unstable build's console end, read once by the poll so that
  // `f` has nothing to fetch; null when Jenkins did not give it.
  consoleTail?: string | null
}

declare module 'claude-code' {
  interface PluginState {
    // attachment: the log tail joined to the prompt `f` prepared, once sent;
    // header is that prompt's first line. armed: whether `f` typed in an
    // empty prompt is caught, from a build turning broken to the next submit.
    'ci-watch': {
      build: Build | null
      dir: string | null
      // `#231` or `data-bridge#231`, from /ci.
      pr: string | null
      second: number
      askedAt: number
      attachment: { header: string; context: string } | null
      armed: boolean
    }
  }
}
