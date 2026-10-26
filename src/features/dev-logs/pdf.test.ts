import { describe, expect, it, vi } from 'vitest';
import { logPdfFileName, logPdfResourceIds, renderLogPdfBody, resolveLogPdfPage, type PdfResource } from './pdf';
import type { LogPage } from './contracts';
import type { JSONContent } from '@tiptap/core';

const page = (content: JSONContent[] = []): LogPage => ({ id: 'current', projectId: 'project', title: '中文开发日志 <试验>', documentJson: JSON.stringify({ type: 'doc', content }), schemaVersion: 1, revision: 3, position: 0, createdAt: '', updatedAt: '', deletedAt: null });
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const image: PdfResource = { id: 'img', pageId: 'current', name: '原图 & 中文.png', mime: 'image/png', size: 200, sha256: '', isImage: true, dataUrl: 'data:image/png;base64,aGVsbG8=', width: 1000, height: 4000 };

describe('development log PDF content', () => {
 it('preserves Chinese, marks, links, alignment, line breaks and empty paragraphs while escaping content', () => {
  const p = page([{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '电源设计' }] }, { type: 'paragraph', attrs: { textAlign: 'center' }, content: [
   { type: 'text', text: '中文 <脚本> & 引号', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#ff0000' } }, { type: 'highlight', attrs: { color: '#ffff00' } }] },
   { type: 'hardBreak' }, { type: 'text', text: '规格书', marks: [{ type: 'link', attrs: { href: 'https://example.com/?a=1&b=2' } }] },
  ] }, { type: 'paragraph' }]);
  const html = renderLogPdfBody(p, new Map(), '项目 A&B');
  expect(html).toContain('中文开发日志 &lt;试验&gt;');
  expect(html).toContain('项目 A&amp;B');
  expect(html).toContain('<h2>电源设计</h2>');
  expect(html).toContain('text-align:center');
  expect(html).toContain('<strong>中文 &lt;脚本&gt; &amp; 引号</strong>');
  expect(html).toContain('background-color:#ffff00');
  expect(html).toContain('color:#ff0000');
  expect(html).toContain('<br><a href="https://example.com/?a=1&amp;b=2">规格书</a>');
  expect(html).toContain('<p><br></p>');
 });
 it('preserves nested lists, numbering, task status and long code without editor chrome', () => {
  const html = renderLogPdfBody(page([
   { type: 'orderedList', attrs: { start: 3, type: 'A' }, content: [{ type: 'listItem', content: [paragraph('步骤'), { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('子项')] }] }] }] },
   { type: 'taskList', content: [true, false].map(checked => ({ type: 'taskItem', attrs: { checked }, content: [paragraph(checked ? '完成' : '待办')] })) },
   { type: 'codeBlock', content: [{ type: 'text', text: 'const 电压 = 12;\n'.repeat(200) }] },
  ]), new Map());
  expect(html).toContain('<ol start="3" type="A">');
  expect(html).toContain('<ul><li><p>子项</p></li></ul>');
  expect(html).toContain('class="task-check checked"');
  expect(html).toContain('class="task-check"');
  expect(html.match(/const 电压 = 12;/g)).toHaveLength(200);
  expect(html).not.toMatch(/contenteditable|log-line-gutter|打开|另存为/);
 });
 it('uses original image data and scales tall images proportionally to one page', () => {
  const html = renderLogPdfBody(page([{ type: 'image', attrs: { resourceId: 'img', displayWidth: 400 } }]), new Map([['img', image]]));
  const width = Number(/width:([\d.]+)px/.exec(html)![1]);
  expect(width).toBeLessThan(400);
  expect(width * image.height! / image.width!).toBeCloseTo(235 / 25.4 * 96, 1);
  expect(html).toContain(image.dataUrl);
  expect(html).toContain('原图 &amp; 中文.png');
  const small = renderLogPdfBody(page([{ type: 'image', attrs: { resourceId: 'img', displayWidth: 100 } }]), new Map([['img', image]]));
  expect(small).toContain(`width:${width.toFixed(2)}px`);
 });
 it('exports attachments as metadata and fails explicitly for missing or broken images', () => {
  const file = { ...image, id: 'file', name: '设计.zip', isImage: false };
  expect(renderLogPdfBody(page([{ type: 'fileAttachment', attrs: { resourceId: 'file' } }]), new Map([['file', file]]))).toContain('附件：设计.zip');
  const p = page([{ type: 'image', attrs: { resourceId: 'img' } }]);
  expect(() => renderLogPdfBody(p, new Map())).toThrow('不存在');
  expect(() => renderLogPdfBody(p, new Map([['img', { ...image, dataUrl: undefined }]]))).toThrow('无法解码');
  expect(() => renderLogPdfBody(p, new Map([['img', { ...image, dataUrl: 'https://example.com/a.png' }]]))).toThrow('无法解码');
 });
 it('ignores editor zoom and leaves small originals at their natural size', () => {
  const natural = { ...image, width: 256, height: 128 };
  for (const displayWidth of [64, 400, 4096]) {
   expect(renderLogPdfBody(page([{ type: 'image', attrs: { resourceId: 'img', displayWidth } }]), new Map([['img', natural]]))).toContain('width:256.00px');
  }
 });
 it('deduplicates resources and distinguishes image attachments from inline images', () => {
  const doc: JSONContent = { type: 'doc', content: [{ type: 'image', attrs: { resourceId: 'img' } }, { type: 'image', attrs: { resourceId: 'img' } }, { type: 'fileAttachment', attrs: { resourceId: 'file' } }] };
  expect(logPdfResourceIds(doc)).toEqual(['img', 'file']);
  expect(logPdfResourceIds(doc, true)).toEqual(['img']);
 });
 it('keeps filenames portable, including reserved Windows names', () => {
  expect(logPdfFileName('中文:测试/日志?')).toBe('中文_测试_日志_.pdf');
  expect(logPdfFileName('CON')).toBe('_CON.pdf');
  expect(logPdfFileName('  ...  ')).toBe('未命名页面.pdf');
 });
});

describe('PDF export target snapshot', () => {
 it('exports the unsaved current draft without reading an older persisted page or changing it', async () => {
  const draft = page([paragraph('尚未保存的中文')]);
  const getPage = vi.fn();
  const target = await resolveLogPdfPage(draft.id, draft, getPage);
  expect(target.documentJson).toContain('尚未保存的中文');
  expect(target).not.toBe(draft);
  expect(getPage).not.toHaveBeenCalled();
  target.title = '导出快照';
  expect(draft.title).toBe('中文开发日志 <试验>');
 });
 it('reads a right-clicked noncurrent page without touching the current draft', async () => {
  const current = page([paragraph('未保存')]);
  const other = { ...page([paragraph('另一页')]), id: 'other' };
  const getPage = vi.fn().mockResolvedValue(other);
  expect(await resolveLogPdfPage('other', current, getPage)).toEqual(other);
  expect(getPage).toHaveBeenCalledWith('other');
  expect(current.documentJson).toContain('未保存');
  getPage.mockResolvedValue({ ...other, deletedAt: 'now' });
  await expect(resolveLogPdfPage('other', current, getPage)).rejects.toThrow('页面已删除');
 });
});
