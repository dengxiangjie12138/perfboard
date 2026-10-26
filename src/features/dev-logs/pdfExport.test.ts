import { beforeEach, expect, it, vi } from 'vitest';
const { invoke, save, metadata, read, decode } = vi.hoisted(() => ({ invoke: vi.fn(), save: vi.fn(), metadata: vi.fn(), read: vi.fn(), decode: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save }));
vi.mock('./resourceApi', () => ({ logResourceApi: { metadata, read } }));
import { exportLogPagePdf } from './pdfExport';
import type { LogPage } from './contracts';
const page: LogPage = { id: 'p', projectId: 'project', title: '中文草稿', documentJson: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '最新未保存内容' }] }, { type: 'image', attrs: { resourceId: 'img' } }, { type: 'image', attrs: { resourceId: 'img' } }, { type: 'fileAttachment', attrs: { resourceId: 'file' } }] }), schemaVersion: 1, revision: 4, position: 0, createdAt: '', updatedAt: '', deletedAt: null };
beforeEach(() => {
 vi.resetAllMocks();
 save.mockResolvedValue('D:/export/中文草稿.pdf');
 metadata.mockResolvedValue([{ id: 'img', name: '中文原图.png', mime: 'image/png', size: 4, isImage: true }, { id: 'file', name: '图片附件.png', mime: 'image/png', size: 4, isImage: true }]);
 read.mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer);
 decode.mockResolvedValue(undefined);
 vi.stubGlobal('Image', class { src = ''; naturalWidth = 640; naturalHeight = 480; decode = decode; });
});
it('cancels without loading resources or generating any file', async () => {
 save.mockResolvedValue(null);
 expect(await exportLogPagePdf(page, 'repository', '项目')).toBe(false);
 expect(metadata).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
});
it('loads each inline original once, including offscreen images, then exports the complete draft', async () => {
 expect(await exportLogPagePdf(page, 'repository', '项目')).toBe(true);
 expect(read).toHaveBeenCalledTimes(1);
 expect(read.mock.calls[0][1]).toBe('img');
 expect(invoke).toHaveBeenCalledTimes(1);
 const [command, args] = invoke.mock.calls[0];
 expect(command).toBe('dev_log_export_pdf');
 expect(args.body).toContain('最新未保存内容');
 expect(args.body.match(/<img /g)).toHaveLength(2);
 expect(args.body).toContain('data:image/png;base64,AQIDBA==');
 expect(args.body).toContain('附件：图片附件.png');
 expect(args.repositoryKey).toBe('repository');
 // No log save or selection-changing command is issued by exporting.
 expect(invoke.mock.calls.every(([name]) => name === 'dev_log_export_pdf')).toBe(true);
});
it('fails without generating an incomplete PDF when an image cannot be read or decoded', async () => {
 decode.mockRejectedValue(new Error('decode failure'));
 await expect(exportLogPagePdf(page, 'repository', '')).rejects.toThrow('中文原图.png');
 expect(invoke).not.toHaveBeenCalled();
});
