import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:54321/test_db";
const PORT = 3333;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function seedData() {
  console.log("Seeding test database for screenshot capture...");
  const db = postgres(DATABASE_URL, { max: 1 });

  const userId = "00000000-0000-0000-0000-000000000001";
  const token = "screenshot_session_token_123";
  const tokenHash = hashToken(token);
  const cycleDate = "2026-10-20";

  // 1. Usuário Comprador
  await db`
    INSERT INTO users (id, name, email, password_hash, role, active, permissions)
    VALUES (
      ${userId}::uuid,
      'Lucas Lira (Comprador)',
      'comprador@multishow.com.br',
      'hash_test',
      'COMPRADOR',
      true,
      ARRAY['compras:destinacao', 'compras:custos', 'compras:fornecedores', 'compras:consolidado']::text[]
    )
    ON CONFLICT (id) DO UPDATE SET active = true, permissions = EXCLUDED.permissions
  `;

  // 2. Sessão ativa
  await db`
    INSERT INTO sessions (user_id, token_hash, idle_expires_at, absolute_expires_at)
    VALUES (
      ${userId}::uuid,
      ${tokenHash},
      now() + interval '1 day',
      now() + interval '7 days'
    )
    ON CONFLICT DO NOTHING
  `;

  // 3. Lojas
  const stores = await db<{ id: string; slug: string; name: string }[]>`
    SELECT id, slug, name FROM stores ORDER BY name ASC
  `;
  const storePonta = stores.find((s) => s.slug === "ponta-da-fruta")!;
  const storeBalneario = stores.find((s) => s.slug === "balneario")!;
  const storeSantaMonica = stores.find((s) => s.slug === "santa-monica")!;

  // 4. Fornecedores
  let [suppUniao] = await db<{ id: string }[]>`
    SELECT id FROM suppliers WHERE corporate_name = 'União Frutas Ltda'
  `;
  if (!suppUniao) {
    [suppUniao] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('União Frutas Ltda', 'União Distribuidora CEASA', '11111111000199', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;
  }

  let [suppJeb] = await db<{ id: string }[]>`
    SELECT id FROM suppliers WHERE corporate_name = 'JEB Distribuidora'
  `;
  if (!suppJeb) {
    [suppJeb] = await db<{ id: string }[]>`
      INSERT INTO suppliers (corporate_name, trade_name, tax_id, tax_id_type, tax_invoice_rule, active)
      VALUES ('JEB Distribuidora', 'JEB Hortifruti', '22222222000199', 'CNPJ', 'STANDARD', true)
      RETURNING id
    `;
  }

  // 5. Produtos
  let [prodBanana] = await db<{ id: string }[]>`SELECT id FROM products WHERE erp_code = 35`;
  if (!prodBanana) {
    [prodBanana] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (35, 'BANANA PRATA CLIMATIZADA', 'CX', 'KG', 30.00, true)
      RETURNING id
    `;
  }

  let [prodCenoura] = await db<{ id: string }[]>`SELECT id FROM products WHERE erp_code = 42`;
  if (!prodCenoura) {
    [prodCenoura] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (42, 'CENOURA ESPECIAL', 'CX', 'KG', 30.00, true)
      RETURNING id
    `;
  }

  let [prodTomate] = await db<{ id: string }[]>`SELECT id FROM products WHERE erp_code = 10`;
  if (!prodTomate) {
    [prodTomate] = await db<{ id: string }[]>`
      INSERT INTO products (erp_code, name, purchase_format, unit, markup, active)
      VALUES (10, 'TOMATE LONGA VIDA EXTRA', 'CX', 'KG', 35.00, true)
      RETURNING id
    `;
  }

  // Vincula produtos aos fornecedores
  await db`
    INSERT INTO product_suppliers (product_id, supplier_id, is_primary, is_exclusive, active)
    VALUES
      (${prodBanana.id}::uuid, ${suppUniao.id}::uuid, true, false, true),
      (${prodCenoura.id}::uuid, ${suppUniao.id}::uuid, true, false, true),
      (${prodTomate.id}::uuid, ${suppUniao.id}::uuid, true, false, true),
      (${prodBanana.id}::uuid, ${suppJeb.id}::uuid, false, false, true)
    ON CONFLICT DO NOTHING
  `;

  // 6. Custos
  await db`
    INSERT INTO purchase_cycle_product_costs (purchase_cycle_date, product_id, cost, purchased, purchased_at, updated_by)
    VALUES
      (${cycleDate}::date, ${prodBanana.id}::uuid, 52.00, true, now(), ${userId}::uuid),
      (${cycleDate}::date, ${prodCenoura.id}::uuid, 34.00, true, now(), ${userId}::uuid),
      (${cycleDate}::date, ${prodTomate.id}::uuid, 65.00, true, now(), ${userId}::uuid)
    ON CONFLICT (product_id, purchase_cycle_date) DO UPDATE
      SET cost = EXCLUDED.cost, purchased = true, purchased_at = now()
  `;

  // 7. Pedidos das 3 lojas
  // Limpa pedidos e alocações antigos do ciclo para consistência
  await db`DELETE FROM purchase_cycle_product_allocations WHERE purchase_cycle_date = ${cycleDate}::date`;
  await db`DELETE FROM purchase_cycle_product_supplier_decisions WHERE purchase_cycle_date = ${cycleDate}::date`;
  await db`DELETE FROM purchase_cycle_supplier_store_reviews WHERE purchase_cycle_date = ${cycleDate}::date`;
  await db`DELETE FROM purchase_cycle_store_closures WHERE purchase_cycle_date = ${cycleDate}::date`;
  await db`DELETE FROM purchase_cycle_buyer_closures WHERE purchase_cycle_date = ${cycleDate}::date`;
  await db`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE purchase_cycle_date = ${cycleDate}::date)`;
  await db`DELETE FROM orders WHERE purchase_cycle_date = ${cycleDate}::date`;

  // Pedido Ponta da Fruta
  const [orderPonta] = await db<{ id: string }[]>`
    INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
    VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${storePonta.id}::uuid, 1, now(), ${userId}::uuid)
    RETURNING id
  `;
  await db`
    INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
    VALUES
      (${orderPonta.id}::uuid, ${prodBanana.id}::uuid, 0.00, 7.00, 35, 'BANANA PRATA CLIMATIZADA', 'CX'),
      (${orderPonta.id}::uuid, ${prodCenoura.id}::uuid, 0.00, 5.00, 42, 'CENOURA ESPECIAL', 'CX')
  `;

  // Pedido Balneário
  const [orderBalneario] = await db<{ id: string }[]>`
    INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
    VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${storeBalneario.id}::uuid, 1, now(), ${userId}::uuid)
    RETURNING id
  `;
  await db`
    INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
    VALUES
      (${orderBalneario.id}::uuid, ${prodBanana.id}::uuid, 0.00, 8.00, 35, 'BANANA PRATA CLIMATIZADA', 'CX'),
      (${orderBalneario.id}::uuid, ${prodCenoura.id}::uuid, 0.00, 4.00, 42, 'CENOURA ESPECIAL', 'CX'),
      (${orderBalneario.id}::uuid, ${prodTomate.id}::uuid, 0.00, 6.00, 10, 'TOMATE LONGA VIDA EXTRA', 'CX')
  `;

  // Pedido Santa Mônica
  const [orderSantaMonica] = await db<{ id: string }[]>`
    INSERT INTO orders (order_date, purchase_cycle_date, cutoff_at, store_id, revision, submitted_at, submitted_by)
    VALUES (${cycleDate}::date, ${cycleDate}::date, now(), ${storeSantaMonica.id}::uuid, 1, now(), ${userId}::uuid)
    RETURNING id
  `;
  await db`
    INSERT INTO order_items (order_id, product_id, stock, quantity, snapshot_erp_code, snapshot_name, snapshot_unit)
    VALUES
      (${orderSantaMonica.id}::uuid, ${prodBanana.id}::uuid, 0.00, 6.00, 35, 'BANANA PRATA CLIMATIZADA', 'CX'),
      (${orderSantaMonica.id}::uuid, ${prodCenoura.id}::uuid, 0.00, 3.00, 42, 'CENOURA ESPECIAL', 'CX')
  `;

  // 8. Alocações
  // Ponta da Fruta: 7 CX Banana, 5 CX Cenoura (Finalizada)
  await db`
    INSERT INTO purchase_cycle_product_allocations (
      purchase_cycle_date, supplier_id, product_id, store_id, ordered_quantity, destined_quantity, purchase_format, created_by
    ) VALUES
      (${cycleDate}::date, ${suppUniao.id}::uuid, ${prodBanana.id}::uuid, ${storePonta.id}::uuid, 7.00, 7.00, 'CX', ${userId}::uuid),
      (${cycleDate}::date, ${suppUniao.id}::uuid, ${prodCenoura.id}::uuid, ${storePonta.id}::uuid, 5.00, 5.00, 'CX', ${userId}::uuid)
  `;

  // Fecha conferência de Ponta da Fruta (Finalizada)
  await db`
    INSERT INTO purchase_cycle_store_closures (
      purchase_cycle_date, store_id, order_id, order_revision, status,
      total_ordered_items, total_destined_items, total_cut_items, cut_summary,
      allocations_hash, closed_at, closed_by
    ) VALUES (
      ${cycleDate}::date, ${storePonta.id}::uuid, ${orderPonta.id}::uuid, 1, 'CLOSED',
      2, 2, 0, '[]'::jsonb,
      'hash_ponta', now(), ${userId}::uuid
    )
  `;

  // Balneário: 2 CX Cenoura (de 4 pedidas), 0 CX Banana (de 8 pedidas), 6 CX Tomate (de 6 pedidas)
  await db`
    INSERT INTO purchase_cycle_product_allocations (
      purchase_cycle_date, supplier_id, product_id, store_id, ordered_quantity, destined_quantity, purchase_format, created_by
    ) VALUES
      (${cycleDate}::date, ${suppUniao.id}::uuid, ${prodCenoura.id}::uuid, ${storeBalneario.id}::uuid, 4.00, 2.00, 'CX', ${userId}::uuid),
      (${cycleDate}::date, ${suppUniao.id}::uuid, ${prodTomate.id}::uuid, ${storeBalneario.id}::uuid, 6.00, 6.00, 'CX', ${userId}::uuid)
  `;

  // Balneário: Decisão explícita de NOT_PURCHASED para Banana Prata na JEB Distribuidora
  await db`
    INSERT INTO purchase_cycle_product_supplier_decisions (
      purchase_cycle_date, supplier_id, product_id, store_id, decision, created_by
    ) VALUES (
      ${cycleDate}::date, ${suppJeb.id}::uuid, ${prodBanana.id}::uuid, ${storeBalneario.id}::uuid, 'NOT_PURCHASED', ${userId}::uuid
    )
  `;

  await db.end();

  return {
    token,
    cycleDate,
    storeBalnearioId: storeBalneario.id,
    storePontaId: storePonta.id,
    storeSantaMonicaId: storeSantaMonica.id,
    suppUniaoId: suppUniao.id,
    suppJebId: suppJeb.id,
  };
}

async function prepareStandaloneAssets() {
  const root = path.resolve(".");
  const staticSrc = path.join(root, ".next/static");
  const staticDest = path.join(root, ".next/standalone/.next/static");
  const publicSrc = path.join(root, "public");
  const publicDest = path.join(root, ".next/standalone/public");

  if (existsSync(staticSrc) && !existsSync(staticDest)) {
    cpSync(staticSrc, staticDest, { recursive: true });
  }
  if (existsSync(publicSrc) && !existsSync(publicDest)) {
    cpSync(publicSrc, publicDest, { recursive: true });
  }
}

async function main() {
  const seed = await seedData();
  await prepareStandaloneAssets();

  console.log("Starting Next.js standalone server on port", PORT);
  const server = spawn("node", [".next/standalone/server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL,
    },
    stdio: "inherit",
  });

  // Aguarda servidor responder
  console.log("Waiting for server readiness...");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (!ready) {
    server.kill();
    throw new Error("Server failed to start on port " + PORT);
  }

  console.log("Server is ready. Launching Playwright browser...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    // 1. Desktop Context (1366x768)
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
    });
    await context.addCookies([
      {
        name: "multishow_session",
        value: seed.token,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
      },
    ]);

    const page = await context.newPage();
    const targetUrl = `${BASE_URL}/comprador/destinacao?ciclo=${seed.cycleDate}&loja=${seed.storeBalnearioId}&fornecedor=${seed.suppUniaoId}`;
    console.log("Navigating to desktop URL:", targetUrl);
    await page.goto(targetUrl, { waitUntil: "networkidle" });

    // Screenshot 1: Visão Desktop da Loja Balneário (com os 3 cards de lojas e dados do fornecedor)
    console.log("Taking Screenshot 1: Desktop Workspace...");
    await page.screenshot({
      path: "docs/screenshots/01-desktop-workspace-balneario.png",
      fullPage: false,
    });

    // Screenshot 2: Modal de Conferência Conjunta dos Cortes da Loja
    console.log("Opening Modal: Conferência Conjunta dos Cortes...");
    const cutsButton = page.locator("button:has-text('Conferir Cortes da Loja'), button:has-text('Conferir Cortes e Finalizar Loja')").first();
    await cutsButton.click();
    await page.waitForSelector(".alloc-cuts-table", { timeout: 5000 });
    console.log("Taking Screenshot 2: Modal Conferência de Cortes...");
    await page.screenshot({
      path: "docs/screenshots/02-modal-conferencia-cortes.png",
      fullPage: false,
    });

    // Fecha o modal de cortes
    const closeCutsModalBtn = page.locator(".alloc-modal footer button:has-text('Fechar')").first();
    await closeCutsModalBtn.click();
    await page.waitForTimeout(300);

    // Screenshot 3: Modal de Conclusão em Lote do Fornecedor
    console.log("Opening Modal: Concluir Conferência deste Fornecedor...");
    const batchButton = page.locator("button:has-text('Concluir Conferência deste Fornecedor')").first();
    if (await batchButton.isVisible()) {
      await batchButton.click();
      await page.waitForSelector(".alloc-modal h2:has-text('Concluir Conferência')", { timeout: 5000 });
      console.log("Taking Screenshot 3: Modal Concluir Fornecedor...");
      await page.screenshot({
        path: "docs/screenshots/03-modal-concluir-fornecedor.png",
        fullPage: false,
      });
      const cancelBatchBtn = page.locator(".alloc-modal footer button:has-text('Cancelar')").first();
      await cancelBatchBtn.click();
    }

    await context.close();

    // 2. Mobile Context (iPhone 14 - 390x844)
    console.log("Launching Mobile Context (390x844)...");
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await mobileContext.addCookies([
      {
        name: "multishow_session",
        value: seed.token,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
      },
    ]);

    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(targetUrl, { waitUntil: "networkidle" });

    console.log("Taking Screenshot 4: Mobile Workspace...");
    await mobilePage.screenshot({
      path: "docs/screenshots/04-mobile-workspace.png",
      fullPage: false,
    });

    await mobileContext.close();
    console.log("All screenshots successfully captured in docs/screenshots/!");
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error("Error generating screenshots:", err);
  process.exit(1);
});
