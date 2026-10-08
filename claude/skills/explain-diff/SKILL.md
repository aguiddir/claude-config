---
name: explain-diff
description: Use when the person must understand or validate a change they did not follow closely (a session's edits, a commit range, a PR, a branch, a module) before merging or deciding, or asks "what changed", "explique ce qui a changé", "montre-moi ce que tu as fait".
---

# Explain a change

## Overview

Reading a diff is the slowest way to understand a change. Hand back the
form that is fastest to understand: a short controlled-language text, a
diagram, or a private web page (after Karpathy, "we'll be spending a lot
more time trying to understand the outputs of language models",
https://x.com/karpathy/status/2105819303471976479).

The page is for the person's own understanding. Being alone, in a hurry,
or not sharing it is not a reason to fall back to terminal prose.

## Scope

| Argument | Scope |
|---|---|
| none | `git diff HEAD` plus untracked files, plus this session's edits |
| `<sha>..<sha>`, `<sha>` | that range, or that commit (`A..B` excludes A: use `A^..B` to include it) |
| `#123`, PR URL | the PR's diff (`gh pr diff`) |
| a path | that module as it is today (no diff: explain how it works) |

Read the code around the diff and trace each changed flow end to end
before writing. Run the checks the repo's CI runs (tests, type check);
with no CI config, the toolchain's own (`claude plugin test` for a mod,
`pytest`, `npm test`). Never explain from the diff alone.

## Form

The medium follows what there is to understand, not the file count.

- No behaviour changes (rename, moved code, a local fix, a config value, a dependency bump), whatever the number of files → **8 lines max in the terminal**, in the writing style below.
- At least one behaviour or flow changes → **a private web page** (Artifact), then 1-3 lines in the terminal: the verdict, the link, the open points the reader must act on.
- A rule with several cases (thresholds, routing, permissions) → on the page, a table `case → before → after` next to its diagram, one row per case. That is the only interactivity: no script.

## The page

**REQUIRED SUB-SKILLS:** `artifact-design` for the page, `artifact-diagramming` for every diagram.
The page is plain HTML: no `quickstart`, no Artifact type, no runtime capability, no preview before publishing. The reader is waiting.

Sections, in this order, each with its heading. Leave a section out only
when it would be empty, and say so in one line.

1. **In one sentence** - what changed and why. Then the verdict: merge, fix first, or discuss.
2. **Before / after** - one diagram per changed flow (sequence, state, or data flow). Changed parts stand out. A flow that did not change is not drawn. A flow with two states and one transition gets one sentence instead.
3. **Files by intent** - group the files by what they achieve, not by path. One line per group, then the files; a file that serves several intents is listed by function (`register.tsx: target()`).
4. **Decisions** - each choice made, and the option not taken, in one line each.
5. **Boundaries crossed** - API contract, DB schema, config, permissions, security, public behavior. Say "none" when none.
6. **Verified / not verified** - two lists: what ran with its result, what did not run and why.
7. **Open points** - risks, doubts, anything to check by hand.

Write the page and the terminal answer in French, whatever the language of the code and its comments.

## Writing style

80% of ASD-STE100, on the page and in the terminal:

- One idea per sentence. 20 words max.
- Active voice, present tense. "The poll keeps its result" not "the result is kept by the poll".
- The same word for the same thing throughout. Pick one of "build/job", "thread/conversation", and keep it.
- Concrete over abstract: name the function, the state, the file.
- No filler: no "note that", no "it is worth mentioning", no summary of what the diff already shows.

## Common mistakes

| Mistake | Fix |
|---|---|
| Terminal prose because "they just want a quick validation" | Quick to read is the goal. The page is quicker. |
| Sections by commit | Sections by intent. One commit can carry two intents, two commits one. |
| Diagram of the whole system | Only the flows that changed, before and after. |
| "Tests pass" with no names | Command, count, result. What did not run is a section, not a footnote. |
| Explaining the diff line by line | The diff is one click away. Explain what the reader cannot see in it. |
