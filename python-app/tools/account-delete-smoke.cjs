// Isolated UI checks: simulated API, no accounts or database are deleted.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../public');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || 'msedge' });
  try {
    for (const width of [320, 412, 1440]) for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://account.test/**', route => route.fulfill({ contentType: 'text/html', body: '<button id="delete-account-btn">Excluir conta</button><input id="password" type="password"><ul id="password-requirements" class="password-requirements" hidden></ul>' }));
      await page.goto('http://account.test/settings');
      for (const file of ['app.css', 'redesign.css']) await page.addStyleTag({ path: path.join(root, 'css', file) });
      // The destination fixture has no cross-document transition styles.
      await page.addStyleTag({ content: '@view-transition { navigation: none; }' });
      for (const file of ['api.js', 'ui.js', 'auth.js', 'modal.js', 'settings.js']) await page.addScriptTag({ path: path.join(root, 'js', file) });
      await page.evaluate(dark => {
        document.documentElement.classList.toggle('dark', dark);
        wirePasswordVisibility();
        wirePasswordRequirements(document.querySelector('#password'), document.querySelector('#password-requirements'));
        wireDeleteAccountButton();
        window.calls = [];
        window.events = [];
        window.apiFetch = async (url, options) => {
          calls.push({ url, ...options });
          sessionStorage.setItem('calls', JSON.stringify(calls));
          if (options.body.password !== 'test-password') throw new Error('Senha incorreta');
          return { ok: true };
        };
        window.emitTT = name => { events.push(name); sessionStorage.setItem('events', JSON.stringify(events)); return {}; };
      }, dark);
      await page.locator('#password').focus();
      assert.equal(await page.locator('#password-requirements').evaluate(el => getComputedStyle(el).animationName), 'password-hints-in');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('#password-requirements').evaluate(el => getComputedStyle(el).animationName), 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });

      const dialog = page.locator('.modal-overlay:not([inert])');
      const next = () => dialog.getByRole('button', { name: 'Continuar', exact: true }).click();
      async function start(password = 'test-password') {
        await page.locator('#delete-account-btn').click();
        await dialog.locator('input').fill(password);
        await next();
        await dialog.getByRole('heading', { name: 'Confirme a frase — etapa 2 de 3' }).waitFor();
      }
      async function phrase() {
        await dialog.locator('input').fill('eu quero excluir essa conta');
        await next();
        await dialog.getByRole('heading', { name: 'Tem certeza que quer excluir essa conta?' }).waitFor();
      }
      async function cancel() {
        await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.modal-overlay'));
        assert.equal(await page.locator('#delete-account-btn').evaluate(el => el === document.activeElement), true);
      }
      await page.locator('#delete-account-btn').click();
      await next();
      await dialog.getByText('Digite sua senha para confirmar.', { exact: true }).waitFor();
      await cancel();
      await start();
      await dialog.locator('input').fill('excluir');
      await next();
      await dialog.getByText('Digite a frase exatamente como indicada.').waitFor();
      await cancel();
      await start();
      await phrase();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await cancel();
      assert.equal(await page.evaluate(() => calls.length), 0);
      await start('wrong-password');
      await phrase();
      await dialog.getByRole('button', { name: 'Excluir definitivamente' }).click();
      await dialog.locator('.modal-error').filter({ hasText: 'Senha incorreta' }).waitFor();
      assert.equal(await page.evaluate(() => events.length), 0);
      await cancel();
      await start();
      await phrase();
      await dialog.getByRole('button', { name: 'Excluir definitivamente' }).click();
      await page.waitForURL('http://account.test/');
      const calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('calls')));
      assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('events'))), ['account-deleted', 'logout']);
      assert.deepEqual(calls.at(-1).body, { password: 'test-password', confirmation: 'eu quero excluir essa conta' });
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px ${dark ? 'dark' : 'light'}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
