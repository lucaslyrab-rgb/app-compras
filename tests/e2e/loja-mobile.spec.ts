import { expect, test } from '@playwright/test';

// An isolated component preview may be supplied for UI-only checks without a database.
// Otherwise this suite uses a configured test Loja account and never submits orders.
for (const [width, height] of [[320, 568], [375, 667], [390, 844], [412, 915], [768, 1024], [1280, 900]]) {
  test(`Pedido da Loja: layout e digitação ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const preview = process.env.LOJA_PREVIEW_URL;
    if (preview) {
      await page.goto(preview);
    } else {
      test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Requer conta Loja de teste ou prévia isolada');
      await page.goto('/login');
      await page.getByLabel('E-mail').fill(process.env.E2E_EMAIL!);
      await page.getByLabel('Senha').fill(process.env.E2E_PASSWORD!);
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    }
    const rows = page.locator('.product-card');
    await expect(rows.first()).toBeVisible();
    const firstId = await rows.first().locator('input[name="productId"]').inputValue();
    const first = page.locator('.product-card').filter({has: page.locator(`input[name="productId"][value="${firstId}"]`)});
    const stock = first.locator('input[name="stock"]');
    const quantity = first.locator('input[name="quantity"]');
    await stock.fill('99999');
    await stock.press('Enter');
    await expect(quantity).toBeFocused();
    await quantity.fill('12345');
    await quantity.press('Enter');
    await expect(rows.nth(1).locator('input[name="stock"]')).toBeFocused();
    await stock.focus();
    expect(await stock.evaluate(el => ({start:(el as HTMLInputElement).selectionStart, end:(el as HTMLInputElement).selectionEnd}))).toEqual({start:0, end:5});
    expect(await stock.getAttribute('inputmode')).toBe('decimal');
    expect(await stock.getAttribute('maxlength')).toBeNull();
    expect(await stock.getAttribute('aria-label')).toContain('Estoque atual de');
    const inputFits = await stock.evaluate(el => {
      const style = getComputedStyle(el);
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return context.measureText((el as HTMLInputElement).value).width <= el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    expect(inputFits).toBe(true);
    const name = await first.locator('h2').innerText();
    const search = page.getByPlaceholder('Buscar produto…');
    await search.fill('não existe produto xyz');
    await expect(rows).toHaveCount(0);
    await search.fill(name.toLocaleLowerCase('pt-BR'));
    await expect(stock).toHaveValue('99999');
    await expect(quantity).toHaveValue('12345');
    await page.getByRole('button', {name:'Com pedido', exact:true}).click();
    await expect(first).toBeVisible();
    await page.getByRole('button', {name:'Sem pedido', exact:true}).click();
    await expect(first).toHaveCount(0);
    await page.getByRole('button', {name:'Todos', exact:true}).click();
    await expect(quantity).toHaveValue('12345');
    await search.fill('');
    if (preview) {
      await search.fill('1000');
      await expect(rows).toHaveCount(1);
      await expect(stock).toHaveValue('99999');
      await search.fill('');
    }
    await stock.focus();
    await stock.press('Enter');
    await expect(quantity).toBeFocused();
    await quantity.press('Enter');
    await expect(rows.nth(1).locator('input[name="stock"]')).toBeFocused();
    if (width <= 600) {
      expect((await stock.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await stock.boundingBox())!.width).toBe(66);
      await expect(first.locator('.product-thumbnail')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const overflow = await rows.evaluateAll(elements => elements.some(el => el.scrollWidth > el.clientWidth));
      expect(overflow).toBe(false);
      // Short viewport simulates reduced available space, not the native iOS keyboard.
      await page.setViewportSize({width, height: Math.min(height, 430)});
      const lastInput = rows.last().locator('input[name="quantity"]');
      await lastInput.focus();
      const fieldBox = (await lastInput.boundingBox())!;
      const footerBox = (await page.locator('.sticky-actions').boundingBox())!;
      expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(footerBox.y);
      expect(fieldBox.y).toBeGreaterThanOrEqual(0);
      await page.setViewportSize({width, height});
    } else {
      await expect(first.locator('.product-thumbnail')).toBeHidden();
      await expect(page.locator('.product-list__header')).toBeVisible();
    }
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({path: test.info().outputPath(`loja-${width}.png`), fullPage:false});
  });
}
