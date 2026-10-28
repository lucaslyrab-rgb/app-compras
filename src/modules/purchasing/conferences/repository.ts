import { database } from "@/db/client";
import {
  ConferenceValidationError,
  calculateConferenceProgress,
  assertCanFinalizeConference,
  validateReceivedWeight,
  type ConferenceCycleOption,
  type ConferenceHeader,
  type ConferenceItem,
} from "./domain";

const CONFERENCE_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { code?: string }).code === CONFERENCE_UNIQUE_VIOLATION;
}

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
      c.cancelled_at::text AS cancelled_at,
      c.cancelled_by,
      c.cancellation_reason,
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
    // Conferências finalizadas/canceladas são histórico encerrado: não revalidar
    // contra o pedido atual. Conferências em andamento precisam refletir se a
    // loja revisou ou cancelou o pedido depois que esta conferência foi criada.
    let orderSyncStatus: ConferenceHeader["orderSyncStatus"] = "SYNCED";
    if (existing.status === "IN_PROGRESS") {
      const [currentOrder] = await sql`
        SELECT id, revision
        FROM orders
        WHERE store_id = ${storeId}::uuid
          AND purchase_cycle_date = ${cycleDate}::date
          AND cancelled_at IS NULL
        ORDER BY revision DESC
        LIMIT 1
      `;
      if (!currentOrder) {
        orderSyncStatus = "CANCELLED_WITHOUT_REPLACEMENT";
      } else if (currentOrder.id !== existing.order_id) {
        orderSyncStatus = "REVISED";
      }
    }

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
        AND ci.removed_from_order = false
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
        cancelledAt: existing.cancelled_at,
        cancelledBy: existing.cancelled_by,
        cancellationReason: existing.cancellation_reason,
        version: existing.version,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
        orderSyncStatus,
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
  try {
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
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        version: createdConf.version,
        createdAt: createdConf.created_at,
        updatedAt: createdConf.updated_at,
        orderSyncStatus: "SYNCED",
      },
      items: insertedItems,
    };
    });
  } catch (error) {
    // Duas requisições concorrentes podem checar "não existe conferência" e tentar
    // criar ao mesmo tempo; a constraint única (purchase_cycle_date, store_id) rejeita
    // a segunda. Em vez de propagar erro, recarrega a conferência que a outra já criou.
    if (isUniqueViolation(error)) {
      return getStoreConference(storeId, cycleDate);
    }
    throw error;
  }
}

/**
 * Lista os ciclos que o seletor de /conferencia pode oferecer. TODA pendência
 * (NOT_STARTED ou IN_PROGRESS) é sempre incluída, não importa a idade - uma
 * conferência pendente antiga nunca deve desaparecer só porque ciclos novos já
 * encerrados (FINALIZED ou CANCELLED) se acumularam. Só o histórico encerrado
 * é limitado/recente, como contexto; ele não representa trabalho pendente.
 */
export async function listStoreConferenceCycles(
  storeId: string,
  finalizedHistoryLimit = 14
): Promise<ConferenceCycleOption[]> {
  const { sql } = database();

  const rows = await sql`
    WITH cycle_dates AS (
      SELECT DISTINCT purchase_cycle_date FROM orders
      WHERE store_id = ${storeId}::uuid AND cancelled_at IS NULL
      UNION
      SELECT DISTINCT purchase_cycle_date FROM store_delivery_conferences
      WHERE store_id = ${storeId}::uuid
    ),
    joined AS (
      SELECT
        cd.purchase_cycle_date,
        COALESCE(c.status, 'NOT_STARTED') AS status,
        COALESCE(c.total_items, 0) AS total_items,
        COALESCE(c.verified_items, 0) AS verified_items
      FROM cycle_dates cd
      LEFT JOIN store_delivery_conferences c
        ON c.store_id = ${storeId}::uuid AND c.purchase_cycle_date = cd.purchase_cycle_date
    ),
    pending AS (
      SELECT * FROM joined WHERE status NOT IN ('FINALIZED', 'CANCELLED')
    ),
    recent_finalized AS (
      SELECT * FROM joined WHERE status IN ('FINALIZED', 'CANCELLED')
      ORDER BY purchase_cycle_date DESC
      LIMIT ${finalizedHistoryLimit}
    )
    SELECT purchase_cycle_date::text AS cycle_date, status, total_items, verified_items FROM pending
    UNION
    SELECT purchase_cycle_date::text AS cycle_date, status, total_items, verified_items FROM recent_finalized
    ORDER BY cycle_date ASC
  `;

  return rows.map((r) => ({
    cycleDate: r.cycle_date as string,
    status: r.status as ConferenceCycleOption["status"],
    totalItems: r.total_items as number,
    verifiedItems: r.verified_items as number,
  }));
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
  expectedVersion: number;
  items: Array<{
    productId: string;
    receivedWeightKg: number | null;
    isUnreceived: boolean;
  }>;
}): Promise<{ total: number; verified: number; pending: number; percent: number; version: number }> {
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

    // 1b. O bloqueio FOR UPDATE serializa escritas concorrentes, mas sem checar a versão
    // esperada a última gravação sempre venceria mesmo enviando dados antigos (ex.: um
    // operador reabre a tela antes da pesagem de outro e devolve um item já conferido
    // para pendente). Rejeita a gravação se a conferência avançou desde que foi lida.
    if (conf.version !== params.expectedVersion) {
      throw new ConferenceValidationError(
        "Esta conferência foi atualizada por outra sessão desde o seu último carregamento. Atualize a página para ver os dados mais recentes antes de salvar."
      );
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
        AND removed_from_order = false
        AND (is_unreceived = true OR (received_weight_kg IS NOT NULL AND received_weight_kg > 0))
    `;

    const [{ version: newVersion }] = await tx`
      UPDATE store_delivery_conferences
      SET
        verified_items = ${verifiedCount},
        version = version + 1,
        updated_at = now()
      WHERE id = ${params.conferenceId}::uuid
      RETURNING version
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
    return { ...progress, version: newVersion as number };
  });
}

export async function finalizeConference(params: {
  conferenceId: string;
  storeId: string;
  userId: string;
  expectedVersion: number;
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
      SELECT id, status, total_items, version, order_id, purchase_cycle_date::text AS purchase_cycle_date
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

    if (conf.version !== params.expectedVersion) {
      throw new ConferenceValidationError(
        "Esta conferência foi atualizada por outra sessão desde o seu último carregamento. Atualize a página para ver os dados mais recentes antes de finalizar."
      );
    }

    // 1b. Reconfirma que o pedido que originou esta conferência continua sendo a
    // revisão vigente da loja para o ciclo. Revisão nova ou cancelamento depois da
    // criação da conferência não pode ser finalizado como se nada tivesse mudado.
    const [currentOrder] = await tx`
      SELECT id
      FROM orders
      WHERE store_id = ${params.storeId}::uuid
        AND purchase_cycle_date = ${conf.purchase_cycle_date}::date
        AND cancelled_at IS NULL
      ORDER BY revision DESC
      LIMIT 1
    `;

    if (!currentOrder) {
      throw new ConferenceValidationError(
        "O pedido desta loja foi cancelado sem revisão substituta para este ciclo; não há o que finalizar. Cancele esta conferência em vez de finalizá-la."
      );
    }
    if (currentOrder.id !== conf.order_id) {
      throw new ConferenceValidationError(
        "O pedido desta loja foi revisado depois que esta conferência foi iniciada. Sincronize com o pedido vigente antes de finalizar."
      );
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
        AND ci.removed_from_order = false
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

/**
 * Reconcilia uma conferência em andamento com a revisão de pedido vigente da loja,
 * quando a revisão que originou a conferência foi substituída ou cancelada
 * (ConferenceHeader.orderSyncStatus === "REVISED"). Não apaga nada: produtos que saíram da
 * revisão vigente são marcados `removed_from_order`, preservando a pesagem e o
 * histórico para auditoria; produtos novos entram como pendentes; produtos que
 * continuam na revisão têm apenas `ordered_quantity`/`ordered_unit` atualizados,
 * mantendo a pesagem já registrada (pesagem aproveitável).
 */
export async function reconcileConferenceWithCurrentOrder(params: {
  conferenceId: string;
  storeId: string;
  userId: string;
}): Promise<{ header: ConferenceHeader; items: ConferenceItem[] } | null> {
  const { sql } = database();

  const cycleDate = await sql.begin(async (tx) => {
    const [conf] = await tx`
      SELECT id, status, order_id, order_revision, purchase_cycle_date::text AS purchase_cycle_date
      FROM store_delivery_conferences
      WHERE id = ${params.conferenceId}::uuid
        AND store_id = ${params.storeId}::uuid
      FOR UPDATE
    `;

    if (!conf) {
      throw new ConferenceValidationError("Conferência não encontrada para esta loja.");
    }

    if (conf.status === "FINALIZED") {
      throw new ConferenceValidationError("Esta conferência já está finalizada e não pode ser reconciliada.");
    }

    const [currentOrder] = await tx`
      SELECT id, revision
      FROM orders
      WHERE store_id = ${params.storeId}::uuid
        AND purchase_cycle_date = ${conf.purchase_cycle_date}::date
        AND cancelled_at IS NULL
      ORDER BY revision DESC
      LIMIT 1
    `;

    if (!currentOrder) {
      throw new ConferenceValidationError(
        "Não há pedido vigente desta loja para este ciclo (o pedido foi cancelado sem substituição). Use a opção de cancelar a conferência em vez de sincronizar."
      );
    }

    if (currentOrder.id === conf.order_id) {
      // Já está sincronizada com a revisão vigente; nada a reconciliar.
      return conf.purchase_cycle_date as string;
    }

    const newOrderItems = await tx`
      SELECT oi.product_id, oi.quantity::float AS quantity, oi.snapshot_unit, p.purchase_format
      FROM order_items oi
      INNER JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ${currentOrder.id}::uuid
        AND oi.quantity > 0
    `;
    const newProductIds = new Set(newOrderItems.map((it) => it.product_id as string));

    const existingItems = await tx`
      SELECT id, product_id, removed_from_order
      FROM store_delivery_conference_items
      WHERE conference_id = ${params.conferenceId}::uuid
    `;
    const existingByProduct = new Map(existingItems.map((it) => [it.product_id as string, it]));

    let added = 0;
    let removed = 0;
    let updated = 0;

    for (const item of newOrderItems) {
      const unit = item.purchase_format || item.snapshot_unit || "CX";
      const existingItem = existingByProduct.get(item.product_id as string);

      if (!existingItem) {
        await tx`
          INSERT INTO store_delivery_conference_items (
            conference_id, product_id, ordered_quantity, ordered_unit,
            received_weight_kg, is_unreceived, removed_from_order
          ) VALUES (
            ${params.conferenceId}::uuid, ${item.product_id}::uuid, ${item.quantity}, ${unit},
            NULL, false, false
          )
        `;
        added += 1;
      } else {
        await tx`
          UPDATE store_delivery_conference_items
          SET ordered_quantity = ${item.quantity}, ordered_unit = ${unit}, removed_from_order = false, updated_at = now()
          WHERE id = ${existingItem.id}::uuid
        `;
        if (existingItem.removed_from_order) updated += 1;
      }
    }

    for (const existingItem of existingItems) {
      if (!newProductIds.has(existingItem.product_id as string) && !existingItem.removed_from_order) {
        await tx`
          UPDATE store_delivery_conference_items
          SET removed_from_order = true, updated_at = now()
          WHERE id = ${existingItem.id}::uuid
        `;
        removed += 1;
      }
    }

    const [{ totalCount, verifiedCount }] = await tx<{ totalCount: number; verifiedCount: number }[]>`
      SELECT
        count(*) FILTER (WHERE removed_from_order = false)::int AS "totalCount",
        count(*) FILTER (
          WHERE removed_from_order = false
            AND (is_unreceived = true OR (received_weight_kg IS NOT NULL AND received_weight_kg > 0))
        )::int AS "verifiedCount"
      FROM store_delivery_conference_items
      WHERE conference_id = ${params.conferenceId}::uuid
    `;

    await tx`
      UPDATE store_delivery_conferences
      SET
        order_id = ${currentOrder.id}::uuid,
        order_revision = ${currentOrder.revision},
        total_items = ${totalCount},
        verified_items = ${verifiedCount},
        version = version + 1,
        reconciled_at = now(),
        reconciled_by = ${params.userId}::uuid,
        updated_at = now()
      WHERE id = ${params.conferenceId}::uuid
    `;

    await tx`
      INSERT INTO audit_events (
        id, actor_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES (
        gen_random_uuid(),
        ${params.userId}::uuid,
        'store_delivery_conference.reconcile',
        'store_delivery_conferences',
        ${params.conferenceId},
        ${JSON.stringify({
          storeId: params.storeId,
          previousOrderId: conf.order_id,
          previousOrderRevision: conf.order_revision,
          newOrderId: currentOrder.id,
          newOrderRevision: currentOrder.revision,
          itemsAdded: added,
          itemsRemoved: removed,
          itemsRestored: updated,
        })}::jsonb,
        now()
      )
    `;

    return conf.purchase_cycle_date as string;
  });

  return getStoreConference(params.storeId, cycleDate);
}

/**
 * Encerra (cancela) uma conferência em andamento cujo pedido foi cancelado sem
 * nenhuma revisão substituta - não há pedido para conferir. Não apaga nada: os
 * itens e a pesagem já registrada permanecem no banco para auditoria; o
 * encerramento fica rastreável (cancelled_at/cancelled_by/cancellation_reason),
 * no mesmo espírito do cancelamento lógico já usado em `orders`.
 */
export async function cancelConferenceWithoutReplacementOrder(params: {
  conferenceId: string;
  storeId: string;
  userId: string;
  reason?: string;
}): Promise<{ header: ConferenceHeader; items: ConferenceItem[] } | null> {
  const { sql } = database();

  const cycleDate = await sql.begin(async (tx) => {
    const [conf] = await tx`
      SELECT id, status, order_id, purchase_cycle_date::text AS purchase_cycle_date
      FROM store_delivery_conferences
      WHERE id = ${params.conferenceId}::uuid
        AND store_id = ${params.storeId}::uuid
      FOR UPDATE
    `;

    if (!conf) {
      throw new ConferenceValidationError("Conferência não encontrada para esta loja.");
    }

    if (conf.status !== "IN_PROGRESS") {
      throw new ConferenceValidationError("Esta conferência não está em andamento e não pode ser cancelada por esta via.");
    }

    // Reconfirma dentro da transação: só cancela por esta via quando realmente
    // não existe pedido vigente. Se existir, a operação correta é reconciliar.
    const [currentOrder] = await tx`
      SELECT id
      FROM orders
      WHERE store_id = ${params.storeId}::uuid
        AND purchase_cycle_date = ${conf.purchase_cycle_date}::date
        AND cancelled_at IS NULL
      ORDER BY revision DESC
      LIMIT 1
    `;

    if (currentOrder) {
      throw new ConferenceValidationError(
        "Existe um pedido vigente para este ciclo; sincronize a conferência em vez de cancelá-la."
      );
    }

    const reason = params.reason?.trim() || "Pedido da loja cancelado sem revisão substituta para este ciclo.";

    await tx`
      UPDATE store_delivery_conferences
      SET
        status = 'CANCELLED',
        cancelled_at = now(),
        cancelled_by = ${params.userId}::uuid,
        cancellation_reason = ${reason},
        version = version + 1,
        updated_at = now()
      WHERE id = ${params.conferenceId}::uuid
    `;

    await tx`
      INSERT INTO audit_events (
        id, actor_id, action, entity_type, entity_id, metadata, created_at
      ) VALUES (
        gen_random_uuid(),
        ${params.userId}::uuid,
        'store_delivery_conference.cancel',
        'store_delivery_conferences',
        ${params.conferenceId},
        ${JSON.stringify({
          storeId: params.storeId,
          previousOrderId: conf.order_id,
          reason,
        })}::jsonb,
        now()
      )
    `;

    return conf.purchase_cycle_date as string;
  });

  return getStoreConference(params.storeId, cycleDate);
}
