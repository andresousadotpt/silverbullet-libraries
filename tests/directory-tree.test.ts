import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../plugs/directory-tree/src/tree.ts';

test('buildTree groups nested files and sorts folders before files', () => {
  const tree = buildTree([
    { name: 'z.md' }, { name: 'notes/2026/today.md' }, { name: 'notes/index.md' },
    { name: 'assets/logo.svg' }, { name: 'A.md' },
  ]);
  assert.deepEqual(tree.map(node => [node.kind, node.name]), [
    ['folder', 'assets'], ['folder', 'notes'], ['file', 'A.md'], ['file', 'z.md'],
  ]);
  const notes = tree[1];
  assert.equal(notes.children[0].name, '2026');
  assert.equal(notes.children[0].children[0].path, 'notes/2026/today.md');
});

test('buildTree rejects empty and parent path segments', () => {
  const tree = buildTree([{ name: '' }, { name: '../outside.md' }, { name: 'safe/./note.md' }, { name: 'safe/note.md' }]);
  assert.deepEqual(tree.map(node => node.name), ['safe']);
  assert.deepEqual(tree[0].children.map(node => node.name), ['note.md']);
});
