// Regenerate the deterministic CAD fixtures in tests/fixtures/cad (docs/testing/CAD_FIXTURES.md).
// Loads the TypeScript fixture builders through Vite (resolved via vitest) and runs them on OCCT.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const vite = await import(pathToFileURL(createRequire(require.resolve('vitest/package.json')).resolve('vite')).href);

const { module: kernel } = await vite.runnerImport(join(root, 'packages/cad-kernel/src/index.ts'), { root, configFile: false, logLevel: 'error' });
const oc = await kernel.loadOcct();
const outDir = join(root, 'tests/fixtures/cad');
mkdirSync(outDir, { recursive: true });
const index = [];
for (const f of kernel.buildFixtures(oc)) {
  writeFileSync(join(outDir, f.name), f.contents);
  index.push({ name: f.name, description: f.description });
  console.log(`${f.name.padEnd(32)} ${f.description}`);
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
process.exit(0);
