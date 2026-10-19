import { mkdirSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, openSessionAtCwd } from './harness/browser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolvePath(__dirname, 'fixtures', 'long-running.jsonl');
const TEST_CWD = '/tmp/outpost-e2e-interrupt';

test.use({ daemonOpts: { fixturePath: FIXTURE } });

test.beforeAll(() => {
  mkdirSync(TEST_CWD, { recursive: true });
});

test('clicking Stop interrupts the claude subprocess and silently resumes the session', async ({ daemon, outpostPage }) => {
  await openSessionAtCwd(outpostPage, daemon, TEST_CWD);

  const composer = outpostPage.locator('.sv-composer');
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.click();
  await outpostPage.keyboard.type('go');
  await outpostPage.keyboard.press('Enter');

  // First assistant chunk renders.
  await expect(outpostPage.getByText('working on it')).toBeVisible({ timeout: 10_000 });

  // While the mock is paused waiting for input, the daemon-side claude is still alive
  // and the turn is running, so Stop is showing. Click it.
  await outpostPage.locator('.sv-stop').click();

  // The user-initiated interrupt should NOT produce the "subprocess exited" error tile —
  // the PWA treats it as expected and silently resumes the session.
  await outpostPage.waitForTimeout(1_000);
  await expect(outpostPage.getByText(/subprocess exited/i)).toHaveCount(0);

  // The composer is still present (still in the session view, not bounced to the picker).
  await expect(composer).toBeVisible();

  // The second assistant chunk "done!" must NOT appear (process was killed before).
  await expect(outpostPage.getByText(/^done!$/)).toHaveCount(0);

  // Regression: after the interrupt the session is idle-but-resumable. Typing a
  // message must leave the send button live (armed, not muted) so the next send
  // can reconnect — previously it stayed wedged behind the disconnected mute
  // until the user reloaded the session.
  await composer.click();
  await outpostPage.keyboard.type('keep going');
  const send = outpostPage.locator('.sv-send');
  await expect(send).toHaveClass(/\barmed\b/);
  await expect(send).not.toHaveClass(/sv-send-disconnected/);
});

test('a message sent mid-turn is delivered to the running turn instead of stopping it', async ({ daemon, outpostPage }) => {
  await openSessionAtCwd(outpostPage, daemon, TEST_CWD);

  const composer = outpostPage.locator('.sv-composer');
  const send = outpostPage.locator('.sv-send');
  const stop = outpostPage.locator('.sv-stop');
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await expect(stop).toBeHidden();
  await composer.click();
  await outpostPage.keyboard.type('go');
  await outpostPage.keyboard.press('Enter');
  await expect(outpostPage.getByText('working on it')).toBeVisible({ timeout: 10_000 });

  // Mid-turn with nothing typed: Stop alone, no Send to mis-tap.
  await expect(stop).toBeVisible();
  await expect(send).toBeHidden();

  // Typing brings Send back beside Stop rather than in place of it.
  await composer.click();
  await outpostPage.keyboard.type('also check the docs');
  await expect(send).toBeVisible();
  await expect(send).toHaveClass(/\barmed\b/);
  await expect(stop).toBeVisible();

  // Tapping Send writes the message to the live subprocess — the mock's turn continues
  // on that input, which an interrupt would have killed before "done!".
  await send.click();
  await expect(outpostPage.locator('.sv-transcript-inner')).toContainText('also check the docs');
  await expect(outpostPage.getByText(/^done!$/)).toBeVisible({ timeout: 10_000 });
});
