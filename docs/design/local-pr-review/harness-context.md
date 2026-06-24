# Harness Context Artifacts

Local PR Review can generate external harness artifacts under `.git/ai-review/` so a CLI or other agent runner can reconcile human and agentic review findings without relying on VS Code state or adding trackable files to the workspace.

## Generated files

| File | Purpose |
| --- | --- |
| `.git/ai-review/harness-context.md` | Human/agent-readable Markdown summary of the review session, hunk structure, active reviewers, patches, human comments, and agentic reviewer outputs. |
| `.git/ai-review/harness-manifest.json` | Tool-readable manifest with the same core data for external harnesses. |
| `.git/ai-review/harness-agent.md` | Instructions for a CLI or external agent to reconcile reviewer outputs against hunk-linked code context. |

Both files are generated review state. Do not edit them by hand; regenerate them from the extension.

`harness-agent.md` is intended to be read by a CLI agent. It tells the agent which generated files to read, how to evaluate scaffolded reviewer comments, and how to report hunk-by-hunk reconciliation.

## Manifest shape

```json
{
  "version": 1,
  "generatedAt": "2026-06-24T13:00:00.000Z",
  "review": {
    "id": "review id",
    "sourceBranch": "main",
    "targetBranch": "feature",
    "baselineCommit": "abc123",
    "targetCommit": "def456",
    "createdAt": "2026-06-24T12:00:00.000Z"
  },
  "agentConfig": {
    "directory": ".ai-review-agents",
    "note": "Only repo-local agent.md files listed here are active reviewers.",
    "agents": []
  },
  "hunkSchema": {
    "idField": "hunkId",
    "patchIncluded": true,
    "decisions": ["pending", "approved", "question", "disputed", "stale", "resolved"]
  },
  "hunks": [],
  "agentReviewInvocations": []
}
```

## Hunk linkage

Every hunk uses `hunkId` as its stable identifier. Agentic reviewer outputs link to code through `agentReviewInvocations[].hunkIds`.

Each hunk includes:

- `filePath`
- `oldRange` and `newRange`
- `patchHash`
- `patch` with the diff text
- human `comments`
- current `decision`

## Reviewer configuration

Only repo-local `.ai-review-agents/<agent-id>/agent.md` files are active. Scaffold templates are optional starting points, not hardcoded active reviewers. Unlike generated review state, these agent config files are intentionally workspace files so teams may choose whether to keep them local or commit them.

External harnesses should treat missing reviewer config as "no active reviewers" rather than implicitly enabling defaults.
