import "dotenv/config";
import postgres from "postgres";
import { databaseUrlFromEnv } from "./database-url";

export type ExclusiveProductSummary = {
  productId: string;
  erpCode: number;
  name: string;
  unit: string;
  purchaseFormat: string;
  pontaDaFrutaQty: string;
  balnearioQty: string;
  santaMonicaQty: string;
  totalConsolidatedQty: string;
  alreadyLinkedToJeb: boolean;
  isPrimary: boolean;
  isExclusive: boolean;
};

export type AssociationResult = {
  jebSupplierId: string;
  jebCorporateName: string;
  jebTaxId: string;
  totalExclusiveProductsFound: number;
  toAssociate: number;
  alreadyAssociated: number;
  cycleDate: string | null;
  products: ExclusiveProductSummary[];
};

export async function findJebAndExclusiveProducts(
  sql: postgres.Sql | postgres.TransactionSql
): Promise<AssociationResult> {
  // 1. Identifica a JEB DISTRIBUIDORA no cadastro
  const [jeb] = await sql<{
    id: string;
    corporate_name: string;
    tax_id: string;
    active: boolean;
  }[]>`
    SELECT id, corporate_name, tax_id, active
    FROM suppliers
    WHERE tax_id = '48336863000160'
       OR corporate_name ILIKE '%JEB DISTRIBUIDORA%'
    LIMIT 1
  `;

  if (!jeb) {
    throw new Error(
      "JEB DISTRIBUIDORA DE ALIMENTOS LTDA não encontrada no cadastro de fornecedores."
    );
  }

  // 2. Busca o ciclo de compra operacional mais recente
  const [latestCycleRow] = await sql<{ cycle_date: string }[]>`
    SELECT purchase_cycle_date::text AS cycle_date
    FROM orders
    WHERE cancelled_at IS NULL
    ORDER BY purchase_cycle_date DESC
    LIMIT 1
  `;
  const cycleDate = latestCycleRow?.cycle_date ?? null;

  // 3. Busca todos os produtos com exclusive_supplier = true
  const rows = await sql<{
    id: string;
    erp_code: number;
    name: string;
    unit: string;
    purchase_format: string;
    ponta_da_fruta: string;
    balneario: string;
    santa_monica: string;
    total_consolidado: string;
    link_id: string | null;
    is_primary: boolean | null;
    is_exclusive: boolean | null;
  }[]>`
    WITH latest_orders AS (
      SELECT DISTINCT ON (store_id) id, store_id, revision, submitted_at
      FROM orders
      WHERE purchase_cycle_date = ${cycleDate}::date AND cancelled_at IS NULL
      ORDER BY store_id, submitted_at DESC, revision DESC, id DESC
    )
    SELECT
      p.id,
      p.erp_code,
      p.name,
      p.unit,
      p.purchase_format,
      COALESCE(SUM(CASE WHEN s.slug = 'ponta-da-fruta' THEN oi.quantity ELSE 0 END), 0)::text AS ponta_da_fruta,
      COALESCE(SUM(CASE WHEN s.slug = 'balneario' THEN oi.quantity ELSE 0 END), 0)::text AS balneario,
      COALESCE(SUM(CASE WHEN s.slug = 'santa-monica' THEN oi.quantity ELSE 0 END), 0)::text AS santa_monica,
      COALESCE(SUM(oi.quantity), 0)::text AS total_consolidado,
      ps.id AS link_id,
      ps.is_primary,
      ps.is_exclusive
    FROM products p
    CROSS JOIN stores s
    LEFT JOIN latest_orders lo ON lo.store_id = s.id
    LEFT JOIN order_items oi ON oi.order_id = lo.id AND oi.product_id = p.id
    LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.supplier_id = ${jeb.id}::uuid
    WHERE p.exclusive_supplier = true
    GROUP BY p.id, p.erp_code, p.name, p.unit, p.purchase_format, ps.id, ps.is_primary, ps.is_exclusive
    ORDER BY p.erp_code ASC
  `;

  const products: ExclusiveProductSummary[] = rows.map((r) => ({
    productId: r.id,
    erpCode: r.erp_code,
    name: r.name,
    unit: r.unit,
    purchaseFormat: r.purchase_format,
    pontaDaFrutaQty: Number(r.ponta_da_fruta).toFixed(2),
    balnearioQty: Number(r.balneario).toFixed(2),
    santaMonicaQty: Number(r.santa_monica).toFixed(2),
    totalConsolidatedQty: Number(r.total_consolidado).toFixed(2),
    alreadyLinkedToJeb: Boolean(r.link_id),
    isPrimary: Boolean(r.is_primary),
    isExclusive: Boolean(r.is_exclusive),
  }));

  const alreadyAssociated = products.filter((p) => p.alreadyLinkedToJeb && p.isExclusive).length;
  const toAssociate = products.length - alreadyAssociated;

  return {
    jebSupplierId: jeb.id,
    jebCorporateName: jeb.corporate_name,
    jebTaxId: jeb.tax_id,
    totalExclusiveProductsFound: products.length,
    toAssociate,
    alreadyAssociated,
    cycleDate,
    products,
  };
}

export async function runAssociationRoutine(options: {
  databaseUrl: string;
  apply: boolean;
}): Promise<AssociationResult> {
  const { databaseUrl, apply } = options;
  const sql = postgres(databaseUrl, {
    host: process.env.PGHOST,
    max: 1,
  });

  try {
    let result!: AssociationResult;

    await sql.begin(async (tx) => {
      result = await findJebAndExclusiveProducts(tx);

      if (apply && result.toAssociate > 0) {
        for (const item of result.products) {
          // Garante que nenhum outro fornecedor seja exclusivo para o produto
          await tx`
            UPDATE product_suppliers
            SET is_primary = false, is_exclusive = false, updated_at = now()
            WHERE product_id = ${item.productId}::uuid
              AND supplier_id <> ${result.jebSupplierId}::uuid
          `;

          // Insere ou atualiza o vínculo com a JEB como principal e exclusivo
          await tx`
            INSERT INTO product_suppliers (
              product_id,
              supplier_id,
              is_primary,
              is_exclusive,
              active,
              notes
            ) VALUES (
              ${item.productId}::uuid,
              ${result.jebSupplierId}::uuid,
              true,
              true,
              true,
              'Associação de produtos exclusivos do catálogo à JEB'
            )
            ON CONFLICT (product_id, supplier_id) DO UPDATE
            SET is_primary = true, is_exclusive = true, active = true, updated_at = now()
          `;

          // Garante que a coluna legada continue true
          await tx`
            UPDATE products
            SET exclusive_supplier = true, updated_at = now()
            WHERE id = ${item.productId}::uuid
          `;
        }
      }
    });

    return result;
  } finally {
    await sql.end();
  }
}

function printSummary(result: AssociationResult, mode: "DRY_RUN" | "APPLIED") {
  console.log("\n=========================================================================================================");
  console.log(`ASSOCIAÇÃO DE PRODUTOS EXCLUSIVOS À JEB DISTRIBUIDORA [${mode === "DRY_RUN" ? "SIMULAÇÃO / DRY-RUN" : "APLICADO COM SUCESSO"}]`);
  console.log("=========================================================================================================");
  console.log(`Fornecedor Alvo: ${result.jebCorporateName} | CNPJ: ${result.jebTaxId}`);
  console.log(`Ciclo de Compra Base para Quantidades: ${result.cycleDate ?? "Nenhum ciclo registrado"}`);
  console.log(`Total de produtos exclusivos encontrados : ${result.totalExclusiveProductsFound}`);
  console.log(`Produtos a associar/atualizar             : ${result.toAssociate}`);
  console.log(`Produtos já associados como exclusivos   : ${result.alreadyAssociated}`);
  console.log("---------------------------------------------------------------------------------------------------------");
  console.log("RELAÇÃO COMPLETA DE PRODUTOS, CÓDIGOS ERP E QUANTIDADES POR LOJA:");
  console.log("---------------------------------------------------------------------------------------------------------");
  console.log(
    "ERP".padStart(5) + " | " +
    "PRODUTO".padEnd(26) + " | " +
    "UNID".padEnd(4) + " | " +
    "FMT".padEnd(4) + " | " +
    "PONTA FRUTA".padStart(11) + " | " +
    "BALNEÁRIO".padStart(10) + " | " +
    "STA MÔNICA".padStart(10) + " | " +
    "TOTAL CONS.".padStart(11) + " | " +
    "STATUS"
  );
  console.log("-".repeat(105));

  for (const p of result.products) {
    const status = p.isExclusive ? "[JÁ EXCLUSIVO]" : "[A VINCULAR]";
    console.log(
      String(p.erpCode).padStart(5) + " | " +
      p.name.padEnd(26) + " | " +
      p.unit.padEnd(4) + " | " +
      p.purchaseFormat.padEnd(4) + " | " +
      p.pontaDaFrutaQty.padStart(11) + " | " +
      p.balnearioQty.padStart(10) + " | " +
      p.santaMonicaQty.padStart(10) + " | " +
      p.totalConsolidatedQty.padStart(11) + " | " +
      status
    );
  }
  console.log("=========================================================================================================\n");
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply") || args.includes("--execute");
  const databaseUrl = databaseUrlFromEnv();

  console.log(`Modo de execução: ${apply ? "APLICAÇÃO REAL (--apply)" : "SIMULAÇÃO SEGURA (--dry-run)"}`);

  const result = await runAssociationRoutine({
    databaseUrl,
    apply,
  });

  printSummary(result, apply ? "APPLIED" : "DRY_RUN");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Erro na execução da associação JEB:", err);
    process.exit(1);
  });
}
