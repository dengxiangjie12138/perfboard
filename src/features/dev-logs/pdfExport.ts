import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { JSONContent } from '@tiptap/core';
import type { LogPage } from './contracts';
import { parseStoredDocument } from './document';
import { logResourceApi, type LogResourceContext } from './resourceApi';
import { logPdfFileName, logPdfResourceIds, renderLogPdfBody, type PdfResource } from './pdf';

function imageDataUrl(bytes: ArrayBuffer, mime: string): string {
 const array = new Uint8Array(bytes);
 let binary = '';
 for (let i = 0; i < array.length; i += 8192) binary += String.fromCharCode(...array.subarray(i, i + 8192));
 return `data:${mime};base64,${btoa(binary)}`;
}
async function decodeImage(dataUrl: string): Promise<{ width: number; height: number }> {
 const image = new Image();
 image.src = dataUrl;
 await image.decode();
 if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效');
 return { width: image.naturalWidth, height: image.naturalHeight };
}

export async function exportLogPagePdf(page: LogPage, repositoryKey: string, projectTitle: string): Promise<boolean> {
 const path = await save({ title: '导出开发日志 PDF', defaultPath: logPdfFileName(page.title), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
 if (!path) return false;
 const context: LogResourceContext = { repositoryKey, pageId: page.id, expectedRevision: page.revision };
 const document = parseStoredDocument(page.documentJson, page.schemaVersion) as JSONContent;
 const ids = logPdfResourceIds(document);
 const imageIds = new Set(logPdfResourceIds(document, true));
 const resources = new Map<string, PdfResource>();
 // Batch metadata, then load originals once per ID, including images outside the editor viewport.
 for (let offset = 0; offset < ids.length; offset += 512) {
  for (const metadata of await logResourceApi.metadata(context, ids.slice(offset, offset + 512))) resources.set(metadata.id, metadata);
 }
 let imageBytes = 0;
 for (const resource of resources.values()) {
  if (!imageIds.has(resource.id)) continue;
  if (!resource.isImage) throw new Error(`“${resource.name}”不是可显示的图片，已取消导出`);
  imageBytes += resource.size;
  if (imageBytes > 64 * 1024 * 1024) throw new Error('本页图片超过 64 MiB，请分成多个页面后导出');
  try {
   resource.dataUrl = imageDataUrl(await logResourceApi.read(context, resource.id), resource.mime);
   Object.assign(resource, await decodeImage(resource.dataUrl));
  } catch { throw new Error(`图片“${resource.name}”无法读取或解码，已取消导出`); }
 }
 await invoke<void>('dev_log_export_pdf', { repositoryKey, path, body: renderLogPdfBody(page, resources, projectTitle) });
 return true;
}
