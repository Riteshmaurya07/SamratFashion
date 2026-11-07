import PDFDocument from 'pdfkit';

export interface OrdersReportRow {
  orderNumber: string;
  createdAt: Date | string;
  customerName: string;
  customerEmail: string;
  itemCount: number;
  total: number;
  paymentStatus: string;
  status: string;
}

export interface OrdersReportMeta {
  rangeLabel: string;
  generatedAt?: Date;
  statusFilter?: string;
  paymentFilter?: string;
  search?: string;
  truncated?: boolean;
}

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN_X = 36;
const RIGHT_X = PAGE_WIDTH - MARGIN_X;
const CONTENT_WIDTH = RIGHT_X - MARGIN_X;
const FOOTER_Y = PAGE_HEIGHT - 28;

const COLUMN_DEFS = [
  { key: 'index', label: '#', width: 24, align: 'left' as const },
  { key: 'orderNumber', label: 'ORDER #', width: 108, align: 'left' as const },
  { key: 'date', label: 'DATE', width: 92, align: 'left' as const },
  { key: 'customer', label: 'CUSTOMER', width: 142, align: 'left' as const },
  { key: 'email', label: 'EMAIL', width: 144, align: 'left' as const },
  { key: 'qty', label: 'QTY', width: 40, align: 'right' as const },
  { key: 'amount', label: 'AMOUNT (Rs.)', width: 72, align: 'right' as const },
  { key: 'payment', label: 'PAYMENT', width: 64, align: 'center' as const },
  { key: 'status', label: 'STATUS', width: 0, align: 'center' as const },
];

const COLUMNS = (() => {
  let cursor = MARGIN_X;
  return COLUMN_DEFS.map((col, index) => {
    const width = index === COLUMN_DEFS.length - 1 ? RIGHT_X - cursor : col.width;
    const positioned = { ...col, x: cursor, width };
    cursor += width;
    return positioned;
  });
})();

const TABLE_HEADER_HEIGHT = 20;
const ROW_HEIGHT = 24;

function formatMoney(value: number): string {
  return (Number(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: Date | string): { date: string; time: string } {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: '-', time: '' };
  }

  return {
    date: parsed.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    time: parsed.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
  };
}

function fitText(doc: InstanceType<typeof PDFDocument>, text: string, maxWidth: number): string {
  const value = String(text ?? '');
  if (!value) return '';
  if (doc.widthOfString(value) <= maxWidth) return value;

  let truncated = value;
  while (truncated.length > 0 && doc.widthOfString(`${truncated}...`) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated.length > 0 ? `${truncated}...` : '';
}

function paymentColor(status: string): string {
  switch ((status || '').toUpperCase()) {
    case 'PAID':
      return '#047857';
    case 'FAILED':
      return '#B91C1C';
    case 'REFUNDED':
      return '#6D28D9';
    default:
      return '#B45309';
  }
}

function orderStatusColor(status: string): string {
  switch ((status || '').toUpperCase()) {
    case 'DELIVERED':
      return '#047857';
    case 'CANCELLED':
    case 'EXPIRED':
      return '#B91C1C';
    case 'SHIPPED':
      return '#1D4ED8';
    case 'PROCESSING':
    case 'CONFIRMED':
      return '#B45309';
    default:
      return '#475569';
  }
}

function buildFilterText(meta: OrdersReportMeta): string {
  const parts: string[] = [];
  if (meta.statusFilter) parts.push(`Status: ${meta.statusFilter}`);
  if (meta.paymentFilter) parts.push(`Payment: ${meta.paymentFilter}`);
  if (meta.search) parts.push(`Search: "${meta.search}"`);
  if (meta.truncated) parts.push('Showing first 5000 orders');
  return parts.join('   ·   ');
}

function drawAccentBar(doc: InstanceType<typeof PDFDocument>): void {
  doc.rect(0, 0, PAGE_WIDTH, 6).fill('#004AC6');
}

function drawSummaryCards(
  doc: InstanceType<typeof PDFDocument>,
  summary: { totalOrders: number; totalUnits: number; totalValue: number; paidValue: number },
  top: number
): void {
  const gap = 10;
  const cardWidth = (CONTENT_WIDTH - gap * 3) / 4;
  const cards = [
    { label: 'TOTAL ORDERS', value: String(summary.totalOrders) },
    { label: 'TOTAL UNITS', value: String(summary.totalUnits) },
    { label: 'ORDER VALUE', value: `Rs. ${formatMoney(summary.totalValue)}` },
    { label: 'PAID VALUE', value: `Rs. ${formatMoney(summary.paidValue)}` },
  ];

  cards.forEach((card, index) => {
    const x = MARGIN_X + index * (cardWidth + gap);
    doc.roundedRect(x, top, cardWidth, 48, 6).fillAndStroke('#F8FAFC', '#E2E8F0');
    doc
      .fillColor('#64748B')
      .font('Helvetica-Bold')
      .fontSize(7)
      .text(card.label, x + 10, top + 9, { width: cardWidth - 20, lineBreak: false });
    doc
      .fillColor('#0F172A')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(card.value, x + 10, top + 22, { width: cardWidth - 20, lineBreak: false });
  });
}

function drawFirstHeader(
  doc: InstanceType<typeof PDFDocument>,
  meta: OrdersReportMeta,
  summary: { totalOrders: number; totalUnits: number; totalValue: number; paidValue: number }
): number {
  drawAccentBar(doc);

  doc.fillColor('#004AC6').font('Helvetica-Bold').fontSize(20)
    .text('SAMRAT FASHION', MARGIN_X, 24, { lineBreak: false });
  doc.fillColor('#475569').font('Helvetica-Bold').fontSize(8)
    .text('THREADVIBE // PREMIUM APPAREL & CUSTOM STUDIO', MARGIN_X, 50, { lineBreak: false });
  doc.fillColor('#64748B').font('Helvetica').fontSize(8)
    .text(`Generated ${formatDate(meta.generatedAt || new Date()).date}, ${formatDate(meta.generatedAt || new Date()).time} IST`, MARGIN_X, 64, { lineBreak: false });

  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(17)
    .text('ORDERS REPORT', MARGIN_X, 24, { width: CONTENT_WIDTH, align: 'right', lineBreak: false });
  doc.fillColor('#004AC6').font('Helvetica-Bold').fontSize(10)
    .text(meta.rangeLabel, MARGIN_X, 47, { width: CONTENT_WIDTH, align: 'right', lineBreak: false });

  const filterText = buildFilterText(meta);
  if (filterText) {
    doc.fillColor('#64748B').font('Helvetica').fontSize(8)
      .text(filterText, MARGIN_X, 63, { width: CONTENT_WIDTH, align: 'right', lineBreak: false });
  }

  doc.moveTo(MARGIN_X, 88).lineTo(RIGHT_X, 88).lineWidth(1).strokeColor('#E2E8F0').stroke();

  drawSummaryCards(doc, summary, 100);
  return 160;
}

function drawContinuationHeader(doc: InstanceType<typeof PDFDocument>): number {
  drawAccentBar(doc);
  doc.fillColor('#004AC6').font('Helvetica-Bold').fontSize(12)
    .text('SAMRAT FASHION', MARGIN_X, 18, { lineBreak: false });
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10)
    .text('ORDERS REPORT (continued)', MARGIN_X, 20, { width: CONTENT_WIDTH, align: 'right', lineBreak: false });
  doc.moveTo(MARGIN_X, 38).lineTo(RIGHT_X, 38).lineWidth(1).strokeColor('#E2E8F0').stroke();
  return 46;
}

function drawTableHeader(doc: InstanceType<typeof PDFDocument>, y: number): number {
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, TABLE_HEADER_HEIGHT).fill('#0F172A');
  COLUMNS.forEach(col => {
    doc
      .fillColor('#F8FAFC')
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text(col.label, col.x + 4, y + 6, { width: col.width - 8, align: col.align, lineBreak: false });
  });
  return y + TABLE_HEADER_HEIGHT;
}

function drawCellText(
  doc: InstanceType<typeof PDFDocument>,
  column: typeof COLUMNS[number],
  text: string,
  y: number,
  options: { font?: string; size?: number; color?: string; top?: number } = {}
): void {
  doc
    .font(options.font || 'Helvetica')
    .fontSize(options.size || 7.5)
    .fillColor(options.color || '#334155')
    .text(
      fitText(doc, text, column.width - 8),
      column.x + 4,
      y + (options.top ?? 7),
      { width: column.width - 8, align: column.align, lineBreak: false }
    );
}

function drawRow(
  doc: InstanceType<typeof PDFDocument>,
  row: OrdersReportRow,
  index: number,
  y: number,
  shaded: boolean
): void {
  if (shaded) {
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, ROW_HEIGHT).fill('#F8FAFC');
  }
  doc.moveTo(MARGIN_X, y + ROW_HEIGHT).lineTo(RIGHT_X, y + ROW_HEIGHT)
    .lineWidth(0.5).strokeColor('#E2E8F0').stroke();

  const { date, time } = formatDate(row.createdAt);

  const column = (key: string) => COLUMNS.find(col => col.key === key)!;

  drawCellText(doc, column('index'), String(index + 1).padStart(2, '0'), y, { color: '#94A3B8' });
  drawCellText(doc, column('orderNumber'), row.orderNumber, y, { font: 'Helvetica-Bold', color: '#004AC6' });

  const dateCol = column('date');
  doc.font('Helvetica').fontSize(7.5).fillColor('#334155')
    .text(date, dateCol.x + 4, y + 5, { width: dateCol.width - 8, align: 'left', lineBreak: false });
  if (time) {
    doc.font('Helvetica').fontSize(6.5).fillColor('#94A3B8')
      .text(time, dateCol.x + 4, y + 14, { width: dateCol.width - 8, align: 'left', lineBreak: false });
  }

  drawCellText(doc, column('customer'), row.customerName || '-', y);
  drawCellText(doc, column('email'), row.customerEmail || '-', y, { color: '#64748B' });
  drawCellText(doc, column('qty'), String(row.itemCount), y);
  drawCellText(doc, column('amount'), formatMoney(row.total), y, { font: 'Helvetica-Bold', color: '#0F172A' });
  drawCellText(doc, column('payment'), row.paymentStatus || 'PENDING', y, {
    font: 'Helvetica-Bold',
    color: paymentColor(row.paymentStatus),
  });
  drawCellText(doc, column('status'), row.status || 'UNKNOWN', y, {
    font: 'Helvetica-Bold',
    color: orderStatusColor(row.status),
  });
}

function drawEmptyState(doc: InstanceType<typeof PDFDocument>, y: number): void {
  doc.roundedRect(MARGIN_X, y, CONTENT_WIDTH, 80, 6).fillAndStroke('#F8FAFC', '#E2E8F0');
  doc
    .fillColor('#64748B')
    .font('Helvetica')
    .fontSize(10)
    .text('No orders found for the selected period and filters.', MARGIN_X, y + 34, {
      width: CONTENT_WIDTH,
      align: 'center',
    });
}

function drawFooters(doc: InstanceType<typeof PDFDocument>): void {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    doc.moveTo(MARGIN_X, FOOTER_Y - 6).lineTo(RIGHT_X, FOOTER_Y - 6)
      .lineWidth(0.5).strokeColor('#E2E8F0').stroke();
    doc.fillColor('#94A3B8').font('Helvetica').fontSize(7)
      .text('Samrat Fashion · Confidential — internal operations report', MARGIN_X, FOOTER_Y, {
        width: CONTENT_WIDTH / 2,
        lineBreak: false,
      });
    doc.fillColor('#94A3B8').font('Helvetica').fontSize(7)
      .text(`Page ${index + 1} of ${range.count}`, MARGIN_X, FOOTER_Y, {
        width: CONTENT_WIDTH,
        align: 'right',
        lineBreak: false,
      });
  }
}

export function generateOrdersReportPDFStream(
  rows: OrdersReportRow[],
  meta: OrdersReportMeta
): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferPages: true,
    info: {
      Title: `Orders Report - ${meta.rangeLabel}`,
      Author: 'Samrat Fashion (THREADVIBE)',
      Subject: 'Admin orders export',
      Creator: 'Samrat Fashion E-Commerce Platform',
    },
  });

  const summary = rows.reduce(
    (acc, row) => {
      acc.totalOrders += 1;
      acc.totalUnits += Number(row.itemCount) || 0;
      acc.totalValue += Number(row.total) || 0;
      if ((row.paymentStatus || '').toUpperCase() === 'PAID') {
        acc.paidValue += Number(row.total) || 0;
      }
      return acc;
    },
    { totalOrders: 0, totalUnits: 0, totalValue: 0, paidValue: 0 }
  );

  let y = drawFirstHeader(doc, meta, summary);
  y = drawTableHeader(doc, y);
  y += 4;

  if (rows.length === 0) {
    drawEmptyState(doc, y);
  } else {
    rows.forEach((row, index) => {
      if (y + ROW_HEIGHT > PAGE_HEIGHT - 40) {
        doc.addPage();
        y = drawContinuationHeader(doc);
        y = drawTableHeader(doc, y);
        y += 4;
      }

      drawRow(doc, row, index, y, index % 2 === 1);
      y += ROW_HEIGHT;
    });
  }

  drawFooters(doc);
  doc.end();
  return doc;
}
