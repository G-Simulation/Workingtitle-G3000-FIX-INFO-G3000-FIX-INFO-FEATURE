// Generates layout.json for the MSFS community package by walking the file tree.
// Excludes manifest.json and layout.json itself. Paths use forward slashes regardless of OS.
//
// date field is Windows FILETIME (100ns ticks since 1601-01-01).
// MSFS treats it as informational; precision loss in the last few digits is harmless.

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', 'package', 'g3000-fix-info-fix-2024');

const UNIX_EPOCH_AS_FILETIME = 116444736000000000;

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
    } else {
      const rel = relative(PACKAGE_ROOT, full).split(sep).join('/');
      if (rel === 'manifest.json' || rel === 'layout.json') continue;
      acc.push({
        path: rel,
        size: st.size,
        date: st.mtimeMs * 10000 + UNIX_EPOCH_AS_FILETIME,
      });
    }
  }
  return acc;
}

const layout = { content: walk(PACKAGE_ROOT) };
const out = join(PACKAGE_ROOT, 'layout.json');
writeFileSync(out, JSON.stringify(layout, null, 2) + '\n');
console.log(`layout.json written with ${layout.content.length} entries -> ${out}`);
