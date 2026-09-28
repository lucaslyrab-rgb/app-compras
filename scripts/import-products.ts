import "dotenv/config";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import postgres from "postgres";
import { normalizeProduct, type ProductInput } from "../src/modules/catalog/domain";
import { databaseUrlFromEnv } from "./database-url";

export type InitialPricingParameters = {
  saleUnit: "KG" | "UND";
  conversionQuantity: "20" | "1";
  conversionOrigin: "PROVISIONAL" | "UNIT";
};

export function initialPricingParameters(purchaseFormat: string): InitialPricingParameters {
  if (purchaseFormat === "CX" || purchaseFormat === "SC")
    return { saleUnit: "KG", conversionQuantity: "20", conversionOrigin: "PROVISIONAL" };
  if (purchaseFormat === "UND" || purchaseFormat === "PCT" || purchaseFormat === "BDJ")
    return { saleUnit: "UND", conversionQuantity: "1", conversionOrigin: "UNIT" };
  throw new Error(`Formato de compra sem conversão inicial suportada: ${purchaseFormat}`);
}

export async function readProducts(file: string): Promise<ProductInput[]> {
  const archive = unzipSync(new Uint8Array(await readFile(file)));
  const sharedXml = archive["xl/sharedStrings.xml"];
  const sheetXml = archive["xl/worksheets/sheet1.xml"];
  if (!sharedXml || !sheetXml) throw new Error("Estrutura XLSX inválida");
  const decode = (value: string) => value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
  const shared = [...strFromU8(sharedXml).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => decode([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((text) => text[1]).join("")));
  const rows = [...strFromU8(sheetXml).matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
  const products: ProductInput[] = [];
  const codes = new Set<number>();
  for (const row of rows) {
    if (Number(row[1]) === 1) continue;
    const cells = new Map<string, string>();
    for (const cell of row[2].matchAll(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const raw = cell[3].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      cells.set(cell[1], cell[2].includes('t="s"') ? (shared[Number(raw)] ?? "") : raw);
    }
    const erpCode = Number(cells.get("A"));
    const rawName = String(cells.get("B") ?? "").trim();
    const markup = Number(cells.get("C"));
    const purchaseFormat = String(cells.get("D") ?? "").trim();
    const exclusiveSupplier = String(cells.get("E") ?? "").trim().toLowerCase() === "x";
    const unitMatch = rawName.match(/\s(KG|UN|UND|PCT|DZ|BDJ)(?:\s|$)/i);
    const unit = unitMatch?.[1]?.toUpperCase().replace("UN", "UND") ?? "UND";
    const name = rawName.replace(/\s*\[\d+\]\s*$/, "").trim();
    const product = normalizeProduct({ erpCode, name, markup, purchaseFormat, exclusiveSupplier, unit });
    if (codes.has(product.erpCode)) throw new Error(`Código ERP duplicado: ${product.erpCode}`);
    codes.add(product.erpCode);
    products.push(product);
  }
  if (products.length !== 74) throw new Error(`Esperados 74 produtos; encontrados ${products.length}`);
  const exclusiveCount = products.filter((product) => product.exclusiveSupplier).length;
  if (exclusiveCount !== 21) throw new Error(`Esperados 21 exclusivos; encontrados ${exclusiveCount}`);
  return products;
}

export type ProductImportMode = "PRESERVE_EXISTING" | "BOOTSTRAP_SYNC";

export async function persistProducts(url: string, products: ProductInput[], options: { mode?: ProductImportMode } = {}) {
  const mode = options.mode ?? "PRESERVE_EXISTING";
  const prepared = products.map((product) => ({
    product,
    pricing: initialPricingParameters(product.purchaseFormat),
  }));
  const sql = postgres(url, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      for (const { product, pricing } of prepared) {
        const [inserted] = await tx<{ id: string }[]>`
          INSERT INTO products (erp_code, name, unit, purchase_format, markup, exclusive_supplier, active)
          VALUES (${product.erpCode}, ${product.name}, ${product.unit}, ${product.purchaseFormat}, ${product.markup}, ${product.exclusiveSupplier}, true)
          ON CONFLICT (erp_code) DO NOTHING
          RETURNING id
        `;
        let saved = inserted;
        if (!saved && mode === "BOOTSTRAP_SYNC") {
          [saved] = await tx<{ id: string }[]>`
            UPDATE products SET name = ${product.name}, unit = ${product.unit}, purchase_format = ${product.purchaseFormat},
              markup = ${product.markup}, exclusive_supplier = ${product.exclusiveSupplier},
              version = version + 1, updated_at = now()
            WHERE erp_code = ${product.erpCode} RETURNING id
          `;
        }
        if (!saved) [saved] = await tx<{ id: string }[]>`SELECT id FROM products WHERE erp_code = ${product.erpCode}`;
        await tx`
          INSERT INTO product_pricing_parameters (
            product_id, sale_unit, conversion_quantity, conversion_origin,
            beneficiation_loss_percent, specific_margin_percent
          )
          VALUES (
            ${saved.id}, ${pricing.saleUnit}, ${pricing.conversionQuantity},
            ${pricing.conversionOrigin}, 0, NULL
          )
          ON CONFLICT (product_id) DO NOTHING
        `;
      }
    });
    const [{ count, exclusive }] = await sql<[{ count: number; exclusive: number }]>`
      SELECT count(*)::int AS count, count(*) FILTER (WHERE exclusive_supplier)::int AS exclusive FROM products
    `;
    return { imported: products.length, total: count, exclusive, mode };
  } finally {
    await sql.end();
  }
}

export async function importProducts(file = "base_produtos_atual.xlsx", mode: ProductImportMode = "PRESERVE_EXISTING") {
  const url = databaseUrlFromEnv();
  const result = await persistProducts(url, await readProducts(file), { mode });
  console.log(JSON.stringify(result));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const bootstrapSync = args.includes("--bootstrap-sync");
  const file = args.find((arg) => !arg.startsWith("--")) ?? "base_produtos_atual.xlsx";
  await importProducts(file, bootstrapSync ? "BOOTSTRAP_SYNC" : "PRESERVE_EXISTING");
}
