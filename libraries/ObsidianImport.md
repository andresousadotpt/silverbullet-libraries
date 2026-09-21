---
name: Library/andresousadotpt/Obsidian Import
tags: meta/library
files:
- obsidian-import.plug.js
---
# Obsidian Import

Run **Obsidian: Import ZIP**, select a vault ZIP, choose a destination folder, and confirm the preview. Nested folders, Markdown notes, and binary attachments are preserved. You can remove an enclosing vault folder. Existing files are skipped, and a report lists imported, skipped, and failed paths.

Note contents are preserved byte-for-byte: Obsidian links, embeds, queries, and plugin syntax are not converted. Hidden configuration/system files and executable SilverBullet plugs are skipped. Import only trusted vaults: Markdown can contain executable Space Lua.

Filenames containing punctuation such as `?`, `:`, `#`, and `@` are preserved. The destination filesystem must support them; SilverBullet links may need escaping or may not address every such name. Files are not renamed. Absolute paths and path traversal remain blocked.

Limits: 1 GiB ZIP, 2 GiB extracted data, 512 MiB per file, and 10,000 archive entries. The ZIP is loaded into browser memory; files are extracted one at a time. Large vaults need sufficient browser memory. No encrypted ZIP entries, symbolic links, empty-folder preservation, or automatic rollback. A failure stops the import; completed files remain. Rerunning skips existing files. Avoid concurrent writes to the destination while importing.

[Instructions and limitations](https://github.com/andresousadotpt/silverbullet-plugs#obsidian-import)
