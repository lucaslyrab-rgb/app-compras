import { expect, test, type Page, type TestInfo } from "@playwright/test";

const password = process.env.CONSOLIDATED_E2E_PASSWORD ?? "";

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function login(page: Page, role: "gestor" | "comprador") {
  if (!password) throw new Error("CONSOLIDATED_E2E_PASSWORD é obrigatória");
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${role}@consolidado.test`);
  await page.getByLabel("Senha").fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/login"),
    page.getByRole("button", { name: "Entrar" }).click(),
  ]);
}

async function selectSupplier(page: Page, text: string, expectNavigation = true) {
  const selector = page.locator("#supplier-selector");
  const option = selector.locator("option").filter({ hasText: text });
  const value = await option.getAttribute("value");
  expect(value).toBeTruthy();
  await selector.selectOption(value!);
  if (expectNavigation) {
    await page.waitForURL((url) => url.searchParams.get("fornecedor") === value);
    await page.waitForLoadState("networkidle");
  }
}

test("Bug 01/04/05: pedido do catálogo, confirmação da sugestão e split explícito", async ({
  page,
}, testInfo) => {
  await login(page, "comprador");
  const cycle = testInfo.project.name === "mobile" ? "2097-09-23" : "2097-09-24";
  await page.goto(`/comprador/destinacao?ciclo=${cycle}`);
  await page.getByRole("button", { name: /Ponta da Fruta/ }).click();
  await selectSupplier(page, "UNIÃO FRUTAS E2E");

  await page.getByRole("button", { name: "+ Adicionar Outro Produto" }).click();
  const catalogDialog = page.locator('[role="dialog"]').filter({ hasText: "Adicionar Produto" });
  await expect(catalogDialog).toBeVisible();
  await catalogDialog.getByPlaceholder("Buscar produto por código ERP ou nome...").fill("UVA VITÓRIA E2E");
  const catalogItem = catalogDialog.locator(".alloc-modal-catalog-item").filter({ hasText: "UVA VITÓRIA E2E" });
  await expect(catalogItem).toContainText("Pedido Ponta da Fruta: 5.00 CX");
  await catalogItem.getByRole("button", { name: "+ Adicionar" }).click();

  const uvaCard = page.locator(".alloc-product-card").filter({ hasText: "UVA VITÓRIA E2E" });
  await expect(uvaCard.getByText(/Pedido da loja:/)).toContainText("5.00 CX");
  await expect(uvaCard.locator(".alloc-stepper-input")).toHaveValue("5.00");
  await capture(page, testInfo, `bug01-uva-pedido-${testInfo.project.name}`);

  await selectSupplier(page, "CORTELETTI E2E", false);
  const unsavedDialog = page.locator('[role="dialog"]').filter({ hasText: "Alterações não salvas" });
  await expect(unsavedDialog).toBeVisible();
  await unsavedDialog.getByRole("button", { name: "Descartar Alterações" }).click();
  await expect(page.locator("#supplier-selector option:checked")).toContainText("CORTELETTI E2E");

  const saveButton = page.getByRole("button", { name: "Salvar Destinações desta Loja" });
  await expect(page.getByText("Sugestões aguardando confirmação")).toBeVisible();
  await expect(saveButton).toBeEnabled();
  await capture(page, testInfo, `bug04-sugestao-confirmavel-${testInfo.project.name}`);
  await saveButton.click();
  await expect(page.getByText(/Destinações salvas com sucesso para MultiShow Ponta da Fruta/)).toBeVisible();
  await expect(saveButton).toBeDisabled();

  await page.reload();
  await expect(uvaCard.locator(".alloc-stepper-input")).toHaveValue("5.00");
  await expect(saveButton).toBeDisabled();

  await selectSupplier(page, "UNIÃO FRUTAS E2E");
  await page.getByRole("button", { name: "+ Adicionar Outro Produto" }).click();
  const refreshedCatalogDialog = page
    .locator('[role="dialog"]')
    .filter({ hasText: "Adicionar Produto" });
  await refreshedCatalogDialog
    .getByPlaceholder("Buscar produto por código ERP ou nome...")
    .fill("UVA VITÓRIA E2E");
  await refreshedCatalogDialog
    .locator(".alloc-modal-catalog-item")
    .filter({ hasText: "UVA VITÓRIA E2E" })
    .getByRole("button", { name: "+ Adicionar" })
    .click();
  await saveButton.click();

  const conflictDialog = page.getByRole("dialog", {
    name: "Confirmar destinação entre fornecedores",
  });
  await expect(conflictDialog).toContainText("CORTELETTI E2E");
  await expect(conflictDialog).toContainText("Total já destinado");
  await expect(conflictDialog).toContainText("Pedido original da loja");
  await expect(conflictDialog).toContainText("Quantidade adicional pretendida");
  await capture(page, testInfo, `bug05-conflito-fornecedores-${testInfo.project.name}`);
  await conflictDialog.getByRole("button", { name: "Confirmar compra dividida" }).click();
  await expect(page.getByText(/Destinações salvas com sucesso para MultiShow Ponta da Fruta/)).toBeVisible();
});

test("Bug 02: editor de produto mantém campos e ações dentro da viewport", async ({ page }, testInfo) => {
  await login(page, "gestor");
  await page.goto("/gestor/produtos");
  await page.getByPlaceholder("Buscar por produto, ERP ou formato...").fill("UVA VITÓRIA E2E");

  if (testInfo.project.name === "mobile") {
    const editHref = await page
      .locator('.manager-mobile-card a[href^="/gestor/produtos/"]')
      .getAttribute("href");
    expect(editHref).toBeTruthy();
    await page.goto(editHref!);
  } else {
    await page.getByRole("button", { name: /Editar UVA VITÓRIA E2E/ }).click();
  }

  const widths = testInfo.project.name === "mobile" ? [390, 768] : [1024, 1280, 1366];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const editor = page.locator(".manager-editor");
    await expect(editor).toBeVisible();
    const measurements = await editor.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const controls = Array.from(
        element.querySelectorAll<HTMLElement>(
          "input, select, button, .product-supplier-card, .manager-photo-manager",
        ),
      );
      return {
        viewportWidth: window.innerWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        editorLeft: bounds.left,
        editorRight: bounds.right,
        overflowingControls: controls
          .filter((control) => {
            const rect = control.getBoundingClientRect();
            return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
          })
          .map((control) => control.textContent?.trim() || control.tagName),
      };
    });
    expect(measurements.documentOverflow).toBeLessThanOrEqual(0);
    expect(measurements.editorLeft).toBeGreaterThanOrEqual(0);
    expect(measurements.editorRight).toBeLessThanOrEqual(measurements.viewportWidth + 1);
    expect(measurements.overflowingControls).toEqual([]);
    await capture(page, testInfo, `bug02-painel-produtos-${testInfo.project.name}-${width}px`);
  }
});
