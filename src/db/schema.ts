import { relations, sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, smallint, text, time, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["LOJA", "COMPRADOR", "GESTOR"]);

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull(),
  storeId: uuid("store_id").references(() => stores.id, { onDelete: "restrict" }),
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("users_email_ci_unique").on(sql`lower(${table.email})`),
  check("users_permissions_valid_check", sql`${table.permissions} <@ ARRAY['pedidos:criar', 'pedidos:historico', 'compras:consolidado', 'compras:custos', 'compras:fornecedores', 'gestor:produtos', 'gestor:precificacao', 'gestor:fornecedores', 'gestor:configuracoes', 'gestor:usuarios']::text[]`),
  check("users_store_permission_check", sql`(ARRAY['pedidos:criar', 'pedidos:historico']::text[] && ${table.permissions} AND ${table.storeId} IS NOT NULL) OR (NOT (ARRAY['pedidos:criar', 'pedidos:historico']::text[] && ${table.permissions}) AND ${table.storeId} IS NULL)`)
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("sessions_user_idx").on(table.userId), index("sessions_expiry_idx").on(table.idleExpiresAt)]);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  erpCode: integer("erp_code").notNull().unique(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  purchaseFormat: text("purchase_format").notNull(),
  markup: numeric("markup", { precision: 8, scale: 2 }).notNull(),
  exclusiveSupplier: boolean("exclusive_supplier").notNull().default(false),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  photoKey: text("photo_key"),
  photoUpdatedAt: timestamp("photo_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  check("products_markup_nonnegative", sql`${table.markup} >= 0`),
  check("products_version_check", sql`${table.version} > 0`),
]);

export const orderDrafts = pgTable("order_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  orderDate: date("order_date").notNull(),
  version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [uniqueIndex("draft_store_date_unique").on(table.storeId, table.orderDate)]);

export const orderDraftItems = pgTable("order_draft_items", {
  draftId: uuid("draft_id").notNull().references(() => orderDrafts.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  stock: numeric("stock", { precision: 12, scale: 2 }).notNull().default("0"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("0")
}, (table) => [
  uniqueIndex("draft_item_unique").on(table.draftId, table.productId),
  check("draft_item_nonnegative", sql`${table.stock} >= 0 AND ${table.quantity} >= 0`)
]);

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  orderDate: date("order_date").notNull(),
  purchaseCycleDate: date("purchase_cycle_date").notNull(),
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
  revision: integer("revision").notNull(),
  submittedBy: uuid("submitted_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  cancellationReason: text("cancellation_reason")
}, (table) => [uniqueIndex("order_revision_unique").on(table.storeId, table.orderDate, table.revision)]);

export const purchaseCalendarSettings = pgTable("purchase_calendar_settings", {
  id: text("id").primaryKey(),
  timezone: text("timezone").notNull(),
  cutoffTime: time("cutoff_time").notNull(),
  enabledIsoWeekdays: smallint("enabled_iso_weekdays").array().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  check("purchase_calendar_settings_singleton_check", sql`${table.id} = 'OPERATIONAL'`),
  check("purchase_calendar_settings_timezone_check", sql`btrim(${table.timezone}) <> ''`),
  check("purchase_calendar_settings_weekdays_nonempty_check", sql`cardinality(${table.enabledIsoWeekdays}) > 0`),
  check("purchase_calendar_settings_weekdays_range_check", sql`${table.enabledIsoWeekdays} <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]`),
  check("purchase_calendar_settings_version_check", sql`${table.version} > 0`)
]);

export const orderItems = pgTable("order_items", {
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  stock: numeric("stock", { precision: 12, scale: 2 }).notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  snapshotErpCode: integer("snapshot_erp_code").notNull(),
  snapshotName: text("snapshot_name").notNull(),
  snapshotUnit: text("snapshot_unit").notNull()
}, (table) => [
  uniqueIndex("order_item_unique").on(table.orderId, table.productId),
  check("order_item_nonnegative", sql`${table.stock} >= 0 AND ${table.quantity} >= 0`)
]);

export const purchaseCycleProductCosts = pgTable("purchase_cycle_product_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  purchaseCycleDate: date("purchase_cycle_date").notNull(),
  cost: numeric("cost", { precision: 12, scale: 2 }),
  costIsUnit: boolean("cost_is_unit").notNull().default(false),
  purchased: boolean("purchased").notNull().default(false),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }),
  updatedBy: uuid("updated_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("purchase_cycle_product_costs_product_cycle_unique").on(table.productId, table.purchaseCycleDate),
  index("purchase_cycle_product_costs_official_idx").on(table.productId, table.purchaseCycleDate).where(sql`${table.purchased} = true`),
  index("purchase_cycle_product_costs_cycle_idx").on(table.purchaseCycleDate, table.purchased),
  check("purchase_cycle_product_costs_cost_check", sql`${table.cost} IS NULL OR (${table.cost} > 0 AND ${table.cost} <= 99999999.99)`),
  check("purchase_cycle_product_costs_purchased_cost_check", sql`NOT ${table.purchased} OR ${table.cost} IS NOT NULL`),
  check("purchase_cycle_product_costs_purchased_at_check", sql`(${table.purchased} AND ${table.purchasedAt} IS NOT NULL) OR (NOT ${table.purchased} AND ${table.purchasedAt} IS NULL)`),
  check("purchase_cycle_product_costs_version_check", sql`${table.version} > 0`)
]);

export const productPricingParameters = pgTable("product_pricing_parameters", {
  productId: uuid("product_id").primaryKey().references(() => products.id, { onDelete: "restrict" }),
  saleUnit: text("sale_unit").notNull(),
  conversionQuantity: numeric("conversion_quantity", { precision: 14, scale: 6 }).notNull(),
  conversionOrigin: text("conversion_origin").notNull(),
  beneficiationLossPercent: numeric("beneficiation_loss_percent", { precision: 7, scale: 4 }).notNull().default("0"),
  specificMarginPercent: numeric("specific_margin_percent", { precision: 7, scale: 4 }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index("product_pricing_parameters_origin_idx").on(table.conversionOrigin),
  check("product_pricing_parameters_sale_unit_check", sql`btrim(${table.saleUnit}) <> ''`),
  check("product_pricing_parameters_conversion_check", sql`${table.conversionQuantity} > 0`),
  check("product_pricing_parameters_origin_check", sql`${table.conversionOrigin} IN ('PROVISIONAL', 'UNIT', 'MANUAL')`),
  check("product_pricing_parameters_loss_check", sql`${table.beneficiationLossPercent} >= 0 AND ${table.beneficiationLossPercent} < 100`),
  check("product_pricing_parameters_margin_check", sql`${table.specificMarginPercent} IS NULL OR (${table.specificMarginPercent} >= 0 AND ${table.specificMarginPercent} < 100)`),
  check("product_pricing_parameters_version_check", sql`${table.version} > 0`)
]);

export const pricingSettings = pgTable("pricing_settings", {
  id: text("id").primaryKey(),
  operatingCostPercent: numeric("operating_cost_percent", { precision: 7, scale: 4 }).notNull(),
  defaultMarginPercent: numeric("default_margin_percent", { precision: 7, scale: 4 }).notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  check("pricing_settings_singleton_check", sql`${table.id} = 'FLV'`),
  check("pricing_settings_operating_check", sql`${table.operatingCostPercent} >= 0 AND ${table.operatingCostPercent} < 100`),
  check("pricing_settings_margin_check", sql`${table.defaultMarginPercent} >= 0 AND ${table.defaultMarginPercent} < 100`),
  check("pricing_settings_denominator_check", sql`${table.operatingCostPercent} + ${table.defaultMarginPercent} < 100`),
  check("pricing_settings_version_check", sql`${table.version} > 0`)
]);

export const pricingReviews = pgTable("pricing_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  officialCostId: uuid("official_cost_id").notNull().references(() => purchaseCycleProductCosts.id, { onDelete: "restrict" }),
  officialCostVersion: integer("official_cost_version").notNull(),
  officialPurchaseCycleDate: date("official_purchase_cycle_date").notNull(),
  officialCost: numeric("official_cost", { precision: 12, scale: 2 }).notNull(),
  costIsUnit: boolean("cost_is_unit").notNull(),
  saleUnit: text("sale_unit").notNull(),
  conversionQuantity: numeric("conversion_quantity", { precision: 14, scale: 6 }).notNull(),
  conversionOrigin: text("conversion_origin").notNull(),
  beneficiationLossPercent: numeric("beneficiation_loss_percent", { precision: 7, scale: 4 }).notNull(),
  parameterVersion: integer("parameter_version").notNull(),
  operatingCostPercent: numeric("operating_cost_percent", { precision: 7, scale: 4 }).notNull(),
  desiredMarginPercent: numeric("desired_margin_percent", { precision: 7, scale: 4 }).notNull(),
  marginOrigin: text("margin_origin").notNull(),
  settingsVersion: integer("settings_version").notNull(),
  grossUnitCost: numeric("gross_unit_cost", { precision: 18, scale: 6 }).notNull(),
  effectiveUnitCost: numeric("effective_unit_cost", { precision: 18, scale: 6 }).notNull(),
  calculatedPrice: numeric("calculated_price", { precision: 18, scale: 6 }).notNull(),
  suggestedPrice: numeric("suggested_price", { precision: 18, scale: 2 }).notNull(),
  appliedPrice: numeric("applied_price", { precision: 18, scale: 2 }),
  decidedPrice: numeric("decided_price", { precision: 18, scale: 2 }),
  decisionOrigin: text("decision_origin"),
  inputFingerprint: text("input_fingerprint").notNull(),
  reviewedBy: uuid("reviewed_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index("pricing_reviews_product_date_idx").on(table.productId, table.reviewedAt, table.id),
  index("pricing_reviews_official_cost_idx").on(table.officialCostId),
  check("pricing_reviews_cost_check", sql`${table.officialCost} > 0`),
  check("pricing_reviews_conversion_check", sql`${table.conversionQuantity} > 0`),
  check("pricing_reviews_origin_check", sql`${table.conversionOrigin} IN ('PROVISIONAL', 'UNIT', 'MANUAL')`),
  check("pricing_reviews_loss_check", sql`${table.beneficiationLossPercent} >= 0 AND ${table.beneficiationLossPercent} < 100`),
  check("pricing_reviews_margin_origin_check", sql`${table.marginOrigin} IN ('DEFAULT', 'SPECIFIC')`),
  check("pricing_reviews_percentages_check", sql`${table.operatingCostPercent} >= 0 AND ${table.desiredMarginPercent} >= 0 AND ${table.operatingCostPercent} + ${table.desiredMarginPercent} < 100`),
  check("pricing_reviews_versions_check", sql`${table.officialCostVersion} > 0 AND ${table.parameterVersion} > 0 AND ${table.settingsVersion} > 0`),
  check("pricing_reviews_derived_values_check", sql`${table.grossUnitCost} > 0 AND ${table.effectiveUnitCost} > 0 AND ${table.calculatedPrice} > 0 AND ${table.suggestedPrice} > 0`),
  check("pricing_reviews_applied_price_check", sql`${table.appliedPrice} IS NULL OR ${table.appliedPrice} > 0`),
  check("pricing_reviews_decision_check", sql`(${table.decidedPrice} IS NULL AND ${table.decisionOrigin} IS NULL) OR (${table.decidedPrice} > 0 AND ${table.decisionOrigin} IN ('SUGGESTED', 'MANUAL'))`)
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadata: jsonb("metadata").notNull().default({}),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("audit_entity_idx").on(table.entityType, table.entityId)]);

export const usersRelations = relations(users, ({ one, many }) => ({
  store: one(stores, { fields: [users.storeId], references: [stores.id] }),
  sessions: many(sessions)
}));

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  corporateName: text("corporate_name").notNull(),
  tradeName: text("trade_name"),
  taxId: text("tax_id"),
  taxIdType: text("tax_id_type").notNull().default("NOT_INFORMED"),
  taxInvoiceRule: text("tax_invoice_rule").notNull().default("STANDARD"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("suppliers_tax_id_unique").on(table.taxId).where(sql`${table.taxId} IS NOT NULL AND btrim(${table.taxId}) <> ''`),
  index("suppliers_active_name_idx").on(table.active, table.corporateName),
  check("suppliers_corporate_name_check", sql`btrim(${table.corporateName}) <> ''`),
  check("suppliers_tax_id_type_check", sql`${table.taxIdType} IN ('CNPJ', 'CPF', 'NOT_INFORMED')`),
  check("suppliers_tax_invoice_rule_check", sql`${table.taxInvoiceRule} IN ('STANDARD', 'AFTER_WEIGHING', 'SPECIAL_REGIME')`),
  check("suppliers_version_check", sql`${table.version} > 0`)
]);

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  creator: one(users, { fields: [suppliers.createdBy], references: [users.id] }),
  updater: one(users, { fields: [suppliers.updatedBy], references: [users.id] }),
  productLinks: many(productSuppliers)
}));

export const productSuppliers = pgTable("product_suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  isPrimary: boolean("is_primary").notNull().default(false),
  isExclusive: boolean("is_exclusive").notNull().default(false),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("product_suppliers_unique").on(table.productId, table.supplierId),
  uniqueIndex("product_suppliers_single_primary_idx").on(table.productId).where(sql`${table.isPrimary} = true`),
  uniqueIndex("product_suppliers_single_exclusive_idx").on(table.productId).where(sql`${table.isExclusive} = true`),
  index("product_suppliers_product_idx").on(table.productId),
  index("product_suppliers_supplier_idx").on(table.supplierId),
  check("product_suppliers_exclusive_implies_primary", sql`NOT ${table.isExclusive} OR ${table.isPrimary}`)
]);

export const productSuppliersRelations = relations(productSuppliers, ({ one }) => ({
  product: one(products, { fields: [productSuppliers.productId], references: [products.id] }),
  supplier: one(suppliers, { fields: [productSuppliers.supplierId], references: [suppliers.id] }),
  creator: one(users, { fields: [productSuppliers.createdBy], references: [users.id] }),
  updater: one(users, { fields: [productSuppliers.updatedBy], references: [users.id] })
}));

export const purchaseCycleProductAllocations = pgTable("purchase_cycle_product_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseCycleDate: date("purchase_cycle_date").notNull(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  orderedQuantity: numeric("ordered_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  destinedQuantity: numeric("destined_quantity", { precision: 12, scale: 2 }).notNull(),
  purchaseFormat: text("purchase_format").notNull(),
  isAdditionalPurchase: boolean("is_additional_purchase").notNull().default(false),
  conversionFactorKg: numeric("conversion_factor_kg", { precision: 12, scale: 3 }),
  conversionOrigin: text("conversion_origin"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("allocations_cycle_supp_prod_store_unique").on(table.purchaseCycleDate, table.supplierId, table.productId, table.storeId),
  index("allocations_cycle_idx").on(table.purchaseCycleDate),
  index("allocations_supplier_cycle_idx").on(table.supplierId, table.purchaseCycleDate),
  index("allocations_product_cycle_idx").on(table.productId, table.purchaseCycleDate),
  index("allocations_store_cycle_idx").on(table.storeId, table.purchaseCycleDate),
  check("allocations_quantities_nonnegative", sql`${table.orderedQuantity} >= 0 AND ${table.destinedQuantity} >= 0`),
  check("allocations_version_check", sql`${table.version} > 0`)
]);

export const purchaseCycleProductAllocationsRelations = relations(purchaseCycleProductAllocations, ({ one }) => ({
  supplier: one(suppliers, { fields: [purchaseCycleProductAllocations.supplierId], references: [suppliers.id] }),
  product: one(products, { fields: [purchaseCycleProductAllocations.productId], references: [products.id] }),
  store: one(stores, { fields: [purchaseCycleProductAllocations.storeId], references: [stores.id] }),
  creator: one(users, { fields: [purchaseCycleProductAllocations.createdBy], references: [users.id] }),
  updater: one(users, { fields: [purchaseCycleProductAllocations.updatedBy], references: [users.id] })
}));

export const purchaseCycleBuyerClosures = pgTable("purchase_cycle_buyer_closures", {
  purchaseCycleDate: date("purchase_cycle_date").primaryKey(),
  status: text("status").notNull().default("OPEN"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenedBy: uuid("reopened_by").references(() => users.id, { onDelete: "set null" }),
  reopenReason: text("reopen_reason"),
  totalPurchasedProducts: integer("total_purchased_products").notNull().default(0),
  totalAllocatedProducts: integer("total_allocated_products").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("closures_version_check", sql`${table.version} > 0`),
  check("closures_status_check", sql`${table.status} IN ('OPEN', 'CLOSED')`),
  check("closures_closed_check", sql`(${table.status} = 'CLOSED' AND ${table.closedAt} IS NOT NULL AND ${table.closedBy} IS NOT NULL) OR (${table.status} = 'OPEN')`)
]);

export const purchaseCycleBuyerClosuresRelations = relations(purchaseCycleBuyerClosures, ({ one }) => ({
  closer: one(users, { fields: [purchaseCycleBuyerClosures.closedBy], references: [users.id] }),
  reopener: one(users, { fields: [purchaseCycleBuyerClosures.reopenedBy], references: [users.id] })
}));

export const purchaseCycleProductSupplierDecisions = pgTable("purchase_cycle_product_supplier_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseCycleDate: date("purchase_cycle_date").notNull(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  decision: text("decision").notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("decisions_cycle_supp_prod_store_unique").on(table.purchaseCycleDate, table.supplierId, table.productId, table.storeId),
  index("decisions_cycle_store_idx").on(table.purchaseCycleDate, table.storeId),
  index("decisions_cycle_supp_idx").on(table.supplierId, table.purchaseCycleDate),
  check("decisions_decision_check", sql`${table.decision} IN ('NOT_PURCHASED')`)
]);

export const purchaseCycleProductSupplierDecisionsRelations = relations(purchaseCycleProductSupplierDecisions, ({ one }) => ({
  supplier: one(suppliers, { fields: [purchaseCycleProductSupplierDecisions.supplierId], references: [suppliers.id] }),
  product: one(products, { fields: [purchaseCycleProductSupplierDecisions.productId], references: [products.id] }),
  store: one(stores, { fields: [purchaseCycleProductSupplierDecisions.storeId], references: [stores.id] }),
  creator: one(users, { fields: [purchaseCycleProductSupplierDecisions.createdBy], references: [users.id] }),
  updater: one(users, { fields: [purchaseCycleProductSupplierDecisions.updatedBy], references: [users.id] })
}));

export const purchaseCycleSupplierStoreReviews = pgTable("purchase_cycle_supplier_store_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseCycleDate: date("purchase_cycle_date").notNull(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("REVIEWED"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("supplier_store_review_unique").on(table.purchaseCycleDate, table.supplierId, table.storeId),
  index("supplier_store_review_cycle_idx").on(table.purchaseCycleDate, table.storeId),
  check("supplier_store_review_status_check", sql`${table.status} IN ('REVIEWED', 'PENDING')`),
  check("supplier_store_review_version_check", sql`${table.version} > 0`)
]);

export const purchaseCycleSupplierStoreReviewsRelations = relations(purchaseCycleSupplierStoreReviews, ({ one }) => ({
  supplier: one(suppliers, { fields: [purchaseCycleSupplierStoreReviews.supplierId], references: [suppliers.id] }),
  store: one(stores, { fields: [purchaseCycleSupplierStoreReviews.storeId], references: [stores.id] }),
  reviewer: one(users, { fields: [purchaseCycleSupplierStoreReviews.reviewedBy], references: [users.id] })
}));

export const purchaseCycleStoreClosures = pgTable("purchase_cycle_store_closures", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseCycleDate: date("purchase_cycle_date").notNull(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  orderRevision: integer("order_revision"),
  status: text("status").notNull().default("CLOSED"),
  totalOrderedItems: integer("total_ordered_items").notNull().default(0),
  totalDestinedItems: integer("total_destined_items").notNull().default(0),
  totalCutItems: integer("total_cut_items").notNull().default(0),
  cutSummary: jsonb("cut_summary").notNull().default(sql`'[]'::jsonb`),
  allocationsHash: text("allocations_hash").notNull(),
  orderHash: text("order_hash"),
  costsHash: text("costs_hash"),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenedBy: uuid("reopened_by").references(() => users.id, { onDelete: "set null" }),
  reopenReason: text("reopen_reason"),
  version: integer("version").notNull().default(1),
  isCurrent: boolean("is_current").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("store_closures_cycle_store_version_unique").on(table.purchaseCycleDate, table.storeId, table.version),
  uniqueIndex("store_closures_current_unique").on(table.purchaseCycleDate, table.storeId).where(sql`${table.isCurrent} = true`),
  index("store_closures_cycle_idx").on(table.purchaseCycleDate),
  index("store_closures_store_idx").on(table.storeId),
  check("store_closures_version_check", sql`${table.version} > 0`),
  check("store_closures_status_check", sql`${table.status} IN ('OPEN', 'CLOSED', 'REOPENED')`),
  check("store_closures_closed_check", sql`(${table.status} = 'CLOSED' AND ${table.closedAt} IS NOT NULL AND ${table.closedBy} IS NOT NULL) OR (${table.status} IN ('OPEN', 'REOPENED'))`)
]);

export const purchaseCycleStoreClosuresRelations = relations(purchaseCycleStoreClosures, ({ one }) => ({
  store: one(stores, { fields: [purchaseCycleStoreClosures.storeId], references: [stores.id] }),
  order: one(orders, { fields: [purchaseCycleStoreClosures.orderId], references: [orders.id] }),
  closer: one(users, { fields: [purchaseCycleStoreClosures.closedBy], references: [users.id] }),
  reopener: one(users, { fields: [purchaseCycleStoreClosures.reopenedBy], references: [users.id] })
}));

export const purchaseCycleParticipatingStores = pgTable("purchase_cycle_participating_stores", {
  purchaseCycleDate: date("purchase_cycle_date").notNull(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  primaryKey({ columns: [table.purchaseCycleDate, table.storeId] }),
  index("participating_stores_cycle_idx").on(table.purchaseCycleDate)
]);

export const purchaseCycleParticipatingStoresRelations = relations(purchaseCycleParticipatingStores, ({ one }) => ({
  store: one(stores, { fields: [purchaseCycleParticipatingStores.storeId], references: [stores.id] })
}));

export const purchaseCycleInvoices = pgTable("purchase_cycle_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseCycleDate: date("purchase_cycle_date").notNull(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  invoiceNumber: text("invoice_number").notNull(),
  imageS3Key: text("image_s3_key").notNull(),
  contentType: text("content_type").notNull().default("image/webp"),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("purchase_cycle_invoices_unique").on(table.purchaseCycleDate, table.storeId, table.supplierId, table.invoiceNumber),
  index("invoices_cycle_store_idx").on(table.purchaseCycleDate, table.storeId),
  index("invoices_cycle_supp_idx").on(table.purchaseCycleDate, table.supplierId),
  index("invoices_cycle_store_supp_idx").on(table.purchaseCycleDate, table.storeId, table.supplierId),
  check("invoice_number_not_empty", sql`length(trim(${table.invoiceNumber})) > 0`),
  check("image_s3_key_not_empty", sql`length(trim(${table.imageS3Key})) > 0`),
  check("file_size_positive", sql`${table.fileSizeBytes} > 0`)
]);

export const purchaseCycleInvoicesRelations = relations(purchaseCycleInvoices, ({ one, many }) => ({
  store: one(stores, { fields: [purchaseCycleInvoices.storeId], references: [stores.id] }),
  supplier: one(suppliers, { fields: [purchaseCycleInvoices.supplierId], references: [suppliers.id] }),
  creator: one(users, { fields: [purchaseCycleInvoices.createdBy], references: [users.id] }),
  items: many(purchaseCycleInvoiceItems)
}));

export const purchaseCycleInvoiceItems = pgTable("purchase_cycle_invoice_items", {
  invoiceId: uuid("invoice_id").notNull().references(() => purchaseCycleInvoices.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  primaryKey({ columns: [table.invoiceId, table.productId] }),
  index("invoice_items_product_idx").on(table.productId)
]);

export const purchaseCycleInvoiceItemsRelations = relations(purchaseCycleInvoiceItems, ({ one }) => ({
  invoice: one(purchaseCycleInvoices, { fields: [purchaseCycleInvoiceItems.invoiceId], references: [purchaseCycleInvoices.id] }),
  product: one(products, { fields: [purchaseCycleInvoiceItems.productId], references: [products.id] })
}));

export const storeDeliveryConferences = pgTable("store_delivery_conferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseCycleDate: date("purchase_cycle_date").notNull(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "restrict" }),
  orderRevision: integer("order_revision"),
  status: text("status").notNull().default("IN_PROGRESS"),
  totalItems: integer("total_items").notNull().default(0),
  verifiedItems: integer("verified_items").notNull().default(0),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  finalizedBy: uuid("finalized_by").references(() => users.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("store_delivery_conferences_cycle_store_unique").on(table.purchaseCycleDate, table.storeId),
  index("delivery_conferences_cycle_idx").on(table.purchaseCycleDate),
  index("delivery_conferences_store_cycle_idx").on(table.storeId, table.purchaseCycleDate),
  check("store_delivery_conferences_version_check", sql`${table.version} > 0`),
  check("store_delivery_conferences_status_check", sql`${table.status} IN ('IN_PROGRESS', 'FINALIZED')`),
  check("delivery_conf_items_count_check", sql`${table.totalItems} >= 0 AND ${table.verifiedItems} >= 0 AND ${table.verifiedItems} <= ${table.totalItems}`),
  check("delivery_conf_finalized_coherence_check", sql`(${table.status} = 'FINALIZED' AND ${table.finalizedAt} IS NOT NULL AND ${table.finalizedBy} IS NOT NULL AND ${table.totalItems} = ${table.verifiedItems}) OR (${table.status} = 'IN_PROGRESS' AND ${table.finalizedAt} IS NULL AND ${table.finalizedBy} IS NULL)`)
]);

export const storeDeliveryConferencesRelations = relations(storeDeliveryConferences, ({ one, many }) => ({
  store: one(stores, { fields: [storeDeliveryConferences.storeId], references: [stores.id] }),
  order: one(orders, { fields: [storeDeliveryConferences.orderId], references: [orders.id] }),
  finalizer: one(users, { fields: [storeDeliveryConferences.finalizedBy], references: [users.id] }),
  items: many(storeDeliveryConferenceItems)
}));

export const storeDeliveryConferenceItems = pgTable("store_delivery_conference_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  conferenceId: uuid("conference_id").notNull().references(() => storeDeliveryConferences.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  orderedQuantity: numeric("ordered_quantity", { precision: 10, scale: 2 }).notNull(),
  orderedUnit: text("ordered_unit").notNull(),
  receivedWeightKg: numeric("received_weight_kg", { precision: 10, scale: 2 }),
  isUnreceived: boolean("is_unreceived").notNull().default(false),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  checkedBy: uuid("checked_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("conference_items_unique").on(table.conferenceId, table.productId),
  index("conference_items_product_idx").on(table.productId),
  index("conference_items_conf_idx").on(table.conferenceId),
  check("conference_items_ordered_qty_positive", sql`${table.orderedQuantity} > 0 AND ${table.orderedQuantity} <> 'NaN'::numeric`),
  check("conference_items_weight_coherence_check", sql`(${table.isUnreceived} = true AND ${table.receivedWeightKg} IS NOT NULL AND ${table.receivedWeightKg} = 0) OR (${table.isUnreceived} = false AND (${table.receivedWeightKg} IS NULL OR (${table.receivedWeightKg} > 0 AND ${table.receivedWeightKg} <> 'NaN'::numeric)))`)
]);

export const storeDeliveryConferenceItemsRelations = relations(storeDeliveryConferenceItems, ({ one }) => ({
  conference: one(storeDeliveryConferences, { fields: [storeDeliveryConferenceItems.conferenceId], references: [storeDeliveryConferences.id] }),
  product: one(products, { fields: [storeDeliveryConferenceItems.productId], references: [products.id] }),
  checker: one(users, { fields: [storeDeliveryConferenceItems.checkedBy], references: [users.id] })
}));

export const storeLossRecords = pgTable("store_loss_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
  unit: text("unit").notNull().default("KG"),
  reason: text("reason"),
  notes: text("notes"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  recordedBy: uuid("recorded_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index("store_losses_store_date_idx").on(table.storeId, table.recordedAt),
  index("store_losses_product_idx").on(table.productId),
  index("store_losses_date_idx").on(table.recordedAt),
  check("store_losses_quantity_positive", sql`${table.quantity} > 0 AND ${table.quantity} <> 'NaN'::numeric`)
]);

export const storeLossRecordsRelations = relations(storeLossRecords, ({ one }) => ({
  store: one(stores, { fields: [storeLossRecords.storeId], references: [stores.id] }),
  product: one(products, { fields: [storeLossRecords.productId], references: [products.id] }),
  recorder: one(users, { fields: [storeLossRecords.recordedBy], references: [users.id] }),
  canceller: one(users, { fields: [storeLossRecords.cancelledBy], references: [users.id] })
}));

