---
name: Library/andresousadotpt/Obsidian Import
tags: meta/library
files:
- obsidian-import.plug.js
---
# Obsidian Import

Run **Obsidian: Import ZIP**, select a vault ZIP, choose a destination folder, and confirm the preview. Nested folders, Markdown notes, and binary attachments are preserved. You can remove an enclosing vault folder. Existing files are skipped, and a report lists imported, skipped, and failed paths.

Note contents are preserved byte-for-byte: Obsidian links, embeds, queries, and plugin syntax are not converted. Hidden configuration/system files and executable SilverBullet plugs are skipped. Import only trusted vaults: Markdown can contain executable Space Lua.

Limits: 100 MiB ZIP, 250 MiB extracted data, 50 MiB per file, and 10,000 archive entries. No encrypted ZIP entries, symbolic links, empty-folder preservation, or automatic rollback. A failure stops the import; completed files remain. Rerunning skips existing files. Avoid concurrent writes to the destination while importing.

[Instructions and limitations](https://github.com/andresousadotpt/silverbullet-plugs#obsidian-import)
