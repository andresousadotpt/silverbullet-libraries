---
name: Library/andresousadotpt/Directory Tree
tags: meta/library
files:
- directory-tree.plug.js
---
# Directory Tree

Browse every file in the current SilverBullet space through a collapsible folder tree. The tree opens automatically in the left panel on desktop and in a bottom panel on mobile. Select a file to open it; use the filter, refresh, and hide buttons in the panel as needed. On desktop, drag the panel's right edge to resize it. The panel size is remembered on that client.

Commands:

- **Directory Tree: Toggle** — hide or restore the tree.
- **Directory Tree: Reveal** — show the tree.

To add the toggle next to Home, Open, and the Command Palette, add this to the space `CONFIG` page:

````space-lua
actionButton.define {
  icon = "sidebar",
  description = "Toggle directory tree",
  command = "Directory Tree: Toggle",
}
````

The action-button layout belongs to the space configuration, so installing the plug never overwrites a user’s existing toolbar. The tree only lists and opens files; it does not create, rename, move, or delete anything.

[Source and installation](https://github.com/andresousadotpt/silverbullet-plugs)
