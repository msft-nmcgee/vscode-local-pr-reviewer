import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { GitService } from './git/gitService';
import { GitFileContentProvider } from './git/gitFileContentProvider';
import { LocalPrManager } from './services/localPrManager';
import { StorageService } from './storage/storageService';
import { BranchSelectorWebviewProvider } from './views/branchSelectorWebviewProvider';
import { ChangedFilesProvider, FileChangeItem, HunkReviewItem } from './views/changedFilesProvider';
import { LocalPrsProvider, LocalPrItem } from './views/localPrsProvider';
import { LocalCommentsProvider, CommentFileItem } from './views/localCommentsProvider';
import { ReviewCommentController } from './comments/commentController';
import { LocalReviewTool } from './tools/localReviewTool';
import { ReviewFileDecorationProvider } from './decorations/fileDecorationProvider';
import { SuggestChangePanel } from './views/suggestChangePanel';
import { ReviewDecision, ReviewHunkRecord } from './types';
import { AiReviewStorageService, AiReviewSessionFile } from './storage/aiReviewStorageService';

export async function activate(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showInformationMessage('Local PR Review: Open a Git repository folder to use this extension.');
        return;
    }

    // Initialize git service
    const gitService = new GitService(context);

    // Initialize services (will work once git is ready)
    const localPrManager = new LocalPrManager(gitService, workspaceRoot);
    const storageService = new StorageService(localPrManager);
    const aiReviewStorageService = new AiReviewStorageService(workspaceRoot);

    // Register custom URI scheme for git file content
    const gitFileContentProvider = new GitFileContentProvider(gitService);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('git-local-review', gitFileContentProvider)
    );

    // Initialize view providers
    const branchSelectorProvider = new BranchSelectorWebviewProvider(
        context.extensionUri, gitService, localPrManager
    );
    const changedFilesProvider = new ChangedFilesProvider(gitService, storageService, localPrManager);
    const localPrsProvider = new LocalPrsProvider(localPrManager);
    const localCommentsProvider = new LocalCommentsProvider(storageService);

    // Initialize comment controller
    const commentController = new ReviewCommentController(storageService);

    // Initialize file decoration provider (shows unresolved comment badges in explorer)
    const fileDecorationProvider = new ReviewFileDecorationProvider(storageService);
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(fileDecorationProvider)
    );

    // Register Copilot Language Model Tool (optional — requires VS Code 1.93+ and Copilot)
    try {
        const localReviewTool = new LocalReviewTool(gitService, localPrManager, storageService);
        context.subscriptions.push(
            vscode.lm.registerTool('localPrReview_getComments', localReviewTool)
        );
    } catch {
        // Language Model API unavailable — extension works without it
    }

    // Register views
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            BranchSelectorWebviewProvider.viewType,
            branchSelectorProvider
        ),
    );

    // Changed files tree view with checkbox support
    const selectedHunkDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        isWholeLine: true,
        overviewRulerColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    context.subscriptions.push(selectedHunkDecoration);

    const changedFilesTreeView = vscode.window.createTreeView('localPrReview.changedFiles', {
        treeDataProvider: changedFilesProvider,
        manageCheckboxStateManually: true,
        showCollapseAll: true,
    });
    changedFilesTreeView.onDidChangeCheckboxState(e => {
        for (const [item, state] of e.items) {
            if (item instanceof FileChangeItem) {
                changedFilesProvider.setFileReviewed(
                    item.fileChange.filePath,
                    state === vscode.TreeItemCheckboxState.Checked
                );
                writeAiReviewArtifacts();
            }
        }
    });

    context.subscriptions.push(
        changedFilesTreeView,
        vscode.window.createTreeView('localPrReview.localPrs', {
            treeDataProvider: localPrsProvider,
        }),
        vscode.window.createTreeView('localPrReview.localComments', {
            treeDataProvider: localCommentsProvider,
        })
    );

    // Initialize git asynchronously (after tree views are registered)
    const initialized = await gitService.initialize();
    if (!initialized) {
        vscode.window.showInformationMessage('Local PR Review: No git repository found. Open a folder with a git repo.');
    }

    // Sync the list of reviewable file paths so comments work on working-tree files
    const syncReviewableFiles = () => {
        commentController.setReviewableFiles(changedFilesProvider.getAllFilePaths());
    };

    // Load active review on startup
    if (initialized) {
        const activeReview = localPrManager.getActiveReview();
        if (activeReview) {
            await changedFilesProvider.refresh(activeReview.sourceBranch, activeReview.targetBranch);
            writeAiReviewArtifacts();
            syncReviewableFiles();
            await commentController.loadAllThreads(gitService, activeReview.sourceBranch, activeReview.targetBranch);
        }
    }

    // Helper: auto-create review and refresh files when both branches are selected
    const autoRefreshFiles = async (base: string, compare: string) => {
        if (base && compare && base !== compare) {
            await localPrManager.createReview(base, compare);
            await changedFilesProvider.refresh(base, compare);
            writeAiReviewArtifacts();
            syncReviewableFiles();
            localCommentsProvider.refresh();
            await commentController.loadAllThreads(gitService, base, compare);
            fileDecorationProvider.refresh();
        }
    };

    // Auto-refresh changed files on save when comparing against the working tree
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async () => {
            const active = localPrManager.getActiveReview();
            if (!active) { return; }
            const isWorkingTree = await gitService.isCurrentBranch(active.targetBranch);
            if (!isWorkingTree) { return; }
            // Debounce to avoid rapid successive refreshes
            if (refreshTimer) { clearTimeout(refreshTimer); }
            refreshTimer = setTimeout(async () => {
                await changedFilesProvider.refresh(active.sourceBranch, active.targetBranch);
                writeAiReviewArtifacts();
                syncReviewableFiles();
            }, 500);
        })
    );

    // Listen for branch selection from webview
    context.subscriptions.push(
        branchSelectorProvider.onDidSelectBranches(async ({ base, compare }) => {
            await autoRefreshFiles(base, compare);
        })
    );

    // Auto-update compare branch when user switches git branches
    context.subscriptions.push(
        gitService.onDidChangeBranch(async (newBranch) => {
            const base = branchSelectorProvider.getSourceBranch();
            if (base && newBranch !== base) {
                branchSelectorProvider.setTargetBranch(newBranch);
                await autoRefreshFiles(base, newBranch);
            }
        })
    );

    // Auto-refresh when new commits are made on the current branch
    context.subscriptions.push(
        gitService.onDidChangeHead(async () => {
            const active = localPrManager.getActiveReview();
            if (!active) { return; }
            await changedFilesProvider.refresh(active.sourceBranch, active.targetBranch);
            writeAiReviewArtifacts();
            syncReviewableFiles();
            fileDecorationProvider.refresh();
        })
    );

    // --- Register commands ---

    // Create review
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.createReview', async () => {
            const source = branchSelectorProvider.getSourceBranch();
            const target = branchSelectorProvider.getTargetBranch();

            if (!source) {
                vscode.window.showWarningMessage('Please select a base branch first');
                return;
            }
            if (!target) {
                vscode.window.showWarningMessage('Please select a compare branch first');
                return;
            }
            if (source === target) {
                vscode.window.showWarningMessage('Base and compare branches must be different');
                return;
            }

            const review = await localPrManager.createReview(source, target);
            await changedFilesProvider.refresh(source, target);
            writeAiReviewArtifacts();
            syncReviewableFiles();
            localCommentsProvider.refresh();
            vscode.window.showInformationMessage(`Review created: ${target} -> ${source}`);
        })
    );

    // Activate review (click on Local PR)
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.activateReview', async (item: LocalPrItem) => {
            localPrManager.setActiveReview(item.review.id);
            branchSelectorProvider.refresh();
            await changedFilesProvider.refresh(item.review.sourceBranch, item.review.targetBranch);
            writeAiReviewArtifacts();
            syncReviewableFiles();
            localCommentsProvider.refresh();
            await commentController.loadAllThreads(gitService, item.review.sourceBranch, item.review.targetBranch);
        })
    );

    // Delete review
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.deleteReview', async (item: LocalPrItem) => {
            const answer = await vscode.window.showWarningMessage(
                `Delete review "${item.review.targetBranch} -> ${item.review.sourceBranch}"? This will also delete all comments.`,
                { modal: true },
                'Delete'
            );
            if (answer === 'Delete') {
                localPrManager.deleteReview(item.review.id);
                changedFilesProvider.clear();
                commentController.setReviewableFiles([]);
                localCommentsProvider.refresh();
                branchSelectorProvider.refresh();
                await commentController.loadAllThreads();
            }
        })
    );

    // Refresh changed files
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.refreshFiles', async () => {
            const active = localPrManager.getActiveReview();
            if (active) {
                await changedFilesProvider.refresh(active.sourceBranch, active.targetBranch);
                writeAiReviewArtifacts();
                syncReviewableFiles();
            }
        })
    );

    // Expand all in changed files tree
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.expandAll', async () => {
            const items = changedFilesProvider.getAllExpandableItems();
            for (const item of items) {
                try {
                    await changedFilesTreeView.reveal(item, { expand: true, select: false, focus: false });
                } catch {
                    // item may not be visible
                }
            }
        })
    );

    // Open file (working copy)
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.openFile', async (item: FileChangeItem) => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (workspaceRoot) {
                const fileUri = vscode.Uri.joinPath(workspaceRoot, item.fileChange.filePath);
                await vscode.window.showTextDocument(fileUri);
            }
        })
    );

    // Open diff
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.openDiff', async (item: FileChangeItem) => {
            await openReviewDiff(item.fileChange.filePath, item.sourceBranch, item.targetBranch);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.openHunk', async (item: HunkReviewItem) => {
            await openReviewDiff(item.hunk.filePath, item.sourceBranch, item.targetBranch, item.hunk);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.approveHunk', async (item: HunkReviewItem) => {
            await updateHunkDecision(item, 'approved');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.questionHunk', async (item: HunkReviewItem) => {
            await updateHunkDecision(item, 'question');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.disputeHunk', async (item: HunkReviewItem) => {
            await updateHunkDecision(item, 'disputed');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.revertHunk', async (item: HunkReviewItem) => {
            await revertHunk(item);
        })
    );

    async function openReviewDiff(
        filePath: string,
        sourceBranch: string,
        targetBranch: string,
        hunk?: ReviewHunkRecord
    ): Promise<void> {
        const leftUri = vscode.Uri.parse(
            `git-local-review://authority/${filePath}?ref=${encodeURIComponent(sourceBranch)}`
        );

        // If compare branch is the current branch, show working tree file instead of committed version
        const isWorkingTree = await gitService.isCurrentBranch(targetBranch);
        const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
        const rightUri = isWorkingTree && workspaceUri
            ? vscode.Uri.joinPath(workspaceUri, filePath)
            : vscode.Uri.parse(
                `git-local-review://authority/${filePath}?ref=${encodeURIComponent(targetBranch)}`
            );

        const title = `${filePath} (${sourceBranch} <-> ${targetBranch})`;

        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

        // Load comments for this file on both sides of the diff
        commentController.loadThreadsForFile(leftUri, filePath);
        commentController.loadThreadsForFile(rightUri, filePath);

        if (hunk) {
            await revealHunk(rightUri, hunk);
        }
    }

    async function revealHunk(uri: vscode.Uri, hunk: ReviewHunkRecord): Promise<void> {
        const editor = await waitForEditor(uri);
        if (!editor) { return; }

        const startLine = Math.max(hunk.newRange.start - 1, 0);
        const endLine = Math.max(startLine, startLine + Math.max(hunk.newRange.count - 1, 0));
        const range = new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        editor.selection = new vscode.Selection(startLine, 0, startLine, 0);
        editor.setDecorations(selectedHunkDecoration, [range]);
    }

    async function waitForEditor(uri: vscode.Uri): Promise<vscode.TextEditor | undefined> {
        const target = uri.toString();
        for (let attempt = 0; attempt < 10; attempt++) {
            const editor = vscode.window.visibleTextEditors.find(candidate => candidate.document.uri.toString() === target);
            if (editor) {
                return editor;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return undefined;
    }

    async function updateHunkDecision(item: HunkReviewItem, decision: ReviewDecision): Promise<void> {
        const hunk = await buildUpdatedHunk(item.hunk, decision);
        if (!hunk) { return; }

        localPrManager.upsertHunkReview(hunk);
        await changedFilesProvider.refresh(item.sourceBranch, item.targetBranch);
        aiReviewStorageService.appendLedgerEvent({
            reviewId: localPrManager.getActiveReview()?.id || 'unknown-review',
            timestamp: hunk.updatedAt,
            type: 'hunk-decision',
            hunkId: hunk.hunkId,
            decision,
            filePath: hunk.filePath,
        });
        writeAiReviewArtifacts();
        vscode.window.showInformationMessage(`Marked hunk ${hunk.hunkId} as ${decision}.`);
    }

    async function revertHunk(item: HunkReviewItem): Promise<void> {
        const isWorkingTree = await gitService.isCurrentBranch(item.targetBranch);
        if (!isWorkingTree) {
            vscode.window.showWarningMessage('Hunk revert is only available when the compare branch is the current working tree.');
            return;
        }
        if (!item.hunk.patch) {
            vscode.window.showWarningMessage('Cannot revert this hunk because its patch text is unavailable.');
            return;
        }

        const answer = await vscode.window.showWarningMessage(
            `Revert ${item.hunk.filePath}:${item.hunk.newRange.start}?`,
            { modal: true },
            'Revert Hunk'
        );
        if (answer !== 'Revert Hunk') { return; }

        await gitService.reverseApplyPatch(item.hunk.patch);
        await changedFilesProvider.refresh(item.sourceBranch, item.targetBranch);
        writeAiReviewArtifacts();
        vscode.window.showInformationMessage(`Reverted hunk ${item.hunk.hunkId}.`);
    }

    async function buildUpdatedHunk(hunk: ReviewHunkRecord, decision: ReviewDecision): Promise<ReviewHunkRecord | undefined> {
        const timestamp = new Date().toISOString();
        const comments = [...hunk.comments];

        if (decision === 'question' || decision === 'disputed') {
            const prompt = decision === 'question'
                ? 'Question for this hunk'
                : 'Reason this hunk is disputed';
            const body = await vscode.window.showInputBox({
                prompt,
                ignoreFocusOut: true,
            });
            if (!body) {
                return undefined;
            }
            comments.push({
                id: crypto.randomUUID(),
                body,
                author: process.env.USERNAME || process.env.USER || 'reviewer',
                timestamp,
            });
        }

        return {
            ...hunk,
            decision,
            comments,
            updatedAt: timestamp,
            reviewedAt: decision === 'approved' || decision === 'question' || decision === 'disputed'
                ? timestamp
                : hunk.reviewedAt,
            resolvedAt: decision === 'resolved' ? timestamp : hunk.resolvedAt,
        };
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.generateActiveFeedback', () => {
            writeAiReviewArtifacts();
            vscode.window.showInformationMessage(`Generated ${aiReviewStorageService.getActiveFeedbackPath()}.`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.copyReconciliationPrompt', async () => {
            writeAiReviewArtifacts();
            const prompt = [
                'Read .ai-review/active-feedback.md and reconcile every disputed item.',
                'For questions, provide a direct answer before making speculative changes.',
                'Run the relevant tests, then report results by hunk ID.',
                'Do not modify .ai-review files.',
            ].join('\n');
            await vscode.env.clipboard.writeText(prompt);
            vscode.window.showInformationMessage('Copied Copilot reconciliation prompt.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.validateReview', () => {
            writeAiReviewArtifacts();
            const findings = validateActiveReview();
            if (findings.length === 0) {
                vscode.window.showInformationMessage('Review validation passed.');
                return;
            }
            vscode.window.showWarningMessage(`Review validation found ${findings.length} issue(s): ${findings.join('; ')}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.completeSession', () => {
            writeAiReviewArtifacts();
            const findings = validateActiveReview();
            if (findings.length > 0) {
                vscode.window.showWarningMessage(`Review is not complete: ${findings.join('; ')}`);
                return;
            }
            vscode.window.showInformationMessage('Review session complete. No pending, disputed, or stale hunks remain.');
        })
    );

    function writeAiReviewArtifacts(): void {
        const review = localPrManager.getActiveReview();
        if (!review) { return; }

        const hunks = changedFilesProvider.getHunkReviews();
        const timestamp = new Date().toISOString();
        const session: AiReviewSessionFile = {
            version: 1,
            reviewId: review.id,
            sourceBranch: review.sourceBranch,
            targetBranch: review.targetBranch,
            baselineCommit: review.sourceCommit,
            targetCommit: review.targetCommit,
            createdAt: review.createdAt,
            updatedAt: timestamp,
            hunkIds: hunks.map(hunk => hunk.hunkId),
        };

        aiReviewStorageService.writeSession(session);
        aiReviewStorageService.writeActiveFeedback({
            reviewId: review.id,
            baselineCommit: review.sourceCommit,
            generatedAt: timestamp,
            hunks,
        });
    }

    function validateActiveReview(): string[] {
        const hunks = changedFilesProvider.getHunkReviews();
        const pending = hunks.filter(hunk => hunk.decision === 'pending');
        const disputed = hunks.filter(hunk => hunk.decision === 'disputed');
        const stale = hunks.filter(hunk => hunk.decision === 'stale');
        const findings: string[] = [];
        if (pending.length > 0) {
            findings.push(`${pending.length} pending hunk${pending.length === 1 ? '' : 's'}`);
        }
        if (disputed.length > 0) {
            findings.push(`${disputed.length} disputed hunk${disputed.length === 1 ? '' : 's'}`);
        }
        if (stale.length > 0) {
            findings.push(`${stale.length} stale approval${stale.length === 1 ? '' : 's'}`);
        }
        return findings;
    }

    // Comment commands
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.addComment', (reply: vscode.CommentReply) => {
            try {
                const thread = reply.thread;
                const filePath = extractFilePath(thread.uri);

                if (thread.comments.length === 0) {
                    commentController.createThread(
                        thread.uri,
                        thread.range!,
                        reply.text,
                        filePath,
                        thread
                    );
                } else {
                    commentController.addReply(thread, reply.text);
                }
                localCommentsProvider.refresh();
                fileDecorationProvider.refresh();
                changedFilesProvider.fireChange();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to add comment: ${err.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.saveComment', (reply: vscode.CommentReply) => {
            try {
                const thread = reply.thread;
                const filePath = extractFilePath(thread.uri);

                if (thread.comments.length === 0) {
                    commentController.createThread(
                        thread.uri,
                        thread.range!,
                        reply.text,
                        filePath,
                        thread
                    );
                } else {
                    commentController.addReply(thread, reply.text);
                }
                localCommentsProvider.refresh();
                fileDecorationProvider.refresh();
                changedFilesProvider.fireChange();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to save comment: ${err.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.cancelComment', (reply: vscode.CommentReply) => {
            if (reply.thread.comments.length === 0) {
                reply.thread.dispose();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.resolveThread', (thread: vscode.CommentThread) => {
            if (thread.state === vscode.CommentThreadState.Unresolved) {
                commentController.resolveThread(thread);
            } else {
                commentController.unresolveThread(thread);
            }
            localCommentsProvider.refresh();
            fileDecorationProvider.refresh();
            changedFilesProvider.fireChange();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.unresolveThread', (thread: vscode.CommentThread) => {
            commentController.unresolveThread(thread);
            localCommentsProvider.refresh();
            fileDecorationProvider.refresh();
            changedFilesProvider.fireChange();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.editComment', (comment: vscode.Comment) => {
            // Toggle to editing mode
            (comment as any).mode = vscode.CommentMode.Editing;
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.deleteComment', (comment: vscode.Comment & { thread?: vscode.CommentThread }) => {
            // For comments/comment/title, VS Code may pass comment with parent reference
            // We need to find the thread from our controller
            const thread = comment.thread || commentController.findThreadForComment(comment);
            if (!thread) { return; }

            vscode.window.showWarningMessage('Delete this comment?', 'Delete', 'Cancel')
                .then(answer => {
                    if (answer === 'Delete') {
                        commentController.deleteComment(thread, comment);
                        localCommentsProvider.refresh();
                        fileDecorationProvider.refresh();
                        changedFilesProvider.fireChange();
                    }
                });
        })
    );

    // Refresh commands for Local PRs and Local Comments
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.refreshPrs', () => {
            localPrsProvider.refresh();
        }),
        vscode.commands.registerCommand('localPrReview.refreshComments', () => {
            localCommentsProvider.refresh();
        })
    );

    // Open all changed files in a multi-diff editor
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.openAllDiffs', async () => {
            const allFiles = changedFilesProvider.getAllFileItems();
            if (allFiles.length === 0) {
                vscode.window.showInformationMessage('No changed files to show. Select branches first.');
                return;
            }

            const { source, target } = changedFilesProvider.getBranches();
            const isWorkingTree = await gitService.isCurrentBranch(target);
            const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;

            const resources = allFiles.map(item => {
                const original = vscode.Uri.parse(
                    `git-local-review://authority/${item.fileChange.filePath}?ref=${encodeURIComponent(source)}`
                );
                const modified = isWorkingTree && workspaceUri
                    ? vscode.Uri.joinPath(workspaceUri, item.fileChange.filePath)
                    : vscode.Uri.parse(
                        `git-local-review://authority/${item.fileChange.filePath}?ref=${encodeURIComponent(target)}`
                    );
                return [original, modified, undefined] as [vscode.Uri, vscode.Uri, undefined];
            });

            try {
                await vscode.commands.executeCommand(
                    'vscode.changes',
                    `Review: ${source} <-> ${target}`,
                    resources
                );
            } catch (err: any) {
                const msg = err?.message ?? String(err);
                vscode.window.showErrorMessage(`Multi-diff editor failed: ${msg}`);
            }
        })
    );

    // Suggest a Change — compose a diff suggestion as an inline comment
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.suggestChange', async (reply: vscode.CommentReply) => {
            try {
                const thread = reply.thread;
                const range = thread.range;
                if (!range) {
                    vscode.window.showWarningMessage('Please select a line range in the diff to suggest a change.');
                    return;
                }
                const doc = await vscode.workspace.openTextDocument(thread.uri);
                const filePath = extractFilePath(thread.uri);

                // Get the full lines covered by the selection
                const normalizedRange = new vscode.Range(
                    range.start.line, 0,
                    range.end.line, doc.lineAt(range.end.line).text.length
                );
                const originalCode = doc.getText(normalizedRange);

                const commentBody = await SuggestChangePanel.show(context.extensionUri, originalCode, filePath);

                if (commentBody === undefined) {
                    // User cancelled — dispose empty thread
                    if (thread.comments.length === 0) {
                        thread.dispose();
                    }
                    return;
                }

                if (thread.comments.length === 0) {
                    commentController.createThread(thread.uri, range, commentBody, filePath);
                    thread.dispose();
                } else {
                    commentController.addReply(thread, commentBody);
                }
                localCommentsProvider.refresh();
                fileDecorationProvider.refresh();
                changedFilesProvider.fireChange();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to add suggestion: ${err.message}`);
            }
        })
    );

    // Delete comments file
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.deleteCommentsFile', async (item: CommentFileItem) => {
            const answer = await vscode.window.showWarningMessage(
                'Delete all comments for this review?',
                { modal: true },
                'Delete'
            );
            if (answer === 'Delete') {
                const fs = await import('fs');
                const path = await import('path');
                if (fs.existsSync(item.filePath)) {
                    fs.unlinkSync(item.filePath);
                    const dir = path.dirname(item.filePath);
                    const remaining = fs.readdirSync(dir);
                    if (remaining.length === 0) {
                        fs.rmdirSync(dir);
                    }
                }
                localCommentsProvider.refresh();
                await commentController.loadAllThreads();
                fileDecorationProvider.refresh();
            }
        })
    );

    // Disposables
    context.subscriptions.push(
        branchSelectorProvider,
        changedFilesProvider,
        localPrsProvider,
        localCommentsProvider,
        commentController,
        gitFileContentProvider,
        fileDecorationProvider,
        { dispose: () => localPrManager.dispose() }
    );
}

function extractFilePath(uri: vscode.Uri): string {
    if (uri.scheme === 'file') {
        return vscode.workspace.asRelativePath(uri, false);
    }
    const path = uri.path;
    return path.startsWith('/') ? path.slice(1) : path;
}

export function deactivate() {}
