import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { ConfirmImportInput, DesignSummary, ImportPreview, SaveDesignInput, TransformerDesignApi, TransformerDesignRecord } from '../tools/transformer-design/types';

export const transformerDesignApi: TransformerDesignApi = {
 list: () => invoke<DesignSummary[]>('transformer_design_list'),
 get: id => invoke<TransformerDesignRecord>('transformer_design_get', { id }),
 save: input => invoke<TransformerDesignRecord>('transformer_design_save', { input }),
 previewImport: async () => {
  const sourcePath = await open({ multiple:false,title:'导入变压器旧设计（先预览再选择一份）',filters:[{name:'设计 JSON / Excel',extensions:['json','xlsx']}] });
  if (typeof sourcePath !== 'string') return null;
  return invoke<ImportPreview>('transformer_design_import_preview', { sourcePath });
 },
 confirmImport: (input: ConfirmImportInput) => invoke<TransformerDesignRecord>('transformer_design_import_confirm', { input }),
};
export async function saveTransformerExport(bytes: Uint8Array, fileName: string) {
 const kind = fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : fileName.toLowerCase().endsWith('.svg') ? 'svg' : 'json';
 const path = await save({ title:kind==='pdf'?'保存中文制作单 PDF':kind==='svg'?'保存绕组示意图 SVG':'保存变压器设计 JSON',defaultPath:fileName,filters:[{name:kind.toUpperCase(),extensions:[kind]}] });
 if (!path) return false;
 await invoke<void>('transformer_export_write', { path,kind,bytes:Array.from(bytes) });
}
export type { SaveDesignInput };
