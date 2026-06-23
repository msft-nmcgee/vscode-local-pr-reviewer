import * as crypto from 'crypto';
import { DiffHunk, DiffRange, FileChangeStatus } from '../types';

interface FileDiffState {
    filePath: string;
    oldFilePath?: string;
    status: FileChangeStatus;
}

export function parseDiffHunks(diffText: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const lines = diffText.replace(/\r\n/g, '\n').split('\n');
    let currentFile: FileDiffState | undefined;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];

        if (line.startsWith('diff --git ')) {
            currentFile = parseDiffHeader(line);
            continue;
        }

        if (!currentFile) {
            continue;
        }

        if (line.startsWith('new file mode ')) {
            currentFile.status = 'added';
            continue;
        }

        if (line.startsWith('deleted file mode ')) {
            currentFile.status = 'deleted';
            continue;
        }

        if (line.startsWith('rename from ')) {
            currentFile.status = 'renamed';
            currentFile.oldFilePath = line.substring('rename from '.length);
            continue;
        }

        if (line.startsWith('rename to ')) {
            currentFile.status = 'renamed';
            currentFile.filePath = line.substring('rename to '.length);
            continue;
        }

        if (line.startsWith('@@ ')) {
            const hunkHeader = parseHunkHeader(line);
            const patchLines = [line];
            index++;
            while (index < lines.length && !lines[index].startsWith('diff --git ') && !lines[index].startsWith('@@ ')) {
                patchLines.push(lines[index]);
                index++;
            }
            index--;

            hunks.push(createDiffHunk(currentFile, hunkHeader, patchLines));
        }
    }

    return hunks;
}

function parseDiffHeader(line: string): FileDiffState {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (!match) {
        throw new Error(`Unsupported diff header: ${line}`);
    }

    return {
        filePath: match[2],
        status: 'modified',
    };
}

function parseHunkHeader(line: string): { oldRange: DiffRange; newRange: DiffRange } {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) {
        throw new Error(`Unsupported hunk header: ${line}`);
    }

    return {
        oldRange: {
            start: Number(match[1]),
            count: match[2] === undefined ? 1 : Number(match[2]),
        },
        newRange: {
            start: Number(match[3]),
            count: match[4] === undefined ? 1 : Number(match[4]),
        },
    };
}

function createDiffHunk(
    file: FileDiffState,
    hunkHeader: { oldRange: DiffRange; newRange: DiffRange },
    patchLines: string[],
): DiffHunk {
    const patch = patchLines.join('\n');
    const normalizedPatch = normalizePatchForHash(patchLines);
    const patchHash = toSha256(normalizedPatch);
    const hunkId = toSha256(`${file.filePath}\n${file.oldFilePath || ''}\n${file.status}\n${patchHash}`);
    const contextLines = patchLines
        .slice(1)
        .filter(line => line.startsWith(' '))
        .map(line => line.substring(1).trim())
        .filter(line => line.length > 0);

    return {
        hunkId: `sha256:${hunkId}`,
        filePath: file.filePath,
        oldFilePath: file.oldFilePath,
        status: file.status,
        oldRange: hunkHeader.oldRange,
        newRange: hunkHeader.newRange,
        patchHash: `sha256:${patchHash}`,
        patch,
        contextBefore: contextLines[0],
        contextAfter: contextLines.length > 1 ? contextLines[contextLines.length - 1] : undefined,
    };
}

function normalizePatchForHash(patchLines: string[]): string {
    return patchLines
        .map(line => line.startsWith('@@ ') ? '@@' : line)
        .join('\n');
}

function toSha256(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
