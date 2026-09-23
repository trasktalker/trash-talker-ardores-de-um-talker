const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async ({ context, base }) => {
  let checks = 0;
  for (const voice of [false, true]) {
    const page = await context.newPage();
    await page.addInitScript(voice => {
      window.SpeechRecognition = voice ? class { start() {} stop() {} abort() {} } : undefined;
      window.webkitSpeechRecognition = undefined;
    }, voice);
    for (const theme of ['light', 'dark']) for (const width of [320,360,390,412,480,639,640,1440]) {
      await page.setViewportSize({ width, height: 892 });
      for (const route of ['/dashboard', '/dashboard/chat/preview', '/dashboard/account']) {
        await page.goto(base + route);
        await page.waitForLoadState('networkidle');
        await page.evaluate(theme => setTheme(theme), theme);
        const mobile = width <= 639;
        if (route.endsWith('account')) {
          assert.equal(await page.locator('.illustrated-avatars').isVisible(), !mobile);
          assert(await page.locator('#avatar-trigger').isVisible());
          const image = await page.locator('#avatar-image-input').inputValue();
          await page.setViewportSize({ width: mobile ? 1440 : 412, height: 892 });
          assert.equal(await page.locator('#avatar-image-input').inputValue(), image);
          await page.setViewportSize({ width, height: 892 });
        } else {
          await page.locator('#personality-picker .personality-picker-trigger').waitFor();
          await page.locator('.social-menu-trigger').waitFor();
          const layout = await page.evaluate(() => {
            const rect = s => { const r=document.querySelector(s).getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, height:r.height }; };
            return { form:rect('.composer'), note:rect('.composer-disclosure'), input:rect('.composer textarea'), picker:rect('#personality-picker'), social:rect('.social-tools'), effort:getComputedStyle(document.querySelector('.picker-effort')).display, noteCount:document.querySelectorAll('.composer-disclosure p').length };
          });
          assert.equal(layout.input.height, 44);
          assert.equal(layout.noteCount, 1);
          assert.equal(layout.effort === 'none', mobile);
          if (mobile) {
            assert.ok(layout.note.bottom <= layout.form.y, 'Notice must precede composer');
            assert.ok(Math.abs(layout.picker.y-layout.social.y)<1, `Menus not aligned: ${width}`);
            assert.ok(layout.social.x >= layout.picker.right && layout.social.x-layout.picker.right <= 8, 'Menus must be adjacent');
          } else assert.ok(layout.note.y >= layout.form.bottom);
          await page.locator('.composer textarea').fill('Mensagem longa para conferir o campo.\n'.repeat(20));
          const long = await page.locator('.composer textarea').evaluate(el => ({height:el.getBoundingClientRect().height, scroll:el.scrollHeight, client:el.clientHeight}));
          assert.equal(long.height,120); assert.ok(long.scroll>long.client);
          await page.locator('.composer textarea').fill('');
          assert.equal(await page.locator('.composer textarea').evaluate(el=>el.getBoundingClientRect().height),44);
          for(const selector of ['#personality-picker .personality-picker-trigger','.social-menu-trigger']) {
            await page.locator(selector).click();
            const bounds=await page.locator('.personality-picker-menu.open').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;});
            assert.ok(bounds, `Menu outside viewport: ${width} ${route} ${selector}`);
            await page.keyboard.press('Escape');
          }
          if (voice && width===412) {
            await page.locator('#personality-picker .personality-picker-trigger').click();
            await page.getByRole('menuitemradio').filter({hasText:'MathIAs'}).click();
            assert.ok((await page.locator('#personality-picker .picker-personality').innerText()).includes('MathIAs'));
            await page.locator('#personality-picker .personality-picker-trigger').click();
            await page.getByRole('menuitemradio').filter({hasText:'Mais elaborada'}).click();
            assert.ok((await page.locator('.picker-effort').textContent()).includes('Mais elaborada'));
          }
        }
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), `Page overflow ${width} ${route}`);
        assert.ok(await page.locator('.composer-actions').count()===0 || await page.locator('.composer-actions').evaluate(el=>[...el.children].every(child=>{const r=child.getBoundingClientRect();return r.width===0 || (r.left>=0 && r.right<=innerWidth)})), `Controls overflow ${width}`);
        if(voice && [412,1440].includes(width)) await page.screenshot({path:path.join(__dirname,`compact-${route.split('/').pop()}-${width}-${theme}.png`),fullPage:true});
        checks++;
      }
    }
    await page.close();
  }
  console.log(JSON.stringify({compactChecks:checks, mockedAPIs:true}));
};
