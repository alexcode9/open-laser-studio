// Builds and runs the firmware's portable C unit tests on the host (gcc, clang or `zig cc`).
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fw = join(root, 'firmware', 'esp32-motion-controller')
const outDir = join(root, 'target', 'fw-host')
mkdirSync(outDir, { recursive: true })
const exe = join(outDir, process.platform === 'win32' ? 'ols_fw_test.exe' : 'ols_fw_test')

const candidates = [['gcc'], ['clang'], ['zig', 'cc']]
const cc = candidates.find(([bin, ...rest]) => spawnSync(bin, [...rest, '--version'], { stdio: 'ignore', shell: false }).status === 0)
if (!cc) {
  console.error('No host C compiler found (tried gcc, clang, zig cc).')
  process.exit(2)
}

const args = [
  ...cc.slice(1),
  '-std=c11', '-Wall', '-Wextra', '-Werror', '-O1',
  '-I', join(fw, 'components', 'ols_protocol', 'include'),
  '-I', join(fw, 'components', 'ols_motion', 'include'),
  join(fw, 'test', 'host', 'test_main.c'),
  join(fw, 'components', 'ols_protocol', 'ols_protocol.c'),
  join(fw, 'components', 'ols_motion', 'ols_motion.c'),
  '-lm', '-o', exe,
]
console.log(`compiling with ${cc.join(' ')}`)
execFileSync(cc[0], args, { stdio: 'inherit' })
const run = spawnSync(exe, { stdio: 'inherit' })
process.exit(run.status ?? 1)
