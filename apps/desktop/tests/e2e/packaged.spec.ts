// Launch check for the electron-builder output. Opt-in: set OLS_PACKAGED_EXE to the unpacked
// executable (e.g. release/0.1.0/win-unpacked/Open Laser Studio.exe).

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

const exe = process.env.OLS_PACKAGED_EXE;

test.skip(!exe, 'OLS_PACKAGED_EXE not set');

test('packaged app loads the native core and plans the sample project', async () => {
  const errors: string[] = [];
  const app = await electron.launch({
    executablePath: exe!,
    env: { ...process.env, OLS_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'ols-pkg-')), ELECTRON_RENDERER_URL: '', OLS_NATIVE_PATH: '' },
  });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.getByTestId('app-root').waitFor({ timeout: 60_000 });
    await expect(page.getByTestId('mode-badge')).toHaveText(/simulation/i);
    await page.getByTestId('tab-plan').click();
    await expect(page.getByTestId('plan-report')).toContainText('executable');
    const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '');
    expect(csp).toContain("default-src 'self'");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
