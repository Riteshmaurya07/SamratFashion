import PDFDocument from 'pdfkit';
import { IInvoice, IInvoiceItemSnapshot } from '../models/Invoice';
import { ICreditNote } from '../models/CreditNote';
import { registerInvoiceFonts } from './fontLoader';

export function formatCurrency(amount: number): string {
  const num = Number(amount) || 0;
  return `₹${num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface InvoiceLineView {
  item: IInvoiceItemSnapshot;
  /** Units still billed on this line (ordered quantity minus cancelled quantity). */
  activeQuantity: number;
  /** Amount billed for the active units, pro-rated from the immutable line total. */
  activeLineTotal: number;
  cancelledQuantity: number;
}

export interface InvoiceAdjustments {
  lineViews: InvoiceLineView[];
  /** Lines that still have at least one active unit and are therefore billed. */
  billedLines: InvoiceLineView[];
  activeSubtotal: number;
  fullyCancelled: boolean;
  creditNotes: ICreditNote[];
  refundedAmount: number;
  netTotal: number;
}

const toPaise = (amount: number | undefined): number => Math.round((Number(amount) || 0) * 100);
const fromPaise = (paise: number): number => paise / 100;

/**
 * Derives what is actually billable on an invoice. Cancelled units stay on the
 * stored snapshot for the audit trail but must never be billed again, so every
 * renderer works from active quantities only.
 */
export function getInvoiceAdjustments(invoice: IInvoice, creditNotes: ICreditNote[] = []): InvoiceAdjustments {
  const lineViews: InvoiceLineView[] = (invoice.itemsSnapshot || []).map((item) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const cancelledQuantity = Math.min(quantity, Math.max(0, Number(item.cancelledQuantity) || 0));
    const activeQuantity = quantity - cancelledQuantity;
    const linePaise = toPaise(item.lineTotal);
    const activeLineTotal = activeQuantity > 0
      ? fromPaise(Math.round((linePaise * activeQuantity) / quantity))
      : 0;
    return { item, activeQuantity, activeLineTotal, cancelledQuantity };
  });

  const billedLines = lineViews.filter((line) => line.activeQuantity > 0);
  const activeSubtotal = fromPaise(
    Math.round(billedLines.reduce((sum, line) => sum + toPaise(line.activeLineTotal), 0))
  );

  const issuedNotes = (creditNotes || []).filter((note) => note && note.status !== 'VOID');
  const refundedPaise = issuedNotes.reduce((sum, note) => sum + toPaise(note.totalRefundAmount), 0);
  const invoiceTotalPaise = toPaise(invoice.total);

  return {
    lineViews,
    billedLines,
    activeSubtotal,
    fullyCancelled: billedLines.length === 0,
    creditNotes: issuedNotes,
    refundedAmount: fromPaise(refundedPaise),
    // Never report a negative payable amount if refunds slightly exceed the
    // invoiced total through rounding.
    netTotal: fromPaise(Math.max(0, invoiceTotalPaise - refundedPaise)),
  };
}

export function generateInvoicePDFStream(
  invoice: IInvoice,
  creditNotes: ICreditNote[] = []
): InstanceType<typeof PDFDocument> {
  // A4 dimensions: 595.28 x 841.89 points.
  // Set bottom margin to 25 so footer comfortably stays on single page for normal orders.
  const doc = new PDFDocument({
    margins: { top: 32, bottom: 25, left: 36, right: 36 },
    size: 'A4',
    info: {
      Title: `Tax Invoice - ${invoice.invoiceNumber}`,
      Author: 'Samrat Fashion (THREADVIBE)',
      Subject: `Order Invoice #${invoice.orderNumber}`,
      Creator: 'Samrat Fashion E-Commerce Platform',
    },
  });

  // Register Unicode fonts supporting U+20B9 (₹)
  registerInvoiceFonts(doc);
  doc.font('Inter');

  const pageWidth = 595.28;
  const leftX = 36;
  const rightX = 559;
  const contentWidth = rightX - leftX; // 523 points

  const adjustments = getInvoiceAdjustments(invoice, creditNotes);
  const { billedLines, fullyCancelled, refundedAmount, netTotal } = adjustments;
  const creditNoteNumbers = adjustments.creditNotes.map((note) => note.creditNoteNumber);

  // Helper for drawing top brand accent bar
  const drawTopBar = () => {
    doc.rect(0, 0, pageWidth, 6).fill('#004AC6');
  };

  // Helper for drawing legal footer
  const drawFooter = () => {
    const footerY = 765;
    doc
      .moveTo(leftX, footerY)
      .lineTo(rightX, footerY)
      .strokeColor('#E2E8F0')
      .lineWidth(0.8)
      .stroke();

    doc
      .fillColor('#0F172A')
      .fontSize(8.5)
      .font('Inter-Bold')
      .text('Thank you for choosing Samrat Fashion & THREADVIBE!', leftX, footerY + 8, { width: contentWidth, align: 'center' });

    doc
      .fillColor('#64748B')
      .fontSize(7.5)
      .font('Inter')
      .text(
        'This is an authorized computer-generated commercial tax invoice. For returns, exchanges, or support, contact support@samratfashion.in or visit your account dashboard at www.samratfashion.in.',
        leftX,
        footerY + 20,
        { width: contentWidth, align: 'center', lineGap: 1.5 }
      );
  };

  // 1. Top Decorative Brand Accent Bar
  drawTopBar();

  // 2. Header Section
  const headerTopY = 28;

  // Left Column: Brand Identity
  doc
    .fillColor('#004AC6')
    .fontSize(22)
    .font('Inter-Bold')
    .text('SAMRAT FASHION', leftX, headerTopY);

  doc
    .fillColor('#475569')
    .fontSize(8.5)
    .font('Inter-SemiBold')
    .text('THREADVIBE // PREMIUM APPAREL & CUSTOM STUDIO', leftX, headerTopY + 27);

  doc
    .fillColor('#64748B')
    .fontSize(8)
    .font('Inter')
    .text('Support: support@samratfashion.in  ·  Web: www.samratfashion.in', leftX, headerTopY + 40)
    .text('Fulfillment Hub: New Delhi / Mumbai, India  ·  Retail Composition Scheme', leftX, headerTopY + 52);

  // Right Column: Invoice Details Meta Box
  const metaBoxWidth = 205;
  const metaBoxX = rightX - metaBoxWidth;
  const metaBoxY = headerTopY;

  // Header Title
  doc
    .fillColor('#0F172A')
    .fontSize(16)
    .font('Inter-Bold')
    .text('TAX INVOICE', metaBoxX, metaBoxY, { width: metaBoxWidth, align: 'right' });

  // Metadata Card Background
  const metaCardY = metaBoxY + 22;
  const metaCardHeight = 60;
  doc
    .roundedRect(metaBoxX, metaCardY, metaBoxWidth, metaCardHeight, 6)
    .fillAndStroke('#F8FAFC', '#E2E8F0');

  const metaTextX = metaBoxX + 10;
  const metaTextWidth = metaBoxWidth - 20;

  // Invoice Number
  doc
    .fillColor('#475569')
    .fontSize(8)
    .font('Inter')
    .text('Invoice No:', metaTextX, metaCardY + 8)
    .font('Inter-Bold')
    .fillColor('#0F172A')
    .text(invoice.invoiceNumber, metaTextX + 60, metaCardY + 8, { width: metaTextWidth - 60, align: 'right' });

  // Invoice Date
  const formattedDate = new Date(invoice.issuedAt).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  doc
    .fillColor('#475569')
    .fontSize(8)
    .font('Inter')
    .text('Invoice Date:', metaTextX, metaCardY + 21)
    .font('Inter-Bold')
    .fillColor('#0F172A')
    .text(formattedDate, metaTextX + 60, metaCardY + 21, { width: metaTextWidth - 60, align: 'right' });

  // Order Reference
  doc
    .fillColor('#475569')
    .fontSize(8)
    .font('Inter')
    .text('Order ID:', metaTextX, metaCardY + 34)
    .font('Inter-Bold')
    .fillColor('#004AC6')
    .text(`#${invoice.orderNumber}`, metaTextX + 60, metaCardY + 34, { width: metaTextWidth - 60, align: 'right' });

  // Status Badge
  const statusLabel = invoice.status === 'ISSUED'
    ? (refundedAmount > 0 ? 'PARTIALLY REFUNDED' : 'PAID (ISSUED)')
    : invoice.status === 'REFUNDED'
    ? (fullyCancelled ? 'CANCELLED & REFUNDED' : 'REFUNDED')
    : invoice.status;
  const statusColor = invoice.status === 'ISSUED' && refundedAmount === 0
    ? '#059669'
    : invoice.status === 'ISSUED'
    ? '#D97706'
    : '#DC2626';

  doc
    .fillColor('#475569')
    .fontSize(8)
    .font('Inter')
    .text('Payment Status:', metaTextX, metaCardY + 47)
    .font('Inter-Bold')
    .fillColor(statusColor)
    .text(statusLabel, metaTextX + 60, metaCardY + 47, { width: metaTextWidth - 60, align: 'right' });

  // Header Divider Rule
  const dividerY = 120;
  doc
    .moveTo(leftX, dividerY)
    .lineTo(rightX, dividerY)
    .strokeColor('#E2E8F0')
    .lineWidth(0.8)
    .stroke();

  // 3. Billing & Shipping Address Section (Side-by-Side Uniform Cards)
  const addressCardY = 130;
  const addressCardWidth = (contentWidth - 14) / 2; // 254.5 points each
  const rightCardX = leftX + addressCardWidth + 14;

  const ship = invoice.shippingAddressSnapshot;
  const cust = invoice.customerSnapshot;

  // Build Shipping Address lines
  const addressParts: string[] = [ship.addressLine1];
  if (ship.addressLine2 && ship.addressLine2.trim()) {
    addressParts.push(ship.addressLine2.trim());
  }
  if (ship.landmark && ship.landmark.trim()) {
    addressParts.push(`Landmark: ${ship.landmark.trim()}`);
  }
  addressParts.push(`${ship.city}, ${ship.state} - ${ship.postalCode}`);
  addressParts.push(ship.country || 'India');
  const fullShippingAddress = addressParts.join(', ');

  // Compute text height to size both cards uniformly
  doc.fontSize(8.5).font('Inter');
  const shippingAddressTextHeight = doc.heightOfString(fullShippingAddress, { width: addressCardWidth - 24 });
  const addressCardHeight = Math.max(96, 44 + shippingAddressTextHeight + 22);

  // Left Card: Billed To / Customer
  doc
    .roundedRect(leftX, addressCardY, addressCardWidth, addressCardHeight, 6)
    .fillAndStroke('#F8FAFC', '#E2E8F0');

  doc
    .fillColor('#004AC6')
    .fontSize(8.5)
    .font('Inter-Bold')
    .text('BILLED TO / CUSTOMER', leftX + 12, addressCardY + 10);

  doc
    .fillColor('#0F172A')
    .fontSize(10)
    .font('Inter-Bold')
    .text(cust.name || ship.fullName, leftX + 12, addressCardY + 24, { width: addressCardWidth - 24 });

  doc
    .fillColor('#475569')
    .fontSize(8.5)
    .font('Inter')
    .text(`Email: ${cust.email}`, leftX + 12, addressCardY + 40, { width: addressCardWidth - 24 })
    .text(`Phone: ${cust.phone || ship.phone || 'N/A'}`, leftX + 12, addressCardY + 54, { width: addressCardWidth - 24 });

  // Right Card: Shipping Address
  doc
    .roundedRect(rightCardX, addressCardY, addressCardWidth, addressCardHeight, 6)
    .fillAndStroke('#F8FAFC', '#E2E8F0');

  doc
    .fillColor('#004AC6')
    .fontSize(8.5)
    .font('Inter-Bold')
    .text('SHIPPING ADDRESS (DELIVERY)', rightCardX + 12, addressCardY + 10);

  doc
    .fillColor('#0F172A')
    .fontSize(10)
    .font('Inter-Bold')
    .text(ship.fullName, rightCardX + 12, addressCardY + 24, { width: addressCardWidth - 24 });

  doc
    .fillColor('#334155')
    .fontSize(8.5)
    .font('Inter')
    .text(fullShippingAddress, rightCardX + 12, addressCardY + 40, {
      width: addressCardWidth - 24,
      lineGap: 1.5,
    });

  // Mobile number at the bottom of Shipping card
  const phoneY = addressCardY + 40 + shippingAddressTextHeight + 4;
  doc
    .font('Inter-Bold')
    .fillColor('#0F172A')
    .fontSize(8.5)
    .text(`Mobile: ${ship.phone}`, rightCardX + 12, phoneY, { width: addressCardWidth - 24 });

  // 4. Products Table Section (Dynamically Positioned)
  const tableStartY = addressCardY + addressCardHeight + 14;

  // Table Columns Definition (Total contentWidth: 523, leftX: 36, rightX: 559)
  const colX = {
    num: leftX + 8, // X: 44, width 18 (align: center)
    desc: leftX + 30, // X: 66, width 205 (align: left)
    variant: leftX + 240, // X: 276, width 96 (align: left)
    price: leftX + 342, // X: 378, width 62 (align: right)
    qty: leftX + 410, // X: 446, width 30 (align: center)
    total: leftX + 446, // X: 482, width 69 (align: right)
  };

  const tableHeaderHeight = 24;

  const drawTableHeader = (y: number) => {
    doc
      .roundedRect(leftX, y, contentWidth, tableHeaderHeight, 4)
      .fill('#0A192F');

    doc
      .fillColor('#FFFFFF')
      .fontSize(8.5)
      .font('Inter-Bold')
      .text('#', colX.num, y + 7, { width: 18, align: 'center' })
      .text('Item Description & Details', colX.desc, y + 7, { width: 205 })
      .text('Variant (Color/Size)', colX.variant, y + 7, { width: 96 })
      .text('Price', colX.price, y + 7, { width: 62, align: 'right' })
      .text('Qty', colX.qty, y + 7, { width: 30, align: 'center' })
      .text('Line Total', colX.total, y + 7, { width: 69, align: 'right' });
  };

  // Table Header
  drawTableHeader(tableStartY);

  // Table Rows — only the units that were not cancelled are billed.
  let currentY = tableStartY + tableHeaderHeight + 3;

  if (billedLines.length === 0) {
    const emptyRowHeight = 30;
    doc
      .rect(leftX, currentY - 1, contentWidth, emptyRowHeight)
      .fill('#FEF2F2');

    doc
      .fillColor('#B91C1C')
      .fontSize(9)
      .font('Inter-Bold')
      .text('All items on this order were cancelled and refunded.', colX.desc, currentY + 10, { width: 380 })
      .text(formatCurrency(0), colX.total, currentY + 10, { width: 69, align: 'right' });

    doc
      .moveTo(leftX, currentY + emptyRowHeight - 1)
      .lineTo(rightX, currentY + emptyRowHeight - 1)
      .strokeColor('#FECACA')
      .lineWidth(0.5)
      .stroke();

    currentY += emptyRowHeight;
  }

  billedLines.forEach((line, index) => {
    const { item, activeQuantity, activeLineTotal, cancelledQuantity } = line;
    const title = item.productName;
    let customText = '';
    if (item.customizationSnapshot?.name) {
      customText = `Customization: ${item.customizationSnapshot.name}`;
      if (item.customizationSnapshot.printLocations && item.customizationSnapshot.printLocations.length > 0) {
        customText += ` (${item.customizationSnapshot.printLocations.join(', ')})`;
      }
    }
    const cancelledText = cancelledQuantity > 0
      ? `Cancelled & refunded: ${cancelledQuantity} of ${item.quantity} unit(s)`
      : '';
    const skuText = item.sku ? `SKU: ${item.sku}` : '';

    const variantText = `${item.selectedColor || '-'}  /  ${item.selectedSize || '-'}`;

    doc.font('Inter-Bold').fontSize(9);
    const titleHeight = doc.heightOfString(title, { width: 205 });
    doc.font('Inter').fontSize(8.5);
    const variantHeight = doc.heightOfString(variantText, { width: 96 });
    const detailsHeight =
      titleHeight +
      (skuText ? 10 : 0) +
      (customText ? 13 : 0) +
      (cancelledText ? 11 : 0);
    const contentTextHeight = Math.max(detailsHeight, variantHeight);
    const rowHeight = Math.max(26, contentTextHeight + 8);

    // Overflow check for table rows
    if (currentY + rowHeight > 680) {
      doc.addPage();
      drawTopBar();
      currentY = 36;
      drawTableHeader(currentY);
      currentY += tableHeaderHeight + 3;
    }

    // Alternating Row Background
    if (index % 2 === 1) {
      doc
        .rect(leftX, currentY - 1, contentWidth, rowHeight)
        .fill('#F8FAFC');
    }

    // Row Number
    doc
      .fillColor('#64748B')
      .fontSize(8.5)
      .font('Inter')
      .text(String(index + 1), colX.num, currentY + 3, { width: 18, align: 'center' });

    // Item Title
    doc
      .fillColor('#0F172A')
      .fontSize(9)
      .font('Inter-Bold')
      .text(title, colX.desc, currentY + 3, { width: 205 });

    let detailY = currentY + titleHeight + 3;

    if (skuText) {
      doc
        .fillColor('#64748B')
        .fontSize(7.5)
        .font('Inter')
        .text(skuText, colX.desc, detailY, { width: 205 });
      detailY += 10;
    }

    if (customText) {
      doc
        .fillColor('#004AC6')
        .fontSize(7.5)
        .font('Inter')
        .text(customText, colX.desc, detailY, { width: 205 });
      detailY += 11;
    }

    if (cancelledText) {
      doc
        .fillColor('#DC2626')
        .fontSize(7.5)
        .font('Inter-SemiBold')
        .text(cancelledText, colX.desc, detailY, { width: 205 });
    }

    // Variant (Color & Size)
    doc
      .fillColor('#334155')
      .fontSize(8.5)
      .font('Inter')
      .text(variantText, colX.variant, currentY + 3, { width: 96 });

    // Unit Price (Formatted with formatCurrency, strictly right-aligned)
    doc
      .fillColor('#334155')
      .fontSize(8.5)
      .font('Inter-SemiBold')
      .text(formatCurrency(item.unitPrice), colX.price, currentY + 3, { width: 62, align: 'right' });

    // Quantity (active units only)
    doc
      .fillColor('#0F172A')
      .fontSize(8.5)
      .font('Inter-Bold')
      .text(String(activeQuantity), colX.qty, currentY + 3, { width: 30, align: 'center' });

    // Line Total (active units only)
    doc
      .fillColor('#0F172A')
      .fontSize(8.5)
      .font('Inter-Bold')
      .text(formatCurrency(activeLineTotal), colX.total, currentY + 3, { width: 69, align: 'right' });

    // Bottom Border for Row
    doc
      .moveTo(leftX, currentY + rowHeight - 1)
      .lineTo(rightX, currentY + rowHeight - 1)
      .strokeColor('#E2E8F0')
      .lineWidth(0.5)
      .stroke();

    currentY += rowHeight;
  });

  // 5. Financial Summary & Payment Breakdown (Side-by-Side Cards)
  const summaryTopMargin = 14;
  let summaryTopY = currentY + summaryTopMargin;

  const hasDiscount = invoice.discount > 0;

  interface SummaryRow {
    label: string;
    value: string;
    valueColor: string;
  }

  const summaryRows: SummaryRow[] = [];
  if (!fullyCancelled) {
    summaryRows.push({
      label: 'Order Subtotal:',
      value: formatCurrency(invoice.subtotal),
      valueColor: '#0F172A',
    });
    if (hasDiscount) {
      summaryRows.push({
        label: 'Coupon Discount:',
        value: `- ${formatCurrency(invoice.discount)}`,
        valueColor: '#DC2626',
      });
    }
    summaryRows.push({
      label: 'Delivery / Shipping:',
      value: invoice.shipping === 0 ? 'FREE' : formatCurrency(invoice.shipping),
      valueColor: invoice.shipping === 0 ? '#059669' : '#0F172A',
    });
    summaryRows.push({
      label: invoice.tax > 0 ? `GST / Tax (${invoice.currency || 'INR'}):` : 'Taxes / GST:',
      value: invoice.tax > 0 ? formatCurrency(invoice.tax) : '₹0.00 (Included)',
      valueColor: '#0F172A',
    });
  }

  const showIssuedTotal = refundedAmount > 0 || fullyCancelled;
  if (showIssuedTotal) {
    summaryRows.push({
      label: 'Invoiced Total (as issued):',
      value: formatCurrency(invoice.total),
      valueColor: '#0F172A',
    });
  }
  if (refundedAmount > 0) {
    summaryRows.push({
      label: 'Cancelled & refunded:',
      value: `- ${formatCurrency(refundedAmount)}`,
      valueColor: '#DC2626',
    });
  }

  const showCreditNoteRow = creditNoteNumbers.length > 0;
  const summaryCardHeight = Math.max(
    122,
    30 + summaryRows.length * 16 + (showCreditNoteRow ? 14 : 0) + 44
  );

  // Multi-page protection: Ensure summary card fits before footer
  if (summaryTopY + summaryCardHeight > 755) {
    doc.addPage();
    drawTopBar();
    summaryTopY = 36;
  }

  const summaryColWidth = (contentWidth - 14) / 2; // 254.5 points each
  const summaryRightX = leftX + summaryColWidth + 14;

  // Left Card: Payment Information Card
  doc
    .roundedRect(leftX, summaryTopY, summaryColWidth, summaryCardHeight, 6)
    .fillAndStroke('#F8FAFC', '#E2E8F0');

  doc
    .fillColor('#004AC6')
    .fontSize(8.5)
    .font('Inter-Bold')
    .text('PAYMENT & TRANSACTION DETAILS', leftX + 12, summaryTopY + 11);

  doc
    .moveTo(leftX + 12, summaryTopY + 24)
    .lineTo(leftX + summaryColWidth - 12, summaryTopY + 24)
    .strokeColor('#E2E8F0')
    .lineWidth(0.5)
    .stroke();

  const payInfo = invoice.paymentSnapshot || { provider: 'ONLINE', status: 'PAID', currency: 'INR' };
  const providerLabel =
    payInfo.provider === 'RAZORPAY'
      ? 'Razorpay Secure Checkout (UPI / Cards)'
      : payInfo.provider === 'COD'
      ? 'Cash On Delivery (COD)'
      : payInfo.provider || 'Online Payment';

  doc
    .fillColor('#64748B')
    .fontSize(8)
    .font('Inter')
    .text('Payment Gateway:', leftX + 12, summaryTopY + 30)
    .font('Inter-Bold')
    .fillColor('#0F172A')
    .text(providerLabel, leftX + 12, summaryTopY + 41, { width: summaryColWidth - 24 });

  doc
    .fillColor('#64748B')
    .fontSize(8)
    .font('Inter')
    .text('Payment Status:', leftX + 12, summaryTopY + 56)
    .font('Inter-Bold')
    .fillColor(payInfo.status === 'PAID' ? '#059669' : '#D97706')
    .text(payInfo.status || 'PAID', leftX + 85, summaryTopY + 56);

  doc
    .fillColor('#64748B')
    .fontSize(8)
    .font('Inter')
    .text('Currency:', leftX + 12, summaryTopY + 70)
    .font('Inter-Bold')
    .fillColor('#0F172A')
    .text(`${invoice.currency || 'INR'} (Indian Rupee)`, leftX + 85, summaryTopY + 70);

  doc
    .fillColor('#64748B')
    .fontSize(7.5)
    .font('Inter-Italic')
    .text('✓ This transaction is authorized and recorded in our digital ledger.', leftX + 12, summaryTopY + 90, {
      width: summaryColWidth - 24,
      lineGap: 1.2,
    });

  // Right Card: Financial Breakdown Card
  doc
    .roundedRect(summaryRightX, summaryTopY, summaryColWidth, summaryCardHeight, 6)
    .fillAndStroke('#F8FAFC', '#E2E8F0');

  doc
    .fillColor('#004AC6')
    .fontSize(8.5)
    .font('Inter-Bold')
    .text('FINANCIAL BREAKDOWN', summaryRightX + 12, summaryTopY + 11);

  doc
    .moveTo(summaryRightX + 12, summaryTopY + 24)
    .lineTo(summaryRightX + summaryColWidth - 12, summaryTopY + 24)
    .strokeColor('#E2E8F0')
    .lineWidth(0.5)
    .stroke();

  let rightRowY = summaryTopY + 30;
  const labelX = summaryRightX + 12;
  const valueX = summaryRightX + 110;
  const valueWidth = summaryColWidth - 122;

  summaryRows.forEach((row) => {
    doc
      .font('Inter')
      .fontSize(8.5)
      .fillColor('#475569')
      .text(row.label, labelX, rightRowY)
      .font('Inter-SemiBold')
      .fillColor(row.valueColor)
      .text(row.value, valueX, rightRowY, { width: valueWidth, align: 'right' });
    rightRowY += 16;
  });

  if (showCreditNoteRow) {
    const creditNoteLabel = creditNoteNumbers.length > 3
      ? `${creditNoteNumbers.slice(0, 3).join(', ')} +${creditNoteNumbers.length - 3} more`
      : creditNoteNumbers.join(', ');
    doc
      .font('Inter')
      .fontSize(7)
      .fillColor('#64748B')
      .text(`Credit Note(s): ${creditNoteLabel}`, labelX, rightRowY, {
        width: summaryColWidth - 24,
      });
  }

  // Prominent Cobalt Blue Total Highlight Block. Refunded/cancelled invoices
  // switch to a red block so the net retained amount is unmistakable.
  const fullyRefunded = fullyCancelled || (refundedAmount > 0 && netTotal === 0);
  const totalBoxY = summaryTopY + summaryCardHeight - 38;
  const totalBoxHeight = 32;
  doc
    .roundedRect(summaryRightX + 6, totalBoxY, summaryColWidth - 12, totalBoxHeight, 5)
    .fill(fullyRefunded ? '#B91C1C' : '#004AC6');

  const totalLabel = fullyCancelled
    ? 'NET AMOUNT RETAINED:'
    : refundedAmount > 0
    ? 'NET AMOUNT PAID:'
    : 'TOTAL AMOUNT PAID:';

  doc
    .fillColor('#FFFFFF')
    .fontSize(9)
    .font('Inter-Bold')
    .text(totalLabel, summaryRightX + 14, totalBoxY + 10);

  doc
    .fillColor('#FFFFFF')
    .fontSize(13)
    .font('Inter-Bold')
    .text(formatCurrency(netTotal), summaryRightX + 110, totalBoxY + 8, { width: summaryColWidth - 122, align: 'right' });

  // 6. Professional Footer & Legal Notes
  drawFooter();

  doc.end();
  return doc;
}
