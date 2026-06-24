import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface GitCommandOptions {
    env?: NodeJS.ProcessEnv;
    input?: string;
}

export class ReviewIndexService {
    constructor(private readonly workspaceRoot: string) {}

    async getReviewIndexPath(): Promise<string> {
        const gitPath = (await this.execGit(['rev-parse', '--git-path', 'ai-review/index'])).trim();
        return path.resolve(this.workspaceRoot, gitPath);
    }

    async initialize(baselineRef: string): Promise<void> {
        const indexPath = await this.getReviewIndexPath();
        fs.mkdirSync(path.dirname(indexPath), { recursive: true });
        await this.execGit(['read-tree', '--reset', baselineRef], {
            env: this.createReviewIndexEnvironment(indexPath),
        });
    }

    async hasReviewIndex(): Promise<boolean> {
        return fs.existsSync(await this.getReviewIndexPath());
    }

    async applyPatchToReviewIndex(patch: string): Promise<void> {
        const indexPath = await this.requireReviewIndexPath();
        await this.execGit(['apply', '--cached', '--index'], {
            env: this.createReviewIndexEnvironment(indexPath),
            input: patch,
        });
    }

    async getApprovedDiff(baselineRef: string): Promise<string> {
        const indexPath = await this.requireReviewIndexPath();
        return this.execGit(['diff', '--cached', '--no-ext-diff', '--find-renames', '--unified=3', baselineRef], {
            env: this.createReviewIndexEnvironment(indexPath),
        });
    }

    async getPendingDiff(): Promise<string> {
        const indexPath = await this.requireReviewIndexPath();
        return this.execGit(['diff', '--no-ext-diff', '--find-renames', '--unified=3'], {
            env: this.createReviewIndexEnvironment(indexPath),
        });
    }

    async getWorkingTreeDiff(baselineRef: string): Promise<string> {
        return this.execGit(['diff', '--no-ext-diff', '--find-renames', '--unified=3', baselineRef]);
    }

    private async requireReviewIndexPath(): Promise<string> {
        const indexPath = await this.getReviewIndexPath();
        if (!fs.existsSync(indexPath)) {
            throw new Error('Review index has not been initialized');
        }
        return indexPath;
    }

    private createReviewIndexEnvironment(indexPath: string): NodeJS.ProcessEnv {
        return {
            ...process.env,
            GIT_INDEX_FILE: indexPath,
        };
    }

    private execGit(args: string[], options: GitCommandOptions = {}): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = cp.spawn('git', args, {
                cwd: this.workspaceRoot,
                env: options.env,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';
            const timeout = setTimeout(() => {
                child.kill();
                reject(new Error(`git ${args.join(' ')} timed out`));
            }, 30000);

            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            child.stdout.on('data', chunk => { stdout += chunk; });
            child.stderr.on('data', chunk => { stderr += chunk; });
            child.on('error', error => {
                clearTimeout(timeout);
                reject(error);
            });
            child.on('close', code => {
                clearTimeout(timeout);
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(stderr || `git ${args.join(' ')} exited with code ${code}`));
                }
            });

            child.stdin.end(options.input);
        });
    }
}
