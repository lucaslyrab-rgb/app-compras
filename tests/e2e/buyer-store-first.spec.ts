import { expect, test, type Page, type TestInfo } from "@playwright/test";
import postgres from "postgres";

const password = process.env.CONSOLIDATED_E2E_PASSWORD ?? "";
const cycle = "2097-09-24";

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

async function cleanCycleData() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    await sql`DELETE FROM purchase_cycle_buyer_closures WHERE purchase_cycle_date = ${cycle}::date`;
    await sql`DELETE FROM purchase_cycle_store_closures WHERE purchase_cycle_date = ${cycle}::date`;
    await sql`DELETE FROM purchase_cycle_supplier_store_reviews WHERE purchase_cycle_date = ${cycle}::date`;
    await sql`DELETE FROM purchase_cycle_product_supplier_decisions WHERE purchase_cycle_date = ${cycle}::date`;
    await sql`DELETE FROM purchase_cycle_product_allocations WHERE purchase_cycle_date = ${cycle}::date`;
    await sql`DELETE FROM purchase_cycle_participating_stores WHERE purchase_cycle_date = ${cycle}::date`;
  } finally {
    await sql.end();
  }
}

test.describe("Experiência Operacional Store-First do Comprador", () => {
  test.beforeEach(async () => {
    test.skip(!password, "Requer CONSOLIDATED_E2E_PASSWORD configurada para rodar contra o banco E2E");
    await cleanCycleData();
  });

  test.afterAll(async () => {
    await cleanCycleData();
  });

  test("Desktop (1280px): Navegação fixa por loja, distinção de sugestões, ação negativa e conclusão em lote", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);

    await page.goto(`/comprador/destinacao?ciclo=${cycle}`);

    // 1. Dashboard inicial exibe as 3 lojas padrão da rede
    const storesNav = page.locator(".alloc-store-nav");
    await expect(storesNav).toBeVisible();
    await expect(page.getByRole("button", { name: /Ponta da Fruta/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Balneário/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Santa Mônica/i })).toBeVisible();

    // 2. Comprovação no browser: Fechamento Geral Bloqueado enquanto houver lojas pendentes
    const closeCycleBtn = page.getByRole("button", { name: /Fechar Ciclo Geral/i });
    await expect(closeCycleBtn).toBeVisible();
    await closeCycleBtn.click();

    const closeCycleModal = page.locator('[role="dialog"]').filter({ hasText: /Fechar Ciclo Operacional do Comprador/i });
    await expect(closeCycleModal).toBeVisible();
    await expect(closeCycleModal.locator("text=Não é possível fechar o ciclo ainda")).toBeVisible();
    const confirmCloseBtn = closeCycleModal.getByRole("button", { name: /Confirmar Fechamento/i });
    await expect(confirmCloseBtn).toBeDisabled();
    await closeCycleModal.getByRole("button", { name: /Cancelar/i }).click();
    await expect(closeCycleModal).not.toBeVisible();

    // 3. Seleciona Santa Mônica: a loja fica ativa
    const santaMonicaTab = page.locator(".alloc-store-tab").filter({ hasText: "Santa Mônica" });
    await santaMonicaTab.click();
    await expect(page.locator(".alloc-store-tab--active")).toContainText("Santa Mônica");

    // 4. Seleciona fornecedor Corteletti mantendo Santa Mônica fixa
    const supplierSelect = page.locator("#supplier-selector");
    await expect(supplierSelect).toBeVisible();
    const cortelettiOption = supplierSelect.locator("option").filter({ hasText: "Corteletti" });
    const cortelettiVal = await cortelettiOption.getAttribute("value");
    expect(cortelettiVal).toBeTruthy();
    await supplierSelect.selectOption(cortelettiVal!);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".alloc-store-tab--active")).toContainText("Santa Mônica");

    // 5. Decisão Individual ("Não comprei deste fornecedor") com confirmação, persistência e reversão
    const productCard = page.locator(".alloc-product-card").first();
    await expect(productCard).toBeVisible();
    await expect(productCard).toContainText("UVA VITÓRIA E2E");

    // Executa ação negativa individual
    const notPurchasedBtn = productCard.getByRole("button", { name: /Não comprei deste fornecedor/i });
    await expect(notPurchasedBtn).toBeVisible();
    await notPurchasedBtn.click();
    await expect(productCard.locator(".alloc-not-purchased-banner")).toContainText("Não comprado deste fornecedor nesta loja");

    // Recarrega a página para comprovar persistência da decisão individual
    await page.reload();
    const reloadedCard = page.locator(".alloc-product-card").first();
    await expect(reloadedCard.locator(".alloc-not-purchased-banner")).toContainText("Não comprado deste fornecedor nesta loja");
    const revertBtn = reloadedCard.locator(".alloc-btn-revert");
    await expect(revertBtn).toBeVisible();

    // Reverte a decisão individual
    await revertBtn.click();
    await expect(reloadedCard.locator(".alloc-not-purchased-banner")).not.toBeVisible();

    // Recarrega a página para comprovar persistência da reversão
    await page.reload();
    const revertedCard = page.locator(".alloc-product-card").first();
    await expect(revertedCard.getByRole("button", { name: /Não comprei deste fornecedor/i })).toBeVisible();

    // 6. Conclusão em Lote do Fornecedor com confirmação e persistência
    const concludeSupplierBtn = page.getByRole("button", {
      name: /Concluir Conferência deste Fornecedor/i,
    });
    await expect(concludeSupplierBtn).toBeVisible();
    await concludeSupplierBtn.click();

    const batchModal = page.locator('[role="dialog"]').filter({ hasText: /Concluir Conferência deste Fornecedor/i });
    await expect(batchModal).toBeVisible();
    await expect(batchModal.locator("text=UVA VITÓRIA E2E")).toBeVisible();
    await capture(page, testInfo, "03-modal-concluir-fornecedor");

    // Confirma conclusão em lote
    await batchModal.getByRole("button", { name: /Confirmar Conclusão do Fornecedor/i }).click();
    await expect(batchModal).not.toBeVisible();

    // Recarrega a página e comprova persistência da conferência do fornecedor
    await page.reload();
    const checkedSelect = page.locator("#supplier-selector");
    await expect(checkedSelect.locator("option:checked")).toContainText("(Conferido)");

    // 7. Modal de Conferência Conjunta de Cortes por Loja e Finalização
    const finalizeStoreBtn = page.getByRole("button", {
      name: /Conferir Cortes e Finalizar Loja/i,
    });
    await expect(finalizeStoreBtn).toBeVisible();
    await finalizeStoreBtn.click();

    const cutsModal = page.locator('[role="dialog"]').filter({ hasText: /Conferência Conjunta dos Cortes/i });
    await expect(cutsModal).toBeVisible();
    await expect(cutsModal.locator("table")).toBeVisible();
    await capture(page, testInfo, "02-modal-conferencia-cortes");

    // Confirma finalização da loja
    await cutsModal.getByRole("button", { name: /Confirmar Cortes e Finalizar Loja/i }).click();
    await expect(cutsModal).not.toBeVisible();

    // Recarrega a página e comprova status Finalizada
    await page.reload();
    const activeFinalizedTab = page.locator(".alloc-store-tab--active");
    await expect(activeFinalizedTab.locator(".alloc-status-pill--closed")).toContainText("Finalizada");
    await expect(page.getByRole("button", { name: /Ver Cortes da Loja/i })).toBeVisible();
    await capture(page, testInfo, "01-desktop-workspace-balneario");

    // 8. Reabertura da Conferência com Justificativa Auditada, Ajuste de Quantidade e Reconferência
    await page.getByRole("button", { name: /Ver Cortes da Loja/i }).click();
    const viewCutsModal = page.locator('[role="dialog"]').filter({ hasText: /Conferência Conjunta dos Cortes/i });
    await expect(viewCutsModal).toBeVisible();

    const reopenStoreBtn = viewCutsModal.getByRole("button", { name: /Reabrir Conferência desta Loja/i });
    await expect(reopenStoreBtn).toBeVisible();
    await reopenStoreBtn.click();

    // Preenche modal de justificativa
    const reopenStoreModal = page.locator('[role="dialog"]').filter({ hasText: /Reabrir Conferência/i });
    await expect(reopenStoreModal).toBeVisible();
    await reopenStoreModal.locator("#reopen-store-reason").fill("Ajuste de conferência pós-auditoria independente");
    await reopenStoreModal.getByRole("button", { name: /Confirmar Reabertura da Loja/i }).click();
    await expect(reopenStoreModal).not.toBeVisible();

    // Recarrega a página e comprova loja reaberta
    await page.reload();
    const reopenedTab = page.locator(".alloc-store-tab--active");
    await expect(reopenedTab.locator(".alloc-status-pill--closed")).not.toBeVisible();

    // Ajusta quantidade do produto e salva
    const stepperInput = page.locator(".alloc-stepper-input").first();
    await stepperInput.fill("4.00");
    const saveStoreBtn = page.getByRole("button", { name: /Salvar Destinações/i });
    await expect(saveStoreBtn).toBeEnabled();
    await saveStoreBtn.click();
    await expect(page.locator(".alloc-banner").filter({ hasText: /Destinações salvas com sucesso/i })).toBeVisible();

    // Recarrega a página e comprova que o valor 4.00 persistiu
    await page.reload();
    const reloadedInput = page.locator(".alloc-stepper-input").first();
    await expect(reloadedInput).toHaveValue("4.00");

    // Reconferência e finalização com a nova quantidade
    const reconcludeStoreBtn = page.getByRole("button", {
      name: /Conferir Cortes e Finalizar Loja/i,
    });
    await expect(reconcludeStoreBtn).toBeVisible();
    await reconcludeStoreBtn.click();

    const reconferModal = page.locator('[role="dialog"]').filter({ hasText: /Conferência Conjunta dos Cortes/i });
    await expect(reconferModal).toBeVisible();
    await reconferModal.getByRole("button", { name: /Confirmar Cortes e Finalizar Loja|Reconfirmar/i }).click();
    await expect(reconferModal).not.toBeVisible();

    // Recarrega a página e comprova loja finalizada novamente
    await page.reload();
    const reFinalizedTab = page.locator(".alloc-store-tab--active");
    await expect(reFinalizedTab.locator(".alloc-status-pill--closed")).toContainText("Finalizada");
  });

  test("Mobile (390px): Visualização responsiva, cartões compactos e scroll seguro", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    await page.goto(`/comprador/destinacao?ciclo=${cycle}`);

    // As 3 lojas devem ser navegáveis no mobile
    await expect(page.getByRole("button", { name: /Ponta da Fruta/i })).toBeVisible();
    const balnearioBtn = page.locator(".alloc-store-tab").filter({ hasText: "Balneário" });
    await expect(balnearioBtn).toBeVisible();
    await balnearioBtn.click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".alloc-store-tab--active")).toContainText("Balneário");

    // Sem overflow horizontal na página
    const pageScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const pageClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(pageScrollWidth).toBeLessThanOrEqual(pageClientWidth + 1);

    // Modal de cortes no mobile também sem overflow horizontal
    const cutsBtn = page.getByRole("button", { name: /Conferir Cortes e Finalizar Loja/i });
    await expect(cutsBtn).toBeVisible();
    await cutsBtn.click();

    const cutsModal = page.locator('[role="dialog"]').filter({ hasText: /Conferência Conjunta dos Cortes/i });
    await expect(cutsModal).toBeVisible();

    const modalBody = cutsModal.locator(".alloc-modal");
    await expect(modalBody).toBeVisible();
    const modalScrollWidth = await modalBody.evaluate((el) => el.scrollWidth);
    const modalClientWidth = await modalBody.evaluate((el) => el.clientWidth);
    expect(modalScrollWidth).toBeLessThanOrEqual(modalClientWidth + 1);

    // Botão de fechar no modal mobile deve estar visível e navegável
    const modalCloseBtn = cutsModal.getByRole("button", { name: "Fechar" });
    await expect(modalCloseBtn).toBeVisible();
    await modalCloseBtn.click();
    await expect(cutsModal).not.toBeVisible();

    await capture(page, testInfo, "04-mobile-workspace");
  });
});
