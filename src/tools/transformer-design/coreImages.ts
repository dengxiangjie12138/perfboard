import type { CoreSnapshot, DesignImage, TransformerDesignDocument } from './types';
import { copyDocument } from './model';

export const AUTO_CORE_IMAGE_PREFIX = 'auto-core-snapshot:';
export const MAX_FROZEN_IMAGE_BYTES = 1024 * 1024;
export const MAX_DESIGN_DOCUMENT_BYTES = 2 * 1024 * 1024;
export interface CoreImageFreezeOptions {
  fetchAsset?: (assetPath: string) => Promise<Uint8Array>;
  sha256?: (bytes: Uint8Array) => Promise<string>;
}
interface VerifiedImageMetadata {
  assetPath: string; sha256: string; binding: string; sourceLabel: string; filename: string;
  sourceWorkbookSha256: string; sheet: string; anchor: string; sourceModel: string; alt: string;
}
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function metadataOf(value: unknown): VerifiedImageMetadata {
  if (!value || typeof value !== 'object') throw new Error('磁芯附图元数据无效，未复制图纸。');
  const object = value as Record<string, unknown>;
  const assetPath = stringValue(object.assetPath);
  const sha256 = stringValue(object.sha256).toLowerCase();
  if (!/^\/core-library\/[a-zA-Z0-9_-]+\.png$/.test(assetPath) || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('磁芯图缺少可信本地PNG路径或SHA256，未复制图纸。');
  }
  return { assetPath, sha256, binding: stringValue(object.binding), sourceLabel: stringValue(object.sourceLabel),
    filename: stringValue(object.filename), sourceWorkbookSha256: stringValue(object.sourceWorkbookSha256),
    sheet: stringValue(object.sheet), anchor: stringValue(object.anchor), sourceModel: stringValue(object.sourceModel), alt: stringValue(object.alt) };
}
async function readAsset(path: string): Promise<Uint8Array> {
  const response = await fetch(path);
  if (!response.ok) throw new Error('磁芯系列图载入失败：' + path);
  const size = Number(response.headers.get('content-length') || 0);
  if (size > MAX_FROZEN_IMAGE_BYTES) throw new Error('磁芯单张图超过1MiB，未复制图纸。');
  return new Uint8Array(await response.arrayBuffer());
}
async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境无法校验磁芯图SHA256，未复制图纸。');
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function asBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
export function documentByteLength(document: TransformerDesignDocument): number {
  return new TextEncoder().encode(JSON.stringify(document)).byteLength;
}
/** Verified bytes are saved in the design, so later library updates cannot change an old drawing. */
export async function createFrozenCoreDocument(document: TransformerDesignDocument, snapshot: CoreSnapshot, options: CoreImageFreezeOptions = {}): Promise<TransformerDesignDocument> {
  const automatic: DesignImage[] = [];
  for (const [index, value] of snapshot.images.entries()) {
    const image = metadataOf(value);
    const bytes = await (options.fetchAsset || readAsset)(image.assetPath);
    if (bytes.byteLength > MAX_FROZEN_IMAGE_BYTES) throw new Error('磁芯单张图超过1MiB，未复制图纸。');
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((byte, offset) => bytes[offset] === byte)) throw new Error('磁芯源图不是有效PNG，未复制图纸。');
    if ((await (options.sha256 || sha256)(bytes)).toLowerCase() !== image.sha256) throw new Error('磁芯图SHA256与冻结来源不符，未复制图纸。');
    const series = image.binding === 'sheet-series';
    const scope = series ? '原表系列参考示意，具体型号尺寸待核对；不是实物照片。' : '原表示意图，型号与适用范围以原图标注为准；不是实物照片。';
    automatic.push({ id: AUTO_CORE_IMAGE_PREFIX + image.sha256.slice(0, 24) + ':' + index,
      title: (image.sourceLabel || snapshot.shape) + (series ? '系列示意图' : '原表示意图'), attachmentId: null,
      url: 'data:image/png;base64,' + asBase64(bytes),
      notes: ['库型号：' + snapshot.model, scope, '原标注：' + (image.sourceLabel || image.alt || '待确认'),
        image.sourceModel ? '原图型号：' + image.sourceModel : '', '来源：' + (image.filename || '待确认'),
        image.sheet ? 'Sheet：' + image.sheet : '', image.anchor ? '位置：' + image.anchor : '',
        '图像SHA256：' + image.sha256, image.sourceWorkbookSha256 ? '源表SHA256：' + image.sourceWorkbookSha256 : ''].filter(Boolean).join('；') });
  }
  const result = copyDocument(document);
  result.coreSnapshot = JSON.parse(JSON.stringify(snapshot)) as CoreSnapshot;
  result.images = [...result.images.filter(image => !image.id.startsWith(AUTO_CORE_IMAGE_PREFIX)), ...automatic];
  if (documentByteLength(result) > MAX_DESIGN_DOCUMENT_BYTES) throw new Error('磁芯图与完整设计记录合计超过2MiB，请先减少附图。未复制图纸。');
  return result;
}
