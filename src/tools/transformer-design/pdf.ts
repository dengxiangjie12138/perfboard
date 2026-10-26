import { PDFDocument, PDFFont, PDFPage, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { drawProductionSheetPdf } from './sheetPdf';
import type { DesignImage, PdfExportOptions, TransformerDesignDocument } from './types';
import { CONFIRM, STATUS_LABELS, STEP_LABELS, testLabel, displayValue, exportFileName, formatMeasured, pendingItems, sortedSteps, windingName } from './model';

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 30;
const BOTTOM = 38;
const COLORS = { ink: rgb(0.13, 0.18, 0.24), muted: rgb(0.36, 0.41, 0.47), blue: rgb(0.10, 0.30, 0.51), line: rgb(0.78, 0.82, 0.86), pale: rgb(0.94, 0.96, 0.98) };
const DEFAULT_FONT = '/transformer-design/fonts/NotoSansSC-Regular.ttf';
type Column = { title: string; width: number };

export function wrapPdfText(text: string, font: Pick<PDFFont, 'widthOfTextAtSize'>, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const character of Array.from(paragraph)) {
      const next = line + character;
      if (line && font.widthOfTextAtSize(next, size) > width) { lines.push(line); line = character; }
      else line = next;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

class Drawing {
  page!: PDFPage;
  y = 0;
  section = '';
  readonly width = PAGE_WIDTH - MARGIN * 2;
  readonly supported: Set<number>;
  constructor(readonly pdf: PDFDocument, readonly font: PDFFont, readonly design: TransformerDesignDocument) {
    this.supported = new Set(font.getCharacterSet());
  }
  clean(text: unknown): string {
    return Array.from(String(text ?? CONFIRM)).map(character => {
      const code = character.codePointAt(0)!;
      return character === '\n' || (code >= 32 && this.supported.has(code)) ? character : '□';
    }).join('');
  }
  text(text: unknown, x: number, y: number, size = 9, color = COLORS.ink) {
    this.page.drawText(this.clean(text), { x, y, size, font: this.font, color });
  }
  newPage(section: string) {
    this.section = section.replace(/(?:（续）)+$/, '');
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.text('变压器设计记录', MARGIN, PAGE_HEIGHT - 29, 16, COLORS.blue);
    this.text('冻结设计快照 · 绕制与验收记录', MARGIN + 165, PAGE_HEIGHT - 28, 10, COLORS.muted);
    this.page.drawLine({ start: { x: MARGIN, y: PAGE_HEIGHT - 39 }, end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 39 }, thickness: 1, color: COLORS.line });
    this.y = PAGE_HEIGHT - 53;
  }
  startSection(section: string) {
    // Reuse a mostly empty continuation page, keeping all fields without orphan pages.
    if (this.pdf.getPageCount() > 1 && this.y >= PAGE_HEIGHT - 160) { this.section = section; return; }
    this.newPage(section);
  }
  ensure(height: number): boolean {
    if (this.y - height < BOTTOM) { this.newPage(this.section + '（续）'); return true; }
    return false;
  }
  heading(title: string) {
    this.ensure(63);
    this.text(title, MARGIN, this.y - 12, 11, COLORS.blue);
    this.y -= 23;
  }
  paragraph(text: string, size = 9, color = COLORS.ink) {
    const lines = wrapPdfText(this.clean(text), this.font, size, this.width);
    const height = size + 4;
    for (const line of lines) { this.ensure(height); this.text(line, MARGIN, this.y - size, size, color); this.y -= height; }
    this.y -= 3;
  }
  table(columns: Column[], rows: string[][], size = 8.3) {
    const lineHeight = size + 3;
    const headerHeight = 21;
    const drawHeader = () => {
      this.ensure(headerHeight + lineHeight + 8);
      this.page.drawRectangle({ x: MARGIN, y: this.y - headerHeight, width: this.width, height: headerHeight, color: COLORS.pale });
      let x = MARGIN;
      columns.forEach(column => { this.text(column.title, x + 5, this.y - 14, size, COLORS.blue); x += column.width; });
      this.y -= headerHeight;
    };
    drawHeader();
    for (const row of rows) {
      const cellLines = columns.map((column, index) => wrapPdfText(this.clean(row[index] ?? CONFIRM), this.font, size, column.width - 10));
      const count = Math.max(1, ...cellLines.map(lines => lines.length));
      let offset = 0;
      while (offset < count) {
        if (this.y - (lineHeight + 8) < BOTTOM) { this.newPage(this.section + '（续）'); drawHeader(); }
        const capacity = Math.max(1, Math.floor((this.y - BOTTOM - 8) / lineHeight));
        const take = Math.min(count - offset, capacity);
        const rowHeight = take * lineHeight + 8;
        let x = MARGIN;
        columns.forEach((column, columnIndex) => {
          for (let line = 0; line < take; line++) {
            const value = cellLines[columnIndex][offset + line];
            if (value !== undefined) this.text(value, x + 5, this.y - size - 4 - line * lineHeight, size);
          }
          this.page.drawLine({ start: { x, y: this.y }, end: { x, y: this.y - rowHeight }, thickness: 0.4, color: COLORS.line });
          x += column.width;
        });
        this.page.drawLine({ start: { x: MARGIN, y: this.y - rowHeight }, end: { x: MARGIN + this.width, y: this.y - rowHeight }, thickness: 0.4, color: COLORS.line });
        this.y -= rowHeight;
        offset += take;
      }
    }
    this.y -= 7;
  }
  circuit() {
    const steps = sortedSteps(this.design).filter(step => step.kind === 'winding');
    if (!steps.length) { this.paragraph('暂无绕线工序；电气连接待确认。'); return; }
    const columns = 4;
    const boxWidth = (this.width - (columns - 1) * 8) / columns;
    for (let start = 0; start < steps.length; start += columns) {
      this.ensure(83);
      steps.slice(start, start + columns).forEach((step, index) => {
        const x = MARGIN + index * (boxWidth + 8);
        const y = this.y - 77;
        this.page.drawRectangle({ x, y, width: boxWidth, height: 75, borderColor: COLORS.line, borderWidth: 0.5 });
        this.text('绕线工序 ' + step.order, x + 6, y + 58, 8.5, COLORS.blue);
        const left = x + 42;
        const right = x + boxWidth - 44;
        const middle = y + 37;
        this.page.drawLine({ start: { x: x + 20, y: middle }, end: { x: left, y: middle }, thickness: 0.8, color: COLORS.ink });
        const loops = 5;
        const points = 10;
        const pitch = (right - left) / loops;
        for (let loop = 0; loop < loops; loop++) {
          for (let point = 0; point < points; point++) {
            const t1 = point / points;
            const t2 = (point + 1) / points;
            this.page.drawLine({
              start: { x: left + (loop + t1) * pitch, y: middle + Math.sin(Math.PI * t1) * 8 },
              end: { x: left + (loop + t2) * pitch, y: middle + Math.sin(Math.PI * t2) * 8 },
              thickness: 0.8, color: COLORS.ink,
            });
          }
        }
        this.page.drawLine({ start: { x: right, y: middle }, end: { x: x + boxWidth - 20, y: middle }, thickness: 0.8, color: COLORS.ink });
        this.text(step.fromPin && /^\d{1,3}$/.test(step.fromPin) ? step.fromPin : step.fromPin ? '见表' : CONFIRM, x + 7, y + 34, 8);
        this.text(step.toPin && /^\d{1,3}$/.test(step.toPin) ? step.toPin : step.toPin ? '见表' : CONFIRM, x + boxWidth - 20, y + 34, 8);
        this.text((step.turns === null ? CONFIRM : step.turns + 'T') + ' · 同名端见绕组说明', x + 6, y + 12, 7.4, COLORS.muted);
      });
      this.y -= 83;
    }
    this.paragraph('图中每条线段对应一条绕线工序；线圈符号不表示实际匝数。不自动合并同名绕组，不推断端子连接或同名端。', 7.6, COLORS.muted);
  }
  layers() {
    const steps = sortedSteps(this.design);
    if (!steps.length) { this.paragraph('绕制层次待确认。'); return; }
    this.paragraph('以下按工序先后排列；仅表达绕制过程，实际内外层、层数与几何厚度见工序说明，不按比例。', 8, COLORS.muted);
    for (const step of steps) {
      this.ensure(24);
      const y = this.y - 20;
      this.page.drawRectangle({ x: MARGIN, y, width: this.width, height: 20, color: step.kind === 'winding' ? rgb(0.88, 0.93, 0.97) : rgb(0.96, 0.95, 0.91), borderColor: COLORS.line, borderWidth: 0.4 });
      const label = step.order + '  ' + STEP_LABELS[step.kind] + '  ' + (step.kind === 'winding' ? '绕线分段 / ' + (step.turns === null ? CONFIRM : step.turns + 'T') : '材料详见工序表');
      this.text(label, MARGIN + 7, y + 6, 8.2);
      this.y -= 24;
    }
  }
  async image(image: DesignImage, bytes: Uint8Array | undefined) {
    if (!bytes) { this.paragraph(image.title + '：图片未载入，见原始附件。' + (image.notes || ''), 9, COLORS.muted); return; }
    try {
      const isPng = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
      const isJpg = bytes[0] === 255 && bytes[1] === 216;
      if (!isPng && !isJpg) throw new Error('仅支持PNG/JPEG');
      const embedded = isPng ? await this.pdf.embedPng(bytes) : await this.pdf.embedJpg(bytes);
      const scale = Math.min(this.width / embedded.width, 230 / embedded.height, 1);
      const width = embedded.width * scale;
      const height = embedded.height * scale;
      this.heading(image.title);
      this.ensure(height + 7);
      this.page.drawImage(embedded, { x: MARGIN + (this.width - width) / 2, y: this.y - height, width, height });
      this.y -= height + 7;
      if (image.notes) this.paragraph(image.notes, 8, COLORS.muted);
    } catch {
      this.paragraph(image.title + '：图片格式无效或无法嵌入，需补充PNG/JPEG原图。' + (image.notes || ''), 9, COLORS.muted);
    }
  }
  finalize() {
    const pages = this.pdf.getPages();
    pages.forEach((page, index) => {
      page.drawLine({ start: { x: MARGIN, y: 30 }, end: { x: PAGE_WIDTH - MARGIN, y: 30 }, thickness: 0.4, color: COLORS.line });
      const footer = this.clean((this.design.designNo || CONFIRM) + '  /  Rev ' + (this.design.revLabel || CONFIRM) + '  /  ' + (index + 1) + ' / ' + pages.length);
      const footerSize = Math.min(8, (PAGE_WIDTH - MARGIN * 2) / Math.max(1, this.font.widthOfTextAtSize(footer, 8)) * 8);
      page.drawText(footer, { x: MARGIN, y: 17, size: footerSize, font: this.font, color: COLORS.muted });
      if (this.design.exampleFlag || this.design.status === 'draft') {
        const watermark = this.design.exampleFlag ? '仅示例 · 未审核 · 不可生产' : '未审核 · 不可用于生产';
        page.drawText(this.clean(watermark), { x: 160, y: 175, size: 36, font: this.font, color: rgb(0.75, 0.18, 0.15), rotate: degrees(17), opacity: 0.09 });
      }
    });
  }
}

async function loadImage(image: DesignImage, options: PdfExportOptions): Promise<Uint8Array | undefined> {
  if (options.resolveImage) return options.resolveImage(image);
  if (!image.url || !(/^(data:image\/(png|jpeg);base64,|\/transformer-design\/)/.test(image.url))) return undefined;
  const response = await fetch(image.url);
  if (!response.ok) return undefined;
  return new Uint8Array(await response.arrayBuffer());
}

/** Produces real PDF bytes, independently testable without a browser or a save dialog. */
export async function generateTransformerDesignPdf(design: TransformerDesignDocument, options: PdfExportOptions = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  let bytes = options.fontBytes;
  if (!bytes) {
    const response = await fetch(options.fontUrl || DEFAULT_FONT);
    if (!response.ok) throw new Error('中文PDF字体未加载，请检查随软件发布的字体资源。');
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (options.subsetFont) throw new Error('当前中文字体须完整嵌入；子集模式不能可靠显示中文。');
  // Preserve engineering identifiers and numerals; shaping alternates are not mapped
  // reliably by this full-font PDF encoder's ToUnicode table.
  const font = await pdf.embedFont(bytes, {
    subset: false,
    features: { liga: false, kern: false, locl: false, ccmp: false, frac: false, numr: false, dnom: false },
  });
  pdf.setTitle(design.title || '变压器设计记录');
  pdf.setSubject((design.designNo || CONFIRM) + ' / Rev ' + design.revLabel + (design.exampleFlag ? ' / 仅示例' : ''));
  pdf.setCreator('Perfboard');
  pdf.setProducer('Perfboard · pdf-lib');
  pdf.setLanguage('zh-CN');
  if (design.productionSheet) return drawProductionSheetPdf(pdf, font, design, options);
  const drawing = new Drawing(pdf, font, design);
  drawing.newPage('图纸摘要 / 材料 / 连接说明');
  const third = drawing.width / 3;
  drawing.table([{ title: '设计记录', width: third }, { title: '版本与状态', width: third }, { title: '磁芯与骨架快照', width: third }], [
    ['设计号：' + displayValue(design.designNo) + '\n名称：' + displayValue(design.title), '工程Rev：' + displayValue(design.revLabel) + '\n状态：' + STATUS_LABELS[design.status] + (design.exampleFlag ? ' · 仅示例' : ''), '磁芯：' + displayValue(design.coreSnapshot?.model) + ' / ' + displayValue(design.coreSnapshot?.material) + '\n骨架：' + displayValue(design.bobbinSnapshot?.partNumber)],
  ], 9);
  const core = design.coreSnapshot;
  drawing.paragraph('磁芯来源版本：' + displayValue(core?.libraryRevision) + '；图纸冻结参数，不随库更新改变。', 8, COLORS.muted);
  if (core?.conflictNotes.length) drawing.paragraph('来源 / 冲突说明：' + core.conflictNotes.join('；'), 8, COLORS.muted);
  const parameter = core?.parameters;
  drawing.table(Array.from({ length: 6 }, (_, index) => ({ title: ['Ae (mm²)', 'Aw (mm²)', 'AL (nH/T²)', 'le (mm)', 'Ve (mm³)', 'Ap (cm⁴)'][index], width: drawing.width / 6 })), [
    [parameter?.aeMm2, parameter?.awMm2, parameter?.alNhPerTurn2, parameter?.leMm, parameter?.veMm3, parameter?.apCm4].map(displayValue),
  ]);
  if (parameter?.dimensionsMm) drawing.paragraph('磁芯尺寸（mm，冻结来源）：' + (typeof parameter.dimensionsMm === 'string' ? parameter.dimensionsMm : JSON.stringify(parameter.dimensionsMm)), 8);
  const bobbin = design.bobbinSnapshot;
  drawing.paragraph('骨架：' + displayValue(bobbin?.orientation) + ' / 引脚数 ' + displayValue(bobbin?.pinCount) + '；视角：' + displayValue(bobbin?.view) + '；1脚定位：' + displayValue(bobbin?.pin1Location), 9);
  drawing.paragraph('引脚图说明：' + displayValue(bobbin?.pinDiagramNotes) + '。实际引脚排列以带视角和1脚标记的附图为准。', 8, COLORS.muted);
  drawing.heading('电气连接 / 分段示意');
  drawing.circuit();
  drawing.table([{ title: '逻辑绕组', width: 100 }, { title: '用途 / 角色', width: 160 }, { title: '同名端说明', width: 240 }, { title: '端子 / 合并说明', width: drawing.width - 500 }], design.logicalWindings.length ? design.logicalWindings.map(winding => [displayValue(winding.name), displayValue(winding.role), displayValue(winding.polarityNote), displayValue(winding.terminalNotes)]) : [['待确认', '待确认', '待确认', '待确认']]);
  drawing.heading('材料表');
  drawing.table([{ title: '材料', width: 120 }, { title: '规格 / 料号', width: 250 }, { title: '数量 / 单位', width: 110 }, { title: '说明', width: drawing.width - 480 }], design.materials.length ? design.materials.map(material => [displayValue(material.name), displayValue(material.specification), formatMeasured(material.quantity, material.unit), displayValue(material.notes)]) : [['待确认', '待确认', '待确认', '待确认']]);
  if (design.dimensions.length) { drawing.heading('尺寸要求'); drawing.table([{ title: '尺寸', width: 150 }, { title: '数值', width: 160 }, { title: '公差', width: 160 }, { title: '说明', width: drawing.width - 470 }], design.dimensions.map(dimension => [dimension.name, formatMeasured(dimension.value, dimension.unit), displayValue(dimension.tolerance), displayValue(dimension.notes)])); }
  else drawing.paragraph('尺寸 / 安装要求：待确认；未确认项不以0表示。', 8, COLORS.muted);

  drawing.startSection('绕制工序 / 层次 / 测试验收');
  drawing.heading('绕制与绝缘工序（允许同一逻辑绕组分段）');
  drawing.table([{ title: '序 / 类别', width: 65 }, { title: '绕组 / 材料', width: 100 }, { title: '端子 / 匝数', width: 100 }, { title: '线材 / 股数 / 厚度', width: 160 }, { title: '绕向 / 层次 / 说明', width: drawing.width - 425 }], sortedSteps(design).length ? sortedSteps(design).map(step => [
    step.order + ' / ' + STEP_LABELS[step.kind],
    step.kind === 'winding' ? windingName(design, step.logicalWindingId) : displayValue(step.material),
    step.kind === 'winding' ? displayValue(step.fromPin) + ' → ' + displayValue(step.toPin) + '\n' + (step.turns === null ? CONFIRM : step.turns + 'T') : '—',
    step.kind === 'winding' ? displayValue(step.wireSpec) + '\n并绕：' + displayValue(step.parallelCount) : formatMeasured(step.thickness, step.unit),
    (step.kind === 'winding' ? '绕向：' + displayValue(step.direction) + '；' : '') + '层次：' + displayValue(step.layerNotes) + '\n' + displayValue(step.notes),
  ]) : [['待确认', '待确认', '待确认', '待确认', '待确认']], 8);
  drawing.heading('工序层次示意');
  drawing.layers();
  drawing.heading('测试与验收');
  drawing.table([{ title: '项目', width: 90 }, { title: '目标 / 单位', width: 145 }, { title: '公差 / 判定界限', width: 155 }, { title: '条件（端子、频率、温度等）', width: 235 }, { title: '备注', width: drawing.width - 625 }], design.tests.length ? design.tests.map(test => [testLabel(test.kind), formatMeasured(test.target, test.unit), displayValue(test.tolerance), displayValue(test.conditions), displayValue(test.notes)]) : [['待确认', '待确认', '待确认', '待确认', '待确认']], 8);
  if (design.assemblyNotes) { drawing.heading('装配说明'); drawing.paragraph(design.assemblyNotes, 8); }
  else drawing.paragraph('装配说明：待确认', 8);
  if (design.notes) { drawing.heading('设计备注'); drawing.paragraph(design.notes, 8); }
  const pending = pendingItems(design);
  if (pending.length) { drawing.heading('待确认事项'); drawing.paragraph(pending.join('；'), 8, COLORS.muted); }
  if (design.source) {
    drawing.paragraph('历史导入溯源：' + design.source.fileName + ' / ' + displayValue(design.source.sheetName) + ' / 行 ' + displayValue(design.source.rowStart) + '–' + displayValue(design.source.rowEnd), 8);
    if (design.source.warnings.length) drawing.paragraph(design.source.warnings.join('；'), 8, COLORS.muted);
  }
  if (design.images.length) {
    drawing.startSection('附图与说明');
    for (const image of design.images) {
      let imageBytes: Uint8Array | undefined;
      try { imageBytes = await loadImage(image, options); } catch { imageBytes = undefined; }
      await drawing.image(image, imageBytes);
    }
  }
  drawing.finalize();
  return pdf.save();
}

/** Native callers supply onSave so the manufacturer PDF is written to the selected file. */
export async function exportTransformerDesignPdf(design: TransformerDesignDocument, options: PdfExportOptions): Promise<boolean> {
  if (!options.onSave) throw new Error('尚未连接原生文件保存接口，无法保存PDF。');
  const bytes = await generateTransformerDesignPdf(design, options);
  return (await options.onSave(bytes, exportFileName(design, 'pdf'))) !== false;
}
