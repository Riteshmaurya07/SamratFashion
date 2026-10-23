import PDFDocument from 'pdfkit';
import { IInvoice } from '../models/Invoice';

function formatCurrency(amount: number): string {
  const num = Number(amount) || 0;
  return `₹ ${num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function generateInvoicePDFStream(invoice: IInvoice): InstanceType<typeof PDFDocument> {
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

  const pageWidth = 595.28;
  const leftX = 36;
  const rightX = 559;
  const contentWidth = rightX - leftX; // 523 points

  // 1. Top Decorative Brand Accent Bar
  doc.rect(0, 0, pageWidth, 6).fill('#004AC6');

  // 2. Header Section
  const headerTopY = 28;

  // Left Column: Brand Identity
  doc
    .fillColor('#004AC6')
    .fontSize(22)
    .font('Helvetica-Bold')
    .text('SAMRAT FASHION', leftX, headerTopY);

  doc
    .fillColor('#475569')
    .fontSize(8.5)
    .font('Helvetica-Bold')
    .text('THREADVIBE // PREMIUM APPAREL & CUSTOM STUDIO', leftX, headerTopY + 27);

  doc
    .fillColor('#64748B')
    .fontSize(8)
    .font('Helvetica')
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
    .font('Helvetica-Bold')
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
    .font('Helvetica')
    .text('Invoice No:', metaTextX, metaCardY + 8)
    .font('Helvetica-Bold')
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
    .font('Helvetica')
    .text('Invoice Date:', metaTextX, metaCardY + 21)
    .font('Helvetica-Bold')
    .fillColor('#0F172A')
    .text(formattedDate, metaTextX + 60, metaCardY + 21, { width: metaTextWidth - 60, align: 'right' });

  // Order Reference
  doc
    .fillColor('#475569')
    .fontSize(8)
    .font('Helvetica')
    .text('Order ID:', metaTextX, metaCardY + 34)
    .font('Helvetica-Bold')
    .fillColor('#004AC6')
    .text(`#${invoice.orderNumber}`, metaTextX + 60, metaCardY + 34, { width: metaTextWidth - 60, align: 'right' });

  // Status Badge
  doc
    .fillColor('#475569')
    .fontSize(8)
    .font('Helvetica')
    .text('Payment Status:', metaTextX, metaCardY + 47)
    .font('Helvetica-Bold')
    .fillColor(invoice.status === 'VOID' ? '#DC2626' : '#059669')
    .text(invoice.status === 'ISSUED' ? 'PAID (ISSUED)' : invoice.status, metaTextX + 60, metaCardY + 47, { width: metaTextWidth - 60, align: 'right' });

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
  doc.fontSize(8.5).font('Helvetica');
  const shippingAddressTextHeight = doc.heightOfString(fullShippingAddress, { width: addressCardWidth - 24 });
  const addressCardHeight = Math.max(96, 44 + shippingAddressTextHeight + 22);

  // Left Card: Billed To / Customer
  doc
    .roundedRect(leftX, addressCardY, addressCardWidth, addressCardHeight, 6)
    .fillAndStroke('#F8FAFC', '#E2E8F0');

  doc
    .fillColor('#004AC6')
    .fontSize(8.5)
    .font('Helvetica-Bold')
    .text('BILLED TO / CUSTOMER', leftX + 12, addressCardY + 10);

  doc
    .fillColor('#0F172A')
    .fontSize(10)
    .font('Helvetica-Bold')
    .text(cust.name || ship.fullName, leftX + 12, addressCardY + 24, { width: addressCardWidth - 24 });

  doc
    .fillColor('#475569')
    .fontSize(8.5)
    .font('Helvetica')
    .text(`Email: ${cust.email}`, leftX + 12, addressCardY + 40, { width: addressCardWidth - 24 })
    .text(`Phone: ${cust.phone || ship.phone || 'N/A'}`, leftX + 12, addressCardY + 54, { width: addressCardWidth - 24 });

  // Right Card: Shipping Address
  doc
    .roundedRect(rightCardX, addressCardY, addressCardWidth, addressCardHeight, 6)
    .fillAndStroke('#F8FAFC', '#E2E8F0');

  doc
    .fillColor('#004AC6')
    .fontSize(8.5)
    .font('Helvetica-Bold')
    .text('SHIPPING ADDRESS (DELIVERY)', rightCardX + 12, addressCardY + 10);

  doc
    .fillColor('#0F172A')
    .fontSize(10)
    .font('Helvetica-Bold')
    .text(ship.fullName, rightCardX + 12, addressCardY + 24, { width: addressCardWidth - 24 });

  doc
    .fillColor('#334155')
    .fontSize(8.5)
    .font('Helvetica')
    .text(fullShippingAddress, rightCardX + 12, addressCardY + 40, {
      width: addressCardWidth - 24,
      lineGap: 1.5,
    });

  // Mobile number at the bottom of Shipping card
  const phoneY = addressCardY + 40 + shippingAddressTextHeight + 4;
  doc
    .font('Helvetica-Bold')
    .fillColor('#0F172A')
    .fontSize(8.5)
    .text(`Mobile: ${ship.phone}`, rightCardX + 12, phoneY, { width: addressCardWidth - 24 });

  // 4. Products Table Section (Dynamically Positioned)
  const tableStartY = addressCardY + addressCardHeight + 14;

  // Table Columns Definition (Total width: 523)
  const colX = {
    num: leftX + 6, // X: 42, width 18
    desc: leftX + 28, // X: 64, width 215
    variant: leftX + 246, // X: 282, width 95
    price: leftX + 346, // X: 382, width 58 (align: right)
    qty: leftX + 408, // X: 444, width 32 (align: center)
    total: leftX + 443, // X: 479, width 74 (align: right)
  };

  const tableHeaderHeight = 22;

  // Table Header Background
  doc
    .roundedRect(leftX, tableStartY, contentWidth, tableHeaderHeight, 4)
    .fill('#0A192F');

  // Table Header Labels
  doc
    .fillColor('#FFFFFF')
    .fontSize(8.5)
    .font('Helvetica-Bold')
    .text('#', colX.num, tableStartY + 6, { width: 18, align: 'center' })
    .text('Item Description & Details', colX.desc, tableStartY + 6, { width: 215 })
    .text('Variant (Color/Size)', colX.variant, tableStartY + 6, { width: 95 })
    .text('Price', colX.price, tableStartY + 6, { width: 58, align: 'right' })
    .text('Qty', colX.qty, tableStartY + 6, { width: 32, align: 'center' })
    .text('Line Total', colX.total, tableStartY + 6, { width: 74, align: 'right' });

  // Table Rows
  let currentY = tableStartY + tableHeaderHeight + 3;

  invoice.itemsSnapshot.forEach((item, index) => {
    let title = item.productName;
    let customText = '';
    if (item.customizationSnapshot?.name) {
      customText = `Customization: ${item.customizationSnapshot.name}`;
      if (item.customizationSnapshot.printLocations && item.customizationSnapshot.printLocations.length > 0) {
        customText += ` (${item.customizationSnapshot.printLocations.join(', ')})`;
      }
    }

    doc.font('Helvetica-Bold').fontSize(9);
    const titleHeight = doc.heightOfString(title, { width: 215 });
    const rowHeight = Math.max(26, titleHeight + (customText ? 13 : 0) + 8);

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
      .font('Helvetica')
      .text(String(index + 1), colX.num, currentY + 3, { width: 18, align: 'center' });

    // Item Title
    doc
      .fillColor('#0F172A')
      .fontSize(9)
      .font('Helvetica-Bold')
      .text(title, colX.desc, currentY + 3, { width: 215 });

    if (customText) {
      doc
        .fillColor('#004AC6')
        .fontSize(7.5)
        .font('Helvetica')
        .text(customText, colX.desc, currentY + titleHeight + 3, { width: 215 });
    }

    // Variant (Color & Size)
    const variantText = `${item.selectedColor || '-'}  /  ${item.selectedSize || '-'}`;
    doc
      .fillColor('#334155')
      .fontSize(8.5)
      .font('Helvetica')
      .text(variantText, colX.variant, currentY + 3, { width: 95 });

    // Unit Price (Formatted with formatCurrency)
    doc
      .fillColor('#334155')
      .fontSize(8.5)
      .font('Helvetica')
      .text(formatCurrency(item.unitPrice), colX.price, currentY + 3, { width: 58, align: 'right' });

    // Quantity
    doc
      .fillColor('#0F172A')
      .fontSize(8.5)
      .font('Helvetica-Bold')
      .text(String(item.quantity), colX.qty, currentY + 3, { width: 32, align: 'center' });

    // Line Total (Formatted with formatCurrency)
    doc
      .fillColor('#0F172A')
      .fontSize(8.5)
      .font('Helvetica-Bold')
      .text(formatCurrency(item.lineTotal), colX.total, currentY + 3, { width: 74, align: 'right' });

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
  const summaryTopY = currentY + 14;
  const summaryColWidth = (contentWidth - 14) / 2; // 254.5 points each
  const summaryRightX = leftX + summaryColWidth + 14;

  // Left Card: Payment Information Card
  doc
    .roundedRect(leftX, summaryTopY, summaryColWidth, 110, 6)
    .fillAndStroke('#F8FAFC', '#E2E8F0');

  doc
    .fillColor('#004AC6')
    .fontSize(8.5)
    .font('Helvetica-Bold')
    .text('PAYMENT & TRANSACTION DETAILS', leftX + 12, summaryTopY + 10);

  const payInfo = invoice.paymentSnapshot || { provider: 'ONLINE', status: 'PAID', currency: 'INR' };
  const providerLabel =
    payInfo.provider === 'RAZORPAY'
      ? 'Razorpay Secure Checkout (UPI / Cards)'
      : payInfo.provider === 'COD'
      ? 'Cash On Delivery (COD)'
      : payInfo.provider || 'Online Payment';

  doc
    .fillColor('#475569')
    .fontSize(8)
    .font('Helvetica')
    .text('Payment Gateway:', leftX + 12, summaryTopY + 27)
    .font('Helvetica-Bold')
    .fillColor('#0F172A')
    .text(providerLabel, leftX + 12, summaryTopY + 38, { width: summaryColWidth - 24 });

  doc
    .fillColor('#475569')
    .fontSize(8)
    .font('Helvetica')
    .text('Payment Status:', leftX + 12, summaryTopY + 54)
    .font('Helvetica-Bold')
    .fillColor(payInfo.status === 'PAID' ? '#059669' : '#D97706')
    .text(payInfo.status || 'PAID', leftX + 85, summaryTopY + 54);

  doc
    .fillColor('#475569')
    .fontSize(8)
    .font('Helvetica')
    .text('Currency:', leftX + 12, summaryTopY + 67)
    .font('Helvetica-Bold')
    .fillColor('#0F172A')
    .text(`${invoice.currency || 'INR'} (Indian Rupee - ₹)`, leftX + 85, summaryTopY + 67);

  doc
    .fillColor('#64748B')
    .fontSize(7.5)
    .font('Helvetica-Oblique')
    .text('✓ This transaction is authorized and recorded in our digital ledger.', leftX + 12, summaryTopY + 88, {
      width: summaryColWidth - 24,
    });

  // Right Side: Financial Summary Rows & Total Block
  let rightRowY = summaryTopY + 4;

  // Subtotal
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#475569')
    .text('Order Subtotal:', summaryRightX + 10, rightRowY)
    .font('Helvetica-Bold')
    .fillColor('#0F172A')
    .text(formatCurrency(invoice.subtotal), summaryRightX + 120, rightRowY, { width: summaryColWidth - 130, align: 'right' });

  // Coupon Discount (if any)
  if (invoice.discount > 0) {
    rightRowY += 15;
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#475569')
      .text('Coupon Discount:', summaryRightX + 10, rightRowY)
      .font('Helvetica-Bold')
      .fillColor('#DC2626')
      .text(`- ${formatCurrency(invoice.discount)}`, summaryRightX + 120, rightRowY, { width: summaryColWidth - 130, align: 'right' });
  }

  // Delivery Charges
  rightRowY += 15;
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#475569')
    .text('Delivery / Shipping:', summaryRightX + 10, rightRowY)
    .font('Helvetica-Bold')
    .fillColor(invoice.shipping === 0 ? '#059669' : '#0F172A')
    .text(invoice.shipping === 0 ? 'FREE' : formatCurrency(invoice.shipping), summaryRightX + 120, rightRowY, { width: summaryColWidth - 130, align: 'right' });

  // Taxes / GST
  rightRowY += 15;
  const taxLabel = invoice.tax > 0 ? `GST / Tax (${invoice.currency}):` : 'Taxes / GST:';
  const taxValue = invoice.tax > 0 ? formatCurrency(invoice.tax) : '₹ 0.00 (Included)';
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#475569')
    .text(taxLabel, summaryRightX + 10, rightRowY)
    .font('Helvetica-Bold')
    .fillColor('#0F172A')
    .text(taxValue, summaryRightX + 120, rightRowY, { width: summaryColWidth - 130, align: 'right' });

  // Prominent Cobalt Blue Total Highlight Block
  rightRowY += 18;
  const totalBoxHeight = 34;
  doc
    .roundedRect(summaryRightX, rightRowY, summaryColWidth, totalBoxHeight, 6)
    .fill('#004AC6');

  doc
    .fillColor('#FFFFFF')
    .fontSize(9.5)
    .font('Helvetica-Bold')
    .text('TOTAL AMOUNT PAID:', summaryRightX + 12, rightRowY + 11);

  doc
    .fillColor('#FFFFFF')
    .fontSize(13)
    .font('Helvetica-Bold')
    .text(formatCurrency(invoice.total), summaryRightX + 120, rightRowY + 9, { width: summaryColWidth - 132, align: 'right' });

  // 6. Professional Footer & Legal Notes (Compact & Perfectly Placed)
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
    .font('Helvetica-Bold')
    .text('Thank you for choosing Samrat Fashion & THREADVIBE!', leftX, footerY + 8, { width: contentWidth, align: 'center' });

  doc
    .fillColor('#64748B')
    .fontSize(7.5)
    .font('Helvetica')
    .text(
      'This is an authorized computer-generated commercial tax invoice. For returns, exchanges, or support, contact support@samratfashion.in or visit your account dashboard at www.samratfashion.in.',
      leftX,
      footerY + 20,
      { width: contentWidth, align: 'center', lineGap: 1.5 }
    );

  doc.end();
  return doc;
}
