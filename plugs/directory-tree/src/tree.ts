export type TreeFile = { name: string; contentType?: string };

export type TreeNode = {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  contentType?: string;
  children: TreeNode[];
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Turns SilverBullet's flat file metadata into a deterministic directory tree. */
export function buildTree(files: TreeFile[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] };
  for (const file of files) {
    const parts = file.name.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '.' || part === '..')) continue;
    let parent = root;
    for (const [index, part] of parts.entries()) {
      const path = parts.slice(0, index + 1).join('/');
      const fileNode = index === parts.length - 1;
      let node = parent.children.find(candidate => candidate.name === part && candidate.kind === (fileNode ? 'file' : 'folder'));
      if (!node) {
        node = { name: part, path, kind: fileNode ? 'file' : 'folder', children: [] };
        parent.children.push(node);
      }
      if (fileNode) node.contentType = file.contentType;
      parent = node;
    }
  }
  sortTree(root.children);
  return root.children;
}

function sortTree(nodes: TreeNode[]) {
  nodes.sort((left, right) => left.kind === right.kind
    ? collator.compare(left.name, right.name)
    : left.kind === 'folder' ? -1 : 1);
  for (const node of nodes) sortTree(node.children);
}
