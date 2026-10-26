import type { PdfExportOptions, TransformerDesignDocument } from './types';
import { exportFileName } from './model';

/** The native writer and importer both consume the bare schemaVersion:1 document. */
export async function exportTransformerDesignJson(document: TransformerDesignDocument, options: Pick<PdfExportOptions, 'onSave'>): Promise<boolean> {
  if (!options.onSave) throw new Error('尚未连接原生文件保存接口。');
  const bytes = new TextEncoder().encode(JSON.stringify(document, null, 2));
  return (await options.onSave(bytes, exportFileName(document, 'json'))) !== false;
}
