// One file edit of a turn: the tool, the file, its unified-diff hunks.
export type Step = { tool: string; path: string; patch: string; omitted: number }

declare module 'claude-code' {
  interface PluginState {
    replay: { pending: Step[]; steps: Step[]; at: number }
  }
}
