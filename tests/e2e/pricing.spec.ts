import { expect, test, type Page } from "@playwright/test";

const password = process.env.CONSOLIDATED_E2E_PASSWORD ?? "";

async function login(page: Page, role: "gestor" | "comprador" | "loja" = "gestor") {
  if (!password) throw new Error("CONSOLIDATED_E2E_PASSWORD é obrigatória");
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${role}@consolidado.test`);
  await page.getByLabel("Senha").fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/login"),
    page.getByRole("button", { name: "Entrar" }).click(),
  ]);
}

test("Gestor administra produtos e configurações em layout responsivo", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/produtos");
  await expect(page).toHaveURL(/\/gestor\/produtos/);
  await expect(page.getByRole("heading", { name: "Cadastro de Produtos - FLV" })).toBeVisible();
  await expect(page.getByText("Configurações gerais da precificação (FLV)")).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await expect(page.locator(".manager-mobile-card").first()).toBeVisible();
    await expect(page.locator(".manager-table-wrap")).toBeHidden();
    await page.getByLabel("Abrir menu").click();
    await expect(page.getByRole("link", { name: "Precificação", exact: true })).toBeVisible();
    await page.locator(".ops-close").click();
    const editHref = await page.locator('.manager-mobile-card a[href^="/gestor/produtos/"]').first().getAttribute("href");
    expect(editHref).toBeTruthy();
    await page.goto(editHref!);
    await expect(page.locator(".manager-editor")).toBeVisible();
    await expect(page.getByRole("button", { name: "Salvar alterações" })).toBeVisible();
    await page.goto("/gestor/produtos");
  } else {
    await expect(page.locator(".manager-product-table")).toBeVisible();
    await expect(page.locator(".manager-editor")).toBeVisible();
  }
  await page.getByPlaceholder("Buscar por produto, ERP ou formato...").fill("BANANA TESTE");
  const searchedProduct = testInfo.project.name === "mobile"
    ? page.locator(".manager-mobile-card").getByText("BANANA TESTE", { exact: true })
    : page.locator(".manager-product-table").getByRole("row", { name: /BANANA TESTE/ });
  await expect(searchedProduct).toBeVisible();
  for (const width of [320, 375, 390, 412, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  }
  await page.goto("/gestor/configuracoes");
  const operating = page.getByLabel("Custo operacional sobre o preço de venda");
  await expect(operating).toHaveValue("23,00");
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText("Configurações salvas.")).toBeVisible();
  await page.reload();
  await expect(operating).toHaveValue("23,00");
});

test("Precificação exibe estados, cálculo, simulação, revisão e impressão", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/gestor/precificacao");
  await expect(page.getByRole("heading", { name: "Precificação - FLV" })).toBeVisible();
  const pricingList = testInfo.project.name === "mobile"
    ? page.locator(".manager-mobile-cards")
    : page.locator(".manager-table-wrap");
  await expect(pricingList.getByText("Custo alterado", { exact: true }).first()).toBeVisible();
  await expect(pricingList.getByText("Sem compra recente", { exact: true }).first()).toBeVisible();
  await expect(pricingList.getByText("Sem custo", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Sem compra recente/ }).click();
  await expect(pricingList.getByText("Sem compra recente", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Não revisados/ }).click();
  await expect(pricingList.getByText(/Não revisado|Custo alterado|Parâmetros alterados/, { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Todos/ }).click();
  const detailHref = await page.locator('a[href^="/gestor/precificacao/"]').filter({ hasText: "Analisar precificação" }).first().getAttribute("href");
  expect(detailHref).toBeTruthy();
  await page.goto(detailHref!);
  await expect(page.getByText("Preço sugerido", { exact: true })).toBeVisible();
  const simulated = page.getByLabel("Preço de venda");
  await simulated.fill("5,99");
  await expect(page.getByText("Margem líquida", { exact: true })).toBeVisible();
  await expect(page.getByText("Markup sobre custo", { exact: true })).toBeVisible();
  const review = page.getByRole("button", { name: "Marcar como revisado" });
  if (testInfo.project.name === "desktop" && await review.isVisible()) {
    await review.click();
    await expect(page.getByText("Revisão registrada.")).toBeVisible();
  }
  await page.goto("/gestor/precificacao");
  if (testInfo.project.name === "desktop") {
    await page.getByRole("button", { name: /^Revisados/ }).click();
    await expect(page.locator(".manager-table-wrap").getByText("Revisado", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Todos/ }).click();
  }
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: /Imprimir alterações/ }).click();
  const report = await popupPromise;
  await expect(report.getByRole("heading", { name: "Alterações de preços - FLV" })).toBeVisible();
  await expect(report.getByRole("button", { name: "Imprimir" })).toBeVisible();
});

test("RBAC bloqueia rotas gerenciais e drawer respeita o papel", async ({ page }, testInfo) => {
  await login(page, "comprador");
  await page.goto("/gestor/produtos");
  await expect(page).toHaveURL(/\/comprador\/consolidado/);
  await expect(page.getByText("Produtos", { exact: true })).toHaveCount(0);
  await page.goto("/gestor/precificacao/impressao");
  await expect(page).toHaveURL(/\/comprador\/consolidado/);
  await page.goto("/produtos");
  await expect(page).toHaveURL(/\/comprador\/consolidado/);
  await page.context().clearCookies();
  await login(page, "loja");
  await page.goto("/gestor/precificacao");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Pedido de hoje" })).toBeVisible();
  if (testInfo.project.name === "mobile") await expect(page.getByLabel("Abrir menu")).toHaveCount(0);
});

test("Lançamento de Custos persiste a natureza unitária do custo", async ({ page }) => {
  await login(page, "comprador");
  await page.goto("/comprador/custos?ciclo=2097-09-24");
  const card = page.locator(".cost-card").filter({ hasText: "CEBOLA TESTE" });
  const row = page.locator(".cost-table tbody tr").filter({ hasText: "CEBOLA TESTE" });
  const container = await card.isVisible() ? card : row;
  const checkbox = container.getByLabel("Custo informado é unitário");
  const nextChecked = !(await checkbox.isChecked());
  await checkbox.setChecked(nextChecked);
  await expect(container.getByText("Salvo", { exact: true })).toBeVisible();
  await page.reload();
  const reloadedContainer = await page.locator(".cost-card").filter({ hasText: "CEBOLA TESTE" }).isVisible()
    ? page.locator(".cost-card").filter({ hasText: "CEBOLA TESTE" })
    : page.locator(".cost-table tbody tr").filter({ hasText: "CEBOLA TESTE" });
  const reloadedCheckbox = reloadedContainer.getByLabel("Custo informado é unitário");
  if (nextChecked) await expect(reloadedCheckbox).toBeChecked();
  else await expect(reloadedCheckbox).not.toBeChecked();
});
