const ACTIVE_FEEDBACK_PATH = '.ai-review/active-feedback.md';

export function buildReconciliationPrompt(activeFeedbackPath: string = ACTIVE_FEEDBACK_PATH): string {
    return [
        `Read ${activeFeedbackPath} and reconcile every disputed item.`,
        'For questions, provide a direct answer before making speculative changes.',
        'Run the relevant tests, then report results by hunk ID.',
        'Do not modify .ai-review files.',
    ].join('\n');
}

export function buildRepositoryInstructions(activeFeedbackPath: string = ACTIVE_FEEDBACK_PATH): string {
    return [
        '## Human review reconciliation',
        '',
        'Before modifying code in response to review feedback:',
        '',
        `1. Read \`${activeFeedbackPath}\`.`,
        '2. Treat `disputed` items as mandatory rework.',
        '3. Answer `question` items before changing the referenced implementation unless the feedback explicitly requests a code change.',
        '4. Never modify files under `.ai-review/`.',
        '5. Do not mark feedback resolved or approved. Only the human review extension may change review state.',
        '6. After addressing feedback, summarize each hunk ID and the corresponding implementation or explanation.',
    ].join('\n');
}
