#!/usr/bin/env node
// Headless smoke test of the native module (no Electron): plan, preview and a full simulated job.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const native = require(join(root, 'apps', 'desktop', 'native', 'laser_node.node'));

const info = native.nativeInfo();
console.log('nativeInfo', info);
const project = native.sampleProject();

const planned = await native.planToolpath(project);
console.log('plan', {
  sections: planned.summary.sections.length,
  marks: planned.markPositions.length / 6,
  errors: planned.summary.errors,
  gcodeLines: planned.gcodeListing.length,
});

const preview = await native.kinematicPreview(project, 0.02);
console.log('kinematic preview', { samples: preview.t.length, duration: preview.durationS.toFixed(2) });

const ac = new AbortController();
ac.abort();
try {
  await native.planToolpath(project, ac.signal);
  console.log('abort: not aborted (task may have completed first)');
} catch (e) {
  console.log('abort: rejected as expected:', String(e.message ?? e).slice(0, 60));
}

const s = new native.SimSession(project);
s.connect();
s.tick(0.2);
s.home();
for (let i = 0; i < 30; i++) s.tick(1);
const report = s.prepare();
console.log('prepare', { ok: report.ok, units: report.units, errors: report.errors });
s.arm(true);
s.start();
let snap;
for (let i = 0; i < 20000; i++) {
  snap = s.tick(0.1);
  if (!['RUNNING', 'PAUSED', 'STOPPING'].includes(snap.safetyState)) break;
}
const tl = s.timeline(0, 0);
console.log('session', { state: snap.safetyState, outcome: snap.outcome, samples: tl.t.length });
try {
  native.f1ProbeMachineInfo({ host: '127.0.0.1', tcpPort: 8780, httpPort: 8080, simulationOnly: true, developerMode: false });
} catch (e) {
  console.log('real-device probe refused:', e.message);
}
if (snap.outcome?.type !== 'completed') process.exit(1);
