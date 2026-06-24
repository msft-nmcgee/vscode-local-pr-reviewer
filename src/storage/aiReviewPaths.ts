import * as fs from 'fs';
import * as path from 'path';

export function resolveGitLocalReviewDir(workspaceRoot: string): string {
    const dotGitPath = path.join(workspaceRoot, '.git');
    if (fs.existsSync(dotGitPath) && fs.statSync(dotGitPath).isDirectory()) {
        return path.join(dotGitPath, 'ai-review');
    }

    if (fs.existsSync(dotGitPath) && fs.statSync(dotGitPath).isFile()) {
        const gitFile = fs.readFileSync(dotGitPath, 'utf8').trim();
        const match = /^gitdir:\s*(.+)$/i.exec(gitFile);
        if (match) {
            const gitDir = path.isAbsolute(match[1])
                ? match[1]
                : path.resolve(workspaceRoot, match[1]);
            return path.join(gitDir, 'ai-review');
        }
    }

    return path.join(dotGitPath, 'ai-review');
}

export function migrateLegacyWorkspaceReviewDir(workspaceRoot: string): void {
    const legacyReviewDir = path.join(workspaceRoot, '.ai-review');
    if (!fs.existsSync(legacyReviewDir)) {
        return;
    }

    const gitLocalReviewDir = resolveGitLocalReviewDir(workspaceRoot);
    fs.mkdirSync(gitLocalReviewDir, { recursive: true });
    for (const entry of fs.readdirSync(legacyReviewDir, { withFileTypes: true })) {
        const sourcePath = path.join(legacyReviewDir, entry.name);
        const destinationPath = path.join(gitLocalReviewDir, entry.name);
        if (!fs.existsSync(destinationPath)) {
            fs.renameSync(sourcePath, destinationPath);
            continue;
        }

        if (entry.isDirectory()) {
            mergeDirectory(sourcePath, destinationPath);
        } else {
            fs.rmSync(sourcePath, { force: true });
        }
    }

    fs.rmSync(legacyReviewDir, { recursive: true, force: true });
}

export function resolveLocalReviewsDir(workspaceRoot: string): string {
    return path.join(resolveGitLocalReviewDir(workspaceRoot), 'local-reviews');
}

export function resolveReviewBoardDir(workspaceRoot: string): string {
    return path.join(resolveGitLocalReviewDir(workspaceRoot), 'agents');
}

export function migrateLegacyWorkspaceLocalReviewsDir(workspaceRoot: string): void {
    const legacyReviewsDir = path.join(workspaceRoot, '.vscode', 'local-reviews');
    if (!fs.existsSync(legacyReviewsDir)) {
        return;
    }

    mergeDirectory(legacyReviewsDir, resolveLocalReviewsDir(workspaceRoot));

    const legacyVscodeDir = path.dirname(legacyReviewsDir);
    if (fs.existsSync(legacyVscodeDir) && fs.readdirSync(legacyVscodeDir).length === 0) {
        fs.rmdirSync(legacyVscodeDir);
    }
}

export function migrateLegacyWorkspaceReviewBoardDir(workspaceRoot: string): void {
    const legacyBoardDir = path.join(workspaceRoot, '.ai-review-agents');
    if (!fs.existsSync(legacyBoardDir)) {
        return;
    }

    mergeDirectory(legacyBoardDir, resolveReviewBoardDir(workspaceRoot));
}

function mergeDirectory(sourceDir: string, destinationDir: string): void {
    fs.mkdirSync(destinationDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const destinationPath = path.join(destinationDir, entry.name);
        if (entry.isDirectory()) {
            mergeDirectory(sourcePath, destinationPath);
        } else if (!fs.existsSync(destinationPath)) {
            fs.renameSync(sourcePath, destinationPath);
        } else {
            fs.rmSync(sourcePath, { force: true });
        }
    }
    fs.rmSync(sourceDir, { recursive: true, force: true });
}
