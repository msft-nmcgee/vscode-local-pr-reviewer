import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildReconciliationPrompt, buildRepositoryInstructions } from './copilotPromptService';

describe('copilotPromptService', () => {
    it('builds a reconciliation prompt for active feedback', () => {
        assert.equal(buildReconciliationPrompt(), [
            'Read .ai-review/active-feedback.md and reconcile every disputed item.',
            'For questions, provide a direct answer before making speculative changes.',
            'Run the relevant tests, then report results by hunk ID.',
            'Do not modify .ai-review files.',
        ].join('\n'));
    });

    it('builds repository instructions for Copilot CLI', () => {
        const instructions = buildRepositoryInstructions();

        assert.match(instructions, /## Human review reconciliation/);
        assert.match(instructions, /Read `.ai-review\/active-feedback.md`/);
        assert.match(instructions, /Never modify files under `.ai-review\/`/);
        assert.match(instructions, /summarize each hunk ID/);
    });
});
