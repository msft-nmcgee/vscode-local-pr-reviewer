import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ReviewDecision, ReviewHunkRecord } from '../types';
import type { AgenticReviewInvocation } from '../agents/agenticReviewService';
import type { HarnessManifest } from '../harness/harnessContextService';
import { migrateLegacyWorkspaceReviewDir, resolveGitLocalReviewDir } from './aiReviewPaths';

export interface AiReviewLedgerEvent {
    version: 1;
    eventId: string;
    reviewId: string;
    timestamp: string;
    type: 'session-created' | 'hunk-decision' | 'projection-generated' | 'agentic-review';
    hunkId?: string;
    decision?: ReviewDecision;
    filePath?: string;
    details?: Record<string, unknown>;
}

export interface AiReviewSessionFile {
    version: 1;
    reviewId: string;
    sourceBranch: string;
    targetBranch: string;
    baselineCommit: string;
    targetCommit: string;
    createdAt: string;
    updatedAt: string;
    hunkIds: string[];
}

export interface ActiveFeedbackInput {
    reviewId: string;
    baselineCommit: string;
    generatedAt: string;
    hunks: ReviewHunkRecord[];
}

interface StoredAgenticReviewInvocation {
    filePath: string;
    invocation: AgenticReviewInvocation;
}

export class AiReviewStorageService {
    private readonly aiReviewDir: string;
    private readonly sessionsDir: string;
    private readonly agentReviewsDir: string;
    private readonly ledgerPath: string;
    private readonly activeFeedbackPath: string;
    private readonly harnessContextPath: string;
    private readonly harnessManifestPath: string;
    private readonly harnessAgentPath: string;

    constructor(private readonly workspaceRoot: string) {
        migrateLegacyWorkspaceReviewDir(workspaceRoot);
        this.aiReviewDir = resolveGitLocalReviewDir(workspaceRoot);
        this.sessionsDir = path.join(this.aiReviewDir, 'sessions');
        this.agentReviewsDir = path.join(this.aiReviewDir, 'agent-reviews');
        this.ledgerPath = path.join(this.aiReviewDir, 'ledger.jsonl');
        this.activeFeedbackPath = path.join(this.aiReviewDir, 'active-feedback.md');
        this.harnessContextPath = path.join(this.aiReviewDir, 'harness-context.md');
        this.harnessManifestPath = path.join(this.aiReviewDir, 'harness-manifest.json');
        this.harnessAgentPath = path.join(this.aiReviewDir, 'harness-agent.md');
    }

    getLedgerPath(): string {
        return this.ledgerPath;
    }

    getActiveFeedbackPath(): string {
        return this.activeFeedbackPath;
    }

    getHarnessContextPath(): string {
        return this.harnessContextPath;
    }

    getHarnessManifestPath(): string {
        return this.harnessManifestPath;
    }

    getHarnessAgentPath(): string {
        return this.harnessAgentPath;
    }

    getSessionPath(reviewId: string): string {
        return path.join(this.sessionsDir, `${sanitizeFileName(reviewId)}.json`);
    }

    appendLedgerEvent(event: Omit<AiReviewLedgerEvent, 'version' | 'eventId'> & { eventId?: string }): AiReviewLedgerEvent {
        const ledgerEvent: AiReviewLedgerEvent = {
            version: 1,
            ...event,
            eventId: event.eventId ?? crypto.randomUUID(),
        };

        ensureDirectory(this.aiReviewDir);
        fs.appendFileSync(this.ledgerPath, `${JSON.stringify(ledgerEvent)}\n`, 'utf8');
        return ledgerEvent;
    }

    writeSession(session: AiReviewSessionFile): void {
        atomicWriteFile(this.getSessionPath(session.reviewId), `${JSON.stringify(session, null, 2)}\n`);
    }

    writeActiveFeedback(input: ActiveFeedbackInput): string {
        const markdown = this.renderActiveFeedback(input);
        atomicWriteFile(this.activeFeedbackPath, markdown);
        return markdown;
    }

    writeAgenticReviewInvocation(invocation: AgenticReviewInvocation): string {
        const filePath = path.join(this.agentReviewsDir, `${sanitizeFileName(invocation.invocationId)}.json`);
        atomicWriteFile(filePath, `${JSON.stringify(invocation, null, 2)}\n`);
        this.deleteFullySupersededAgenticReviewFiles(invocation, filePath);
        return filePath;
    }

    loadAgenticReviewInvocations(): AgenticReviewInvocation[] {
        return selectLatestAgenticReviewInvocations(
            this.loadStoredAgenticReviewInvocations().map(stored => stored.invocation)
        );
    }

    private loadStoredAgenticReviewInvocations(): StoredAgenticReviewInvocation[] {
        if (!fs.existsSync(this.agentReviewsDir)) {
            return [];
        }

        return fs.readdirSync(this.agentReviewsDir)
            .filter(fileName => fileName.endsWith('.json'))
            .map(fileName => path.join(this.agentReviewsDir, fileName))
            .map(filePath => ({
                filePath,
                invocation: JSON.parse(fs.readFileSync(filePath, 'utf8')) as AgenticReviewInvocation,
            }))
            .sort((left, right) => {
                const completedComparison = left.invocation.completedAt.localeCompare(right.invocation.completedAt);
                if (completedComparison !== 0) {
                    return completedComparison;
                }
                return left.filePath.localeCompare(right.filePath);
            });
    }

    private deleteFullySupersededAgenticReviewFiles(replacement: AgenticReviewInvocation, replacementPath: string): void {
        if (replacement.hunkIds.length === 0 || replacement.results.length === 0) {
            return;
        }

        const replacementHunkIds = new Set(replacement.hunkIds);
        const replacementAgentIds = new Set(replacement.results.map(result => result.agentId));
        for (const stored of this.loadStoredAgenticReviewInvocations()) {
            if (stored.filePath === replacementPath) {
                continue;
            }
            if (isFullySuperseded(stored.invocation, replacement, replacementHunkIds, replacementAgentIds)) {
                fs.rmSync(stored.filePath, { force: true });
            }
        }
    }

    writeHarnessArtifacts(manifest: HarnessManifest, markdown: string, agentInstructions: string): void {
        atomicWriteFile(this.harnessManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        atomicWriteFile(this.harnessContextPath, markdown);
        atomicWriteFile(this.harnessAgentPath, agentInstructions);
    }

    renderActiveFeedback(input: ActiveFeedbackInput): string {
        const disputed = this.getActionableHunks(input.hunks, 'disputed');
        const questions = this.getActionableHunks(input.hunks, 'question');
        const lines: string[] = [
            '# Active Human Review Feedback',
            '',
            `Baseline: ${input.baselineCommit}`,
            `Review session: ${input.reviewId}`,
            `Generated: ${input.generatedAt}`,
            '',
        ];

        if (disputed.length === 0 && questions.length === 0) {
            lines.push('No active disputed or question feedback.');
            lines.push('');
            return lines.join('\n');
        }

        appendFeedbackSection(lines, 'Disputed', disputed);
        appendFeedbackSection(lines, 'Questions', questions);
        return lines.join('\n');
    }

    private getActionableHunks(hunks: ReviewHunkRecord[], decision: ReviewDecision): ReviewHunkRecord[] {
        return hunks
            .filter(hunk => hunk.decision === decision)
            .slice()
            .sort((left, right) => {
                const pathComparison = left.filePath.localeCompare(right.filePath);
                if (pathComparison !== 0) {
                    return pathComparison;
                }
                return left.newRange.start - right.newRange.start;
            });
    }
}

function appendFeedbackSection(lines: string[], title: string, hunks: ReviewHunkRecord[]): void {
    if (hunks.length === 0) {
        return;
    }

    lines.push(`## ${title}`);
    lines.push('');

    for (const hunk of hunks) {
        lines.push(`### ${hunk.filePath}:${hunk.newRange.start}-${hunk.newRange.start + Math.max(hunk.newRange.count - 1, 0)}`);
        lines.push('');
        lines.push(`Hunk: ${hunk.hunkId}`);
        lines.push(`Patch: ${hunk.patchHash}`);
        lines.push('');
        appendContext(lines, hunk);
        appendComments(lines, hunk);
    }
}

function appendContext(lines: string[], hunk: ReviewHunkRecord): void {
    if (!hunk.contextBefore && !hunk.contextAfter) {
        return;
    }

    lines.push('Context:');
    if (hunk.contextBefore) {
        lines.push(`- Before: ${hunk.contextBefore}`);
    }
    if (hunk.contextAfter) {
        lines.push(`- After: ${hunk.contextAfter}`);
    }
    lines.push('');
}

function appendComments(lines: string[], hunk: ReviewHunkRecord): void {
    if (hunk.comments.length === 0) {
        lines.push('_No comment text recorded._');
        lines.push('');
        return;
    }

    for (const comment of hunk.comments) {
        lines.push(comment.body);
        lines.push('');
    }
}

function selectLatestAgenticReviewInvocations(invocations: AgenticReviewInvocation[]): AgenticReviewInvocation[] {
    const latestByReviewHunkAgent = new Map<string, { invocationIndex: number; resultIndex: number }>();

    invocations.forEach((invocation, invocationIndex) => {
        invocation.results.forEach((result, resultIndex) => {
            for (const hunkId of invocation.hunkIds) {
                latestByReviewHunkAgent.set(agentReviewKey(invocation.reviewId, hunkId, result.agentId), {
                    invocationIndex,
                    resultIndex,
                });
            }
        });
    });

    const currentInvocations: AgenticReviewInvocation[] = [];
    invocations.forEach((invocation, invocationIndex) => {
        const groupsByResultSet = new Map<string, { hunkIds: string[]; resultIndices: number[] }>();
        for (const hunkId of invocation.hunkIds) {
            const currentResultIndices = invocation.results
                .map((result, resultIndex) => ({ result, resultIndex }))
                .filter(({ result, resultIndex }) => {
                    const latest = latestByReviewHunkAgent.get(agentReviewKey(invocation.reviewId, hunkId, result.agentId));
                    return latest?.invocationIndex === invocationIndex && latest.resultIndex === resultIndex;
                })
                .map(({ resultIndex }) => resultIndex);

            if (currentResultIndices.length === 0) {
                continue;
            }

            const groupKey = currentResultIndices.join(',');
            const group = groupsByResultSet.get(groupKey) ?? {
                hunkIds: [],
                resultIndices: currentResultIndices,
            };
            group.hunkIds.push(hunkId);
            groupsByResultSet.set(groupKey, group);
        }

        for (const group of groupsByResultSet.values()) {
            currentInvocations.push({
                ...invocation,
                hunkIds: group.hunkIds,
                results: group.resultIndices.map(resultIndex => invocation.results[resultIndex]),
            });
        }
    });

    return currentInvocations;
}

function isFullySuperseded(
    existing: AgenticReviewInvocation,
    replacement: AgenticReviewInvocation,
    replacementHunkIds: Set<string>,
    replacementAgentIds: Set<string>,
): boolean {
    return existing.reviewId === replacement.reviewId
        && existing.completedAt.localeCompare(replacement.completedAt) <= 0
        && existing.hunkIds.length > 0
        && existing.results.length > 0
        && existing.hunkIds.every(hunkId => replacementHunkIds.has(hunkId))
        && existing.results.every(result => replacementAgentIds.has(result.agentId));
}

function agentReviewKey(reviewId: string, hunkId: string, agentId: string): string {
    return `${reviewId}\0${hunkId}\0${agentId}`;
}

function sanitizeFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function ensureDirectory(directoryPath: string): void {
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
    }
}

function atomicWriteFile(filePath: string, contents: string): void {
    ensureDirectory(path.dirname(filePath));
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, contents, 'utf8');
    fs.renameSync(tempPath, filePath);
}
