import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDiffHunks } from './diffParser';

describe('parseDiffHunks', () => {
    it('parses modified hunks with ranges, context, and stable content hashes', () => {
        const hunks = parseDiffHunks(`diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -10,4 +10,5 @@ export function example() {
     const before = true;
-    return before;
+    const after = true;
+    return after;
 }
`);

        assert.equal(hunks.length, 1);
        assert.equal(hunks[0].filePath, 'src/example.ts');
        assert.equal(hunks[0].status, 'modified');
        assert.deepEqual(hunks[0].oldRange, { start: 10, count: 4 });
        assert.deepEqual(hunks[0].newRange, { start: 10, count: 5 });
        assert.match(hunks[0].hunkId, /^sha256:[a-f0-9]{64}$/);
        assert.match(hunks[0].patchHash, /^sha256:[a-f0-9]{64}$/);
        assert.equal(hunks[0].contextBefore, 'const before = true;');
        assert.equal(hunks[0].contextAfter, '}');

        const movedHunk = parseDiffHunks(`diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -20,4 +20,5 @@ export function example() {
     const before = true;
-    return before;
+    const after = true;
+    return after;
 }
`);

        assert.equal(movedHunk[0].patchHash, hunks[0].patchHash);
        assert.equal(movedHunk[0].hunkId, hunks[0].hunkId);
    });

    it('parses added, deleted, and renamed file hunks', () => {
        const hunks = parseDiffHunks(`diff --git a/src/added.ts b/src/added.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/added.ts
@@ -0,0 +1,2 @@
+export const added = true;
+export const value = 1;
diff --git a/src/deleted.ts b/src/deleted.ts
deleted file mode 100644
index 1111111..0000000
--- a/src/deleted.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const deleted = true;
-export const value = 1;
diff --git a/src/old.ts b/src/new.ts
similarity index 88%
rename from src/old.ts
rename to src/new.ts
index 1111111..2222222 100644
--- a/src/old.ts
+++ b/src/new.ts
@@ -1 +1 @@
-export const name = 'old';
+export const name = 'new';
`);

        assert.equal(hunks.length, 3);
        assert.equal(hunks[0].status, 'added');
        assert.equal(hunks[0].filePath, 'src/added.ts');
        assert.equal(hunks[1].status, 'deleted');
        assert.equal(hunks[1].filePath, 'src/deleted.ts');
        assert.equal(hunks[2].status, 'renamed');
        assert.equal(hunks[2].oldFilePath, 'src/old.ts');
        assert.equal(hunks[2].filePath, 'src/new.ts');
    });
});
