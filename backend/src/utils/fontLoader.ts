import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

export interface InvoiceFontBuffers {
  regular: Buffer;
  semiBold: Buffer;
  bold: Buffer;
  italic: Buffer;
}

let cachedFontBuffers: InvoiceFontBuffers | null = null;
let fontLoadPromise: Promise<InvoiceFontBuffers> | null = null;

export function getFontsDir(): string {
  const candidates = [
    path.resolve(__dirname, '../../assets/fonts'),
    path.resolve(__dirname, '../assets/fonts'),
    path.resolve(__dirname, '../../../assets/fonts'),
    path.resolve(process.cwd(), 'assets/fonts'),
    path.resolve(process.cwd(), 'backend/assets/fonts'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'Inter-Regular.ttf'))) {
      return dir;
    }
  }
  return candidates[0];
}

export function loadInvoiceFontsSync(): InvoiceFontBuffers {
  if (cachedFontBuffers) {
    return cachedFontBuffers;
  }
  const fontsDir = getFontsDir();
  cachedFontBuffers = {
    regular: fs.readFileSync(path.join(fontsDir, 'Inter-Regular.ttf')),
    semiBold: fs.readFileSync(path.join(fontsDir, 'Inter-SemiBold.ttf')),
    bold: fs.readFileSync(path.join(fontsDir, 'Inter-Bold.ttf')),
    italic: fs.readFileSync(path.join(fontsDir, 'Inter-Italic.ttf')),
  };
  return cachedFontBuffers;
}

export async function ensureInvoiceFonts(): Promise<InvoiceFontBuffers> {
  if (cachedFontBuffers) {
    return cachedFontBuffers;
  }
  if (fontLoadPromise) {
    return fontLoadPromise;
  }

  fontLoadPromise = (async () => {
    const fontsDir = getFontsDir();
    const [regular, semiBold, bold, italic] = await Promise.all([
      fs.promises.readFile(path.join(fontsDir, 'Inter-Regular.ttf')),
      fs.promises.readFile(path.join(fontsDir, 'Inter-SemiBold.ttf')),
      fs.promises.readFile(path.join(fontsDir, 'Inter-Bold.ttf')),
      fs.promises.readFile(path.join(fontsDir, 'Inter-Italic.ttf')),
    ]);

    cachedFontBuffers = { regular, semiBold, bold, italic };
    return cachedFontBuffers;
  })();

  return fontLoadPromise;
}

export function registerInvoiceFonts(
  doc: InstanceType<typeof PDFDocument>,
  fonts?: InvoiceFontBuffers
): void {
  const f = fonts || cachedFontBuffers || loadInvoiceFontsSync();

  // Primary Unicode Inter fonts supporting U+20B9 (₹)
  doc.registerFont('Inter', f.regular);
  doc.registerFont('Inter-Regular', f.regular);
  doc.registerFont('Inter-SemiBold', f.semiBold);
  doc.registerFont('Inter-Bold', f.bold);
  doc.registerFont('Inter-Italic', f.italic);

  // Fallback aliases for standard 14 font names to eliminate WinAnsiEncoding superscript 1
  doc.registerFont('Helvetica', f.regular);
  doc.registerFont('Helvetica-Bold', f.bold);
  doc.registerFont('Helvetica-Oblique', f.italic);
  doc.registerFont('Helvetica-BoldOblique', f.bold);
}
