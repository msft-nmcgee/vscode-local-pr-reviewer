import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { AiReviewSessionFile, AiReviewStorageService } from './aiReviewStorageService';
import { ReviewHunkRecord } from '../types';

describe('AiReviewStorageService', () => {
    it('appends ledger events and writes session files under .ai-review', () => {
        const workspace = createTempWorkspace();
        try {
            const service = new AiReviewStorageService(workspace);
            const event = service.appendLedgerEvent({
                eventId: 'event-1',
                reviewId: 'review/1',
                timestamp: '2026-06-23T20:00:00.000Z',
                type: 'hunk-decision',
                hunkId: 'sha256:abc',
                decision: 'approved',
                filePath: 'src/example.ts',
            });

            const session: AiReviewSessionFile = {
                version: 1,
                reviewId: 'review/1',
                sourceBranch: 'main',
                targetBranch: 'feature',
                baselineCommit: 'base',
                targetCommit: 'target',
                createdAt: '2026-06-23T20:00:00.000Z',
                updatedAt: '2026-06-23T20:01:00.000Z',
                hunkIds: ['sha256:abc'],
            };

            service.writeSession(session);

            assert.equal(event.version, 1);
            assert.deepEqual(readJsonLines(service.getLedgerPath()), [event]);
            assert.deepEqual(JSON.parse(fs.readFileSync(service.getSessionPath('review/1'), 'utf8')), session);
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    it('writes agentic review invocation result files', () => {
        const workspace = createTempWorkspace();
        try {
            const service = new AiReviewStorageService(workspace);
            const filePath = service.writeAgenticReviewInvocation({
                invocationId: 'invoke-1',
                reviewId: 'review-1',
                scope: 'hunk',
                sourceBranch: 'main',
                targetBranch: 'feature',
                hunkIds: ['sha256:abc'],
                requestedAt: '2026-06-24T12:00:00.000Z',
                completedAt: '2026-06-24T12:01:00.000Z',
                results: [{
                    agentId: 'security',
                    displayName: 'Security Reviewer',
                    role: 'security',
                    color: '#d73a49',
                    status: 'completed',
                    output: 'No findings.',
                }],
            });

            const written = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            assert.equal(written.invocationId, 'invoke-1');
            assert.equal(written.results[0].agentId, 'security');
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    it('generates deterministic active feedback for disputed and question hunks only', () => {
        const workspace = createTempWorkspace();
        try {
            const service = new AiReviewStorageService(workspace);
            const markdown = service.writeActiveFeedback({
                reviewId: 'review-1',
                baselineCommit: 'abc123',
                generatedAt: '2026-06-23T20:02:00.000Z',
                hunks: [
                    createHunk('src/zeta.ts', 30, 'disputed', 'sha256:z', 'Fix the type contract.'),
                    createHunk('src/alpha.ts', 10, 'approved', 'sha256:a', 'Already fine.'),
                    createHunk('src/alpha.ts', 5, 'question', 'sha256:q', 'Why is this write non-atomic?'),
                ],
            });

            assert.equal(markdown, `# Active Human Review Feedback

Baseline: abc123
Review session: review-1
Generated: 2026-06-23T20:02:00.000Z

## Disputed

### src/zeta.ts:30-31

Hunk: sha256:z
Patch: sha256:z-patch

Context:
- Before: before src/zeta.ts
- After: after src/zeta.ts

Fix the type contract.

## Questions

### src/alpha.ts:5-6

Hunk: sha256:q
Patch: sha256:q-patch

Context:
- Before: before src/alpha.ts
- After: after src/alpha.ts

Why is this write non-atomic?
`);
            assert.equal(fs.readFileSync(service.getActiveFeedbackPath(), 'utf8'), markdown);
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });
});

function createTempWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-storage-'));
}

function readJsonLines(filePath: string): unknown[] {
    return fs.readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line));
}

function createHunk(
    filePath: string,
    start: number,
    decision: ReviewHunkRecord['decision'],
    hunkId: string,
    comment: string,
): ReviewHunkRecord {
    return {
        hunkId,
        filePath,
        status: 'modified',
        oldRange: { start, count: 2 },
        newRange: { start, count: 2 },
        patchHash: `${hunkId}-patch`,
        baselineCommit: 'abc123',
        targetCommit: 'def456',
        contextBefore: `before ${filePath}`,
        contextAfter: `after ${filePath}`,
        decision,
        comments: [{
            id: `${hunkId}-comment`,
            body: comment,
            author: 'reviewer',
            timestamp: '2026-06-23T20:00:00.000Z',
        }],
        createdAt: '2026-06-23T20:00:00.000Z',
        updatedAt: '2026-06-23T20:00:00.000Z',
    };
}
