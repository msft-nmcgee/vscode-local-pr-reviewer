import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildHarnessManifest, renderHarnessAgentInstructions, renderHarnessContext } from './harnessContextService';
import { ReviewAgentDefinition, ReviewHunkRecord } from '../types';

describe('harnessContextService', () => {
    it('builds a manifest and markdown context with hunk patches, agents, and review outputs', () => {
        const manifest = buildHarnessManifest({
            review: {
                id: 'review-1',
                sourceBranch: 'main',
                targetBranch: 'feature',
                baselineCommit: 'base',
                targetCommit: 'target',
                createdAt: '2026-06-24T12:00:00.000Z',
            },
            generatedAt: '2026-06-24T13:00:00.000Z',
            hunks: [createHunk()],
            agents: [createAgent()],
            agentReviewInvocations: [{
                invocationId: 'invoke-1',
                reviewId: 'review-1',
                scope: 'hunk',
                sourceBranch: 'main',
                targetBranch: 'feature',
                hunkIds: ['sha256:abc'],
                requestedAt: '2026-06-24T12:30:00.000Z',
                completedAt: '2026-06-24T12:31:00.000Z',
                results: [{
                    agentId: 'security',
                    displayName: 'Security Reviewer',
                    role: 'security',
                    color: '#d73a49',
                    status: 'completed',
                    output: 'No concrete issue.',
                }],
            }],
        });
        const markdown = renderHarnessContext(manifest);

        assert.equal(manifest.hunkSchema.patchIncluded, true);
        assert.equal(manifest.agentConfig.agents[0].id, 'security');
        assert.match(markdown, /# AI Review Harness Context/);
        assert.match(markdown, /sha256:abc/);
        assert.match(markdown, /```diff\n@@ -1 \+1 @@/);
        assert.match(markdown, /No concrete issue/);
    });

    it('renders CLI agent instructions for reconciling harness artifacts', () => {
        const instructions = renderHarnessAgentInstructions();

        assert.match(instructions, /AI Review Reconciliation Agent/);
        assert.match(instructions, /\.git\/ai-review\/harness-manifest\.json/);
        assert.match(instructions, /Do not modify files under `.git\/ai-review\/`/);
        assert.match(instructions, /Hunk-by-hunk reconciliation/);
    });
});

function createAgent(): ReviewAgentDefinition {
    return {
        id: 'security',
        displayName: 'Security Reviewer',
        role: 'security',
        color: '#d73a49',
        enabled: true,
        blocking: { high: true },
        prompt: 'Find security issues.',
        sourcePath: '.ai-review-agents/security/agent.md',
    };
}

function createHunk(): ReviewHunkRecord {
    return {
        hunkId: 'sha256:abc',
        filePath: 'src/example.ts',
        status: 'modified',
        oldRange: { start: 1, count: 1 },
        newRange: { start: 1, count: 1 },
        patchHash: 'sha256:def',
        patch: '@@ -1 +1 @@\n-old\n+new\n',
        baselineCommit: 'base',
        targetCommit: 'target',
        decision: 'question',
        comments: [],
        createdAt: '2026-06-24T12:00:00.000Z',
        updatedAt: '2026-06-24T12:00:00.000Z',
    };
}
