import { relations, sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
