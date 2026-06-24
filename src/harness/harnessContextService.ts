import { AgenticReviewInvocation } from '../agents/agenticReviewService';
import { ReviewAgentDefinition, ReviewHunkRecord } from '../types';

export interface HarnessContextInput {
    review: {
        id: string;
        sourceBranch: string;
        targetBranch: string;
        baselineCommit: string;
        targetCommit: string;
        createdAt: string;
    };
    generatedAt: string;
    hunks: ReviewHunkRecord[];
    agents: ReviewAgentDefinition[];
    agentReviewInvocations: AgenticReviewInvocation[];
}

export interface HarnessManifest {
    version: 1;
    generatedAt: string;
    review: HarnessContextInput['review'];
    agentConfig: {
        directory: '.ai-review-agents';
        note: string;
        agents: ReviewAgentDefinition[];
    };
    hunkSchema: {
        idField: 'hunkId';
        patchIncluded: true;
        decisions: Array<ReviewHunkRecord['decision']>;
    };
    hunks: ReviewHunkRecord[];
    agentReviewInvocations: AgenticReviewInvocation[];
}

export function buildHarnessManifest(input: HarnessContextInput): HarnessManifest {
    return {
        version: 1,
        generatedAt: input.generatedAt,
        review: input.review,
        agentConfig: {
            directory: '.ai-review-agents',
            note: input.agents.length === 0
                ? 'No reviewers are active because no repo-local agent.md files are present.'
                : 'Only repo-local agent.md files listed here are active reviewers.',
            agents: input.agents,
        },
        hunkSchema: {
            idField: 'hunkId',
            patchIncluded: true,
            decisions: ['pending', 'approved', 'question', 'disputed', 'stale', 'resolved'],
        },
        hunks: input.hunks,
        agentReviewInvocations: input.agentReviewInvocations,
    };
}

export function renderHarnessContext(manifest: HarnessManifest): string {
    const lines: string[] = [
        '# AI Review Harness Context',
        '',
        `Generated: ${manifest.generatedAt}`,
        `Review session: ${manifest.review.id}`,
        `Source branch: ${manifest.review.sourceBranch}`,
        `Target branch: ${manifest.review.targetBranch}`,
        `Baseline commit: ${manifest.review.baselineCommit}`,
        `Target commit: ${manifest.review.targetCommit}`,
        '',
        '## How to use this file',
        '',
        'Use this context to reconcile human and agentic review findings with the code hunks they reference.',
        'Do not modify `.ai-review/` files directly. The extension owns review state.',
        '',
        '## Active reviewer configuration',
        '',
        manifest.agentConfig.note,
        '',
    ];

    if (manifest.agentConfig.agents.length === 0) {
        lines.push('_No active reviewers._', '');
    } else {
        for (const agent of manifest.agentConfig.agents) {
            lines.push(`### ${agent.displayName}`);
            lines.push('');
            lines.push(`- ID: ${agent.id}`);
            lines.push(`- Role: ${agent.role}`);
            lines.push(`- Enabled: ${agent.enabled}`);
            lines.push(`- Color: ${agent.color}`);
            lines.push(`- Source: ${agent.sourcePath || 'template/unknown'}`);
            lines.push('');
            lines.push(agent.prompt);
            lines.push('');
        }
    }

    lines.push('## Hunks');
    lines.push('');
    for (const hunk of manifest.hunks) {
        lines.push(`### ${hunk.hunkId}`);
        lines.push('');
        lines.push(`- File: ${hunk.filePath}`);
        lines.push(`- Decision: ${hunk.decision}`);
        lines.push(`- Old range: ${hunk.oldRange.start},${hunk.oldRange.count}`);
        lines.push(`- New range: ${hunk.newRange.start},${hunk.newRange.count}`);
        lines.push(`- Patch hash: ${hunk.patchHash}`);
        if (hunk.comments.length > 0) {
            lines.push('- Human comments:');
            for (const comment of hunk.comments) {
                lines.push(`  - ${comment.body}`);
            }
        }
        lines.push('');
        lines.push('```diff');
        lines.push(hunk.patch || '_Patch text unavailable._');
        lines.push('```');
        lines.push('');
    }

    lines.push('## Agentic review outputs');
    lines.push('');
    if (manifest.agentReviewInvocations.length === 0) {
        lines.push('_No agentic review outputs recorded._');
        lines.push('');
    } else {
        for (const invocation of manifest.agentReviewInvocations) {
            lines.push(`### Invocation ${invocation.invocationId}`);
            lines.push('');
            lines.push(`- Scope: ${invocation.scope}`);
            lines.push(`- Hunk IDs: ${invocation.hunkIds.join(', ')}`);
            lines.push(`- Completed: ${invocation.completedAt}`);
            lines.push('');
            for (const result of invocation.results) {
                lines.push(`#### ${result.displayName} (${result.status})`);
                lines.push('');
                lines.push(result.output || result.error || '_No output recorded._');
                lines.push('');
            }
        }
    }

    return lines.join('\n');
}

export function renderHarnessAgentInstructions(): string {
    return [
        '# AI Review Reconciliation Agent',
        '',
        'You are reconciling human review decisions and agentic reviewer findings for a local code review.',
        '',
        '## Required inputs',
        '',
        'Read these generated files before making any claim:',
        '',
        '1. `.ai-review/harness-manifest.json`',
        '2. `.ai-review/harness-context.md`',
        '3. `.ai-review/active-feedback.md` when it exists',
        '4. `.ai-review/agent-reviews/*.json` when referenced by the manifest',
        '',
        'Do not modify files under `.ai-review/`. The VS Code extension owns review state.',
        '',
        '## Reconciliation task',
        '',
        '1. Map every agentic reviewer finding to the hunk IDs listed in the manifest.',
        '2. Evaluate whether each finding is actionable, already addressed, contradicted by the code, or too speculative.',
        '3. For human `question` hunks, answer the question directly before proposing code changes.',
        '4. For human `disputed` hunks, treat the dispute as mandatory feedback unless the code evidence clearly invalidates it.',
        '5. When multiple reviewer findings conflict, explain the conflict and choose the safest recommendation.',
        '6. Recommend concrete code changes only when they are tied to a hunk ID and supported by the hunk patch or surrounding context.',
        '',
        '## Output format',
        '',
        'Return Markdown with these sections:',
        '',
        '```markdown',
        '# Reconciliation Result',
        '',
        '## Summary',
        '<short outcome>',
        '',
        '## Hunk-by-hunk reconciliation',
        '',
        '### <hunkId>',
        '- File: <path>',
        '- Human state: <pending|approved|question|disputed|stale|resolved>',
        '- Agent findings considered: <reviewer ids>',
        '- Disposition: <actionable|already-addressed|not-actionable|needs-human-decision>',
        '- Recommendation: <specific action or answer>',
        '',
        '## Proposed coding-agent tasks',
        '- <task tied to hunk ID>',
        '',
        '## Validation to run',
        '- <targeted tests/checks>',
        '```',
        '',
        'Do not report success for changes that have not been made and verified.',
        '',
    ].join('\n');
}
