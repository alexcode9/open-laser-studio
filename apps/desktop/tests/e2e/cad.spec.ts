// CAD milestone in the built app (run `pnpm build` first): import the Ø30 × 150 STEP cylinder,
// pick its cylindrical face, measure it, use it as the rotary workpiece, then save and reopen.
// Native file dialogs are stubbed in the main process; everything else runs for real, including
// the OCCT kernel in its utility process.

import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = join(appDir, '..', '..', 'tests', 'fixtures', 'cad', 'a-cylinder-30x150.step');
const work = mkdtempSync(join(tmpdir(), 'ols-cad-e2e-'));
const savedProject = join(work, 'cad-milestone.ols');

let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

async function stubDialogs(openPath: string, savePath: string): Promise<void> {
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.openPath] })) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.savePath })) as typeof dialog.showSaveDialog;
    },
    { openPath, savePath },
  );
}

async function clickViewerCenter(): Promise<void> {
  const box = (await page.getByTestId('cad-viewer').locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 3, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

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

test('imports the STEP cylinder and lists its analytical cylinder', async () => {
  await page.getByTestId('workspace-cad').click();
  await expect(page.getByTestId('cad-workspace')).toBeVisible();
  await stubDialogs(fixture, savedProject);
  await page.getByRole('button', { name: 'Import CAD model' }).first().click();
  const feature = page.getByTestId('cad-feature-cylinder');
  await expect(feature).toHaveCount(1, { timeout: 120_000 });
  await expect(feature).toContainText('Ø30.000 mm × 150.00 mm');
  await expect(page.getByTestId('cad-model-tree')).toContainText('a-cylinder-30x150');
  await expect(page.getByTestId('cad-model-tree')).not.toContainText('Open CASCADE');
  await expect(page.getByTestId('cad-bounds-size')).toHaveText('30.000 mm × 30.000 mm × 150.000 mm');
  await expect(page.getByTestId('cad-axis-candidate')).toContainText('(0.0000, 0.0000, 1.0000)');
});

test('selects the cylindrical face in the viewer and reads Ø30 and the axis', async () => {
  await page.getByTestId('cad-view-front').click();
  await clickViewerCenter();
  await expect(page.getByTestId('cad-prop-kind')).toHaveText('cylinder');
  await expect(page.getByTestId('cad-prop-diameter')).toHaveText('Ø 30.000 mm');
  await expect(page.getByTestId('cad-prop-axis')).toHaveText(/\(0\.0000, 0\.0000, -?1\.0000\)/);
  await expect(page.getByTestId('quality-analytical').first()).toBeVisible();
  await page.screenshot({ path: join(appDir, 'test-results', 'cad-selected.png') });
});

test('measures the radius with the radius tool and shows a 3D annotation', async () => {
  await page.getByTestId('cad-tool-radius').click();
  await expect(page.getByTestId('cad-tool-hint')).toBeVisible();
  await clickViewerCenter();
  await expect(page.getByTestId('cad-measurement')).toHaveCount(1);
  await expect(page.getByTestId('cad-measurement-value')).toHaveText('R 15.000 mm · Ø 30.000 mm');
  await expect(page.getByTestId('cad-annotation')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cad-tool-hint')).toHaveCount(0);
});

test('uses the cylinder as the rotary workpiece', async () => {
  await page.getByTestId('cad-use-workpiece').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('cad-workpiece-option')).toHaveCount(1);
  await expect(dialog.getByTestId('cad-workpiece-option')).toContainText('suggested');
  await expect(dialog).toContainText('Machine calibration, angular zero and axial zero are not changed');
  await dialog.getByTestId('cad-workpiece-apply').click();
  await expect(page.getByTestId('preview-3d')).toBeVisible();
  await expect(page.getByTestId('mode-cylinder')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('preview-3d')).toContainText('Cylinder Ø30 × 150 mm');
  await expect(page.getByTestId('cad-workpiece-label')).toContainText('a-cylinder-30x150');
  await expect(page.getByTestId('cad-model-tree')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(appDir, 'test-results', 'cad-workpiece.png') });
});

test('saves the project with the embedded CAD file and reopens it intact', async () => {
  await page.keyboard.press('Control+s');
  await expect.poll(() => existsSync(savedProject), { timeout: 30_000 }).toBe(true);

  await page.getByTestId('workspace-cad').click();
  await stubDialogs(savedProject, savedProject);
  await page.getByRole('button', { name: 'Open… (Ctrl+O)' }).click();
  await expect(page.getByTestId('cad-feature-cylinder')).toContainText('Ø30.000 mm × 150.00 mm', { timeout: 120_000 });
  await expect(page.getByTestId('cad-measurement')).toHaveCount(1);
  await expect(page.getByTestId('cad-measurement-value')).toHaveText('R 15.000 mm · Ø 30.000 mm');
  await expect(page.getByTestId('cad-measurement')).not.toContainText('stale');
  await expect(page.getByTestId('cad-workpiece-binding')).toContainText('Ø 30.000 mm × 150.000 mm');
});

test('no renderer errors', () => {
  expect(consoleErrors.filter((e) => !e.includes('DevTools'))).toEqual([]);
});
