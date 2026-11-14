import PDFDocument from 'pdfkit';
import { IOrder } from '../models/Order';
import { IFulfillment, IFulfillmentItem } from '../models/Fulfillment';
import { normalizeSku } from './skuFormat';

export interface PackingSlipLine {
  item: IFulfillmentItem;
  /** Units of this line that were cancelled and refunded, and must not be packed. */
  cancelledQuantity: number;
}

export interface PackingSlipLines {
  lines: PackingSlipLine[];
  /** Lines that still have at least one unit to pick and pack. */
  packableLines: PackingSlipLine[];
  cancelledUnits: number;
}

/**
 * Resolves which lines may be packed. Cancelled and refunded units are never
 * fulfilled, so a line with no remaining quantity is dropped entirely and each
 * surviving line is annotated with how many units were removed.
 */
export function getPackingSlipLines(order: IOrder, fulfillment: IFulfillment): PackingSlipLines {
  const orderItems = order.items || [];
  const fulfillmentItems = fulfillment.items || [];
  const matchByIndex = orderItems.length === fulfillmentItems.length;

  const cancelledForItem = (fulfillmentItem: IFulfillmentItem, index: number): number => {
    const orderItem = matchByIndex
      ? orderItems[index]
      : orderItems.find(
          (item) => item._id && item._id.toString() === String(fulfillmentItem.orderItemId)
        );

    if (!orderItem) return 0;

    const orderedQuantity = Number(orderItem.quantity) || 0;
    const cancelledQuantity = Math.min(
      orderedQuantity,
      Math.max(0, Number(orderItem.cancelledQuantity) || 0)
    );
    return cancelledQuantity;
  };

  const lines: PackingSlipLine[] = fulfillmentItems.map((fulfillmentItem, index) => ({
    item: fulfillmentItem,
    cancelledQuantity: cancelledForItem(fulfillmentItem, index),
  }));

  return {
    lines,
    packableLines: lines.filter((line) => Number(line.item.quantityOrdered) > 0),
    cancelledUnits: orderItems.reduce(
      (sum, orderItem) => sum + Math.max(0, Number(orderItem.cancelledQuantity) || 0),
      0
    ),
  };
}

/**
 * Renders the warehouse packing slip body. Split out from the controller so it
 * can be exercised (and visually verified) without an HTTP request.
 */
export function renderPackingSlipDocument(
  doc: InstanceType<typeof PDFDocument>,
  order: IOrder,
  fulfillment: IFulfillment
): void {
  // Header
  doc.fontSize(20).text('SAMRAT FASHION — WAREHOUSE PACKING SLIP', { align: 'center' });
  doc.moveDown(0.5);
  doc
    .fontSize(10)
    .text(`Order Ref: ${order.orderNumber} | Date: ${new Date().toLocaleDateString('en-IN')}`, {
      align: 'center',
    });
  doc.moveDown(1);
  doc.moveTo(36, doc.y).lineTo(559, doc.y).stroke('#CCCCCC');
  doc.moveDown(1);

  // Address & Warehouse Info
  doc.fontSize(12).text('RECIPIENT / SHIPPING ADDRESS:', { underline: true });
  doc.fontSize(10).text(order.shippingAddress.fullName);
  doc.text(`${order.shippingAddress.addressLine1} ${order.shippingAddress.addressLine2 || ''}`);
  doc.text(
    `${order.shippingAddress.city}, ${order.shippingAddress.state} - ${order.shippingAddress.postalCode}`
  );
  doc.text(`Phone: ${order.shippingAddress.phone}`);
  doc.moveDown(1);

  const { packableLines, cancelledUnits } = getPackingSlipLines(order, fulfillment);

  doc.fontSize(12).text('FULFILLMENT DETAILS:', { underline: true });
  doc.fontSize(10).text(`Status: ${fulfillment.status}`);
  doc.text(`Location: Main Warehouse (Bin A1-BIN)`);
  doc.text(`Weight: ${fulfillment.packageDetails?.weightGrams || 500}g`);
  doc.text(`Units to pack: ${packableLines.reduce((sum, line) => sum + line.item.quantityOrdered, 0)}`);
  doc.moveDown(1);
  doc.moveTo(36, doc.y).lineTo(559, doc.y).stroke('#CCCCCC');
  doc.moveDown(1);

  // Items Table — cancelled & refunded units are never picked or packed
  doc.fontSize(12).text('PACKED ITEMS LIST:', { underline: true });
  doc.moveDown(0.5);

  if (packableLines.length === 0) {
    doc
      .fontSize(11)
      .fillColor('#B91C1C')
      .text('All items on this order were cancelled and refunded.');
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('DO NOT PACK OR DISPATCH THIS ORDER.');
    doc.font('Helvetica').fillColor('#000000');
  } else {
    const colX = { name: 36, variant: 260, qty: 390, packed: 470 };
    const colWidth = { name: 215, variant: 120, qty: 70, packed: 70 };
    const rowText = { height: 12, ellipsis: true };

    const headerY = doc.y;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Product / SKU', colX.name, headerY, { ...rowText, width: colWidth.name });
    doc.text('Size / Color', colX.variant, headerY, { ...rowText, width: colWidth.variant });
    doc.text('Qty to Pack', colX.qty, headerY, { ...rowText, width: colWidth.qty });
    doc.text('Packed', colX.packed, headerY, { ...rowText, width: colWidth.packed });
    doc.font('Helvetica');
    doc.y = headerY + 14;

    packableLines.forEach(({ item, cancelledQuantity }) => {
      const rowY = doc.y;
      const nameSuffix = cancelledQuantity > 0 ? `  (${cancelledQuantity} cancelled)` : '';
      const sku = normalizeSku(item.sku);

      doc.fontSize(9);
      doc.fillColor(cancelledQuantity > 0 ? '#B91C1C' : '#000000');
      doc.text(`${item.productName}${nameSuffix}`, colX.name, rowY, { ...rowText, width: colWidth.name });
      if (sku) {
        doc.fontSize(7.5).fillColor('#64748B').text(`SKU: ${sku}`, colX.name, rowY + 11, {
          ...rowText,
          height: 10,
          width: colWidth.name,
        });
      }
      doc.fillColor('#000000').fontSize(9);
      doc.text(`${item.selectedSize} / ${item.selectedColor}`, colX.variant, rowY, {
        ...rowText,
        width: colWidth.variant,
      });
      doc.text(String(item.quantityOrdered), colX.qty, rowY, { ...rowText, width: colWidth.qty });
      doc.text(String(item.quantityPacked || item.quantityOrdered), colX.packed, rowY, {
        ...rowText,
        width: colWidth.packed,
      });
      doc.y = rowY + (sku ? 26 : 16);
    });
  }

  doc.x = 36;

  if (cancelledUnits > 0 && packableLines.length > 0) {
    doc.moveDown(1);
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#B91C1C')
      .text(
        `NOTE: ${cancelledUnits} cancelled & refunded unit(s) are excluded from this slip. Do not pack them.`,
        36,
        doc.y,
        { width: 523 }
      );
    doc.font('Helvetica').fillColor('#000000');
  }

  doc.moveDown(2);
  doc
    .font('Helvetica-Oblique')
    .fontSize(9)
    .text(
      'NOTE: This packing slip is for warehouse verification. Not a financial tax invoice or shipping label.',
      36,
      doc.y,
      { width: 523, align: 'center' }
    );
}
