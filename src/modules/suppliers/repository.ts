import { and, asc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { database } from "@/db/client";
import { suppliers } from "@/db/schema";
import {
  type CreateSupplierInput,
  type Supplier,
  type ToggleSupplierActiveInput,
  type UpdateSupplierInput,
  SupplierConflictError,
  SupplierNotFoundError,
  SupplierValidationError,
  normalizePhone,
  validateTaxId,
} from "./domain";

export const SUPPLIER_MANAGEMENT_ADVISORY_LOCK_ID = 42424202;

function mapSupplierRow(row: typeof suppliers.$inferSelect): Supplier {
  return {
    id: row.id,
    corporateName: row.corporateName,
    tradeName: row.tradeName,
    taxId: row.taxId,
    taxIdType: row.taxIdType as Supplier["taxIdType"],
    taxInvoiceRule: row.taxInvoiceRule as Supplier["taxInvoiceRule"],
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    notes: row.notes,
    active: row.active,
    version: row.version,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type ListSuppliersOptions = {
  includeInactive?: boolean;
  search?: string;
};

export async function listSuppliers(
  options: ListSuppliersOptions = {},
  dbClient: ReturnType<typeof database>["db"] = database().db
): Promise<Supplier[]> {
  const { includeInactive = true, search } = options;

  const conditions = [];

  if (!includeInactive) {
    conditions.push(eq(suppliers.active, true));
  }

  if (search && search.trim() !== "") {
    const term = `%${search.trim()}%`;
    conditions.push(
      or(
        ilike(suppliers.corporateName, term),
        ilike(suppliers.tradeName, term),
        ilike(suppliers.taxId, term)
      )
    );
  }

  const query = dbClient
    .select()
    .from(suppliers)
    .orderBy(asc(suppliers.corporateName));

  const rows = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query;

  return rows.map(mapSupplierRow);
}

export async function findSupplierById(
  id: string,
  dbClient: ReturnType<typeof database>["db"] = database().db
): Promise<Supplier | null> {
  const [row] = await dbClient
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);

  return row ? mapSupplierRow(row) : null;
}

export async function createSupplier(
  input: CreateSupplierInput & { actorId: string },
  dbClient: ReturnType<typeof database>["db"] = database().db
): Promise<Supplier> {
  const corporateName = input.corporateName.trim();
  if (corporateName === "") {
    throw new SupplierValidationError("A razão social é obrigatória.");
  }

  const taxIdValidation = validateTaxId(input.taxId);
  if (!taxIdValidation.valid) {
    throw new SupplierValidationError(
      taxIdValidation.reason ?? "Identificação fiscal (CNPJ/CPF) inválida."
    );
  }

  const normalizedTaxId = taxIdValidation.normalized;
  const taxIdType = taxIdValidation.type;
  const tradeName = input.tradeName ? input.tradeName.trim() || null : null;
  const contactName = input.contactName ? input.contactName.trim() || null : null;
  const contactPhone = input.contactPhone ? normalizePhone(input.contactPhone) : null;
  const notes = input.notes ? input.notes.trim() || null : null;

  return dbClient.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SUPPLIER_MANAGEMENT_ADVISORY_LOCK_ID});`);

    if (normalizedTaxId) {
      const [existing] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.taxId, normalizedTaxId))
        .limit(1);

      if (existing) {
        throw new SupplierConflictError("Já existe um fornecedor cadastrado com este CNPJ/CPF.");
      }
    }

    const [created] = await tx
      .insert(suppliers)
      .values({
        corporateName,
        tradeName,
        taxId: normalizedTaxId,
        taxIdType,
        taxInvoiceRule: input.taxInvoiceRule,
        contactName,
        contactPhone,
        notes,
        active: true,
        version: 1,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      })
      .returning();

    return mapSupplierRow(created);
  });
}

export async function updateSupplier(
  input: UpdateSupplierInput & { actorId: string },
  dbClient: ReturnType<typeof database>["db"] = database().db
): Promise<Supplier> {
  const corporateName = input.corporateName.trim();
  if (corporateName === "") {
    throw new SupplierValidationError("A razão social é obrigatória.");
  }

  const taxIdValidation = validateTaxId(input.taxId);
  if (!taxIdValidation.valid) {
    throw new SupplierValidationError(
      taxIdValidation.reason ?? "Identificação fiscal (CNPJ/CPF) inválida."
    );
  }

  const normalizedTaxId = taxIdValidation.normalized;
  const taxIdType = taxIdValidation.type;
  const tradeName = input.tradeName ? input.tradeName.trim() || null : null;
  const contactName = input.contactName ? input.contactName.trim() || null : null;
  const contactPhone = input.contactPhone ? normalizePhone(input.contactPhone) : null;
  const notes = input.notes ? input.notes.trim() || null : null;

  return dbClient.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SUPPLIER_MANAGEMENT_ADVISORY_LOCK_ID});`);

    const [existing] = await tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, input.id))
      .for("update");

    if (!existing) {
      throw new SupplierNotFoundError("Fornecedor não encontrado.");
    }

    if (existing.version !== input.expectedVersion) {
      throw new SupplierConflictError(
        "O fornecedor foi modificado por outro usuário. Recarregue a página para obter os dados atualizados."
      );
    }

    if (normalizedTaxId) {
      const [conflict] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.taxId, normalizedTaxId), ne(suppliers.id, input.id)))
        .limit(1);

      if (conflict) {
        throw new SupplierConflictError("Já existe outro fornecedor cadastrado com este CNPJ/CPF.");
      }
    }

    const [updated] = await tx
      .update(suppliers)
      .set({
        corporateName,
        tradeName,
        taxId: normalizedTaxId,
        taxIdType,
        taxInvoiceRule: input.taxInvoiceRule,
        contactName,
        contactPhone,
        notes,
        version: existing.version + 1,
        updatedBy: input.actorId,
        updatedAt: new Date(),
      })
      .where(and(eq(suppliers.id, input.id), eq(suppliers.version, existing.version)))
      .returning();

    if (!updated) {
      throw new SupplierConflictError(
        "O fornecedor foi modificado por outro usuário. Recarregue a página."
      );
    }

    return mapSupplierRow(updated);
  });
}

export async function toggleSupplierActive(
  input: ToggleSupplierActiveInput & { actorId: string },
  dbClient: ReturnType<typeof database>["db"] = database().db
): Promise<Supplier> {
  return dbClient.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SUPPLIER_MANAGEMENT_ADVISORY_LOCK_ID});`);

    const [existing] = await tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, input.id))
      .for("update");

    if (!existing) {
      throw new SupplierNotFoundError("Fornecedor não encontrado.");
    }

    if (existing.version !== input.expectedVersion) {
      throw new SupplierConflictError(
        "O fornecedor foi modificado por outro usuário. Recarregue a página para obter os dados atualizados."
      );
    }

    const [updated] = await tx
      .update(suppliers)
      .set({
        active: input.active,
        version: existing.version + 1,
        updatedBy: input.actorId,
        updatedAt: new Date(),
      })
      .where(and(eq(suppliers.id, input.id), eq(suppliers.version, existing.version)))
      .returning();

    if (!updated) {
      throw new SupplierConflictError(
        "O fornecedor foi modificado por outro usuário. Recarregue a página."
      );
    }

    return mapSupplierRow(updated);
  });
}
