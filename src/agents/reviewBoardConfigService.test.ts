import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { defaultReviewAgents, ReviewBoardConfigService } from './reviewBoardConfigService';

describe('ReviewBoardConfigService', () => {
    it('returns built-in default reviewers when no repo config exists', () => {
        const workspace = createTempWorkspace();
        try {
            const agents = new ReviewBoardConfigService(workspace).loadAgents();

            assert.deepEqual(agents.map(agent => agent.id), [
                'security',
                'performance',
                'architecture',
                'reliability',
                'maintainability',
                'testability',
            ]);
            assert.equal(agents.every(agent => agent.enabled), true);
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    it('initializes and loads repo-local agent.md files', () => {
        const workspace = createTempWorkspace();
        try {
            const service = new ReviewBoardConfigService(workspace);
            const written = service.initializeDefaultAgents();
            const loaded = service.loadAgents();

            assert.equal(written.length, defaultReviewAgents().length);
            assert.equal(fs.existsSync(path.join(workspace, '.ai-review-agents', 'security', 'agent.md')), true);
            assert.deepEqual(loaded.map(agent => agent.id).sort(), defaultReviewAgents().map(agent => agent.id).sort());
            assert.equal(loaded.find(agent => agent.id === 'security')?.blocking.high, true);
            assert.equal(loaded.find(agent => agent.id === 'maintainability')?.blocking.high, false);
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    it('fails loud for invalid repo-local agent config', () => {
        const workspace = createTempWorkspace();
        try {
            const agentDir = path.join(workspace, '.ai-review-agents', 'bad-agent');
            fs.mkdirSync(agentDir, { recursive: true });
            fs.writeFileSync(path.join(agentDir, 'agent.md'), [
                '---',
                'id: bad-agent',
                'displayName: Bad Agent',
                'role: security',
                'color: blue',
                'enabled: true',
                '---',
                'Prompt text.',
                '',
            ].join('\n'), 'utf8');

            assert.throws(
                () => new ReviewBoardConfigService(workspace).loadAgents(),
                /invalid color/i,
            );
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });
});

function createTempWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'review-board-config-'));
}
