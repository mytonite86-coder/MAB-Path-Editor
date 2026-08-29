import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exportDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const productionApi = 'https://mab-path-editor.onrender.com';
const forbiddenTargets = ['http://127.0.0.1:8000', 'http://localhost:8000'];

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesBelow(path));
    } else {
      files.push(path);
    }
  }

  return files;
}

const files = await filesBelow(exportDirectory);
const searchableFiles = files.filter((file) => /\.(?:html|js|json|map)$/i.test(file));
const contents = (await Promise.all(searchableFiles.map((file) => readFile(file, 'utf8')))).join('\n');

const failures = forbiddenTargets.filter((target) => contents.includes(target));
if (!contents.includes(productionApi)) failures.push(`missing ${productionApi}`);

if (failures.length) {
  throw new Error(`Unsafe production export: ${failures.join(', ')}`);
}

console.log(`Verified production export uses ${productionApi} and contains no localhost API target.`);
