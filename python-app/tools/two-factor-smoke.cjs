// End-to-end com API real. Execute somente contra servidor local + banco de teste.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const base = new URL(process.env.TWO_FACTOR_TEST_URL || 'http://127.0.0.1:5057');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Somente servidor local de teste');
const password = 'Senha-Teste-2fa-123';

// Implementação independente do RFC 6238 para testar a interoperabilidade do servidor.
function totp(secret, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const hash = crypto.createHmac('sha1', key).update(counter).digest();
  const start = hash.at(-1) & 15;
  return String((hash.readUInt32BE(start) & 0x7fffffff) % 1000000).padStart(6, '0');
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || 'msedge' });
  try {
    for (const width of [320, 412, 1440]) for (const dark of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: dark ? 'dark' : 'light' });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const email = `two-factor-${crypto.randomUUID()}@example.test`;
      let result = await context.request.post(new URL('/api/signup', base).href, {
        data: { name: 'Teste 2FA', email, password },
      });
      assert.equal(result.status(), 201);

      async function login() {
        await page.goto(new URL('/login', base).href);
        await page.locator('#email').fill(email);
        await page.locator('#password').fill(password);
        await page.locator('#login-form button[type=submit]').click();
      }
      async function logout() {
        assert.equal((await context.request.post(new URL('/api/logout', base).href)).status(), 200);
      }
      async function fits() {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Overflow horizontal');
      }
      async function reauth(code) {
        await page.locator('#two-factor-password').fill(password);
        await page.locator('#two-factor-reauth-code').fill(code);
        await page.locator('#two-factor-action-submit').click();
      }

      await login();
      await page.waitForURL('**/dashboard');
      await page.goto(new URL('/dashboard/settings', base).href);
      await page.locator(`[data-theme-btn="${dark ? 'dark' : 'light'}"]`).click();
      await page.locator('#two-factor-start').click();
      await page.locator('#two-factor-password').fill(password);
      await page.locator('#two-factor-action-submit').click();
      await page.locator('#two-factor-enrollment').waitFor({ state: 'visible' });
      const secret = await page.locator('#two-factor-manual-key').textContent();
      assert.match(secret, /^[A-Z2-7]{32}$/);
      assert.equal(await page.locator('#two-factor-qr').evaluate(img => img.complete && img.naturalWidth > 0), true);
      await fits();
      await page.locator('#two-factor-confirm-code').fill(totp(secret));
      await page.locator('#two-factor-confirm-form button[type=submit]').click();
      await page.locator('#two-factor-recovery').waitFor({ state: 'visible' });
      const codes = await page.locator('#two-factor-recovery-list code').allTextContents();
      assert.equal(codes.length, 8);
      assert.equal(await page.locator('#two-factor-manual-key').textContent(), '');
      await fits();
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#two-factor-download').click();
      const download = await downloadPromise;
      assert.ok((await fs.readFile(await download.path(), 'utf8')).includes(codes[0]));
      await page.locator('#two-factor-done').click();
      await page.locator('#two-factor-regenerate').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#two-factor-recovery-list code').count(), 0);
      assert.equal(await page.evaluate(secret => Object.values(localStorage).some(value => value.includes(secret)), secret), false);

      await logout();
      await login();
      await page.locator('#login-2fa-form').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#password').inputValue(), '');
      assert.equal((await context.request.get(new URL('/api/me', base).href)).status(), 401);
      const nextCode = totp(secret, 1);
      await page.locator('#login-2fa-code').fill(nextCode);
      await page.locator('#login-2fa-form button[type=submit]').click();
      await page.waitForURL('**/dashboard');

      await logout();
      await login();
      await page.locator('#login-2fa-code').fill(nextCode);
      await page.locator('#login-2fa-form button[type=submit]').click();
      await page.locator('#login-2fa-error').waitFor({ state: 'visible' });
      assert.equal((await context.request.get(new URL('/api/me', base).href)).status(), 401);
      await page.locator('#login-use-recovery').click();
      await page.locator('#login-2fa-code').fill(codes[0]);
      await page.locator('#login-2fa-form button[type=submit]').click();
      await page.waitForURL('**/dashboard');

      await page.goto(new URL('/dashboard/settings', base).href);
      await page.locator('#two-factor-regenerate').click();
      await reauth(codes[1]);
      await page.locator('#two-factor-recovery').waitFor({ state: 'visible' });
      const newCodes = await page.locator('#two-factor-recovery-list code').allTextContents();
      assert.equal(newCodes.length, 8);
      assert.ok(newCodes.every(code => !codes.includes(code)));
      await page.locator('#two-factor-done').click();
      await page.locator('#two-factor-disable').click();
      await reauth(codes[2]);
      await page.locator('#two-factor-error').waitFor({ state: 'visible' });
      await reauth(newCodes[0]);
      await page.locator('#two-factor-start').waitFor({ state: 'visible' });
      await fits();
      await fs.mkdir(path.join(__dirname, '../artifacts'), { recursive: true });
      await page.locator('#two-factor-card').screenshot({ path: path.join(__dirname, `../artifacts/2fa-${width}-${dark ? 'dark' : 'light'}.png`) });

      await logout();
      await login();
      await page.waitForURL('**/dashboard');
      result = await context.request.post(new URL('/api/account/delete', base).href, {
        data: { password, confirmation: 'eu quero excluir essa conta' },
      });
      assert.equal(result.status(), 200);
      assert.deepEqual(errors, []);
      console.log(`PASS real API: ${width}px ${dark ? 'dark' : 'light'} — ativação, TOTP, replay, recuperação, renovação e desativação`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
