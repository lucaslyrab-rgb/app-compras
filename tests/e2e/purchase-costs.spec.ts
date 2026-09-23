import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Matriz responsiva executada uma vez",
  );
  test.skip(
    !process.env.CONSOLIDATED_E2E_PASSWORD,
    "Requer fixture de banco descartável consolidado_e2e",
  );
  await page.goto("/login");
});

async function login(page: Page, role = "comprador") {
  await page.getByLabel("E-mail").fill(`${role}@consolidado.test`);
  await page.getByLabel("Senha").fill(process.env.CONSOLIDATED_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"));
}

test("Comprador lança, compra, corrige e desmarca com autosave persistente", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/comprador/custos?ciclo=2097-09-24");
  await expect(
    page.getByRole("heading", { name: "Lançamento de custos" }),
  ).toBeVisible();
  await expect(page.locator(".cost-card")).toHaveCount(6);
  const banana = page.locator(".cost-card").filter({ hasText: "BANANA TESTE" });
  await expect(banana).toContainText("EXCLUSIVO");
  await expect(banana).toContainText("Total 23 CX");
  await expect(banana).toContainText("P 5");
  await expect(banana).toContainText("B 10");
  await expect(banana).toContainText("S 8");
  await expect(banana).toContainText("R$ 72,00");
  const cost = banana.getByLabel("Custo atual de BANANA TESTE");
  await expect(cost).toHaveValue("72,00");
  await cost.fill("75,00");
  await cost.blur();
  await expect(banana.getByText("Alterado", { exact: true })).toBeVisible();
  await expect(banana.getByText("Salvo", { exact: true })).toBeVisible();
  await banana.getByRole("checkbox").check();
  await expect(banana.getByText("Salvo", { exact: true })).toBeVisible();
  await expect(banana.getByRole("checkbox")).toBeChecked();
  await page.reload();
  const persisted = page
    .locator(".cost-card")
    .filter({ hasText: "BANANA TESTE" });
  await expect(persisted.getByLabel("Custo atual de BANANA TESTE")).toHaveValue(
    "75,00",
  );
  await expect(persisted.getByRole("checkbox")).toBeChecked();

  await persisted.getByLabel("Custo atual de BANANA TESTE").fill("78,00");
  await persisted.getByLabel("Custo atual de BANANA TESTE").blur();
  await expect(persisted.getByText("Salvo", { exact: true })).toBeVisible();
  await persisted.getByRole("checkbox").uncheck();
  await expect(persisted.getByText("Salvo", { exact: true })).toBeVisible();
  await page.reload();
  const reloadedBanana = page
    .locator(".cost-card")
    .filter({ hasText: "BANANA TESTE" });
  await expect(reloadedBanana.getByRole("checkbox")).not.toBeChecked();
  await expect(
    reloadedBanana.getByLabel("Custo atual de BANANA TESTE"),
  ).toHaveValue("78,00");

  await page.getByRole("button", { name: "Comprados", exact: true }).click();
  await expect(page.locator(".cost-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Faltam comprar", exact: true })
    .click();
  await expect(page.locator(".cost-card")).toHaveCount(4);
  await page
    .getByPlaceholder("Buscar produto (nome ou código)…")
    .fill("banana");
  await expect(page.locator(".cost-card")).toHaveCount(1);
  await page
    .getByPlaceholder("Buscar produto (nome ou código)…")
    .fill("999999999");
  await expect(page.locator(".cost-card")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).include(".cost-page").analyze()).violations,
  ).toEqual([]);
});

test("cards mobile compactos preservam os cenários operacionais A–F", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/comprador/custos?ciclo=2097-09-24");

  const cards = page.locator(".cost-card");
  await expect(cards).toHaveCount(6);
  const scenarioA = cards.filter({ hasText: "PRODUTO NORMAL COM NOME" });
  await expect(scenarioA.locator(".cost-store-quantities > span")).toHaveText([
    "P 1",
    "B 2",
    "S 2",
  ]);
  await expect(scenarioA).toContainText("Total 5 CX");
  await expect(scenarioA.locator(".cost-previous-field strong")).toHaveText(
    "—",
  );
  await expect(
    scenarioA.getByLabel(/Custo atual de PRODUTO NORMAL/),
  ).toHaveValue("5,00");
  await expect(scenarioA.getByRole("checkbox")).not.toBeChecked();

  const scenarioB = cards.filter({ hasText: "CEBOLA TESTE" });
  await expect(scenarioB.locator(".cost-store-quantities > span")).toHaveText([
    "P 1",
    "B 1",
    "S 1",
  ]);
  await expect(scenarioB).toContainText("Total 3 UND");
  await expect(scenarioB.getByLabel("Custo atual de CEBOLA TESTE")).toHaveValue(
    "7,50",
  );
  await expect(scenarioB.getByRole("checkbox")).toBeChecked();

  const scenarioC = cards.filter({ hasText: "ABACAXI UN" });
  await expect(scenarioC.locator(".cost-previous-field strong")).toHaveText(
    "R$ 7,50",
  );
  await expect(scenarioC.getByLabel("Custo atual de ABACAXI UN")).toHaveValue(
    "8,00",
  );
  await expect(scenarioC.getByText("Alterado", { exact: true })).toBeVisible();
  await expect(scenarioC.getByRole("checkbox")).toBeChecked();

  const scenarioD = cards.filter({ hasText: "PRODUTO AUSÊNCIA TESTE" });
  await expect(scenarioD.locator(".cost-store-quantities > span")).toHaveText([
    "P 1",
    "B —",
    "S —",
  ]);
  await expect(scenarioD).toContainText("Total 1 UND");

  const scenarioE = cards.filter({ hasText: "PRODUTO 999 TESTE" });
  await expect(scenarioE.locator(".cost-store-quantities > span")).toHaveText([
    "P 999",
    "B 999",
    "S 999",
  ]);
  await expect(scenarioE).toContainText("Total 2.997 CX");

  const scenarioF = cards.filter({ hasText: "BANANA TESTE" });
  await expect(scenarioF.getByText("EXCLUSIVO", { exact: true })).toBeVisible();

  const thumbnailBox = (await scenarioB
    .locator(".cost-thumbnail")
    .boundingBox())!;
  expect(thumbnailBox.width).toBe(52);
  expect(thumbnailBox.height).toBe(52);
  const badgeWidths = await scenarioE
    .locator(".cost-store-quantities > span")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().width),
    );
  expect(badgeWidths.every((width) => width >= 42 && width <= 48)).toBe(true);
  const costInput = scenarioE.getByLabel("Custo atual de PRODUTO 999 TESTE");
  const costBox = (await costInput.boundingBox())!;
  expect(costBox.width).toBe(86);
  expect(costBox.height).toBeGreaterThanOrEqual(44);
  expect(
    await costInput.evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("16px");
  expect(await costInput.getAttribute("maxlength")).toBeNull();
  expect(
    (await scenarioE.locator(".purchase-toggle").boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  expect(
    await cards.evaluateAll((elements) =>
      elements.every((element) => element.scrollWidth <= element.clientWidth),
    ),
  ).toBe(true);
  expect(
    await scenarioA.locator("h2").evaluate((element) => {
      const card = element.closest(".cost-card")!.getBoundingClientRect();
      const title = element.getBoundingClientRect();
      return title.left >= card.left && title.right <= card.right;
    }),
  ).toBe(true);

  await page
    .locator(".cost-mobile-list")
    .evaluate((element) =>
      window.scrollTo({ top: (element as HTMLElement).offsetTop }),
    );
  expect(
    await cards.evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const box = element.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight;
        }).length,
    ),
  ).toBeGreaterThanOrEqual(5);

  await page.setViewportSize({ width: 390, height: 430 });
  await costInput.focus();
  await costInput.scrollIntoViewIfNeeded();
  const shortViewportCost = (await costInput.boundingBox())!;
  const shortViewportToggle = (await scenarioE
    .locator(".purchase-toggle")
    .boundingBox())!;
  expect(shortViewportCost.y).toBeGreaterThanOrEqual(0);
  expect(shortViewportCost.y + shortViewportCost.height).toBeLessThanOrEqual(
    430,
  );
  expect(
    shortViewportToggle.y + shortViewportToggle.height,
  ).toBeLessThanOrEqual(430);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("custos-compactos-390.png"),
    fullPage: false,
  });
});

test("primeiro custo valida inline e Enter avança no desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await page.goto("/comprador/custos?ciclo=2097-09-24");
  const inputs = page.locator(".cost-table:visible .cost-input");
  await expect(inputs).toHaveCount(6);
  await inputs.first().focus();
  await inputs.first().press("Enter");
  await expect(inputs.nth(1)).toBeFocused();
  const noHistoryRow = page
    .locator(".cost-table tbody tr")
    .filter({ hasText: "PRODUTO AUSÊNCIA TESTE" });
  const checkbox = noHistoryRow.getByRole("checkbox");
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect(noHistoryRow).toContainText(
    "Informe o custo antes de marcar como comprado.",
  );
  const erp = await noHistoryRow.locator("td").first().innerText();
  await page.getByPlaceholder("Buscar produto (nome ou código)…").fill(erp);
  await expect(page.locator(".cost-table tbody tr")).toHaveCount(1);
});

for (const width of [320, 375, 390, 412, 768, 1280]) {
  test(`Custos sem overflow em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await login(page, "gestor");
    await page.goto("/comprador/custos?ciclo=2097-09-24");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator(".cost-metrics")).toContainText(
      "Produtos para comprar",
    );
    await expect(page.locator(".cost-metrics")).toContainText("Faltam comprar");
    await expect(page.locator(".cost-metrics")).toContainText("Comprados");
    if (width <= 900) {
      await expect(page.locator(".cost-card")).toHaveCount(6);
      await expect(page.locator(".cost-table")).toBeHidden();
      expect(
        await page
          .locator(".cost-card")
          .evaluateAll((elements) =>
            elements.every(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
          ),
      ).toBe(true);
    } else {
      await expect(page.locator(".cost-table tbody tr")).toHaveCount(6);
      await expect(page.locator(".cost-mobile-list")).toBeHidden();
    }
  });
}

test("Gestor acessa e Loja é bloqueada", async ({ page }) => {
  await login(page, "gestor");
  await page.goto("/comprador/custos");
  await expect(
    page.getByRole("heading", { name: "Lançamento de custos" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await login(page, "loja");
  await page.goto("/comprador/custos");
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Pedido de hoje" }),
  ).toBeVisible();
});
