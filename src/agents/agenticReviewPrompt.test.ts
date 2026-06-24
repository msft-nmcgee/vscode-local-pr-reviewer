import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAgenticReviewPrompt } from './agenticReviewPrompt';
import { ReviewAgentDefinition, ReviewHunkRecord } from '../types';

describe('buildAgenticReviewPrompt', () => {
    it('includes reviewer instructions and exact hunk metadata', () => {
        const prompt = buildAgenticReviewPrompt(createAgent(), {
            scope: 'hunk',
            sourceBranch: 'main',
            targetBranch: 'feature',
            hunks: [createHunk()],
        });

        assert.match(prompt, /You are the Security Reviewer/);
        assert.match(prompt, /Find security issues/);
        assert.match(prompt, /Review scope: hunk/);
        assert.match(prompt, /Hunk sha256:abc/);
        assert.match(prompt, /File: src\/example.ts/);
        assert.match(prompt, /Existing review comments:\n- Why is this safe\?/);
        assert.match(prompt, /```diff\n@@ -1 \+1 @@/);
    });
});

function createAgent(): ReviewAgentDefinition {
    return {
        id: 'security',
        displayName: 'Security Reviewer',
        role: 'security',
        color: '#d73a49',
        enabled: true,
        blocking: { high: true, critical: true },
        prompt: 'Find security issues.',
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
        comments: [{
            id: 'comment-1',
            author: 'reviewer',
            body: 'Why is this safe?',
            timestamp: '2026-06-24T12:00:00.000Z',
        }],
        createdAt: '2026-06-24T12:00:00.000Z',
        updatedAt: '2026-06-24T12:00:00.000Z',
    };
}
