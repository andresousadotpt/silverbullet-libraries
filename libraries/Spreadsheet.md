---
name: Library/andresousadotpt/Spreadsheet
tags: meta/library
files:
- spreadsheet.plug.js
---
# Spreadsheet

Browse a FortuneSheet canvas grid and edit XLSX, ODS, CSV and TSV files directly in SilverBullet. Legacy XLS files can be viewed and converted to an XLSX copy for editing.

Use **Navigate: Anything Picker** or **Navigate: Document Picker** to open a spreadsheet, or **Spreadsheet: New** to create one. If the viewer is not picked up immediately, run **Plugs: Reload**.

The editor starts in preview mode. **Enable editing** creates one exact original backup (`<name>.original<ext>`) in the same folder before allowing changes; later opens reuse that backup instead of creating more copies. Edits are sent through SilverBullet's normal autosave mechanism.

Use FortuneSheet's native grid and formula bar to edit. Select a cell, type `=` in the grid, then click or drag cells to insert references and press Enter to commit. Shift-selection, paste, delete, and Ctrl/Cmd-Z or Ctrl/Cmd-Shift-Z use FortuneSheet's native spreadsheet behavior.

The grid uses FortuneSheet; the bounded workbook model remains authoritative for serialization. Rich formatting and structural controls are hidden because their round trips are outside this plug's supported contract. The grid remains light in dark mode. Views are limited to 250,000 grid cells across sheets (including blank editing space), 10,000 rows and 1,000 columns per sheet. Oversized workbooks remain downloadable without truncation. This is a lightweight data editor, not full Excel. Advanced formatting, charts, images, pivot tables, macros and other workbook features are not guaranteed to survive conversion or editing. Keep the original backups for complex workbooks. Common imported bracketed references such as `[.$A$1]` are supported. Supported formulas recalculate locally; unsupported formulas show an error and keep their formula text. CSV/TSV are UTF-8 text formats with one sheet and do not evaluate formulas. Read-only spaces and files remain read-only.

[Source, installation, and limitations](https://github.com/andresousadotpt/silverbullet-plugs)
