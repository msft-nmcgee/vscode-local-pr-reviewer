import * as vscode from 'vscode';

export interface LocalPr {
    id: string;
    sourceBranch: string;
    targetBranch: string;
    sourceCommit: string;
    targetCommit: string;
    createdAt: string;
    hunkReviews?: ReviewHunkRecord[];
    /**
     * Legacy file-level state retained until the changed-files UI is migrated to
     * hunk-level review records.
     */
    reviewedFiles?: string[];
}

export interface FileChange {
    status: FileChangeStatus;
    filePath: string;
    oldFilePath?: string; // for renames
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export type ReviewDecision = 'pending' | 'approved' | 'question' | 'disputed' | 'stale' | 'resolved';

export interface DiffRange {
    start: number;
    count: number;
}

export interface ReviewHunkRecord {
    hunkId: string;
    filePath: string;
    oldFilePath?: string;
    status: FileChangeStatus;
    oldRange: DiffRange;
    newRange: DiffRange;
    patchHash: string;
    baselineCommit: string;
    targetCommit: string;
    contextBefore?: string;
    contextAfter?: string;
    decision: ReviewDecision;
    comments: ReviewComment[];
    createdAt: string;
    updatedAt: string;
    reviewedAt?: string;
    resolvedAt?: string | null;
}

export interface DiffHunk {
    hunkId: string;
    filePath: string;
    oldFilePath?: string;
    status: FileChangeStatus;
    oldRange: DiffRange;
    newRange: DiffRange;
    patchHash: string;
    patch: string;
    contextBefore?: string;
    contextAfter?: string;
    sourceRef?: string;
    targetRef?: string;
    sourceCommit?: string;
    targetCommit?: string;
    comparesWorkingTree?: boolean;
}

export interface ReviewThread {
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
    state: 'resolved' | 'unresolved';
    comments: ReviewComment[];
}

export interface ReviewComment {
    id: string;
    body: string;
    author: string;
    timestamp: string;
}

export interface CommentsFile {
    version: number;
    sourceBranch: string;
    targetBranch: string;
    sourceCommit: string;
    targetCommit: string;
    threads: ReviewThread[];
}

export interface LocalPrRegistry {
    version: number;
    reviews: LocalPr[];
    activeReviewId?: string;
}

export interface GitApi {
    repositories: GitRepository[];
    onDidOpenRepository: (cb: (repo: GitRepository) => void) => vscode.Disposable;
}

export interface GitRepository {
    rootUri: vscode.Uri;
    state: {
        HEAD?: {
            name?: string;
            commit?: string;
        };
        onDidChange: vscode.Event<void>;
    };
    getBranches(query: { remote?: boolean }): Promise<GitBranch[]>;
}

export interface GitBranch {
    name?: string;
    commit?: string;
    type?: number;
}

export interface CommitInfo {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
    relativeDate: string;
}
