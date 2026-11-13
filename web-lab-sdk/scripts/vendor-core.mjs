import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const packageDir = process.cwd();
const distDir = path.join(packageDir, 'dist');
const coreDist = path.resolve(packageDir, '../core/dist');
const vendorDir = path.join(distDir, '_core');

await cp(coreDist, vendorDir, { recursive: true });
await rewrite(distDir);

async function rewrite(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '_core') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewrite(fullPath);
      continue;
    }
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) continue;
    const source = await readFile(fullPath, 'utf8');
    if (!source.includes('@web-lab-sdk/core')) continue;
    const relative = path.relative(path.dirname(fullPath), path.join(vendorDir, 'index.js'));
    const specifier = relative.split(path.sep).join('/');
    const prefixed = specifier.startsWith('.') ? specifier : `./${specifier}`;
    await writeFile(fullPath, source.replaceAll('@web-lab-sdk/core', prefixed));
  }
}
