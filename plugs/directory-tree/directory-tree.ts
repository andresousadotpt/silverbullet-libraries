import { syscall } from '@silverbulletmd/silverbullet/syscall';
import { buildTree, type TreeNode } from './src/tree.ts';

type Panel = 'lhs' | 'bhs';
type FileMeta = { name: string; contentType?: string };

let visible = true;
let panel: Panel | undefined;
const sizeKey = 'directory-tree:size';
const defaultSize = 1;
const minimumSize = 0.35;
const maximumSize = 2;

export async function showTree() {
  visible = true;
  const [files, currentPath, mobile] = await Promise.all([
    syscall('space.listFiles') as Promise<FileMeta[]>,
    syscall('editor.getCurrentPath') as Promise<string>,
    syscall('editor.isMobile') as Promise<boolean>,
  ]);
  const nextPanel: Panel = mobile ? 'bhs' : 'lhs';
  if (panel && panel !== nextPanel) await syscall('editor.hidePanel', panel);
  panel = nextPanel;
  const model = { nodes: buildTree(files), currentPath: String(currentPath) };
  await syscall('editor.showPanel', nextPanel, await panelSize(), await panelHtml(), panelScript(model));
}

// The tree starts visible when the plug worker initializes. After a user hides
// it, file/page events must refresh it only when it has been explicitly shown.
export async function showTreeIfVisible() {
  if (visible) await showTree();
}

export async function refreshTree() {
  if (visible) await showTree();
}

export async function hideTree() {
  visible = false;
  if (panel) await syscall('editor.hidePanel', panel);
  panel = undefined;
}

export async function toggleTree() {
  if (visible) await hideTree();
  else await showTree();
}

async function panelSize() {
  try {
    const value = await syscall('clientStore.get', sizeKey);
    return typeof value === 'number' && Number.isFinite(value) && value >= minimumSize && value <= maximumSize
      ? value
      : defaultSize;
  } catch { return defaultSize; }
}

async function panelHtml() {
  // The public UI barrel in SilverBullet 2.10 references optional Preact
  // components that are not present in its npm package. This is the small,
  // documented panelStyles equivalent without importing that barrel.
  const customStyles = await syscall('editor.getUiOption', 'customStyles');
  const themeStyles = typeof customStyles === 'string' ? customStyles : '';
  return `<link rel="stylesheet" href=".client/components.css">${themeStyles}<style>
    :root { color-scheme: light dark; block-size: 100%; }
    body { block-size: 100%; margin: 0; background: var(--root-background-color, Canvas); color: var(--root-color, CanvasText); font: 14px/1.4 var(--ui-font, system-ui, sans-serif); }
    .directory-tree { display: flex; flex-direction: column; block-size: 100%; min-block-size: 0; min-inline-size: 0; }
    .directory-tree__header { display: flex; gap: .4rem; align-items: center; padding: .55rem; border-bottom: 1px solid var(--top-border-color, color-mix(in srgb, CanvasText 20%, Canvas)); }
    .directory-tree__title { font-weight: 650; white-space: nowrap; }
    .directory-tree__search { min-inline-size: 0; flex: 1; }
    .directory-tree__items { overflow: auto; padding: .35rem .25rem 1rem; }
    .directory-tree__branch { margin: 0; padding-inline-start: 1rem; list-style: none; }
    .directory-tree__folder > summary { cursor: pointer; border-radius: .25rem; padding: .14rem .25rem; }
    .directory-tree__folder > summary:hover, .directory-tree__folder > summary:focus-visible { background: var(--subtle-background-color, color-mix(in srgb, CanvasText 12%, Canvas)); color: var(--root-color, CanvasText); outline: none; }
    .directory-tree__file { box-sizing: border-box; display: block; width: 100%; border: 0; border-radius: .25rem; background: none; color: inherit; cursor: pointer; overflow: hidden; padding: .16rem .35rem; text-align: start; text-overflow: ellipsis; white-space: nowrap; }
    .directory-tree__file:hover, .directory-tree__file:focus-visible { background: var(--subtle-background-color, color-mix(in srgb, CanvasText 12%, Canvas)); color: var(--root-color, CanvasText); outline: none; }
    .directory-tree__file[aria-current="page"] { background: var(--highlight-color, Highlight); color: var(--root-color, HighlightText); font-weight: 650; }
    .directory-tree__empty { color: var(--subtle-color, GrayText); padding: 1rem; text-align: center; }
    .sr-only { block-size: 1px; clip: rect(0, 0, 0, 0); inline-size: 1px; margin: -1px; overflow: hidden; padding: 0; position: absolute; white-space: nowrap; }
    @media (max-width: 600px) { .directory-tree__header { position: sticky; inset-block-start: 0; background: var(--root-background-color, Canvas); z-index: 1; } .directory-tree__file, .directory-tree__folder > summary { min-block-size: 2.35rem; display: flex; align-items: center; } }
  </style><section class="directory-tree" aria-label="Directory tree">
    <header class="directory-tree__header"><strong class="directory-tree__title">Files</strong><label class="sr-only" for="directory-tree-search">Filter files</label><input id="directory-tree-search" class="sb-input directory-tree__search" type="search" placeholder="Filter files" autocomplete="off"><button class="sb-button sb-button-icon" type="button" data-action="refresh" title="Refresh files" aria-label="Refresh files">↻</button><button class="sb-button sb-button-icon" type="button" data-action="close" title="Hide directory tree" aria-label="Hide directory tree">×</button></header>
    <div id="directory-tree-items" class="directory-tree__items" role="tree"></div>
  </section>`;
}

function panelScript(model: { nodes: TreeNode[]; currentPath: string }) {
  // Values are data, not HTML. Escaping '<' keeps a filename from closing the
  // script context before the panel creates its text nodes.
  const data = JSON.stringify(model).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `const model = ${data};
    const root = document.getElementById('directory-tree-items');
    const search = document.getElementById('directory-tree-search');
    const matches = (node, query) => !query || node.path.toLocaleLowerCase().includes(query);
    const hasMatch = (node, query) => matches(node, query) || node.children.some(child => hasMatch(child, query));
    const branch = (nodes, query) => {
      const list = document.createElement('ul'); list.className = 'directory-tree__branch';
      for (const node of nodes) {
        if (!hasMatch(node, query)) continue;
        const item = document.createElement('li');
        if (node.kind === 'folder') {
          const details = document.createElement('details'); details.className = 'directory-tree__folder'; details.open = Boolean(query) || model.currentPath === node.path || model.currentPath.startsWith(node.path + '/');
          const summary = document.createElement('summary'); summary.textContent = node.name; details.append(summary);
          details.append(branch(node.children, query)); item.append(details);
        } else {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'directory-tree__file'; button.textContent = node.name; button.title = node.path; button.dataset.path = node.path;
          if (node.path === model.currentPath) button.setAttribute('aria-current', 'page'); item.append(button);
        }
        list.append(item);
      }
      return list;
    };
    const render = () => { const query = search.value.trim().toLocaleLowerCase(); root.replaceChildren(branch(model.nodes, query)); if (!root.childElementCount) { const empty = document.createElement('p'); empty.className = 'directory-tree__empty'; empty.textContent = query ? 'No matching files' : 'No files in this space'; root.append(empty); } };
    search.addEventListener('input', render);
    root.addEventListener('click', async event => { const target = event.target.closest('button[data-path]'); if (target) await syscall('editor.navigate', target.dataset.path, false, false); });
    document.querySelector('[data-action="refresh"]').addEventListener('click', () => syscall('system.invokeFunction', 'directory-tree.refresh'));
    document.querySelector('[data-action="close"]').addEventListener('click', () => syscall('system.invokeFunction', 'directory-tree.hide'));
    const installResizeHandle = () => {
      const frame = window.frameElement;
      const panelElement = frame && frame.parentElement;
      if (!frame || !panelElement || panelElement.parentElement?.id !== 'sb-main') return;
      const hostDocument = frame.ownerDocument;
      hostDocument.getElementById('directory-tree-resize-handle')?.remove();
      panelElement.style.position = 'relative';
      const handle = hostDocument.createElement('div');
      handle.id = 'directory-tree-resize-handle'; handle.title = 'Drag to resize the directory tree';
      Object.assign(handle.style, { position: 'absolute', insetBlock: '0', insetInlineEnd: '-6px', width: '12px', cursor: 'col-resize', touchAction: 'none', zIndex: '20' });
      panelElement.append(handle);
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        const startSize = Number.parseFloat(panelElement.style.flex) || ${defaultSize};
        const available = Math.max(320, panelElement.parentElement.getBoundingClientRect().width);
        const move = moveEvent => {
          const next = Math.min(${maximumSize}, Math.max(${minimumSize}, startSize + (moveEvent.clientX - startX) * 3 / available));
          panelElement.style.flex = String(next);
          handle.dataset.size = String(next);
        };
        const stop = () => {
          hostDocument.removeEventListener('pointermove', move);
          hostDocument.removeEventListener('pointerup', stop);
          const next = Number.parseFloat(handle.dataset.size || String(startSize));
          void syscall('clientStore.set', '${sizeKey}', next);
        };
        hostDocument.addEventListener('pointermove', move);
        hostDocument.addEventListener('pointerup', stop, { once: true });
      });
    };
    installResizeHandle();
    render();`;
}
