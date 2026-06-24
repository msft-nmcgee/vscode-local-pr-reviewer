import * as vscode from 'vscode';
import { ReviewAgentDefinition, ReviewHunkRecord } from '../types';
import { AgenticReviewRequest, AgenticReviewScope, buildAgenticReviewPrompt } from './agenticReviewPrompt';

export interface AgenticReviewResult {
    agentId: string;
    displayName: string;
    role: string;
    color: string;
    status: 'completed' | 'failed' | 'cancelled';
    output?: string;
    error?: string;
}

export interface AgenticReviewInvocation {
    invocationId: string;
    reviewId: string;
    scope: AgenticReviewScope;
    sourceBranch: string;
    targetBranch: string;
    hunkIds: string[];
    requestedAt: string;
    completedAt: string;
    results: AgenticReviewResult[];
}

export class AgenticReviewService {
    async runReview(
        reviewId: string,
        request: AgenticReviewRequest,
        agents: ReviewAgentDefinition[],
        token: vscode.CancellationToken,
    ): Promise<AgenticReviewInvocation> {
        const model = await this.selectModel();
        const requestedAt = new Date().toISOString();
        const results = await runWithConcurrency(
            agents,
            3,
            agent => this.runSingleAgent(model, agent, request, token),
            token,
        );

        return {
            invocationId: cryptoRandomId(),
            reviewId,
            scope: request.scope,
            sourceBranch: request.sourceBranch,
            targetBranch: request.targetBranch,
            hunkIds: request.hunks.map(hunk => hunk.hunkId),
            requestedAt,
            completedAt: new Date().toISOString(),
            results,
        };
    }

    private async selectModel(): Promise<vscode.LanguageModelChat> {
        const models = await vscode.lm.selectChatModels();
        if (models.length === 0) {
            throw new Error('No VS Code language model is available for agentic review.');
        }
        return models[0];
    }

    private async runSingleAgent(
        model: vscode.LanguageModelChat,
        agent: ReviewAgentDefinition,
        request: AgenticReviewRequest,
        token: vscode.CancellationToken,
    ): Promise<AgenticReviewResult> {
        if (token.isCancellationRequested) {
            return this.cancelledResult(agent);
        }

        try {
            const prompt = buildAgenticReviewPrompt(agent, request);
            const response = await model.sendRequest([
                vscode.LanguageModelChatMessage.User(prompt),
            ], {}, token);
            let output = '';
            for await (const fragment of response.text) {
                output += fragment;
            }
            return {
                agentId: agent.id,
                displayName: agent.displayName,
                role: agent.role,
                color: agent.color,
                status: 'completed',
                output,
            };
        } catch (error: any) {
            if (token.isCancellationRequested) {
                return this.cancelledResult(agent);
            }
            return {
                agentId: agent.id,
                displayName: agent.displayName,
                role: agent.role,
                color: agent.color,
                status: 'failed',
                error: error?.message || String(error),
            };
        }
    }

    private cancelledResult(agent: ReviewAgentDefinition): AgenticReviewResult {
        return {
            agentId: agent.id,
            displayName: agent.displayName,
            role: agent.role,
            color: agent.color,
            status: 'cancelled',
            error: 'Agentic review was cancelled.',
        };
    }
}

async function runWithConcurrency<TInput, TOutput>(
    inputs: TInput[],
    concurrency: number,
    run: (input: TInput) => Promise<TOutput>,
    token: vscode.CancellationToken,
): Promise<TOutput[]> {
    const results: TOutput[] = [];
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, inputs.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < inputs.length && !token.isCancellationRequested) {
            const index = nextIndex;
            nextIndex++;
            results[index] = await run(inputs[index]);
        }
    });
    await Promise.all(workers);
    return results;
}

function cryptoRandomId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
