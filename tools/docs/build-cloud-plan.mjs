import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readText = async (path) => (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
const source = await readText(resolve(root, 'docs/sudo-cloud-plan.md'));
const template = await readText(resolve(root, 'docs/templates/sudo-cloud-plan.html'));
const marker = /<!-- cloud-plan:first-diagram -->\s*```mermaid\n([\s\S]*?)\n```\s*<!-- \/cloud-plan:first-diagram -->/g;
const matches = [...source.matchAll(marker)];
if (matches.length !== 1) throw new Error('The plan must contain exactly one marked architecture diagram');
const match = matches[0];
const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const substitutions = {
  BEFORE_DATA: Buffer.from(source.slice(0, match.index).trimEnd() + '\n').toString('base64'),
  FIRST_DIAGRAM: escapeHtml(match[1]),
  AFTER_DATA: Buffer.from(source.slice(match.index + match[0].length).trimStart()).toString('base64'),
};
let output = template;
for (const [name, content] of Object.entries(substitutions)) {
  const placeholder = `{{${name}}}`;
  if (output.split(placeholder).length !== 2) throw new Error(`Expected one ${placeholder}`);
  output = output.replace(placeholder, () => content);
}
if (/\{\{(?:BEFORE_DATA|FIRST_DIAGRAM|AFTER_DATA)\}\}/.test(output)) throw new Error('Unresolved plan placeholder');
const destination = resolve(root, 'docs/sudo-cloud-plan.html');
if (process.argv.includes('--check')) {
  if (await readText(destination) !== output) {
    throw new Error('Cloud plan HTML is stale; run node tools/docs/build-cloud-plan.mjs');
  }
  console.log('Cloud plan HTML matches its Markdown source and template');
} else {
  await writeFile(destination, output);
  console.log('Generated docs/sudo-cloud-plan.html');
}
