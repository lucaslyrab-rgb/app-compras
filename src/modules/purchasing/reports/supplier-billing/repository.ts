import { database } from "@/db/client";
import {
  type BillingStoreItem,
  type BillingStoreSection,
  type ConsolidatedProductBilling,
  type ProductWithoutDemand,
  type SupplierBillingHeader,
  type SupplierBillingReport,
  sumQuantities,
} from "./domain";

type RawSupplier = {
  id: string;
  corporate_name: string;
  trade_name: string | null;
  tax_id: string | null;
  tax_id_type: string;
  tax_invoice_rule: string;
  contact_name: string | null;
  contact_phone: string | null;
};

type RawStore = {
  id: string;
  slug: string;
  name: string;
  order_id: string | null;
  revision: number | null;
  submitted_at: string | null;
  cutoff_at: string | null;
};

type TargetProduct = {
  id: string;
  erp_code: number;
  name: string;
  unit: string;
  purchase_format: string;
};

export async function loadSupplierBillingReport(
  supplierId: string,
  requestedCycle?: string,
  db = database().sql
): Promise<SupplierBillingReport> {
  // 1. Busca dados do fornecedor
  const [supplierRow] = await db<RawSupplier[]>`
    SELECT
      id,
      corporate_name,
      trade_name,
      tax_id,
      tax_id_type,
      tax_invoice_rule,
      contact_name,
      contact_phone
    FROM suppliers
    WHERE id = ${supplierId}::uuid
  `;

  if (!supplierRow) {
    throw new Error("Fornecedor não encontrado.");
  }

  const supplier: SupplierBillingHeader = {
    id: supplierRow.id,
    corporateName: supplierRow.corporate_name,
    tradeName: supplierRow.trade_name,
    taxId: supplierRow.tax_id,
    taxIdType: supplierRow.tax_id_type,
    taxInvoiceRule: supplierRow.tax_invoice_rule,
    contactName: supplierRow.contact_name,
    contactPhone: supplierRow.contact_phone,
  };

  // 2. Busca ciclos disponíveis
  const availableCycleRows = await db<{ cycle_date: string }[]>`
    SELECT DISTINCT purchase_cycle_date::text AS cycle_date
    FROM orders
    WHERE cancelled_at IS NULL
    ORDER BY cycle_date DESC
  `;
  const availableCycles = availableCycleRows.map((r) => r.cycle_date);

  const cycleDate = requestedCycle ?? availableCycles[0] ?? new Date().toISOString().split("T")[0];

  // 3. Busca produtos vinculados como exclusivos ao fornecedor
  let targetProducts: TargetProduct[] = await db<TargetProduct[]>`
    SELECT
      p.id,
      p.erp_code,
      p.name,
      p.unit,
      p.purchase_format
    FROM products p
    JOIN product_suppliers ps ON ps.product_id = p.id
    WHERE ps.supplier_id = ${supplierId}::uuid
      AND ps.is_exclusive = true
      AND ps.active = true
      AND p.active = true
    ORDER BY p.erp_code ASC
  `;

  // Fallback inteligente: se nenhum produto estiver explicitamente em product_suppliers ainda,
  // mas o fornecedor for a JEB, utiliza os produtos com exclusive_supplier = true
  const isJeb =
    supplier.taxId === "48336863000160" ||
    supplier.corporateName.toUpperCase().includes("JEB DISTRIBUIDORA");

  if (targetProducts.length === 0 && isJeb) {
    targetProducts = await db<TargetProduct[]>`
      SELECT
        id,
        erp_code,
        name,
        unit,
        purchase_format
      FROM products
      WHERE exclusive_supplier = true
        AND active = true
      ORDER BY erp_code ASC
    `;
  }

  // 4. Busca lojas e os pedidos válidos mais recentes para o ciclo.
  // Regra do sistema: o cancelamento do envio mais recente nunca reativa uma revisão histórica anterior.
  const storeRows = await db<RawStore[]>`
    WITH latest_orders AS (
      SELECT DISTINCT ON (store_id)
        id,
        store_id,
        revision,
        submitted_at,
        cutoff_at,
        cancelled_at
      FROM orders
      WHERE purchase_cycle_date = ${cycleDate}::date
      ORDER BY store_id, submitted_at DESC, revision DESC, id DESC
    )
    SELECT
      s.id,
      s.slug,
      s.name,
      CASE WHEN lo.cancelled_at IS NULL THEN lo.id ELSE NULL END AS order_id,
      CASE WHEN lo.cancelled_at IS NULL THEN lo.revision ELSE NULL END AS revision,
      CASE WHEN lo.cancelled_at IS NULL THEN lo.submitted_at::text ELSE NULL END AS submitted_at,
      CASE WHEN lo.cancelled_at IS NULL THEN lo.cutoff_at::text ELSE NULL END AS cutoff_at
    FROM stores s
    LEFT JOIN latest_orders lo ON lo.store_id = s.id
    WHERE s.active = true
    ORDER BY CASE s.slug
      WHEN 'ponta-da-fruta' THEN 1
      WHEN 'balneario' THEN 2
      WHEN 'santa-monica' THEN 3
      ELSE 4
    END, s.name ASC
  `;

  // 5. Verifica se existem alocações operacionais (Fase 3) para este fornecedor e ciclo
  const allocationRows = await db<
    {
      product_id: string;
      store_id: string;
      ordered_quantity: string;
      destined_quantity: string;
      is_additional_purchase: boolean;
    }[]
  >`
    SELECT
      product_id,
      store_id,
      ordered_quantity::text,
      destined_quantity::text,
      is_additional_purchase
    FROM purchase_cycle_product_allocations
    WHERE supplier_id = ${supplierId}::uuid
      AND purchase_cycle_date = ${cycleDate}::date
  `;

  const hasAllocations = allocationRows.length > 0;

  if (hasAllocations) {
    // Modo baseado em alocações operacionais do comprador (Fase 3)
    const allocatedProductIds = [...new Set(allocationRows.map((a) => a.product_id))];
    const targetProductIds = new Set(targetProducts.map((p) => p.id));
    const missingProductIds = allocatedProductIds.filter((id) => !targetProductIds.has(id));

    if (missingProductIds.length > 0) {
      const extraProducts = await db<TargetProduct[]>`
        SELECT id, erp_code, name, unit, purchase_format
        FROM products
        WHERE id IN ${db(missingProductIds)}
        ORDER BY erp_code ASC
      `;
      targetProducts = [...targetProducts, ...extraProducts].sort((a, b) => a.erp_code - b.erp_code);
    }

    const allocMap = new Map<string, (typeof allocationRows)[0]>();
    for (const a of allocationRows) {
      allocMap.set(`${a.store_id}:${a.product_id}`, a);
    }

    const stores: BillingStoreSection[] = storeRows.map((store) => {
      const hasOrder = Boolean(store.order_id);
      const storeItems: BillingStoreItem[] = [];

      for (const prod of targetProducts) {
        const alloc = allocMap.get(`${store.id}:${prod.id}`);
        if (alloc && Number(alloc.destined_quantity) > 0) {
          const diffNum = Number(alloc.destined_quantity) - Number(alloc.ordered_quantity);
          const diffSign = diffNum > 0 ? "+" : "";
          storeItems.push({
            productId: prod.id,
            erpCode: prod.erp_code,
            productName: prod.name,
            unit: prod.unit,
            purchaseFormat: prod.purchase_format,
            quantity: Number(alloc.destined_quantity).toFixed(2),
            orderedQuantity: Number(alloc.ordered_quantity).toFixed(2),
            destinedQuantity: Number(alloc.destined_quantity).toFixed(2),
            difference: `${diffSign}${diffNum.toFixed(2)}`,
            isAdditional: alloc.is_additional_purchase,
          });
        }
      }

      const totalQuantity = sumQuantities(storeItems.map((i) => i.quantity));

      return {
        storeId: store.id,
        storeSlug: store.slug,
        storeName: store.name,
        hasOrder: hasOrder || storeItems.length > 0,
        orderId: store.order_id,
        revision: store.revision,
        submittedAt: store.submitted_at,
        cutoffAt: store.cutoff_at,
        items: storeItems,
        totalQuantity,
      };
    });

    const consolidatedProducts: ConsolidatedProductBilling[] = [];
    const productsWithoutOrders: ProductWithoutDemand[] = [];

    for (const prod of targetProducts) {
      const storeQuantities: Record<string, string> = {};
      const quantitiesToSum: string[] = [];
      let prodTotalOrdered = 0;
      let prodTotalDestined = 0;
      let prodIsAdditional = false;

      for (const store of storeRows) {
        const alloc = allocMap.get(`${store.id}:${prod.id}`);
        if (alloc) {
          const dest = Number(alloc.destined_quantity);
          const ord = Number(alloc.ordered_quantity);
          prodTotalOrdered += ord;
          prodTotalDestined += dest;
          if (alloc.is_additional_purchase) prodIsAdditional = true;
          storeQuantities[store.id] = dest > 0 ? dest.toFixed(2) : "0.00";
          quantitiesToSum.push(alloc.destined_quantity);
        } else {
          storeQuantities[store.id] = "—";
        }
      }

      const totalQuantity = sumQuantities(quantitiesToSum);

      if (Number(totalQuantity) > 0) {
        const diffNum = prodTotalDestined - prodTotalOrdered;
        const diffSign = diffNum > 0 ? "+" : "";
        consolidatedProducts.push({
          productId: prod.id,
          erpCode: prod.erp_code,
          productName: prod.name,
          unit: prod.unit,
          purchaseFormat: prod.purchase_format,
          storeQuantities,
          totalQuantity,
          totalOrdered: prodTotalOrdered.toFixed(2),
          totalDestined: prodTotalDestined.toFixed(2),
          totalDifference: `${diffSign}${diffNum.toFixed(2)}`,
          isAdditional: prodIsAdditional && prodTotalOrdered === 0,
        });
      } else {
        productsWithoutOrders.push({
          productId: prod.id,
          erpCode: prod.erp_code,
          productName: prod.name,
          purchaseFormat: prod.purchase_format,
          unit: prod.unit,
          reason: prodTotalOrdered > 0 ? "not_bought" : "not_demanded",
        });
      }
    }

    return {
      supplier,
      cycleDate,
      availableCycles,
      stores,
      consolidatedProducts,
      productsWithoutOrders,
      hasAllocations: true,
      loadedAt: new Date().toISOString(),
    };
  }

  // 6. Fallback Histórico: Sem alocações no ciclo, baseia-se nos pedidos originais das lojas
  const orderIds = storeRows.map((s) => s.order_id).filter((id): id is string => Boolean(id));

  type RawItem = {
    order_id: string;
    product_id: string;
    quantity: string;
  };

  const itemRows = orderIds.length > 0 && targetProducts.length > 0
    ? await db<RawItem[]>`
        SELECT
          oi.order_id,
          oi.product_id,
          oi.quantity::text
        FROM order_items oi
        WHERE oi.order_id IN ${db(orderIds)}
          AND oi.product_id IN ${db(targetProducts.map((p) => p.id))}
      `
    : [];

  const itemsByOrderAndProduct = new Map<string, string>();
  for (const item of itemRows) {
    itemsByOrderAndProduct.set(`${item.order_id}:${item.product_id}`, item.quantity);
  }

  const stores: BillingStoreSection[] = storeRows.map((store) => {
    const hasOrder = Boolean(store.order_id);
    const storeItems: BillingStoreItem[] = [];

    if (hasOrder && store.order_id) {
      for (const prod of targetProducts) {
        const rawQty = itemsByOrderAndProduct.get(`${store.order_id}:${prod.id}`) ?? "0";
        const numQty = Number(rawQty);
        if (numQty > 0) {
          storeItems.push({
            productId: prod.id,
            erpCode: prod.erp_code,
            productName: prod.name,
            unit: prod.unit,
            purchaseFormat: prod.purchase_format,
            quantity: Number(rawQty).toFixed(2),
          });
        }
      }
    }

    const totalQuantity = sumQuantities(storeItems.map((i) => i.quantity));

    return {
      storeId: store.id,
      storeSlug: store.slug,
      storeName: store.name,
      hasOrder,
      orderId: store.order_id,
      revision: store.revision,
      submittedAt: store.submitted_at,
      cutoffAt: store.cutoff_at,
      items: storeItems,
      totalQuantity,
    };
  });

  const consolidatedProducts: ConsolidatedProductBilling[] = [];
  const productsWithoutOrders: ProductWithoutDemand[] = [];

  for (const prod of targetProducts) {
    const storeQuantities: Record<string, string> = {};
    const quantitiesToSum: string[] = [];

    for (const store of storeRows) {
      if (store.order_id) {
        const qty = itemsByOrderAndProduct.get(`${store.order_id}:${prod.id}`) ?? "0";
        storeQuantities[store.id] = Number(qty).toFixed(2);
        quantitiesToSum.push(qty);
      } else {
        storeQuantities[store.id] = "—";
      }
    }

    const totalQuantity = sumQuantities(quantitiesToSum);

    if (Number(totalQuantity) > 0) {
      consolidatedProducts.push({
        productId: prod.id,
        erpCode: prod.erp_code,
        productName: prod.name,
        unit: prod.unit,
        purchaseFormat: prod.purchase_format,
        storeQuantities,
        totalQuantity,
      });
    } else {
      productsWithoutOrders.push({
        productId: prod.id,
        erpCode: prod.erp_code,
        productName: prod.name,
        purchaseFormat: prod.purchase_format,
        unit: prod.unit,
      });
    }
  }

  return {
    supplier,
    cycleDate,
    availableCycles,
    stores,
    consolidatedProducts,
    productsWithoutOrders,
    hasAllocations: false,
    loadedAt: new Date().toISOString(),
  };
}
