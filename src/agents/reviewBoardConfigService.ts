import * as fs from 'fs';
import * as path from 'path';
import { ReviewAgentDefinition, ReviewAgentRole } from '../types';
import { migrateLegacyWorkspaceReviewBoardDir, resolveReviewBoardDir } from '../storage/aiReviewPaths';

const AGENT_FILE_NAME = 'agent.md';

type AgentFrontMatter = Record<string, string>;

export class ReviewBoardConfigService {
    constructor(private readonly workspaceRoot: string) {
        this.migrateLegacyWorkspaceBoard();
    }

    getReviewBoardDir(): string {
        return resolveReviewBoardDir(this.workspaceRoot);
    }

    getAgentFilePath(agentId: string): string {
        return path.join(this.getReviewBoardDir(), agentId, AGENT_FILE_NAME);
    }

    private migrateLegacyWorkspaceBoard(): void {
        migrateLegacyWorkspaceReviewBoardDir(this.workspaceRoot);
    }

    loadAgents(): ReviewAgentDefinition[] {
        const boardDir = this.getReviewBoardDir();
        if (!fs.existsSync(boardDir)) {
            return [];
        }

        const agents = fs.readdirSync(boardDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => this.getAgentFilePath(entry.name))
            .filter(filePath => fs.existsSync(filePath))
            .map(filePath => parseAgentFile(filePath, fs.readFileSync(filePath, 'utf8')));

        validateAgents(agents);
        return agents;
    }

    initializeAgentTemplates(): string[] {
        const writtenPaths: string[] = [];
        for (const agent of defaultAgentTemplates()) {
            const filePath = this.getAgentFilePath(agent.id);
            if (fs.existsSync(filePath)) {
                continue;
            }
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, formatAgentFile(agent), 'utf8');
            writtenPaths.push(filePath);
        }
        return writtenPaths;
    }
}

export function defaultAgentTemplates(): ReviewAgentDefinition[] {
    return [
        {
            id: 'security',
            displayName: 'Security Reviewer',
            role: 'security',
            color: '#d73a49',
            enabled: true,
            blocking: { critical: true, high: true },
            prompt: 'Review for exploitable security vulnerabilities, including injection, auth/authz, secrets, unsafe file or shell access, and unsafe dependency behavior. Only report concrete risks with actionable fixes.',
        },
        {
            id: 'performance',
            displayName: 'Performance Reviewer',
            role: 'performance',
            color: '#fb8500',
            enabled: true,
            blocking: { critical: true, high: true },
            prompt: 'Review for avoidable latency, unbounded work, excess IO, inefficient data structures, N+1 access, and scaling risks. Prefer findings with measurable cost or clear growth behavior.',
        },
        {
            id: 'architecture',
            displayName: 'Architecture Reviewer',
            role: 'architecture',
            color: '#8250df',
            enabled: true,
            blocking: { critical: true, high: true },
            prompt: 'Review for boundary violations, parallel mechanisms, type/model incoherence, persistence or contract drift, and choices that conflict with documented architecture.',
        },
        {
            id: 'reliability',
            displayName: 'Reliability Reviewer',
            role: 'reliability',
            color: '#0969da',
            enabled: true,
            blocking: { critical: true, high: true },
            prompt: 'Review for timeout, cancellation, retry, idempotency, concurrency, partial failure, atomicity, and observability gaps in the changed behavior.',
        },
        {
            id: 'maintainability',
            displayName: 'Maintainability Reviewer',
            role: 'maintainability',
            color: '#1a7f37',
            enabled: true,
            blocking: { critical: false, high: false },
            prompt: 'Review for unnecessary complexity, duplication, unclear responsibility boundaries, missing tests, and code that will be hard to safely extend.',
        },
        {
            id: 'testability',
            displayName: 'Testability Reviewer',
            role: 'testability',
            color: '#bf8700',
            enabled: true,
            blocking: { critical: false, high: false },
            prompt: 'Review whether the changed behavior has focused tests, meaningful fixtures, failure-path coverage, and seams that allow validation without brittle end-to-end-only checks.',
        },
    ];
}

function parseAgentFile(filePath: string, contents: string): ReviewAgentDefinition {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(contents);
    if (!match) {
        throw new Error(`Agent file ${filePath} must start with YAML-style frontmatter`);
    }

    const frontMatter = parseFrontMatter(match[1], filePath);
    const prompt = match[2].trim();
    const agent: ReviewAgentDefinition = {
        id: requireField(frontMatter, 'id', filePath),
        displayName: requireField(frontMatter, 'displayName', filePath),
        role: parseRole(requireField(frontMatter, 'role', filePath), filePath),
        color: requireField(frontMatter, 'color', filePath),
        enabled: parseBoolean(frontMatter.enabled ?? 'true', 'enabled', filePath),
        blocking: {
            critical: parseBoolean(frontMatter.blockCritical ?? 'false', 'blockCritical', filePath),
            high: parseBoolean(frontMatter.blockHigh ?? 'false', 'blockHigh', filePath),
            medium: parseBoolean(frontMatter.blockMedium ?? 'false', 'blockMedium', filePath),
            low: parseBoolean(frontMatter.blockLow ?? 'false', 'blockLow', filePath),
            info: parseBoolean(frontMatter.blockInfo ?? 'false', 'blockInfo', filePath),
        },
        prompt,
        sourcePath: filePath,
    };

    validateAgent(agent);
    return agent;
}

function parseFrontMatter(frontMatter: string, filePath: string): AgentFrontMatter {
    const fields: AgentFrontMatter = {};
    for (const line of frontMatter.split(/\r?\n/)) {
        if (!line.trim()) {
            continue;
        }
        const separatorIndex = line.indexOf(':');
        if (separatorIndex < 0) {
            throw new Error(`Invalid frontmatter line in ${filePath}: ${line}`);
        }
        const key = line.substring(0, separatorIndex).trim();
        const value = line.substring(separatorIndex + 1).trim();
        fields[key] = stripQuotes(value);
    }
    return fields;
}

function formatAgentFile(agent: ReviewAgentDefinition): string {
    return [
        '---',
        `id: ${agent.id}`,
        `displayName: ${agent.displayName}`,
        `role: ${agent.role}`,
        `color: ${agent.color}`,
        `enabled: ${agent.enabled}`,
        `blockCritical: ${agent.blocking.critical ?? false}`,
        `blockHigh: ${agent.blocking.high ?? false}`,
        `blockMedium: ${agent.blocking.medium ?? false}`,
        `blockLow: ${agent.blocking.low ?? false}`,
        `blockInfo: ${agent.blocking.info ?? false}`,
        '---',
        agent.prompt,
        '',
    ].join('\n');
}

function validateAgents(agents: ReviewAgentDefinition[]): void {
    const seenIds = new Set<string>();
    for (const agent of agents) {
        if (seenIds.has(agent.id)) {
            throw new Error(`Duplicate review agent id: ${agent.id}`);
        }
        seenIds.add(agent.id);
        validateAgent(agent);
    }
}

function validateAgent(agent: ReviewAgentDefinition): void {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(agent.id)) {
        throw new Error(`Invalid review agent id: ${agent.id}`);
    }
    if (!agent.displayName.trim()) {
        throw new Error(`Review agent ${agent.id} must have a displayName`);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(agent.color)) {
        throw new Error(`Review agent ${agent.id} has invalid color ${agent.color}`);
    }
    if (!agent.prompt.trim()) {
        throw new Error(`Review agent ${agent.id} must have prompt text`);
    }
}

function requireField(fields: AgentFrontMatter, field: string, filePath: string): string {
    const value = fields[field];
    if (!value) {
        throw new Error(`Missing ${field} in ${filePath}`);
    }
    return value;
}

function parseRole(value: string, filePath: string): ReviewAgentRole {
    const validRoles: ReviewAgentRole[] = ['security', 'performance', 'architecture', 'reliability', 'maintainability', 'testability', 'custom'];
    if (!validRoles.includes(value as ReviewAgentRole)) {
        throw new Error(`Invalid role ${value} in ${filePath}`);
    }
    return value as ReviewAgentRole;
}

function parseBoolean(value: string, field: string, filePath: string): boolean {
    if (value === 'true') { return true; }
    if (value === 'false') { return false; }
    throw new Error(`Invalid boolean ${field} in ${filePath}: ${value}`);
}

function stripQuotes(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.substring(1, value.length - 1);
    }
    return value;
}
