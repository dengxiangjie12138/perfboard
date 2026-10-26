import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFPage, PDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createExampleDesign } from './model';
import { createSheetExample } from './sheet';
import { exportTransformerDesignPdf, generateTransformerDesignPdf, wrapPdfText } from './pdf';
import type { TransformerDesignDocument } from './types';

let fontBytes: Uint8Array;
beforeAll(async () => {
  // Keep Node-only test loading out of the application's explicit ambient types.
  const fsModule: string = ['node', 'fs'].join(':');
  const fs = await import(/* @vite-ignore */ fsModule) as { readFileSync(path: URL): Uint8Array };
  fontBytes = new Uint8Array(fs.readFileSync(new URL('../../../public/transformer-design/fonts/NotoSansSC-Regular.ttf', import.meta.url)));
});
function decodeBase64(value: string): Uint8Array { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
// A deterministic 2x1 RGB PNG with one red and one blue pixel (no external URL).
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==';

describe('manufacturer Chinese PDF integration', () => {
  it('uses a bundled font that contains the real Chinese and electrical notation glyphs', async () => {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes);
    const supported = new Set(font.getCharacterSet());
    for (const character of Array.from('变压器设计记录仅示例未审核不可生产待确认骨架绕组工序材料电感漏感耐压µΩ²⁴')) {
      expect(supported.has(character.codePointAt(0)!), 'missing font glyph: ' + character).toBe(true);
    }
  }, 30000);
  it('preserves every character while wrapping long Chinese table content', () => {
    const source = '绕制条件与绝缘材料待确认。'.repeat(60);
    const font = { widthOfTextAtSize: (text: string, size: number) => Array.from(text).length * size };
    const lines = wrapPdfText(source, font, 8, 80);
    expect(lines.join('')).toBe(source);
    expect(lines.every(line => font.widthOfTextAtSize(line, 8) <= 80)).toBe(true);
  });
  it('persists image pixels in a JSON snapshot and embeds an image XObject in saved PDF bytes', async () => {
    const original = createExampleDesign();
    original.status = 'released'; // The example label must still remain in the exported metadata/watermark path.
    original.images = [{ id: 'pin-fixture', title: '引脚图测试像素', attachmentId: null, url: 'data:image/png;base64,' + pngBase64, notes: '测试图；实际视角与1脚仍待确认。' }];
    const restored = JSON.parse(JSON.stringify(original)) as TransformerDesignDocument;
    expect(restored.images[0].url).toBe(original.images[0].url);
    expect(decodeBase64(restored.images[0].url!.split(',')[1])).toEqual(decodeBase64(pngBase64));
    let written: Uint8Array | undefined;
    const result = await exportTransformerDesignPdf(restored, { fontBytes, onSave: async (bytes, fileName) => {
      expect(fileName).toBe('EXAMPLE-36W_Rev-A.pdf'); written = bytes; return true;
    } });
    expect(result).toBe(true);
    expect(new TextDecoder().decode(written!.slice(0, 5))).toBe('%PDF-');
    const pdf = await PDFDocument.load(written!);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(pdf.getSubject()).toContain('仅示例');
    const images = pdf.context.enumerateIndirectObjects().filter(([, object]) =>
      object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
    expect(images.length).toBeGreaterThanOrEqual(1);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(841.89, 1);
      expect(page.getHeight()).toBeCloseTo(595.28, 1);
    }
  }, 30000);
  it('automatically adds continuation pages for long manufacturing and acceptance text', async () => {
    const design = createExampleDesign();
    design.windingSteps[0].notes = ('超长工序说明需完整保留，不能截断。').repeat(400);
    design.tests[0].conditions = ('端子、频率、幅度、温度与绕组开短路状态。').repeat(200);
    const bytes = await generateTransformerDesignPdf(design, { fontBytes });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(3);
    expect(bytes.byteLength).toBeGreaterThan(100000);
  }, 30000);
  it('retains an imported custom acceptance kind in the actual PDF drawing operations', async () => {
    const design = JSON.parse(JSON.stringify(createExampleDesign())) as TransformerDesignDocument;
    design.tests[0].kind = 'temperatureRise';
    const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
    try {
      const bytes = await generateTransformerDesignPdf(design, { fontBytes });
      expect(drawText.mock.calls.some(([text]) => text.includes('temperatureRise'))).toBe(true);
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(2);
    } finally { drawText.mockRestore(); }
  }, 30000);
  it('requires a real save callback rather than declaring window printing a PDF export', async () => {
    await expect(exportTransformerDesignPdf(createExampleDesign(), { fontBytes })).rejects.toThrow('原生文件保存接口');
  });
});

describe('production sheet bobbin description',()=>{
 it('prints the complete saved free text with wrapping in portrait A4 PDF',async()=>{
  const design=createSheetExample();
  const description='EE19立式十脚骨架，槽宽与绝缘材料按双方已确认图纸制作。'.repeat(30);
  design.productionSheet!.bobbinDescription=description;
  const restored=JSON.parse(JSON.stringify(design)) as TransformerDesignDocument;
  const drawText=vi.spyOn(PDFPage.prototype,'drawText');
  try{
   const bytes=await generateTransformerDesignPdf(restored,{fontBytes,rasterizeSvg:async()=>decodeBase64(pngBase64)});
   const drawn=drawText.mock.calls.map(([text])=>text).join('');
   expect(drawn).toContain('骨架描述：'+description);
   const pdf=await PDFDocument.load(bytes);
   expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
   for(const page of pdf.getPages()){expect(page.getWidth()).toBeCloseTo(595.28,1);expect(page.getHeight()).toBeCloseTo(841.89,1);}
  }finally{drawText.mockRestore();}
 },30000);
});

describe('production sheet transformer description',()=>{
 it('prints both saved descriptions independently with complete multiline free text',async()=>{
  const design=createSheetExample();
  design.productionSheet!.bobbinDescription='立式6+8，保留原骨架要求';
  const lines=['用途：辅助电源；输入16–28V，输出12V，功率36W。','自由备注与换行不被拆成必填参数。'.repeat(45)];
  design.productionSheet!.transformerDescription=lines.join('\n');
  const restored=JSON.parse(JSON.stringify(design)) as TransformerDesignDocument;
  const drawText=vi.spyOn(PDFPage.prototype,'drawText');
  try{
   const bytes=await generateTransformerDesignPdf(restored,{fontBytes,rasterizeSvg:async()=>decodeBase64(pngBase64)});
   const drawn=drawText.mock.calls.map(([text])=>text).join('');
   expect(drawn).toContain('骨架描述：'+design.productionSheet!.bobbinDescription);
   expect(drawn).toContain('变压器描述：'+lines.join(''));
   expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(2);
  }finally{drawText.mockRestore();}
 },30000);
});
