import PDFDocument from 'pdfkit';
import { IShipment } from '../models/Shipment';
import { IOrder } from '../models/Order';

export function generateShippingLabelPDFStream(shipment: IShipment, order: IOrder): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: [288, 432], margin: 18 }); // 4x6 inch thermal shipping label size

  // Header Box
  doc.rect(18, 18, 252, 40).fill('#004ac6');
  doc.fillColor('#FFFFFF').fontSize(14).font('Helvetica-Bold').text('SAMRAT FASHION EXPRESS', 24, 30);

  // AWB & Barcode representation
  doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold').text(`AWB: ${shipment.awbNumber}`, 24, 68);
  doc.fontSize(8).font('Helvetica').text(`CARRIER: ${shipment.carrier.toUpperCase()}`, 24, 82);
  doc.fontSize(8).text(`ORDER NO: #${order.orderNumber}`, 24, 94);

  // Draw simulated Barcode Box
  doc.rect(24, 108, 240, 36).fill('#E5E7EB');
  doc.fillColor('#1F2937').fontSize(9).font('Helvetica-Bold').text(`||||| ||| ||||||| |||| |||||| |||||`, 34, 120);

  // Line Divider
  doc.moveTo(18, 154).lineTo(270, 154).strokeColor('#CCCCCC').stroke();

  // Ship To Address Box
  doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold').text('SHIP TO:', 24, 164);
  doc.fontSize(10).font('Helvetica-Bold').text(order.shippingAddress.fullName, 24, 178);
  doc.fontSize(9).font('Helvetica').text(order.shippingAddress.addressLine1, 24, 192);
  if (order.shippingAddress.addressLine2) {
    doc.text(order.shippingAddress.addressLine2, 24, 204);
  }
  doc.text(`${order.shippingAddress.city}, ${order.shippingAddress.state} - ${order.shippingAddress.postalCode}`, 24, 218);
  doc.text(`Phone: ${order.shippingAddress.phone}`, 24, 232);

  // Line Divider
  doc.moveTo(18, 252).lineTo(270, 252).strokeColor('#CCCCCC').stroke();

  // Payment Badge (COD or PREPAID)
  const isCod = order.paymentStatus === 'PENDING' && order.total > 0;
  if (isCod) {
    doc.rect(24, 262, 240, 36).fill('#FFF7ED');
    doc.fillColor('#C2410C').fontSize(12).font('Helvetica-Bold').text(`C.O.D. COLLECT: ₹${order.total}`, 34, 274);
  } else {
    doc.rect(24, 262, 240, 36).fill('#ECFDF5');
    doc.fillColor('#047857').fontSize(12).font('Helvetica-Bold').text(`PREPAID - DO NOT COLLECT CASH`, 34, 274);
  }

  // Return Address Footer
  doc.moveTo(18, 310).lineTo(270, 310).strokeColor('#CCCCCC').stroke();
  doc.fillColor('#4B5563').fontSize(8).font('Helvetica-Bold').text('RETURN IF UNDELIVERED TO:', 24, 320);
  doc.fontSize(7).font('Helvetica').text('Samrat Fashion Logistics Center', 24, 332);
  doc.text('Plot 404, Industrial Fashion Park, MIDC, Mumbai, MH - 400001', 24, 342);

  doc.end();
  return doc;
}
