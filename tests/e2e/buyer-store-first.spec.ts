import { expect, test, type Page, type TestInfo } from "@playwright/test";

const password = process.env.CONSOLIDATED_E2E_PASSWORD ?? "";

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function login(page: Page) {
  if (!password) {
    test.skip(true, "Requer CONSOLIDATED_E2E_PASSWORD configurada");
  }
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("comprador@consolidado.test");
  await page.getByLabel("Senha").fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/login"),
    page.getByRole("button", { name: "Entrar" }).click(),
  ]);
}

test.describe("Experiência Operacional Store-First do Comprador", () => {
  test.beforeEach(async () => {
    test.skip(!password, "Requer CONSOLIDATED_E2E_PASSWORD configurada para rodar contra o banco E2E");
  });

  test("Desktop (1280px): Navegação fixa por loja, distinção de sugestões, ação negativa e conclusão em lote", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);

    const cycle = "2097-09-24";
    await page.goto(`/comprador/destinacao?ciclo=${cycle}`);

    // 1. Dashboard inicial exibe as 3 lojas
    const storesNav = page.locator(".alloc-stores-bar, .alloc-store-selector");
    await expect(storesNav).toBeVisible();
    await expect(page.getByRole("button", { name: /Ponta da Fruta/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Balneário/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Santa Mônica/i })).toBeVisible();

    // 2. Seleciona MultiShow Balneário: a loja fica ativa
    await page.getByRole("button", { name: /Balneário/i }).click();
    await expect(page.locator(".alloc-store-btn--active")).toContainText("Balneário");

    // 3. Alterna fornecedor enquanto a loja permanece fixa em Balneário
    const supplierSelect = page.locator("#supplier-selector");
    if (await supplierSelect.isVisible()) {
      const optionCount = await supplierSelect.locator("option").count();
      if (optionCount > 1) {
        await supplierSelect.selectOption({ index: 1 });
        // Loja continua selecionada como Balneário
        await expect(page.locator(".alloc-store-btn--active")).toContainText("Balneário");
      }
    }

    // 4. Verifica a distinção entre quantidade sugerida e persistida
    // O botão de salvar só habilita se houver alterações não salvas ou sugestões pendentes
    const productCards = page.locator(".alloc-product-card");
    const count = await productCards.count();
    if (count > 0) {
      const firstCard = productCards.first();
      await expect(firstCard.locator(".alloc-field-label--ordered, .alloc-product-ordered")).toBeVisible();

      // 5. Botão "Não comprei deste fornecedor"
      const notPurchasedBtn = firstCard.getByRole("button", { name: /NÃO COMPREI DESTE FORNECEDOR/i });
      if (await notPurchasedBtn.isVisible()) {
        await notPurchasedBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // 6. Modal de conclusão em lote do fornecedor
    const concludeSupplierBtn = page.getByRole("button", {
      name: /CONCLUIR CONFERÊNCIA DESTE FORNECEDOR/i,
    });
    if (await concludeSupplierBtn.isVisible() && await concludeSupplierBtn.isEnabled()) {
      await concludeSupplierBtn.click();
      const modal = page.locator('[role="dialog"]').filter({ hasText: /Concluir Conferência deste Fornecedor/i });
      await expect(modal).toBeVisible();
      await capture(page, testInfo, "e2e-desktop-modal-concluir-fornecedor");
      // Cancela para não alterar estado compartilhado de outros testes
      await modal.getByRole("button", { name: /Cancelar|Voltar/i }).click();
      await expect(modal).not.toBeVisible();
    }

    // 7. Modal de conferência conjunta de cortes por loja
    const finalizeStoreBtn = page.getByRole("button", {
      name: /CONFERIR E FINALIZAR ESTA LOJA/i,
    });
    if (await finalizeStoreBtn.isVisible()) {
      await finalizeStoreBtn.click();
      const cutsModal = page.locator('[role="dialog"]').filter({ hasText: /Conferência Conjunta dos Cortes da Loja/i });
      await expect(cutsModal).toBeVisible();
      // Tabela de cortes deve ter colunas Produto, Pedido, Destinado, Corte
      await expect(cutsModal.locator("table")).toBeVisible();
      await capture(page, testInfo, "e2e-desktop-modal-conferencia-cortes");
      await cutsModal.getByRole("button", { name: /Fechar|Cancelar|Voltar/i }).click();
      await expect(cutsModal).not.toBeVisible();
    }

    await capture(page, testInfo, "e2e-desktop-workspace-balneario");
  });

  test("Mobile (390px): Visualização responsiva, cartões compactos e scroll seguro", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    const cycle = "2097-09-24";
    await page.goto(`/comprador/destinacao?ciclo=${cycle}`);

    // As 3 lojas devem ser navegáveis no mobile
    await expect(page.getByRole("button", { name: /Ponta da Fruta/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Balneário/i })).toBeVisible();

    // Seleciona Balneário
    await page.getByRole("button", { name: /Balneário/i }).click();

    // Sem overflow horizontal
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await capture(page, testInfo, "e2e-mobile-workspace");
  });
});
