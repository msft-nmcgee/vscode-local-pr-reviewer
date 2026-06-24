import * as assert from 'node:assert/strict';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { ReviewIndexService } from './reviewIndexService';

describe('ReviewIndexService', () => {
    it('tracks approved and pending changes without touching the normal staging index', async () => {
        const repo = createTempGitRepository();
        try {
            writeFile(repo, 'example.txt', 'one\n');
            execGit(repo, ['add', 'example.txt']);
            execGit(repo, ['commit', '-m', 'baseline']);
            const baseline = execGit(repo, ['rev-parse', 'HEAD']).trim();

            writeFile(repo, 'example.txt', 'two\n');
            const patch = execGit(repo, ['diff', '--no-ext-diff', '--unified=3', baseline]);
            const service = new ReviewIndexService(repo);

            await service.initialize(baseline);

            assert.equal(await service.hasReviewIndex(), true);
            assert.equal(await service.getApprovedDiff(baseline), '');
            assert.match(await service.getPendingDiff(), /[-]one/);
            assert.match(await service.getPendingDiff(), /[+]two/);

            await service.applyPatchToReviewIndex(patch);

            assert.match(await service.getApprovedDiff(baseline), /[+]two/);
            assert.equal(await service.getPendingDiff(), '');
            assert.equal(execGit(repo, ['diff', '--cached', '--name-only']), '');
        } finally {
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });
});

function createTempGitRepository(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'local-pr-review-'));
    execGit(repo, ['init']);
    execGit(repo, ['config', 'user.email', 'test@example.com']);
    execGit(repo, ['config', 'user.name', 'Test User']);
    return repo;
}

function writeFile(repo: string, relativePath: string, contents: string): void {
    const filePath = path.join(repo, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, 'utf8');
}

function execGit(repo: string, args: string[]): string {
    return cp.execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}
