import { mkdirSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, openSessionAtCwd } from './harness/browser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolvePath(__dirname, 'fixtures', 'streaming-burst.jsonl');
const TEST_CWD = '/tmp/outpost-e2e-tap-while-streaming';

// The meter strip is mobile-only, and the bug only shows with a real touch: a tap is a
// touchstart and a touchend ~100ms apart, and the browser synthesizes the click only if
// both land on the same node. Every streamed token repaints the session view, and the
// meter used to rebuild its button on every paint — so mid-turn, the touchend landed on
// a replacement and the tap vanished. Playwright's .tap() is instantaneous and can't see it.
test.use({ daemonOpts: { fixturePath: FIXTURE }, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.beforeAll(() => {
  mkdirSync(TEST_CWD, { recursive: true });
});

test('a finger-length tap on the meter registers while tokens are streaming', async ({ daemon, outpostPage, context }) => {
  await openSessionAtCwd(outpostPage, daemon, TEST_CWD);
  const composer = outpostPage.locator('.sv-composer');
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.tap();
  await outpostPage.keyboard.type('go');
  await outpostPage.locator('.sv-send').tap();
  await expect(outpostPage.getByText('working on it')).toBeVisible({ timeout: 10_000 });

  // The burst behind "working on it" is 600 deltas at 5ms apiece — tap inside it.
  const meter = outpostPage.locator('button.meter');
  const box = await meter.boundingBox();
  if (!box) throw new Error('meter not laid out');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await context.newCDPSession(outpostPage);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await outpostPage.waitForTimeout(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(outpostPage.locator('.sv-stop')).toBeVisible();
  await expect(outpostPage.locator('button.meter')).toHaveAttribute('aria-expanded', 'true');
});
