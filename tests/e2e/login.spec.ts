import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("login é acessível e não causa overflow horizontal", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar no MultiShow FLV" })).toBeVisible();
  await expect(page.getByLabel("E-mail")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("E-mail")).toBeFocused();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("login permanece legível com zoom de 200%", async ({ page }) => {
  await page.goto("/login");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
});

test("credencial inválida recebe mensagem genérica", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("inexistente@example.com");
  await page.getByLabel("Senha").fill("credencial-invalida-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha inválidos.", { exact: true })).toBeVisible();
});

test("Loja salva, recupera e envia pedido móvel", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Fluxo operacional móvel");
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error("E2E_EMAIL e E2E_PASSWORD são obrigatórios");
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Pedido de hoje" })).toBeVisible();
  const card = page.locator(".product-card").first();
  const productName = await card.locator("h2").textContent();
  await page.getByPlaceholder("Buscar produto…").fill((productName ?? "").slice(0, 6));
  await expect(card).toBeVisible();
  await card.getByLabel(/Estoque atual/).fill("8");
  await card.getByLabel(/Pedido/).fill("20");
  await page.getByRole("button", { name: "Com pedido" }).click();
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText("Rascunho salvo.")).toBeVisible();
  await page.reload();
  await expect(page.locator(".product-card").first().getByLabel(/Pedido/)).toHaveValue("20");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.getByRole("button", { name: "Enviar pedido" }).click();
  await expect(page.getByText(/Pedido enviado/)).toBeVisible();
  await page.getByRole("link", { name: "Ver histórico" }).click();
  await expect(page.getByText(/Revisão 1/)).toBeVisible();
  await page.getByRole("link", { name: "Abrir conferência" }).click();
  await expect(page.getByRole("heading", { name: "Conferência de recebimento" })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("Enter percorre estoque e pedido sem enviar no último campo", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Fluxo operacional móvel");
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error("E2E_EMAIL e E2E_PASSWORD são obrigatórios");
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Pedido de hoje" })).toBeVisible();
  const stock = page.locator('input[name="stock"]');
  const quantity = page.locator('input[name="quantity"]');
  await stock.first().focus();
  await expect(stock.first()).toHaveJSProperty("selectionStart", 0);
  await stock.first().press("Enter");
  await expect(quantity.first()).toBeFocused();
  await quantity.first().press("Enter");
  await expect(stock.nth(1)).toBeFocused();
  await quantity.last().focus();
  await quantity.last().press("Enter");
  await expect(page.getByText(/Pedido enviado/)).toHaveCount(0);
});
