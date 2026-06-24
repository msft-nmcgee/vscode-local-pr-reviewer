import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
    migrateLegacyWorkspaceLocalReviewsDir,
    migrateLegacyWorkspaceReviewBoardDir,
    resolveLocalReviewsDir,
    resolveReviewBoardDir,
} from './aiReviewPaths';

describe('aiReviewPaths', () => {
    it('resolves local review storage under git-local ai-review storage', () => {
        const workspace = createTempWorkspace();
        try {
            assert.equal(
                resolveLocalReviewsDir(workspace),
                path.join(workspace, '.git', 'ai-review', 'local-reviews'),
            );
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    it('resolves review board config under git-local ai-review storage', () => {
        const workspace = createTempWorkspace();
        try {
            assert.equal(
                resolveReviewBoardDir(workspace),
                path.join(workspace, '.git', 'ai-review', 'agents'),
            );
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    it('migrates legacy workspace review storage into git-local ai-review storage', () => {
        const workspace = createTempWorkspace();
        try {
            const legacyDir = path.join(workspace, '.vscode', 'local-reviews');
            fs.mkdirSync(legacyDir, { recursive: true });
            fs.writeFileSync(path.join(legacyDir, 'registry.json'), JSON.stringify({
                version: 1,
                activeReviewId: 'review-1',
                reviews: [],
            }), 'utf8');

            migrateLegacyWorkspaceLocalReviewsDir(workspace);

            const registryPath = path.join(workspace, '.git', 'ai-review', 'local-reviews', 'registry.json');
            assert.equal(fs.existsSync(registryPath), true);
            assert.equal(fs.existsSync(legacyDir), false);
            assert.equal(JSON.parse(fs.readFileSync(registryPath, 'utf8')).activeReviewId, 'review-1');
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    it('migrates legacy workspace review storage even when git-local storage already exists', () => {
        const workspace = createTempWorkspace();
        try {
            const legacyReviewDir = path.join(workspace, '.vscode', 'local-reviews', 'legacy-review');
            const gitLocalReviewDir = path.join(workspace, '.git', 'ai-review', 'local-reviews', 'current-review');
            fs.mkdirSync(legacyReviewDir, { recursive: true });
            fs.mkdirSync(gitLocalReviewDir, { recursive: true });
            fs.writeFileSync(path.join(legacyReviewDir, 'comments.json'), 'legacy comments', 'utf8');
            fs.writeFileSync(path.join(gitLocalReviewDir, 'comments.json'), 'current comments', 'utf8');

            migrateLegacyWorkspaceLocalReviewsDir(workspace);

            assert.equal(fs.existsSync(path.join(workspace, '.vscode', 'local-reviews')), false);
            assert.equal(fs.readFileSync(path.join(workspace, '.git', 'ai-review', 'local-reviews', 'legacy-review', 'comments.json'), 'utf8'), 'legacy comments');
            assert.equal(fs.readFileSync(path.join(workspace, '.git', 'ai-review', 'local-reviews', 'current-review', 'comments.json'), 'utf8'), 'current comments');
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    it('migrates legacy workspace review board config even when git-local config already exists', () => {
        const workspace = createTempWorkspace();
        try {
            const legacyAgentDir = path.join(workspace, '.ai-review-agents', 'security');
            const gitLocalAgentDir = path.join(workspace, '.git', 'ai-review', 'agents', 'performance');
            fs.mkdirSync(legacyAgentDir, { recursive: true });
            fs.mkdirSync(gitLocalAgentDir, { recursive: true });
            fs.writeFileSync(path.join(legacyAgentDir, 'agent.md'), 'security', 'utf8');
            fs.writeFileSync(path.join(gitLocalAgentDir, 'agent.md'), 'performance', 'utf8');

            migrateLegacyWorkspaceReviewBoardDir(workspace);

            assert.equal(fs.existsSync(path.join(workspace, '.ai-review-agents')), false);
            assert.equal(fs.readFileSync(path.join(workspace, '.git', 'ai-review', 'agents', 'security', 'agent.md'), 'utf8'), 'security');
            assert.equal(fs.readFileSync(path.join(workspace, '.git', 'ai-review', 'agents', 'performance', 'agent.md'), 'utf8'), 'performance');
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });
});

function createTempWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-paths-'));
    fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
    return workspace;
}
