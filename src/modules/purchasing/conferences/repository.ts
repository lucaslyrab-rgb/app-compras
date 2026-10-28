import { database } from "@/db/client";
import {
  ConferenceValidationError,
  calculateConferenceProgress,
  assertCanFinalizeConference,
  validateReceivedWeight,
  type ConferenceHeader,
  type ConferenceItem,
} from "./domain";

export async function getStoreConference(
  storeId: string,
  cycleDate: string
): Promise<{ header: ConferenceHeader; items: ConferenceItem[] } | null> {
  const { sql } = database();

  // 1. Busca conferência existente no ciclo
  const [existing] = await sql`
    SELECT 
      c.id,
      c.purchase_cycle_date::text AS purchase_cycle_date,
      c.store_id,
      s.name AS store_name,
      c.order_id,
      c.order_revision,
      c.status,
      c.total_items,
      c.verified_items,
      c.finalized_at::text AS finalized_at,
      c.finalized_by,
      u.name AS finalizer_name,
      c.version,
      c.created_at::text AS created_at,
      c.updated_at::text AS updated_at
    FROM store_delivery_conferences c
    INNER JOIN stores s ON s.id = c.store_id
    LEFT JOIN users u ON u.id = c.finalized_by
    WHERE c.store_id = ${storeId}::uuid
      AND c.purchase_cycle_date = ${cycleDate}::date
    LIMIT 1
  `;

  if (existing) {
    const items = await sql`
      SELECT 
        ci.id,
        ci.conference_id,
        ci.product_id,
        p.erp_code,
        p.name AS product_name,
        p.photo_key,
        p.photo_updated_at::text AS photo_updated_at,
        ci.ordered_quantity::float AS ordered_quantity,
        ci.ordered_unit,
        ci.received_weight_kg::float AS received_weight_kg,
        ci.is_unreceived,
        ci.checked_at::text AS checked_at,
        ci.checked_by,
        u.name AS checker_name
      FROM store_delivery_conference_items ci
      INNER JOIN products p ON p.id = ci.product_id
      LEFT JOIN users u ON u.id = ci.checked_by
      WHERE ci.conference_id = ${existing.id}::uuid
      ORDER BY p.name ASC
    `;

    return {
      header: {
        id: existing.id,
        purchaseCycleDate: existing.purchase_cycle_date,
        storeId: existing.store_id,
        storeName: existing.store_name,
        orderId: existing.order_id,
        orderRevision: existing.order_revision,
        status: existing.status,
        totalItems: existing.total_items,
        verifiedItems: existing.verified_items,
        finalizedAt: existing.finalized_at,
        finalizedBy: existing.finalized_by,
        finalizerName: existing.finalizer_name,
        version: existing.version,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      },
      items: items.map((it) => ({
        id: it.id,
        conferenceId: it.conference_id,
        productId: it.product_id,
        erpCode: it.erp_code,
        productName: it.product_name,
        photoKey: it.photo_key,
        photoUpdatedAt: it.photo_updated_at,
        orderedQuantity: it.ordered_quantity,
        orderedUnit: it.ordered_unit,
        receivedWeightKg: it.received_weight_kg,
        isUnreceived: it.is_unreceived,
        checkedAt: it.checked_at,
        checkedBy: it.checked_by,
        checkerName: it.checker_name,
      })),
    };
  }

  // 2. Se não existe conferência, procura o pedido enviado da loja para o ciclo
  const [order] = await sql`
    SELECT 
      o.id,
      o.revision,
      o.store_id,
      s.name AS store_name
    FROM orders o
    INNER JOIN stores s ON s.id = o.store_id
    WHERE o.store_id = ${storeId}::uuid
      AND o.purchase_cycle_date = ${cycleDate}::date
      AND o.cancelled_at IS NULL
    ORDER BY o.revision DESC
    LIMIT 1
  `;

  if (!order) {
    return null;
  }

  // Busca itens com quantidade > 0 do pedido
  const orderItems = await sql`
    SELECT 
      oi.product_id,
      oi.quantity::float AS quantity,
      oi.snapshot_unit,
      p.erp_code,
      p.name AS product_name,
      p.purchase_format,
      p.photo_key,
      p.photo_updated_at::text AS photo_updated_at
    FROM order_items oi
    INNER JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ${order.id}::uuid
      AND oi.quantity > 0
    ORDER BY p.name ASC
  `;

  if (orderItems.length === 0) {
    return null;
  }

  // Inicializa o cabeçalho e itens de conferência atomicamente
  return await sql.begin(async (tx) => {
    const [createdConf] = await tx`
      INSERT INTO store_delivery_conferences (
        purchase_cycle_date,
        store_id,
        order_id,
        order_revision,
        status,
        total_items,
        verified_items
      ) VALUES (
        ${cycleDate}::date,
        ${storeId}::uuid,
        ${order.id}::uuid,
        ${order.revision},
        'IN_PROGRESS',
        ${orderItems.length},
        0
      )
      RETURNING 
        id,
        purchase_cycle_date::text AS purchase_cycle_date,
        store_id,
        order_id,
        order_revision,
        status,
        total_items,
        verified_items,
        finalized_at::text AS finalized_at,
        finalized_by,
        version,
        created_at::text AS created_at,
        updated_at::text AS updated_at
    `;

    const insertedItems: ConferenceItem[] = [];

    for (const item of orderItems) {
      const unit = item.purchase_format || item.snapshot_unit || "CX";
      const [ci] = await tx`
        INSERT INTO store_delivery_conference_items (
          conference_id,
          product_id,
          ordered_quantity,
          ordered_unit,
          received_weight_kg,
          is_unreceived
        ) VALUES (
          ${createdConf.id}::uuid,
          ${item.product_id}::uuid,
          ${item.quantity},
          ${unit},
          NULL,
          false
        )
        RETURNING 
          id,
          conference_id,
          product_id,
          ordered_quantity::float AS ordered_quantity,
          ordered_unit,
          received_weight_kg::float AS received_weight_kg,
          is_unreceived,
          checked_at::text AS checked_at,
          checked_by
      `;

      insertedItems.push({
        id: ci.id,
        conferenceId: ci.conference_id,
        productId: ci.product_id,
        erpCode: item.erp_code,
        productName: item.product_name,
        photoKey: item.photo_key,
        photoUpdatedAt: item.photo_updated_at,
        orderedQuantity: ci.ordered_quantity,
        orderedUnit: ci.ordered_unit,
        receivedWeightKg: ci.received_weight_kg,
        isUnreceived: ci.is_unreceived,
        checkedAt: ci.checked_at,
        checkedBy: ci.checked_by,
        checkerName: null,
      });
    }

    return {
      header: {
        id: createdConf.id,
        purchaseCycleDate: createdConf.purchase_cycle_date,
        storeId: createdConf.store_id,
        storeName: order.store_name,
        orderId: createdConf.order_id,
        orderRevision: createdConf.order_revision,
        status: createdConf.status,
        totalItems: createdConf.total_items,
        verifiedItems: createdConf.verified_items,
        finalizedAt: createdConf.finalized_at,
        finalizedBy: createdConf.finalized_by,
        finalizerName: null,
        version: createdConf.version,
        createdAt: createdConf.created_at,
        updatedAt: createdConf.updated_at,
      },
      items: insertedItems,
    };
  });
}

export async function listRecentConferences(
  storeId: string,
  limit = 5
): Promise<Array<{ cycleDate: string; status: string; totalItems: number; verifiedItems: number }>> {
  const { sql } = database();

  const rows = await sql`
    SELECT
      c.purchase_cycle_date::text AS cycle_date,
      c.status,
      c.total_items,
      c.verified_items
    FROM store_delivery_conferences c
    WHERE c.store_id = ${storeId}::uuid
    ORDER BY c.purchase_cycle_date DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    cycleDate: r.cycle_date,
    status: r.status,
    totalItems: r.total_items,
    verifiedItems: r.verified_items,
  }));
}

export async function saveConferenceDraft(params: {
  conferenceId: string;
  storeId: string;
  userId: string;
  items: Array<{
    productId: string;
    receivedWeightKg: number | null;
    isUnreceived: boolean;
  }>;
}): Promise<{ total: number; verified: number; pending: number; percent: number }> {
  const { sql } = database();

  return await sql.begin(async (tx) => {
    // 1. Bloqueia a conferência para evitar escrita concorrente
    const [conf] = await tx`
      SELECT id, status, total_items, version
      FROM store_delivery_conferences
      WHERE id = ${params.conferenceId}::uuid
        AND store_id = ${params.storeId}::uuid
      FOR UPDATE
    `;

    if (!conf) {
      throw new ConferenceValidationError("Conferência não encontrada para esta loja.");
    }

    if (conf.status === "FINALIZED") {
      throw new ConferenceValidationError("Esta conferência já está finalizada e não permite alterações.");
    }

    // 2. Atualiza cada item enviado
    for (const item of params.items) {
      validateReceivedWeight(item.receivedWeightKg);

      if (item.isUnreceived) {
        await tx`
          UPDATE store_delivery_conference_items
          SET 
            received_weight_kg = 0.00,
            is_unreceived = true,
            checked_at = now(),
            checked_by = ${params.userId}::uuid,
            updated_at = now()
          WHERE conference_id = ${params.conferenceId}::uuid
            AND product_id = ${item.productId}::uuid
        `;
      } else if (item.receivedWeightKg !== null && item.receivedWeightKg > 0) {
        await tx`
          UPDATE store_delivery_conference_items
          SET 
            received_weight_kg = ${item.receivedWeightKg},
            is_unreceived = false,
            checked_at = now(),
            checked_by = ${params.userId}::uuid,
            updated_at = now()
          WHERE conference_id = ${params.conferenceId}::uuid
            AND product_id = ${item.productId}::uuid
        `;
      } else {
        // Volta para pendente
        await tx`
          UPDATE store_delivery_conference_items
          SET 
            received_weight_kg = NULL,
            is_unreceived = false,
            checked_at = NULL,
            checked_by = NULL,
            updated_at = now()
          WHERE conference_id = ${params.conferenceId}::uuid
            AND product_id = ${item.productId}::uuid
        `;
      }
    }

    // 3. Recalcula verified_items
    const [{ verifiedCount }] = await tx<{ verifiedCount: number }[]>`
      SELECT count(*)::int AS "verifiedCount"
      FROM store_delivery_conference_items
      WHERE conference_id = ${params.conferenceId}::uuid
        AND (is_unreceived = true OR (received_weight_kg IS NOT NULL AND received_weight_kg > 0))
    `;

    await tx`
      UPDATE store_delivery_conferences
      SET 
        verified_items = ${verifiedCount},
        version = version + 1,
        updated_at = now()
      WHERE id = ${params.conferenceId}::uuid
    `;

    // 4. Trilha de auditoria
    await tx`
      INSERT INTO audit_events (
        id, actor_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES (
        gen_random_uuid(),
        ${params.userId}::uuid,
        'store_delivery_conference.save_draft',
        'store_delivery_conferences',
        ${params.conferenceId},
        ${JSON.stringify({
          storeId: params.storeId,
          verifiedItems: verifiedCount,
          totalItems: conf.total_items,
        })}::jsonb,
        now()
      )
    `;

    const progress = calculateConferenceProgress(params.items);
    return progress;
  });
}

export async function finalizeConference(params: {
  conferenceId: string;
  storeId: string;
  userId: string;
  items: Array<{
    productId: string;
    productName?: string;
    receivedWeightKg: number | null;
    isUnreceived: boolean;
  }>;
}): Promise<void> {
  const { sql } = database();

  await sql.begin(async (tx) => {
    // 1. Bloqueia a conferência
    const [conf] = await tx`
      SELECT id, status, total_items, version
      FROM store_delivery_conferences
      WHERE id = ${params.conferenceId}::uuid
        AND store_id = ${params.storeId}::uuid
      FOR UPDATE
    `;

    if (!conf) {
      throw new ConferenceValidationError("Conferência não encontrada para esta loja.");
    }

    if (conf.status === "FINALIZED") {
      throw new ConferenceValidationError("Esta conferência já se encontra finalizada.");
    }

    // 2. Salva todos os itens recebidos
    for (const item of params.items) {
      validateReceivedWeight(item.receivedWeightKg);

      if (item.isUnreceived) {
        await tx`
          UPDATE store_delivery_conference_items
          SET 
            received_weight_kg = 0.00,
            is_unreceived = true,
            checked_at = now(),
            checked_by = ${params.userId}::uuid,
            updated_at = now()
          WHERE conference_id = ${params.conferenceId}::uuid
            AND product_id = ${item.productId}::uuid
        `;
      } else if (item.receivedWeightKg !== null && item.receivedWeightKg > 0) {
        await tx`
          UPDATE store_delivery_conference_items
          SET 
            received_weight_kg = ${item.receivedWeightKg},
            is_unreceived = false,
            checked_at = now(),
            checked_by = ${params.userId}::uuid,
            updated_at = now()
          WHERE conference_id = ${params.conferenceId}::uuid
            AND product_id = ${item.productId}::uuid
        `;
      } else {
        await tx`
          UPDATE store_delivery_conference_items
          SET 
            received_weight_kg = NULL,
            is_unreceived = false,
            checked_at = NULL,
            checked_by = NULL,
            updated_at = now()
          WHERE conference_id = ${params.conferenceId}::uuid
            AND product_id = ${item.productId}::uuid
        `;
      }
    }

    // 3. Validação estrita de finalização: 100% dos itens verificados
    const allDbItems = await tx`
      SELECT 
        ci.product_id,
        p.name AS product_name,
        ci.received_weight_kg::float AS received_weight_kg,
        ci.is_unreceived
      FROM store_delivery_conference_items ci
      INNER JOIN products p ON p.id = ci.product_id
      WHERE ci.conference_id = ${params.conferenceId}::uuid
    `;

    assertCanFinalizeConference(
      allDbItems.map((it) => ({
        productName: it.product_name,
        receivedWeightKg: it.received_weight_kg,
        isUnreceived: it.is_unreceived,
      }))
    );

    // 4. Marca status FINALIZED
    await tx`
      UPDATE store_delivery_conferences
      SET 
        status = 'FINALIZED',
        verified_items = total_items,
        finalized_at = now(),
        finalized_by = ${params.userId}::uuid,
        version = version + 1,
        updated_at = now()
      WHERE id = ${params.conferenceId}::uuid
    `;

    // 5. Trilha de auditoria
    await tx`
      INSERT INTO audit_events (
        id, actor_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES (
        gen_random_uuid(),
        ${params.userId}::uuid,
        'store_delivery_conference.finalize',
        'store_delivery_conferences',
        ${params.conferenceId},
        ${JSON.stringify({
          storeId: params.storeId,
          totalItems: conf.total_items,
          verifiedItems: conf.total_items,
        })}::jsonb,
        now()
      )
    `;
  });
}
