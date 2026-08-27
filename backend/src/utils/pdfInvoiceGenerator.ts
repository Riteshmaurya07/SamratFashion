import PDFDocument from 'pdfkit';
import { IInvoice } from '../models/Invoice';

export function generateInvoicePDFStream(invoice: IInvoice): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  // Brand Header
  doc
    .fillColor('#004AC6')
    .fontSize(22)
    .font('Helvetica-Bold')
    .text('SAMRAT FASHION', 40, 40);

  doc
    .fillColor('#737686')
    .fontSize(9)
    .font('Helvetica')
    .text('Premium Apparel & Custom Printing Studio', 40, 66)
    .text('Support: support@samratfashion.in | www.samratfashion.in', 40, 78);

  // Invoice Title Right Aligned
  doc
    .fillColor('#191C1D')
    .fontSize(16)
    .font('Helvetica-Bold')
    .text('TAX INVOICE', 400, 40, { align: 'right' });

  doc
    .fillColor('#434655')
    .fontSize(9)
    .font('Helvetica')
    .text(`Invoice No: ${invoice.invoiceNumber}`, 400, 60, { align: 'right' })
    .text(`Invoice Date: ${new Date(invoice.issuedAt).toLocaleDateString('en-IN')}`, 400, 72, { align: 'right' })
    .text(`Order No: ${invoice.orderNumber}`, 400, 84, { align: 'right' })
    .text(`Status: ${invoice.status}`, 400, 96, { align: 'right' });

  // Divider Line
  doc
    .moveTo(40, 115)
    .lineTo(555, 115)
    .strokeColor('#E1E3E4')
    .lineWidth(1)
    .stroke();

  // Address Section
  const addressY = 125;

  // Billed To
  doc
    .fillColor('#004AC6')
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('BILLED TO / CUSTOMER', 40, addressY);

  doc
    .fillColor('#191C1D')
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(invoice.customerSnapshot.name, 40, addressY + 15)
    .font('Helvetica')
    .fillColor('#434655')
    .text(`Email: ${invoice.customerSnapshot.email}`, 40, addressY + 28)
    .text(`Phone: ${invoice.customerSnapshot.phone || invoice.shippingAddressSnapshot.phone}`, 40, addressY + 40);

  // Shipped To
  doc
    .fillColor('#004AC6')
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('SHIPPING ADDRESS', 300, addressY);

  const ship = invoice.shippingAddressSnapshot;
  const addressStr = `${ship.addressLine1}${ship.addressLine2 ? ', ' + ship.addressLine2 : ''}, ${ship.city}, ${ship.state} - ${ship.postalCode}, ${ship.country}`;

  doc
    .fillColor('#191C1D')
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(ship.fullName, 300, addressY + 15)
    .font('Helvetica')
    .fillColor('#434655')
    .text(addressStr, 300, addressY + 28, { width: 250 });

  // Table Header Line
  const tableHeaderY = 205;
  doc
    .rect(40, tableHeaderY, 515, 22)
    .fill('#F3F4F5');

  doc
    .fillColor('#191C1D')
    .fontSize(9)
    .font('Helvetica-Bold')
    .text('Item Description', 50, tableHeaderY + 6)
    .text('Variant', 250, tableHeaderY + 6)
    .text('Price (INR)', 350, tableHeaderY + 6, { width: 60, align: 'right' })
    .text('Qty', 430, tableHeaderY + 6, { width: 30, align: 'center' })
    .text('Total (INR)', 470, tableHeaderY + 6, { width: 75, align: 'right' });

  // Items List
  let currentY = tableHeaderY + 28;

  invoice.itemsSnapshot.forEach((item) => {
    let itemTitle = item.productName;
    if (item.customizationSnapshot?.name) {
      itemTitle += ` (Custom: ${item.customizationSnapshot.name})`;
    }

    doc
      .fillColor('#191C1D')
      .fontSize(9)
      .font('Helvetica')
      .text(itemTitle, 50, currentY, { width: 190 })
      .text(`${item.selectedColor} / ${item.selectedSize}`, 250, currentY, { width: 90 })
      .text(`₹${item.unitPrice.toLocaleString('en-IN')}`, 350, currentY, { width: 60, align: 'right' })
      .text(`${item.quantity}`, 430, currentY, { width: 30, align: 'center' })
      .font('Helvetica-Bold')
      .text(`₹${item.lineTotal.toLocaleString('en-IN')}`, 470, currentY, { width: 75, align: 'right' });

    currentY += 24;
  });

  // Table Divider Line
  doc
    .moveTo(40, currentY + 5)
    .lineTo(555, currentY + 5)
    .strokeColor('#E1E3E4')
    .lineWidth(1)
    .stroke();

  // Summary Section (Right Side)
  let summaryY = currentY + 15;

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#434655')
    .text('Subtotal:', 340, summaryY)
    .font('Helvetica-Bold')
    .fillColor('#191C1D')
    .text(`₹${invoice.subtotal.toLocaleString('en-IN')}`, 470, summaryY, { width: 75, align: 'right' });

  if (invoice.discount > 0) {
    summaryY += 16;
    doc
      .font('Helvetica')
      .fillColor('#434655')
      .text('Coupon Discount:', 340, summaryY)
      .font('Helvetica-Bold')
      .fillColor('#BA1A1A')
      .text(`- ₹${invoice.discount.toLocaleString('en-IN')}`, 470, summaryY, { width: 75, align: 'right' });
  }

  summaryY += 16;
  doc
    .font('Helvetica')
    .fillColor('#434655')
    .text('Shipping Charges:', 340, summaryY)
    .font('Helvetica-Bold')
    .fillColor('#191C1D')
    .text(invoice.shipping === 0 ? 'FREE' : `₹${invoice.shipping.toLocaleString('en-IN')}`, 470, summaryY, { width: 75, align: 'right' });

  summaryY += 16;
  doc
    .font('Helvetica')
    .fillColor('#434655')
    .text('Estimated Tax:', 340, summaryY)
    .font('Helvetica-Bold')
    .fillColor('#191C1D')
    .text(`₹${invoice.tax.toLocaleString('en-IN')}`, 470, summaryY, { width: 75, align: 'right' });

  summaryY += 20;
  doc
    .rect(330, summaryY - 4, 225, 26)
    .fill('#004AC6');

  doc
    .fillColor('#FFFFFF')
    .fontSize(11)
    .font('Helvetica-Bold')
    .text('TOTAL AMOUNT PAID:', 340, summaryY + 3)
    .text(`₹${invoice.total.toLocaleString('en-IN')}`, 470, summaryY + 3, { width: 75, align: 'right' });

  // Payment Status Box (Left Side)
  doc
    .fillColor('#004AC6')
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('PAYMENT INFORMATION', 40, currentY + 15);

  doc
    .fillColor('#434655')
    .fontSize(9)
    .font('Helvetica')
    .text(`Payment Gateway: ${invoice.paymentSnapshot.provider}`, 40, currentY + 30)
    .text(`Payment Status: ${invoice.paymentSnapshot.status}`, 40, currentY + 44)
    .text(`Currency: ${invoice.currency}`, 40, currentY + 58);

  // Footer Note
  doc
    .fontSize(8)
    .fillColor('#737686')
    .font('Helvetica')
    .text('Thank you for shopping with Samrat Fashion! This is a computer-generated tax invoice.', 40, 770, { align: 'center' });

  doc.end();
  return doc;
}
