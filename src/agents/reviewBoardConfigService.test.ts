import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { defaultAgentTemplates, ReviewBoardConfigService } from './reviewBoardConfigService';

describe('ReviewBoardConfigService', () => {
    it('returns no active reviewers when no repo agent.md files exist', () => {
        const workspace = createTempWorkspace();
        try {
            const agents = new ReviewBoardConfigService(workspace).loadAgents();

            assert.deepEqual(agents, []);
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    it('initializes optional repo-local agent.md templates and then loads only present files', () => {
        const workspace = createTempWorkspace();
        try {
            const service = new ReviewBoardConfigService(workspace);
            const written = service.initializeAgentTemplates();
            const loaded = service.loadAgents();

            assert.equal(written.length, defaultAgentTemplates().length);
            assert.equal(fs.existsSync(path.join(workspace, '.ai-review-agents', 'security', 'agent.md')), true);
            assert.deepEqual(loaded.map(agent => agent.id).sort(), defaultAgentTemplates().map(agent => agent.id).sort());
            assert.equal(loaded.find(agent => agent.id === 'security')?.blocking.high, true);
            assert.equal(loaded.find(agent => agent.id === 'maintainability')?.blocking.high, false);
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    it('loads only the agent.md files present in the repository', () => {
        const workspace = createTempWorkspace();
        try {
            const service = new ReviewBoardConfigService(workspace);
            const securityTemplate = defaultAgentTemplates().find(agent => agent.id === 'security');
            assert.ok(securityTemplate);
            const agentDir = path.join(workspace, '.ai-review-agents', 'security');
            fs.mkdirSync(agentDir, { recursive: true });
            fs.writeFileSync(path.join(agentDir, 'agent.md'), [
                '---',
                `id: ${securityTemplate.id}`,
                `displayName: ${securityTemplate.displayName}`,
                `role: ${securityTemplate.role}`,
                `color: ${securityTemplate.color}`,
                'enabled: true',
                'blockCritical: true',
                'blockHigh: true',
                '---',
                securityTemplate.prompt,
                '',
            ].join('\n'), 'utf8');

            assert.deepEqual(service.loadAgents().map(agent => agent.id), ['security']);
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
