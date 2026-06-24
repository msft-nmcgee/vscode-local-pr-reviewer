import { ReviewAgentDefinition, ReviewHunkRecord } from '../types';

export type AgenticReviewScope = 'hunk' | 'selected-hunks' | 'file' | 'all-pending';

export interface AgenticReviewRequest {
    scope: AgenticReviewScope;
    sourceBranch: string;
    targetBranch: string;
    hunks: ReviewHunkRecord[];
}

export function buildAgenticReviewPrompt(agent: ReviewAgentDefinition, request: AgenticReviewRequest): string {
    return [
        `You are the ${agent.displayName}.`,
        '',
        agent.prompt,
        '',
        `Review scope: ${request.scope}`,
        `Source branch: ${request.sourceBranch}`,
        `Target branch: ${request.targetBranch}`,
        `Hunk count: ${request.hunks.length}`,
        '',
        'Return Markdown with these sections:',
        '1. Summary',
        '2. Findings',
        '3. Recommended next actions',
        '',
        'For every finding, include severity, hunk ID, file path, and a concrete fix.',
        'Do not approve or reject hunks. Provide recommendations only.',
        '',
        'Hunks to review:',
        ...request.hunks.flatMap(formatHunkForPrompt),
    ].join('\n');
}

function formatHunkForPrompt(hunk: ReviewHunkRecord): string[] {
    return [
        '',
        `## Hunk ${hunk.hunkId}`,
        `File: ${hunk.filePath}`,
        `Decision: ${hunk.decision}`,
        `Old range: ${hunk.oldRange.start},${hunk.oldRange.count}`,
        `New range: ${hunk.newRange.start},${hunk.newRange.count}`,
        `Patch hash: ${hunk.patchHash}`,
        hunk.contextBefore ? `Context before: ${hunk.contextBefore}` : '',
        hunk.contextAfter ? `Context after: ${hunk.contextAfter}` : '',
        hunk.comments.length > 0 ? `Existing review comments:\n${hunk.comments.map(comment => `- ${comment.body}`).join('\n')}` : '',
        'Patch:',
        '```diff',
        hunk.patch || '_Patch text unavailable._',
        '```',
    ].filter(line => line.length > 0);
}
