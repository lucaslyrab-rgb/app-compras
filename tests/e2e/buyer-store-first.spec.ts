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

/**
 * Prepara fixture determinística e multi-produto para o ciclo E2E:
 * - Limpa dados operacionais do ciclo
 * - Configura Fornecedor Corteletti com 3 produtos em Santa Mônica:
 *   1) UVA VITÓRIA E2E (ERP 22): com destinação positiva salva de 2.00 CX
 *   2) CEBOLA TESTE (ERP 5): vinculado ao fornecedor, pendente (sem destinação)
 *   3) ABACAXI UN (ERP 6): vinculado ao fornecedor, pendente (sem destinação)
 */
async function setupE2EData() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    // 1. Limpa registros operacionais do ciclo
    await sql`DELETE FROM purchase_cycle_buyer_closures WHERE purchase_cycle_date = ${cycle}::date`;
    await sql`DELETE FROM purchase_cycle_store_closures WHERE purchase_cycle_date = ${cycle}::date`;
    await sql`DELETE FROM purchase_cycle_supplier_store_reviews WHERE purchase_cycle_date = ${cycle}::date`;
    await sql`DELETE FROM purchase_cycle_product_supplier_decisions WHERE purchase_cycle_date = ${cycle}::date`;
    await sql`DELETE FROM purchase_cycle_product_allocations WHERE purchase_cycle_date = ${cycle}::date`;
    await sql`DELETE FROM purchase_cycle_participating_stores WHERE purchase_cycle_date = ${cycle}::date`;

    // 2. Busca IDs dinâmicos de Corteletti, União Frutas, Lojas, Comprador e Produtos
    const [corteletti] = await sql<{ id: string }[]>`
      SELECT id FROM suppliers WHERE trade_name ILIKE '%corteletti%' LIMIT 1
    `;
    const [uniao] = await sql<{ id: string }[]>`
      SELECT id FROM suppliers WHERE trade_name ILIKE '%união%' LIMIT 1
    `;
    const [santaMonica] = await sql<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'santa-monica' LIMIT 1
    `;
    const [balneario] = await sql<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'balneario' LIMIT 1
    `;
    const [buyerUser] = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = 'comprador@consolidado.test' LIMIT 1
    `;
    const [prodUva] = await sql<{ id: string }[]>`
      SELECT id FROM products WHERE erp_code = 22 LIMIT 1
    `;
    const prodsPending = await sql<{ id: string; erp_code: number }[]>`
      SELECT id, erp_code FROM products WHERE erp_code IN (5, 6)
    `;

    if (corteletti && santaMonica && buyerUser && prodUva) {
      // Garante vinculação de ERP 5 e 6 a Corteletti
      for (const p of prodsPending) {
        await sql`
          INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive, active)
          VALUES (${p.id}::uuid, ${corteletti.id}::uuid, true, false, true)
          ON CONFLICT (product_id, supplier_id) DO UPDATE SET active = true, is_exclusive = false
        `;
      }

      // Insere destinação positiva salva para UVA VITÓRIA (ERP 22) de 2.00 CX
      await sql`
        INSERT INTO purchase_cycle_product_allocations (
          purchase_cycle_date, supplier_id, product_id, store_id,
          ordered_quantity, destined_quantity, purchase_format,
          is_additional_purchase, created_by, updated_by, version,
          created_at, updated_at
        )
        VALUES (
          ${cycle}::date, ${corteletti.id}::uuid, ${prodUva.id}::uuid, ${santaMonica.id}::uuid,
          2.00, 2.00, 'CX', false, ${buyerUser.id}::uuid, ${buyerUser.id}::uuid, 1, now(), now()
        )
        ON CONFLICT (purchase_cycle_date, supplier_id, product_id, store_id)
        DO UPDATE SET destined_quantity = 2.00, ordered_quantity = 2.00
      `;

      // Sentinela 1: Outro fornecedor (União Frutas) na mesma loja (Santa Mônica) com destinação de 5.00 UN de CEBOLA TESTE (ERP 5)
      const cebolaProd = prodsPending.find((p) => p.erp_code === 5) ?? prodsPending[0];
      if (uniao && cebolaProd) {
        await sql`
          INSERT INTO purchase_cycle_product_allocations (
            purchase_cycle_date, supplier_id, product_id, store_id,
            ordered_quantity, destined_quantity, purchase_format,
            is_additional_purchase, created_by, updated_by, version,
            created_at, updated_at
          )
          VALUES (
            ${cycle}::date, ${uniao.id}::uuid, ${cebolaProd.id}::uuid, ${santaMonica.id}::uuid,
            5.00, 5.00, 'UN', false, ${buyerUser.id}::uuid, ${buyerUser.id}::uuid, 1, now(), now()
          )
          ON CONFLICT (purchase_cycle_date, supplier_id, product_id, store_id)
          DO UPDATE SET destined_quantity = 5.00, ordered_quantity = 5.00
        `;
      }

      // Sentinela 2: Mesmo fornecedor (Corteletti) em outra loja (Balneário) com 3.00 CX
      if (balneario) {
        await sql`
          INSERT INTO purchase_cycle_product_allocations (
            purchase_cycle_date, supplier_id, product_id, store_id,
            ordered_quantity, destined_quantity, purchase_format,
            is_additional_purchase, created_by, updated_by, version,
            created_at, updated_at
          )
          VALUES (
            ${cycle}::date, ${corteletti.id}::uuid, ${prodUva.id}::uuid, ${balneario.id}::uuid,
            3.00, 3.00, 'CX', false, ${buyerUser.id}::uuid, ${buyerUser.id}::uuid, 1, now(), now()
          )
          ON CONFLICT (purchase_cycle_date, supplier_id, product_id, store_id)
          DO UPDATE SET destined_quantity = 3.00, ordered_quantity = 3.00
        `;
      }
    }
  } finally {
    await sql.end();
  }
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
    await setupE2EData();
  });

  test.afterAll(async () => {
    await cleanCycleData();
  });

  test("Fluxo Principal: Navegação fixa por loja, bloqueio por dirty, decisão negativa, conclusão em lote multi-produto e conferência de cortes", async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === "desktop") {
      await page.setViewportSize({ width: 1280, height: 900 });
    } else {
      await page.setViewportSize({ width: 390, height: 844 });
    }

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

    // 5. Verifica os 3 produtos no catálogo do fornecedor:
    // - UVA VITÓRIA E2E (ERP 22): com 2.00 CX destinada previamente
    // - CEBOLA TESTE (ERP 5): pendente
    // - ABACAXI UN (ERP 6): pendente
    const uvaCard = page.locator(".alloc-product-card").filter({ hasText: "UVA VITÓRIA E2E" });
    const cebolaCard = page.locator(".alloc-product-card").filter({ hasText: "CEBOLA TESTE" });
    const abacaxiCard = page.locator(".alloc-product-card").filter({ hasText: "ABACAXI UN" });

    await expect(uvaCard).toBeVisible();
    await expect(cebolaCard).toBeVisible();
    await expect(abacaxiCard).toBeVisible();
    await expect(uvaCard.locator(".alloc-stepper-input")).toHaveValue("2.00");

    // 6. Bloqueio de Conclusão em Lote quando houver alterações locais não salvas (isDirty)
    const concludeSupplierBtn = page.getByRole("button", {
      name: /Concluir Conferência deste Fornecedor/i,
    });
    await expect(concludeSupplierBtn).toBeVisible();

    // Altera valor de UVA VITÓRIA de 2.00 para 3.00 localmente sem salvar
    const uvaStepper = uvaCard.locator(".alloc-stepper-input");
    await uvaStepper.fill("3.00");
    await expect(page.locator(".alloc-sticky-status")).toContainText("Alterações não salvas");

    // Tenta concluir o fornecedor em lote com alteração pendente
    await concludeSupplierBtn.click();

    // O modal NÃO deve abrir e um aviso de bloqueio por dirty state deve ser apresentado
    const batchModal = page.locator('[role="dialog"]').filter({ hasText: /Concluir Conferência deste Fornecedor/i });
    await expect(batchModal).not.toBeVisible();
    await expect(page.locator(".alloc-banner--warning")).toContainText("Você possui alterações não salvas");

    // Desfaz a alteração local recarregando a página para estado limpo
    await page.reload();
    await page.waitForLoadState("networkidle");

    // 7. Decisão Individual ("Não comprei deste fornecedor") em ABACAXI UN com reversão
    const abacaxiCardClean = page.locator(".alloc-product-card").filter({ hasText: "ABACAXI UN" });
    const notPurchasedBtn = abacaxiCardClean.getByRole("button", { name: /Não comprei deste fornecedor/i });
    await expect(notPurchasedBtn).toBeVisible();
    await notPurchasedBtn.click();
    await expect(abacaxiCardClean.locator(".alloc-not-purchased-banner")).toContainText("Não comprado deste fornecedor nesta loja");

    // Recarrega a página para comprovar persistência da decisão individual
    await page.reload();
    const abacaxiCardReloaded = page.locator(".alloc-product-card").filter({ hasText: "ABACAXI UN" });
    await expect(abacaxiCardReloaded.locator(".alloc-not-purchased-banner")).toContainText("Não comprado deste fornecedor nesta loja");
    const revertBtn = abacaxiCardReloaded.locator(".alloc-btn-revert");
    await expect(revertBtn).toBeVisible();

    // Reverte a decisão individual
    await revertBtn.click();
    await expect(abacaxiCardReloaded.locator(".alloc-not-purchased-banner")).not.toBeVisible();

    // Recarrega a página para comprovar persistência da reversão
    await page.reload();
    const abacaxiCardReverted = page.locator(".alloc-product-card").filter({ hasText: "ABACAXI UN" });
    await expect(abacaxiCardReverted.getByRole("button", { name: /Não comprei deste fornecedor/i })).toBeVisible();

    // 8. Conclusão em Lote com Múltiplos Produtos
    const concludeSupplierBtnClean = page.getByRole("button", {
      name: /Concluir Conferência deste Fornecedor/i,
    });
    await expect(concludeSupplierBtnClean).toBeVisible();
    await concludeSupplierBtnClean.click();

    await expect(batchModal).toBeVisible();
    // Verifica que o modal declara a preservação de 1 item positivo
    await expect(batchModal.locator("text=Destinações positivas salvas (1 itens) serão integralmente preservadas.")).toBeVisible();
    // Verifica que a lista de negativação contém CEBOLA TESTE e ABACAXI UN
    await expect(batchModal.locator("text=CEBOLA TESTE")).toBeVisible();
    await expect(batchModal.locator("text=ABACAXI UN")).toBeVisible();
    // E NÃO inclui o produto com destino positivo (UVA VITÓRIA) na lista de cortes
    const negativeItemsList = batchModal.locator("ul");
    await expect(negativeItemsList.locator("text=UVA VITÓRIA E2E")).not.toBeVisible();

    await capture(page, testInfo, "03-modal-concluir-fornecedor");

    // Confirma conclusão em lote
    await batchModal.getByRole("button", { name: /Confirmar Conclusão do Fornecedor/i }).click();
    await expect(batchModal).not.toBeVisible();

    // 9. Comprovação Direta no Banco PostgreSQL Descartável
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      const sqlCheck = postgres(dbUrl, { max: 1 });
      try {
        // Verifica decisões de fornecedor: CEBOLA TESTE (5) e ABACAXI UN (6) gravados como NOT_PURCHASED
        const decisions = await sqlCheck<{ erp_code: number; decision: string }[]>`
          SELECT p.erp_code, d.decision
          FROM purchase_cycle_product_supplier_decisions d
          JOIN products p ON p.id = d.product_id
          WHERE d.purchase_cycle_date = ${cycle}::date
          ORDER BY p.erp_code
        `;
        expect(decisions).toHaveLength(2);
        expect(decisions[0].erp_code).toBe(5);
        expect(decisions[0].decision).toBe("NOT_PURCHASED");
        expect(decisions[1].erp_code).toBe(6);
        expect(decisions[1].decision).toBe("NOT_PURCHASED");

        const [uniao] = await sqlCheck<{ id: string }[]>`SELECT id FROM suppliers WHERE trade_name ILIKE '%união%' LIMIT 1`;
        const [santaMonica] = await sqlCheck<{ id: string }[]>`SELECT id FROM stores WHERE slug = 'santa-monica' LIMIT 1`;
        const [balneario] = await sqlCheck<{ id: string }[]>`SELECT id FROM stores WHERE slug = 'balneario' LIMIT 1`;
        const [corteletti] = await sqlCheck<{ id: string }[]>`SELECT id FROM suppliers WHERE trade_name ILIKE '%corteletti%' LIMIT 1`;

        // Verifica que a destinação positiva de UVA VITÓRIA (ERP 22) em Santa Mônica foi integralmente preservada com 2.00 CX
        const [uvaAlloc] = await sqlCheck<{ destined_quantity: string }[]>`
          SELECT pa.destined_quantity::text
          FROM purchase_cycle_product_allocations pa
          JOIN products p ON p.id = pa.product_id
          WHERE pa.purchase_cycle_date = ${cycle}::date
            AND p.erp_code = 22
            AND pa.supplier_id = ${corteletti.id}::uuid
            AND pa.store_id = ${santaMonica.id}::uuid
        `;
        expect(uvaAlloc).toBeDefined();
        expect(Number(uvaAlloc.destined_quantity)).toBe(2);

        // Sentinela 1: Comprova isolamento e ausência de efeitos colaterais em outro fornecedor (União Frutas) na mesma loja

        if (uniao && santaMonica) {
          const [uniaoAlloc] = await sqlCheck<{ destined_quantity: string }[]>`
            SELECT pa.destined_quantity::text
            FROM purchase_cycle_product_allocations pa
            JOIN products p ON p.id = pa.product_id
            WHERE pa.purchase_cycle_date = ${cycle}::date
              AND p.erp_code = 5
              AND pa.supplier_id = ${uniao.id}::uuid
              AND pa.store_id = ${santaMonica.id}::uuid
          `;
          expect(uniaoAlloc).toBeDefined();
          expect(Number(uniaoAlloc.destined_quantity)).toBe(5);

          const uniaoDecisions = await sqlCheck<{ count: string }[]>`
            SELECT count(*)::text as count
            FROM purchase_cycle_product_supplier_decisions
            WHERE purchase_cycle_date = ${cycle}::date
              AND supplier_id = ${uniao.id}::uuid
              AND store_id = ${santaMonica.id}::uuid
          `;
          expect(uniaoDecisions[0].count).toBe("0");
        }

        // Sentinela 2: Comprova ausência de efeitos colaterais em outra loja (Balneário) no mesmo fornecedor
        if (corteletti && balneario) {
          const [balnearioAlloc] = await sqlCheck<{ destined_quantity: string }[]>`
            SELECT pa.destined_quantity::text
            FROM purchase_cycle_product_allocations pa
            JOIN products p ON p.id = pa.product_id
            WHERE pa.purchase_cycle_date = ${cycle}::date
              AND p.erp_code = 22
              AND pa.supplier_id = ${corteletti.id}::uuid
              AND pa.store_id = ${balneario.id}::uuid
          `;
          expect(balnearioAlloc).toBeDefined();
          expect(Number(balnearioAlloc.destined_quantity)).toBe(3);

          const balnearioDecisions = await sqlCheck<{ count: string }[]>`
            SELECT count(*)::text as count
            FROM purchase_cycle_product_supplier_decisions
            WHERE purchase_cycle_date = ${cycle}::date
              AND supplier_id = ${corteletti.id}::uuid
              AND store_id = ${balneario.id}::uuid
          `;
          expect(balnearioDecisions[0].count).toBe("0");
        }
      } finally {
        await sqlCheck.end();
      }
    }

    // 10. Recarrega a página e comprova persistência na UI
    await page.reload();
    const checkedSelect = page.locator("#supplier-selector");
    await expect(checkedSelect.locator("option:checked")).toContainText("(Conferido)");

    const reloadedUva = page.locator(".alloc-product-card").filter({ hasText: "UVA VITÓRIA E2E" });
    const reloadedCebola = page.locator(".alloc-product-card").filter({ hasText: "CEBOLA TESTE" });
    const reloadedAbacaxi = page.locator(".alloc-product-card").filter({ hasText: "ABACAXI UN" });

    await expect(reloadedUva.locator(".alloc-stepper-input")).toHaveValue("2.00");
    await expect(reloadedCebola.locator(".alloc-not-purchased-banner")).toContainText("Não comprado deste fornecedor nesta loja");
    await expect(reloadedAbacaxi.locator(".alloc-not-purchased-banner")).toContainText("Não comprado deste fornecedor nesta loja");

    // 11. Modal de Conferência Conjunta de Cortes por Loja e Finalização
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

    // 12. Reabertura da Conferência com Justificativa Auditada, Ajuste de Quantidade e Reconferência
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

    // Ajusta quantidade de UVA VITÓRIA para 4.00 e salva
    const uvaInput = page.locator(".alloc-product-card").filter({ hasText: "UVA VITÓRIA E2E" }).locator(".alloc-stepper-input");
    await uvaInput.fill("4.00");
    const saveStoreBtn = page.getByRole("button", { name: /Salvar Destinações/i });
    await expect(saveStoreBtn).toBeEnabled();
    await saveStoreBtn.click();
    await expect(page.locator(".alloc-banner").filter({ hasText: /Destinações salvas com sucesso/i })).toBeVisible();

    // Recarrega a página e comprova que o valor 4.00 persistiu
    await page.reload();
    const reloadedInput = page.locator(".alloc-product-card").filter({ hasText: "UVA VITÓRIA E2E" }).locator(".alloc-stepper-input");
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

  test("Mobile: Visualização responsiva, cartões compactos e scroll seguro", async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === "desktop") {
      await page.setViewportSize({ width: 390, height: 844 });
    }

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
