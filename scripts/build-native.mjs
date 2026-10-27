#!/usr/bin/env node
// Builds crates/laser-node and copies the Node-API library to apps/desktop/native/laser_node.node.
// Usage: node scripts/build-native.mjs [--debug]
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const debug = process.argv.includes('--debug');
const profile = debug ? 'debug' : 'release';

const args = ['build', '-p', 'laser-node'];
if (!debug) args.push('--release');
execFileSync('cargo', args, { cwd: root, stdio: 'inherit' });

const libName = {
  win32: 'laser_node.dll',
  darwin: 'liblaser_node.dylib',
  linux: 'liblaser_node.so',
}[process.platform];
if (!libName) throw new Error(`unsupported platform ${process.platform}`);

const src = join(root, 'target', profile, libName);
const outDir = join(root, 'apps', 'desktop', 'native');
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, 'laser_node.node');
copyFileSync(src, dest);
console.log(`native module: ${dest}`);
