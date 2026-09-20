import "dotenv/config";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import postgres from "postgres";
import { normalizeProduct, type ProductInput } from "../src/modules/catalog/domain";

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

export async function persistProducts(url: string, products: ProductInput[]) {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      for (const product of products) {
        await tx`
          INSERT INTO products (erp_code, name, unit, purchase_format, markup, exclusive_supplier, active)
          VALUES (${product.erpCode}, ${product.name}, ${product.unit}, ${product.purchaseFormat}, ${product.markup}, ${product.exclusiveSupplier}, true)
          ON CONFLICT (erp_code) DO UPDATE SET
            name = EXCLUDED.name,
            unit = EXCLUDED.unit,
            purchase_format = EXCLUDED.purchase_format,
            markup = EXCLUDED.markup,
            exclusive_supplier = EXCLUDED.exclusive_supplier,
            updated_at = now()
        `;
      }
    });
    const [{ count, exclusive }] = await sql<[{ count: number; exclusive: number }]>`
      SELECT count(*)::int AS count, count(*) FILTER (WHERE exclusive_supplier)::int AS exclusive FROM products
    `;
    return { imported: products.length, total: count, exclusive };
  } finally {
    await sql.end();
  }
}

export async function importProducts(file = "base_produtos_atual.xlsx") {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada");
  const result = await persistProducts(url, await readProducts(file));
  console.log(JSON.stringify(result));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) await importProducts(process.argv[2]);
