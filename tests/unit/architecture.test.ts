import { readdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverMigrations } from "../../scripts/migration-runner.mjs";

describe("arquitetura e isolamento de módulos", () => {
  it("impede vazamento de banco nos módulos de regras", async () => {
    const modulesDir = path.resolve("src", "modules");
    const moduleFiles = (await readdir(modulesDir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => path.join(entry.parentPath, entry.name));

    for (const file of moduleFiles) {
      const source = await readFile(file, "utf8");
      const moduleName = file.split(path.sep)[2];
      const imports = [...source.matchAll(/from ["']@\/modules\/([^/"']+)/g)].map((match) => match[1]);
      if (path.basename(file) === "repository.ts") expect(imports.filter((name) => name !== moduleName && name !== "identity")).toEqual([]);
    }
  });

  it("descobre e ordena automaticamente as migrations 0001–0012", async () => {
    const migrations = await discoverMigrations(path.resolve("migrations"));
    expect(migrations.map((filename) => filename.slice(0, 4))).toEqual(
      Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(4, "0")),
    );
  });

  it("mantém a 0012 aditiva com backfill e constraints de permissões", async () => {
    const migration = await readFile("migrations/0012_user_permissions_and_management.sql", "utf8");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}'");
    expect(migration).toContain("users_permissions_valid_check");
    expect(migration).toContain("users_store_permission_check");
  });

  it("mantém a 0011 aditiva e prepara fotos sem implementar armazenamento", async () => {
    const migration = await readFile("migrations/0011_product_catalog_management.sql", "utf8");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS photo_key text");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS photo_updated_at timestamptz");
    expect(migration).not.toMatch(/UPDATE\s+products\b/i);
  });

  it("rejeita prefixos numéricos duplicados", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "migration-prefixes-"));
    try {
      await writeFile(path.join(directory, "0009_one.sql"), "SELECT 1;");
      await writeFile(path.join(directory, "9_two.sql"), "SELECT 2;");
      await expect(discoverMigrations(directory)).rejects.toThrow(/prefixo numérico duplicado/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("empacota todas as migrations versionadas na imagem runtime", async () => {
    const dockerfile = await readFile("Dockerfile", "utf8");
    expect(dockerfile).toContain("/app/migrations ./migrations");
    expect(dockerfile).not.toMatch(/\/app\/migrations\/\d{4}_.+\.sql/);
  });

  it("usa um único runner em desenvolvimento e produção sem listas hardcoded", async () => {
    const [development, production, dockerfile] = await Promise.all([
      readFile("scripts/migrate.ts", "utf8"),
      readFile("scripts/entrypoint.mjs", "utf8"),
      readFile("Dockerfile", "utf8"),
    ]);

    expect(development).toContain('from "./migration-runner.mjs"');
    expect(production).toContain('from "./migration-runner.mjs"');
    expect(`${development}\n${production}`).not.toMatch(/\d+_[^"']+\.sql/);
    expect(production).toContain("process.env.DATABASE_URL_FILE");
    expect(production.indexOf("await runMigrations")).toBeLessThan(production.indexOf("spawn("));
    expect(dockerfile).toContain("/app/migrations ./migrations");
    expect(dockerfile).toContain("/app/scripts/migration-runner.mjs ./migration-runner.mjs");
    expect(dockerfile).not.toMatch(/migrations\/\d+_[^\s]+\.sql/);
  });

  it("mantém a 0010 aditiva e compatível com revisões históricas", async () => {
    const migration = await readFile("migrations/0010_pricing_review_decisions.sql", "utf8");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS decided_price numeric(18,2)");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS decision_origin text");
    expect(migration).toContain("decided_price IS NULL AND decision_origin IS NULL");
    expect(migration).not.toMatch(/UPDATE\s+pricing_reviews\b/i);
  });

  it("mantém a 0008 aditiva, sem recalcular histórico e com ownership explícito", async () => {
    const migration = await readFile("migrations/0008_purchase_calendar_settings.sql", "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS purchase_calendar_settings");
    expect(migration).toContain("ALTER TABLE public.purchase_calendar_settings OWNER TO");
    expect(migration).not.toMatch(/UPDATE\s+(?:orders|purchase_cycle_product_costs|pricing_reviews)\b/i);
  });

  it("mantém a 0009 aditiva e não inventa preço aplicado no histórico", async () => {
    const migration = await readFile("migrations/0009_pricing_review_applied_price.sql", "utf8");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS applied_price numeric(18,2)");
    expect(migration).toContain("applied_price IS NULL OR applied_price > 0");
    expect(migration).not.toMatch(/UPDATE\s+pricing_reviews\b/i);
    expect(migration).not.toMatch(/DEFAULT\s+/i);
  });

  it("preserva a seleção oficial e usa a referência efetivamente comprada", async () => {
    const repository = await readFile("src/modules/pricing/analysis/repository.ts", "utf8");
    const service = await readFile("src/modules/pricing/analysis/service.ts", "utf8");
    const detail = await readFile("src/modules/pricing/analysis/pricing-detail.tsx", "utf8");
    expect(repository).toContain("c.purchased AND c.cost IS NOT NULL");
    expect(repository).toContain("max(c.purchase_cycle_date) AS cycle_date");
    expect(repository).toContain("c.purchase_cycle_date <= ${operationalDate}::date");
    expect(repository).toContain("c.purchase_cycle_date <= pricing_reference.cycle_date");
    expect(service).toContain("operationalLocalDate");
    expect(service).not.toContain("currentPurchaseCycle");
    expect(detail).toContain("pricingStalePurchaseMessage(analysis)");
    expect(detail).not.toContain("dateLabel(analysis.officialCost.purchasedAt)");
  });

  it("remonta o detalhe ao trocar o produto selecionado e exibe foto do produto", async () => {
    const [workspace, detail] = await Promise.all([
      readFile("src/modules/pricing/analysis/pricing-workspace.tsx", "utf8"),
      readFile("src/modules/pricing/analysis/pricing-detail.tsx", "utf8"),
    ]);
    expect(workspace).toContain("<PricingDetail key={selected.id} analysis={selected} />");
    expect(detail).toContain("<ProductPhoto");
    expect(detail).toContain('thumbnailClassName="manager-photo-thumb"');
    expect(detail).not.toContain('<span className="manager-placeholder"');
  });

  it("não utiliza suggested_price como fallback para preço decidido", async () => {
    const repository = await readFile("src/modules/pricing/analysis/repository.ts", "utf8");
    expect(repository).not.toMatch(/COALESCE\s*\([^)]*suggested_price[^)]*\)\s*::text\s*AS\s*"(?:reviewDecidedPrice|decidedPrice)"/i);
    expect(repository).not.toMatch(/decidedPrice:\s*[^,\n]*reviewSuggestedPrice/);
    expect(repository).not.toMatch(/appliedPrice:\s*[^,\n]*reviewSuggestedPrice/);
  });

  it("restringe a impressão a mudanças revisadas da rodada atual e mantém o painel desktop sticky", async () => {
    const [page, domain, managerStyles, shellStyles] = await Promise.all([
      readFile("src/app/gestor/precificacao/impressao/page.tsx", "utf8"),
      readFile("src/modules/pricing/analysis/domain.ts", "utf8"),
      readFile("src/app/gestor/styles.css", "utf8"),
      readFile("src/modules/navigation/operational-shell.css", "utf8"),
    ]);
    expect(page).toContain("pricingPrintRows");
    expect(page).not.toContain('analysis.status !== "REVIEWED"');
    expect(domain).toContain('analysis.status !== "REVIEWED"');
    expect(domain).toContain("hasReferenceCycleCostChange(analysis)");
    expect(domain).toContain("reviewCoversCurrentOfficialCost(analysis)");
    expect(domain).toContain("review.decidedPrice ?? review.appliedPrice");
    expect(managerStyles).toMatch(/@media \(min-width: 1181px\)[\s\S]*position: sticky/);
    expect(shellStyles).not.toContain("brightness(0) invert(1)");
  });

  it("mantém o painel de produtos sticky no desktop e a tabela de produtos compacta", async () => {
    const [productWorkspace, managerStyles] = await Promise.all([
      readFile("src/modules/pricing/parameters/product-workspace.tsx", "utf8"),
      readFile("src/app/gestor/styles.css", "utf8"),
    ]);
    expect(productWorkspace).toContain('className="manager-two-column product-columns"');
    expect(productWorkspace).toContain('className="manager-table manager-product-table"');
    expect(managerStyles).toMatch(
      /\.product-columns\s*>\s*\.manager-editor[\s\S]*?position:\s*sticky[\s\S]*?top:\s*(?:14|18)px[\s\S]*?overflow-y:\s*auto/,
    );
    expect(managerStyles).toMatch(/\.manager-product-table\s+th,\s*\.manager-product-table\s+td[\s\S]*?padding:\s*5px\s+6px/);
    expect(managerStyles).toMatch(/\.manager-product-table\s+\.manager-icon-button[\s\S]*?height:\s*26px/);
    expect(managerStyles).toMatch(/\.manager-product-table\s+\.manager-status-button[\s\S]*?height:\s*26px/);
  });

  it("renderiza preview de gerenciamento de foto com contain sem afetar miniaturas da lista ou precificação", async () => {
    const [productPhotoComponent, productEditor, managerStyles] = await Promise.all([
      readFile("src/components/product-photo.tsx", "utf8"),
      readFile("src/modules/pricing/parameters/product-editor.tsx", "utf8"),
      readFile("src/app/gestor/styles.css", "utf8"),
    ]);
    expect(productPhotoComponent).toContain('fit?: "cover" | "contain"');
    expect(productPhotoComponent).toContain('fit = "cover"');
    expect(productPhotoComponent).toContain("objectFit: fit");
    expect(productEditor).toContain('fit="contain"');
    expect(managerStyles).toMatch(/\.manager-photo-preview-wrap\s+img[\s\S]*?object-fit:\s*contain/);
  });
});
