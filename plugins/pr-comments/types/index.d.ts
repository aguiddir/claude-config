export type Comment = { author: string; body: string }

// An unresolved review thread; line is null on a file-level comment or when
// GitHub can no longer place it. hunk: the diff GitHub shows above it.
export type Thread = {
  id: string
  path: string
  line: number | null
  isOutdated: boolean
  url: string
  hunk: string
  comments: Comment[]
  // The last word is the PR author's: likely answered, not yet resolved.
  isAnswered: boolean
}

// An open PR with its unresolved threads; branch is its head branch,
// isReview says the user reviews it rather than works on it, and isMine
// that the user wrote it: Claude commits and pushes only on those.
export type Pr = {
  number: number
  isReview: boolean
  isMine: boolean
  author: string
  title: string
  url: string
  branch: string
  threads: Thread[]
}

declare module 'claude-code' {
  interface PluginState {
    'pr-comments': {
      // The PRs with unresolved threads, those to work on (the current
      // branch's, the user's) before those under review; the session's branch.
      prs: Pr[]
      branch: string
      // The PR the pane shows, by its number.
      shownPr: number | null
      // Ids of the threads handed to Claude, badged in the pane.
      sent: string[]
      // The prompt `f` put in the box, by its first line, and its threads,
      // marked sent once that prompt is.
      draft: { header: string; ids: string[] } | null
      // The pane: the thread shown, those marked for `f`, the reply being
      // written (null when none) and what is running (null when idle).
      at: number
      marked: string[]
      reply: string | null
      busy: string | null
      // Whether `c` typed in an empty prompt is caught: from threads not
      // seen before to the next prompt sent.
      armed: boolean
    }
  }
}
