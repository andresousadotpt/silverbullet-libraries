---
name: Library/andresousadotpt/Spreadsheet
tags: meta/library
files:
- spreadsheet.plug.js
---
# Spreadsheet

Open and edit XLSX, ODS, CSV and TSV files directly in SilverBullet. Legacy XLS files can be viewed and converted to an XLSX copy for editing.

Use **Navigate: Anything Picker** or **Navigate: Document Picker** to open a spreadsheet, or **Spreadsheet: New** to create one. If the viewer is not picked up immediately, run **Plugs: Reload**.

The editor starts in preview mode. **Enable editing** creates one exact original backup (`<name>.original<ext>`) in the same folder before allowing changes; later opens reuse that backup instead of creating more copies. Edits are sent through SilverBullet's normal autosave mechanism.

Select a cell and edit its value in the formula bar, or double-click / press F2. Press Enter or Apply to commit. Shift-click to select a range; copy/paste uses tab-separated values. Undo and Redo restore workbook edits. **+ Sheet** adds a sheet to a workbook. Use the address box or row/column navigation controls to reach cells outside the current window.

This is a lightweight data editor, not full Excel. Advanced formatting, charts, images, pivot tables, macros and other workbook features are not guaranteed to survive conversion or editing. Keep the original backups for complex workbooks. Common imported bracketed references such as `[.$A$1]` are supported. Supported formulas recalculate locally; unsupported formulas show an error and keep their formula text. CSV/TSV are UTF-8 text formats with one sheet and do not evaluate formulas. Read-only spaces and files remain read-only.

[Source, installation, and limitations](https://github.com/andresousadotpt/silverbullet-plugs)
