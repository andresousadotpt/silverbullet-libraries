# Working on silverbullet-plugs

This is a public repository containing independently installable SilverBullet plugs.

## Structure

- Put each plug in `plugs/<name>/` with its own `<name>.plug.yaml` manifest.
- Keep shared build and development tooling in `scripts/`.
- Build outputs go in `dist/`; generated editor modules go in `plugs/*/generated/`.
- Keep the repository usable without a neighboring SilverBullet checkout.

## Public repository hygiene

- Never commit credentials, tokens, `.env` files, private URLs, absolute personal filesystem paths, browser profiles, or actual SilverBullet space contents.
- Use synthetic workbooks and generic paths in tests and documentation.
- Keep dependencies pinned in `package-lock.json`. Do not use authenticated registry URLs.
- Before committing, inspect `git diff --cached` and `git status --short` for accidental data or generated output.
- Do not publish packages, push, create releases, or install into a real space unless explicitly requested.

## Implementation

- Keep plugs self-contained; bundle runtime dependencies, with no CDN or telemetry calls from the editor.
- Use SilverBullet's document editor bridge for file-open, file-changed, request-save and file-saved events.
- Respect read-only spaces and files. Preserve the original bytes until a deliberate edit.
- Never silently discard workbook features. Explain format limitations, and retain an original backup before enabling edits.
- Treat workbook values as untrusted text. Do not insert them as HTML or evaluate formulas with JavaScript `eval`.
- Preserve formulas as formulas and strings as strings. Bound rendering and formula evaluation for large or cyclic workbooks.
- Use TypeScript and keep parsing/serialization separate from the UI so round trips can be tested.

## Validation

Run `npm ci`, `npm run build`, `npm run check`, `npm test`, and `npm run test:browser` for changes to the spreadsheet editor. Install the browser with `npx playwright install chromium` if necessary. Browser tests use a synthetic SilverBullet bridge; distinguish these from testing in a live space.

Test data edits and save/reopen round trips, formulas, multiple sheets, undo/redo, read-only operation, backup failures, and file switching. A build alone does not validate data preservation.

Update README instructions and limitations when behavior changes. Do not claim full Excel fidelity, server persistence verification, or live-space validation unless actually verified.

## Releases

Pushes to `main` trigger the `Release` workflow: full validation, then semantic-release publishes a GitHub release with the `dist/release/` assets and commits the version bump back with `[skip ci]`. Versions come from Conventional Commits (`fix:` patch, `feat:` minor, `BREAKING CHANGE:` major; other types release nothing), so write commit messages in that format. Local build/package scripts never publish.
