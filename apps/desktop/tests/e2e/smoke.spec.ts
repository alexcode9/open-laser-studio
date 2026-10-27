// Electron smoke test: launches the built app (run `pnpm build` first), checks the sample
// project plans, then runs a full simulated cylinder job through the safety workflow.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  app = await electron.launch({
    args: [appDir],
    cwd: appDir,
    env: { ...process.env, OLS_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'ols-e2e-')), ELECTRON_RENDERER_URL: '' },
  });
  page = await app.firstWindow();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.getByTestId('app-root').waitFor({ timeout: 60_000 });
});

test.afterAll(async () => {
  await app?.close();
});

test('starts in simulation mode with a planned sample project', async () => {
  await expect(page.getByTestId('mode-badge')).toHaveText(/simulation/i);
  await expect(page.getByTestId('safety-state').first()).toHaveText('DISCONNECTED');
  await page.getByTestId('tab-plan').click();
  await expect(page.getByTestId('plan-report')).toContainText('executable');
  await expect(page.getByTestId('design-canvas').locator('canvas').first()).toBeVisible();
  await expect(page.getByTestId('preview-3d').locator('canvas')).toBeVisible();
  await page.screenshot({ path: join(appDir, 'test-results', 'startup.png') });
});

test('draws a rectangle, then undo and redo', async () => {
  const layers = page.getByTestId('layer-list');
  await expect(layers).toContainText('line · 3');
  await page.getByTestId('tool-rect').click();
  const box = (await page.getByTestId('design-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.55, { steps: 5 });
  await page.mouse.up();
  await expect(layers).toContainText('line · 4');
  await page.getByTestId('tool-select').click();
  await page.keyboard.press('Control+z');
  await expect(layers).toContainText('line · 3');
  await page.keyboard.press('Control+y');
  await expect(layers).toContainText('line · 4');
  await page.keyboard.press('Control+z');
});

test('switching to flat mode replans and back', async () => {
  await page.getByTestId('mode-flat').click();
  await page.getByTestId('tab-plan').click();
  await expect(page.getByTestId('plan-report')).toContainText('flat');
  await page.getByTestId('mode-cylinder').click();
  await expect(page.getByTestId('plan-report')).toContainText('indexed');
});

test('runs a simulated cylinder job end to end', async () => {
  await page.getByTestId('tab-machine').click();
  await page.getByLabel('Injection').waitFor();
  await page.locator('select').filter({ hasText: 'real time' }).selectOption('25');

  await page.getByTestId('connect').click();
  await expect(page.getByTestId('safety-state').first()).toHaveText('IDLE');
  await page.getByTestId('home').click();
  await expect(page.getByText('homed', { exact: true })).toBeVisible();

  await page.getByTestId('prepare').click();
  await expect(page.getByTestId('prepare-report')).toContainText('Prepare OK');
  await expect(page.getByTestId('safety-state').first()).toHaveText('READY');

  await page.getByTestId('arm').click();
  const dialog = page.getByRole('alertdialog');
  for (const box of await dialog.getByRole('checkbox').all()) await box.check();
  await dialog.getByRole('button', { name: 'Arm' }).click();
  await expect(page.getByTestId('safety-state').first()).toHaveText('ARMED');

  await page.getByTestId('start').click();
  await expect(page.getByTestId('safety-state').first()).toHaveText('RUNNING');
  await page.screenshot({ path: join(appDir, 'test-results', 'running.png') });
  await expect(page.getByTestId('job-outcome')).toContainText('completed', { timeout: 150_000 });
  await expect(page.getByTestId('safety-state').first()).toHaveText('IDLE');
  await page.screenshot({ path: join(appDir, 'test-results', 'completed.png') });
});

test('e-stop latches and requires an explicit reset', async () => {
  await page.getByTestId('estop').click();
  await expect(page.getByTestId('safety-state').first()).toHaveText('ESTOP');
  await page.getByTestId('reset').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: 'Reset' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('safety-state').first()).not.toHaveText('ESTOP');
});

test('no renderer errors', () => {
  expect(consoleErrors.filter((e) => !e.includes('DevTools'))).toEqual([]);
});
