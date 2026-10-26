import { invoke } from '@tauri-apps/api/core';

export const MAX_LOG_RESOURCE_BYTES = 20 * 1024 * 1024;
export interface LogResourceContext { repositoryKey: string; pageId: string; expectedRevision: number }
export interface LogResourceMetadata { id: string; pageId: string; name: string; mime: string; size: number; sha256: string; isImage: boolean }
export interface LogResourceController {
 context: LogResourceContext;
 runImport: (operation: (context: LogResourceContext) => Promise<void>) => Promise<void>;
 onError: (error: unknown) => void;
 onNotice?: (message: string) => void;
}
export function validateLogFile(file: Pick<File, 'name' | 'size' | 'type'>, imagesOnly = false): void {
 if (imagesOnly && !file.size) throw new Error(`“${file.name}”是空图片文件`);
 if (file.size > MAX_LOG_RESOURCE_BYTES) throw new Error(`“${file.name}”超过 20 MiB，请选择较小的文件`);
 if (imagesOnly && !/^image\/(?:png|jpeg|gif|webp)$/i.test(file.type)) throw new Error('请选择 PNG、JPEG、GIF 或 WebP 图片');
}
export const logResourceApi = {
 importFile: async (context: LogResourceContext, file: File) => {
  validateLogFile(file);
  return invoke<LogResourceMetadata>('log_resource_import_bytes', new Uint8Array(await file.arrayBuffer()), {
   headers: { 'x-log-context': encodeURIComponent(JSON.stringify(context)), 'x-file-name': encodeURIComponent(file.name || (file.type === 'image/png' ? '截图.png' : '附件')), 'x-file-mime': file.type || 'application/octet-stream' },
  });
 },
 clone: (context: LogResourceContext, resourceId: string) => invoke<LogResourceMetadata>('log_resource_clone', { context, resourceId }),
 metadata: (context: LogResourceContext, resourceIds: string[]) => invoke<LogResourceMetadata[]>('log_resource_metadata', { context, resourceIds }),
 read: (context: LogResourceContext, resourceId: string) => invoke<ArrayBuffer>('log_resource_read', { context, resourceId }),
 export: (context: LogResourceContext, resourceId: string, destination: string) => invoke<void>('log_resource_export', { context, resourceId, destination }),
 open: (context: LogResourceContext, resourceId: string) => invoke<void>('log_resource_open', { context, resourceId }),
};
