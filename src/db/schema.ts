import { relations, sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable, smallint, text, time, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("users_email_ci_unique").on(sql`lower(${table.email})`),
  check("users_store_role_check", sql`(${table.role} = 'LOJA' AND ${table.storeId} IS NOT NULL) OR (${table.role} <> 'LOJA' AND ${table.storeId} IS NULL)`)
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [check("products_markup_nonnegative", sql`${table.markup} >= 0`)]);

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
  check("pricing_reviews_applied_price_check", sql`${table.appliedPrice} IS NULL OR ${table.appliedPrice} > 0`)
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
