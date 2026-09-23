import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
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

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [412, 915],
  [768, 1024],
  [1280, 900],
]) {
  test(`Consolidado ${width}px: leitura completa, filtros e scroll contínuo`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await login(page);
    await page.goto("/comprador/consolidado?ciclo=2097-09-24");
    await expect(
      page.getByText("3 de 3 lojas enviaram", { exact: true }),
    ).toBeVisible();
    const mobile = width <= 700;
    const rows = page.locator(
      mobile ? ".buyer-card" : ".buyer-table tbody > tr",
    );
    await expect(rows).toHaveCount(74);
    await expect(
      page.getByText(/Estoque é informativo\. Total pedido soma/),
    ).toHaveCount(0);
    await expect(page.getByText(/revisão \d/i)).toHaveCount(0);
    await expect(page.locator(".buyer-updated")).toHaveText(
      /^74 produtos • Atualizado às \d{2}:\d{2}$/,
    );
    const storeNames = mobile
      ? await rows.first().locator("tbody th").allTextContents()
      : await page.locator(".buyer-table .store-heading").allTextContents();
    expect(storeNames).toEqual(["Ponta da Fruta", "Balneário", "Santa Mônica"]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator("input:not([type=search]):visible")).toHaveCount(
      0,
    );
    const search = page.getByPlaceholder("Buscar produto (nome ou código)…");
    await search.fill("banana teste");
    await expect(rows).toHaveCount(1);
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(search).toHaveValue("banana teste");
    await expect(rows).toHaveCount(1);
    await expect(
      rows.first().getByText("23 CX", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sem pedido", exact: true }).click();
    await expect(rows).toHaveCount(0);
    await page.getByRole("button", { name: "Com pedido", exact: true }).click();
    await expect(rows).toHaveCount(1);
    await search.fill("");
    await expect(rows).toHaveCount(6);
    const maxQuantityRow = rows.filter({ hasText: "PRODUTO 999 TESTE" });
    const erp = mobile
      ? await maxQuantityRow.locator("header small").innerText()
      : await maxQuantityRow.locator("td").first().innerText();
    await search.fill(erp);
    await expect(rows).toHaveCount(1);
    await search.fill("");
    await expect(rows).toHaveCount(6);
    await page.getByRole("button", { name: "Sem pedido", exact: true }).click();
    await expect(rows).toHaveCount(68);
    await page.getByRole("button", { name: "Todos", exact: true }).click();
    await expect(rows).toHaveCount(74);
    expect(
      (await new AxeBuilder({ page }).include(".buyer-page").analyze())
        .violations,
    ).toEqual([]);
    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows.last()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Carregar mais|Próxima página/ }),
    ).toHaveCount(0);
    if (!mobile) {
      await expect(page.locator(".buyer-metrics")).toBeVisible();
      await rows.nth(30).scrollIntoViewIfNeeded();
      const head = (await page.locator(".buyer-table thead").boundingBox())!;
      expect(head.y).toBeGreaterThanOrEqual(-1);
      expect(head.y).toBeLessThanOrEqual(2);
    } else {
      await expect(page.locator(".buyer-metrics")).toBeHidden();
      const statusBoxes = page.locator(".buyer-status li");
      await expect(statusBoxes).toHaveCount(3);
      const statusTops = await statusBoxes.evaluateAll((elements) =>
        elements.map((element) =>
          Math.round(element.getBoundingClientRect().top),
        ),
      );
      expect(new Set(statusTops).size).toBe(1);
      for (const statusBox of await statusBoxes.all()) {
        await expect(statusBox.locator(".store-time--mobile")).toHaveText(
          /^\d{2}\/\d{2} \d{2}:\d{2}$/,
        );
      }
      const first = rows.first();
      await first.scrollIntoViewIfNeeded();
      await expect(first.locator("tbody tr")).toHaveCount(3);
      await expect(
        first.getByRole("columnheader", { name: "Est.", exact: true }),
      ).toBeVisible();
      expect(
        await rows.evaluateAll((elements) =>
          elements.every((el) => el.scrollWidth <= el.clientWidth),
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: test.info().outputPath(`consolidado-${width}.png`),
    });
  });
}

test("mobile identifica lado a lado a loja que não enviou", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/comprador/consolidado?ciclo=2097-09-23");
  await expect(
    page.getByText("2 de 3 lojas enviaram", { exact: true }),
  ).toBeVisible();
  const boxes = page.locator(".buyer-status li");
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(2)).toContainText("Santa Mônica");
  await expect(boxes.nth(2)).toContainText("Não enviado");
  const tops = await boxes.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("ciclos parciais, cancelado, zero e permissões reais", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await page.goto("/comprador/consolidado?ciclo=2097-09-23");
  await expect(
    page.getByText("2 de 3 lojas enviaram", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Envios incompletos — totais parciais.", { exact: true }),
  ).toBeVisible();
  await page
    .getByPlaceholder("Buscar produto (nome ou código)…")
    .fill("banana teste");
  await expect(page.locator(".buyer-total:visible")).toHaveText("15 CX");
  await expect(
    page
      .locator(".buyer-table:visible")
      .getByLabel("Loja sem pedido operacional válido"),
  ).toHaveCount(2);
  await page
    .getByLabel("Ciclo de compra", { exact: true })
    .selectOption("2097-09-22");
  await expect(
    page.getByText("0 de 3 lojas enviaram", { exact: true }),
  ).toBeVisible();
  await page.goto("/comprador/consolidado?ciclo=2097-09-25");
  await expect(
    page.getByText("0 de 3 lojas enviaram", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await login(page, "gestor");
  await page.goto("/comprador/consolidado");
  await expect(
    page.getByRole("heading", { name: "Consolidado de pedidos" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Administrar produtos" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await login(page, "loja");
  await page.goto("/comprador/consolidado");
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Pedido de hoje" }),
  ).toBeVisible();
});
