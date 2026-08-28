# Samrat Fashion — Operational Runbook (Phase 12A)

---

## 1. Daily Admin Operational Workflow

### Morning Order & Payment Review (09:00 IST)
1. Log into `/admin/login` using authenticated Admin credentials.
2. Review Dashboard KPIs at `/admin/dashboard` (Total Sales, Pending Orders, Custom Orders, Returns).
3. Filter Orders by status `CONFIRMED` and `PAID` at `/admin/orders`.
4. Verify payment capture status and Razorpay payment ID for all newly confirmed orders.

### Warehouse Fulfillment Workflow (10:00 IST)
1. Open Warehouse Fulfillment Queue at `/admin/production`.
2. Transition orders from `ALLOCATED` → `PICKED` after item retrieval from warehouse bins.
3. Perform Quality Check (QC) and pack items into standard branded mailers.
4. Transition order status from `PICKED` → `PACKED` → `READY_TO_SHIP`.

### Custom Printing Production Workflow (11:00 IST)
1. Filter Custom Print Orders at `/admin/custom-orders`.
2. Inspect customer-uploaded artwork, position snapshots, and print specifications.
3. Confirm customization details (locks order against customer cancellation).
4. Send print specifications to DTG (Direct-to-Garment) print queue (`PrintJob`).
5. Perform post-print QC inspection (color accuracy, placement, fabric integrity).
6. Handoff finished custom apparel to Warehouse Fulfillment.

### Courier Shipment & Handoff (14:00 IST)
1. Select orders in `READY_TO_SHIP` status at `/admin/orders`.
2. Generate shipping label and manifest.
3. Handoff sealed packages to courier pickup partner.
4. Transition order status from `READY_TO_SHIP` → `SHIPPED` and input AWB tracking code.

### Returns & Refund Handling (16:00 IST)
1. Review pending return requests at `/admin/returns`.
2. Validate return eligibility:
   - **Standard Apparel**: All valid reasons (`WRONG_SIZE`, `DAMAGED`, `DEFECTIVE`).
   - **Custom Printed Apparel**: Strictly restricted to `DAMAGED` or `WRONG_PRODUCT`.
3. Process incoming returned packages: `APPROVED` → `RECEIVED` → `INSPECTING` → `ACCEPTED`.
4. Initiate Razorpay refund for accepted returns. Stock is automatically restocked via `InventoryTransaction` (`RETURN`).

---

## 2. Inventory Reconciliation & Exception Handling

- **Stock Adjustments**: Perform manual stock restocks or adjustments at `/admin/inventory`. Every adjustment requires a mandatory audit reason.
- **Negative Stock Prevention**: Inventory transactions enforce compound unique indexes to guarantee idempotency.
- **Damaged Goods Handling**: Record damaged inventory as `ADJUSTMENT` with reason `DAMAGED_IN_TRANSIT` to ensure stock accuracy.
