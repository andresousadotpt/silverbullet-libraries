# SilverBullet Plugs

A repository of independently installable [SilverBullet](https://silverbullet.md/) extensions. Each folder in `plugs/` owns one plug; each page in `libraries/` packages a plug as an installable library. `REPO.md` is the catalog used by SilverBullet's Libraries manager.

## Directory Tree

A file-and-folder tree for the current SilverBullet space. It opens by default in the left panel on desktop and the bottom panel on mobile. Select a file to open it, filter paths, expand folders, and refresh after external file changes. On desktop, drag the panel's right edge to resize it; the size is remembered on that client. **Directory Tree: Toggle** hides or restores it; **Directory Tree: Reveal** opens it again.

Install it from the catalog or directly with `ghr:andresousadotpt/silverbullet-plugs/DirectoryTree.md`.

SilverBullet action buttons are configured by each space, rather than by plugs. Add this to your `CONFIG` page to place the toggle alongside Home, Open, and the Command Palette; the `sidebar` icon is available on desktop and mobile:

````space-lua
actionButton.define {
  icon = "sidebar",
  description = "Toggle directory tree",
  command = "Directory Tree: Toggle",
}
````

## Encrypted Notes

Create and open `.sben` notes encrypted locally with AES-256-GCM. **Encrypted Note: New** creates a blank encrypted-note container; choose its passphrase in the editor. **Encrypted Note: Open** selects an existing encrypted note. Every open requires its passphrase; a wrong passphrase or altered ciphertext displays an error and never renders the note body.

The passphrase is never stored or recoverable. Use a strong, unique passphrase and keep an independent backup: losing it permanently loses the note. The encrypted file protects its contents at rest, but filenames, size, and timestamps remain visible. While unlocked, plaintext necessarily exists in the browser editor’s memory; it is not protection against a compromised device, browser extension, or already-authorized SilverBullet client.

Install it from the catalog or directly with `ghr:andresousadotpt/silverbullet-plugs/EncryptedNotes.md`.

## Spreadsheet

A local spreadsheet editor for SilverBullet's document viewer, with a bundled FortuneSheet canvas grid. Workbooks stay in your space; the editor has no runtime CDN, telemetry, or external service dependency.

- Open `.xlsx`, `.ods`, `.csv`, `.tsv`, and legacy `.xls` documents from the file picker.
- Edit XLSX/ODS cells and formulas; edit UTF-8 CSV/TSV text values.
- Browse sheets, add sheets, navigate by cell address, and select ranges with Shift-click.
- Copy displayed values and paste a tabular range from another spreadsheet.
- Undo/redo up to 30 workbook edits, download the current file, and save through SilverBullet's document autosave bridge.
- Calculate supported formulas, including arithmetic, `SUM`, `AVERAGE`, `IF`, and cross-sheet references. Common imported OpenFormula references such as `[.$A$1]` and `[.A1:.B3]` are recognized without rewriting XLSX formula text. ODS output translates these references through the A1 syntax required by SheetJS before writing OpenFormula syntax.
- Preserve the original file exactly until editing is explicitly enabled. Enabling editing saves one original backup (`<name>.original<ext>`) alongside the file before any changes are allowed; the same backup is reused on later opens, never duplicated or overwritten.
- View legacy XLS files and convert them to a separate `<name>.converted.xlsx` copy for editing. The legacy file is never rewritten, and an existing converted copy is reopened instead of duplicated.

### Install locally for testing

Requires Node.js 22 or newer and a SilverBullet version supporting `.plug.js` document editors (developed against 2.10.0).

```sh
npm ci
npm run build
```

Copy `dist/spreadsheet.plug.js` anywhere in your SilverBullet space, for example under `Library/andresousadotpt/`. Run **Plugs: Reload** in SilverBullet. Use **Navigate: Anything Picker** / **Navigate: Document Picker** to open a spreadsheet, or run **Spreadsheet: New** to create an XLSX workbook.

The spreadsheet starts in preview mode. Click **Enable editing** to create a byte-for-byte backup and unlock edits. If the backup fails, the file remains in preview mode. Read-only files and spaces cannot enable editing. Later opens reuse the same original backup without overwriting it.

Use FortuneSheet's native grid and formula bar to edit. Select a cell, type `=` in the grid, then click or drag cells to insert references and press Enter to commit. Arrow keys, Tab, Shift-selection, paste, delete, and Ctrl/Cmd-Z or Ctrl/Cmd-Shift-Z use FortuneSheet's native spreadsheet behavior. Ctrl/Cmd-S or Save requests a save. SilverBullet controls final storage and sync status; “Changes sent to SilverBullet” is not a server-persistence acknowledgement.

For XLS files, **Convert to XLSX** creates and opens a separately named copy. Review it before enabling editing.

### Install through Libraries after publication

The source repository and a SilverBullet repository serve different purposes:

- **GitHub repository:** source code, tests, build scripts and library definitions.
- **SilverBullet repository (`REPO.md`):** a catalog pointing to installable libraries.
- **Library (`Spreadsheet.md`):** a page whose `files` list installs the compiled `spreadsheet.plug.js` beside it.

After the source has been pushed and the first release assets published:

1. Open the Libraries manager and add this repository URI (or use **Library: Add Repository**):
   ```text
   https://github.com/andresousadotpt/silverbullet-plugs/blob/main/REPO.md
   ```
2. Install **Spreadsheet** from the repository's list.
3. If necessary, run **Plugs: Reload**.

The direct library install URI is:

```text
ghr:andresousadotpt/silverbullet-plugs/Spreadsheet.md
```

These remote installation URLs become usable only after publication. A Git clone URL ending in `.git` is not a SilverBullet catalog URI.

### Current limits

This is a lightweight spreadsheet data editor, not a replacement for Excel or LibreOffice.

- Advanced formatting, charts, drawings, pivot tables, macros, external connections, validation rules, and other complex features are not guaranteed to survive conversion or saving. The backup retains the untouched original. Do not use the edited copy as the sole copy of a complex workbook.
- Formula support comes from `fast-formula-parser`, not Excel. Named ranges, external references, structured table references, dynamic arrays and other unsupported formulas may show errors. Formula text is retained; stale cached results are removed on save. Network formulas are disabled. Excel/LibreOffice may need to recalculate the file when opened there.
- CSV/TSV are UTF-8, single-sheet text formats. CSV uses commas; TSV uses tabs. Input is kept as text, including leading zeros. Formula-like text is not evaluated by this editor. Opening an exported CSV in another spreadsheet app follows that app's own interpretation rules.
- Array formula cells and non-anchor cells in merged ranges cannot be edited. Merged ranges are shown as ordinary grid cells. Protected sheets reject edits.
- FortuneSheet 1.0.4 provides the native canvas grid, formula editor, reference-range picker, scrolling, sheet tabs, clipboard and undo/redo. The bounded model remains authoritative for serialization. The rich formatting and structural controls are hidden because format, row/column and sheet-structure round trips are outside this plug's supported contract. Formula text is synchronized back to the model without a hand-built formula editor; unsupported formulas remain subject to the formula limitations above.
- Files up to 20 MB and 10,000 cells per paste/copy/clear. FortuneSheet allocates dense matrices: views are limited to 250,000 grid cells across all sheets, 10,000 rows and 1,000 columns per sheet. Each view includes at least 100 rows and 26 columns, or the used extent plus 20 rows and 5 columns. Blank space grows after committed edits. Oversized views are rejected without truncation; the original remains downloadable. Edits that exceed the view limit are rejected atomically. Formula depth/range/work budgets remain bounded; expensive formulas can show `#LIMIT!`.
- The surrounding controls follow the SilverBullet theme; FortuneSheet's grid uses its light theme. Canvas cells are not HTML table cells; the formula bar and selected-cell display expose the active value as text.
- No concurrent-edit merge or conflict resolution beyond SilverBullet's normal document behavior. Avoid editing the same workbook in multiple clients simultaneously.

## Develop and test

```sh
npm ci
npm run build
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

`npm run dev` serves a synthetic workbook and a document-editor protocol harness at `http://127.0.0.1:4179`. It does not connect to a real space. The build is self-contained and can be developed without a neighboring SilverBullet source checkout.

Adapter and model tests exercise serialization and reopening for the supported formats, formula caches, cross-sheet calculations, literal strings, Unicode, undo/redo, paste and read-only cell protections. Browser tests exercise the compiled UI and SilverBullet bridge messages. These tests are not a substitute for a final test in your own SilverBullet installation.

## Releases

Releases are automated by the `Release` GitHub Actions workflow. Every push to `main` runs the full validation suite (`npm ci`, build, type check, model tests, browser tests); if it passes, [semantic-release](https://semantic-release.gitbook.io/) derives the next version from [Conventional Commits](https://www.conventionalcommits.org/) since the last tag:

- `fix: …` → patch release, `feat: …` → minor release, `BREAKING CHANGE:` (or `!`) → major release
- Other types (`chore:`, `docs:`, `ci:`, `test:`, …) do not trigger a release

semantic-release bumps `package.json`/`package-lock.json`, rebuilds and repackages so the generated library page carries the new version and bundle hash, tags `vX.Y.Z`, publishes the GitHub release with the `dist/release/` assets, and commits the version bump back to `main` with `[skip ci]`. The `ghr:` install URI always serves the latest release.

Local scripts never publish anything. To preview what a push would release, run `npx semantic-release --no-ci --dry-run`. Manual fallback: `npm run package` creates `dist/release/` (library page, `spreadsheet.plug.js`, `REPO.md`, third-party notices) for a maintainer to attach to a GitHub release by hand.

The original code is available under the MIT license in `LICENSE`. Bundled dependencies retain the licenses reproduced in `THIRD_PARTY_NOTICES.md`.

## Add another plug

Create `plugs/<name>/<name>.plug.yaml` and its TypeScript entry points. The build discovers every matching plug directory and produces a separate `dist/<name>.plug.js`. A document editor can additionally provide `editor.html`, `src/app.ts`, and `src/style.css`; these are bundled into a generated HTML module.

Add a `libraries/<Library Name>.md` page with `name`, `tags: meta/library`, and the plug in its `files` list. Add a `#meta/library/remote` entry to `REPO.md` pointing to the page's release asset. Build and package to distribute the new library independently alongside the existing ones.

## Dependency references

- [SheetJS installation](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/), [writing behavior](https://docs.sheetjs.com/docs/api/write-options/), and [format support](https://docs.sheetjs.com/docs/miscellany/formats/).
- [FortuneSheet configuration](https://ruilisi.github.io/fortune-sheet-docs/guide/config.html) and [Workbook API](https://ruilisi.github.io/fortune-sheet-docs/guide/api.html). React 18.3.1 and FortuneSheet 1.0.4 are bundled locally; the adapter isolates FortuneSheet from formula evaluation and serialization. The build applies an exact-match compatibility patch to the 1.0.4 InputBox layout effect, avoiding unnecessary read-only state updates that otherwise cause a React update loop.
- [fast-formula-parser API and supported formulas](https://github.com/LesterLyu/fast-formula-parser).

See `AGENTS.md` for contributor guidance and public-repository hygiene.
