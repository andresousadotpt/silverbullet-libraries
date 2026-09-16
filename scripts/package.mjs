import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
// Release assets are generated output. Start fresh so a renamed or removed
// library page cannot be carried into a later package.
await rm('dist/release', { recursive: true, force: true });
await mkdir('dist/release', { recursive: true });
for (const name of await readdir('libraries')) {
  if (!name.endsWith('.md')) continue;
  const source = await readFile(`libraries/${name}`, 'utf8');
  const bundles = [...source.matchAll(/^- ([-\w]+\.plug\.js)$/gm)].map(match => match[1]);
  if (!bundles.length) throw new Error(`No plug bundle in ${name}`);
  const hash = createHash('sha256');
  for (const bundle of bundles) {
    const bytes = await readFile(`dist/${bundle}`);
    hash.update(bytes);
    await cp(`dist/${bundle}`, `dist/release/${bundle}`);
  }
  // Library updates compare the page hash, so binary changes must change the page.
  const stamped = source.replace(/^---\n/, `---\nversion: "${version}"\nbundleSha256: ${hash.digest('hex')}\n`);
  await writeFile(`dist/release/${name}`, stamped);
}
await cp('REPO.md', 'dist/release/REPO.md');
await cp('LICENSE', 'dist/release/LICENSE');
await cp('THIRD_PARTY_NOTICES.md', 'dist/release/THIRD_PARTY_NOTICES.md');
console.log('Installable library files prepared in dist/release/. Nothing has been published.');
