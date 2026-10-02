export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

// `Code format="diff"` takes at most 10000 characters and refuses a hunk cut
// in the middle, so whole hunks are kept while they fit; the rest is counted.
const LIMIT = 10_000
// Tab and newline are the only control characters Code accepts.
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g

export const toPatch = (hunks: readonly Hunk[]) => {
  let patch = ''
  let omitted = 0
  for (const h of hunks) {
    const text = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.join('\n')}`.replace(CONTROL, "")
    const next = patch ? `${patch}\n${text}` : text
    if (next.length > LIMIT) omitted++
    else patch = next
  }
  return { patch, omitted }
}

// A Write that created a file may come back with no hunks: the whole content is added.
export const createdHunk = (content: string): Hunk => {
  const lines = content.replace(/\n$/, '').split('\n')
  return { oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map(l => `+${l}`) }
}
