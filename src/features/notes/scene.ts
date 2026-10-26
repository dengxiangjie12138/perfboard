import type { BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
export const EMPTY_SCENE = JSON.stringify({ type: 'excalidraw', version: 2, source: 'Perfboard', elements: [], appState: {}, files: {} });
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
function dataUrlParts(value: string): { mime: string; parameters: string[]; payload: string } | null {
  const comma = value.indexOf(',');
  if (comma < 0 || !value.toLowerCase().startsWith('data:')) return null;
  const [mime, ...parameters] = value.slice(5, comma).toLowerCase().split(';');
  return { mime, parameters, payload: value.slice(comma + 1) };
}
export function decodeSvgDataUrl(value: string): string | null {
  const parts = dataUrlParts(value);
  if (!parts || parts.mime !== 'image/svg+xml' || parts.parameters.some(parameter => parameter !== 'base64' && !/^charset=(?:utf-8|utf8|us-ascii)$/.test(parameter))) return null;
  try {
    if (!parts.parameters.includes('base64')) return decodeURIComponent(parts.payload);
    const bytes = Uint8Array.from(atob(parts.payload), character => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
}
function isEmbeddedBinary(value: string, fonts = false): boolean {
  const parts = dataUrlParts(value);
  if (!parts || !parts.parameters.includes('base64') || parts.parameters.some(parameter => parameter !== 'base64' && !/^charset=(?:utf-8|utf8|us-ascii)$/.test(parameter))) return false;
  return /^image\/(?:png|jpeg|gif|webp|bmp|avif|x-icon)$/.test(parts.mime) || (fonts && /^(?:font\/(?:woff2?|ttf|otf|sfnt)|application\/(?:font-woff|x-font-woff|x-font-ttf|x-font-opentype))$/.test(parts.mime));
}
function isLocalResource(value: string): boolean {
  const trimmed = value.trim();
  return /^#[^\s'"()<>\\]+$/u.test(trimmed) || isEmbeddedBinary(trimmed, true);
}
/** CSS escape sequences and comments are refused so resource tokens cannot be hidden. */
function isLocalCss(value: string): boolean {
  if (/\\|\/\*|@import\b|\b(?:image(?:-set)?|src|attr)\s*\(/i.test(value)) return false;
  const starts = value.match(/\burl\s*\(/gi) ?? [];
  const urls = [...value.matchAll(/\burl\s*\(([^)]*)\)/gi)];
  if (starts.length !== urls.length) return false;
  return urls.every(match => {
    let resource = match[1].trim();
    if (resource.startsWith('"') || resource.startsWith("'")) {
      if (resource.length < 2 || resource.at(-1) !== resource[0]) return false;
      resource = resource.slice(1, -1);
    } else if (/['"]/.test(resource)) return false;
    return isLocalResource(resource);
  });
}
/** Parse inert XML, then inspect every node and attribute before the SVG reaches an image. */
export function isSelfContainedSvg(value: string): boolean {
  const xml = decodeSvgDataUrl(value);
  if (xml === null || /<!DOCTYPE/i.test(xml) || typeof DOMParser === 'undefined') return false;
  try {
    const document = new DOMParser().parseFromString(xml, 'image/svg+xml');
    if (document.doctype || document.getElementsByTagName('parsererror').length || document.documentElement.localName !== 'svg' || document.documentElement.namespaceURI !== SVG_NAMESPACE) return false;
    const pending: Node[] = [document];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.nodeType === 7 || node.nodeType === 10) return false; // PI and document type.
      pending.push(...Array.from(node.childNodes));
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      const name = element.localName.toLowerCase();
      if (element.namespaceURI !== SVG_NAMESPACE || ['script', 'foreignobject', 'handler', 'listener', 'animate', 'animatemotion', 'animatetransform', 'set'].includes(name)) return false;
      if (name === 'style' && !isLocalCss(element.textContent ?? '')) return false;
      for (const attribute of Array.from(element.attributes)) {
        const attributeName = attribute.localName.toLowerCase();
        if (attributeName.startsWith('on') || attribute.name.toLowerCase() === 'xml:base' || (attribute.namespaceURI === 'http://www.w3.org/XML/1998/namespace' && attributeName === 'base')) return false;
        if ((attributeName === 'href' || attributeName === 'src') && !isLocalResource(attribute.value)) return false;
        if (attributeName === 'style' || /url\s*\(|\\|\/\*/i.test(attribute.value)) {
          if (!isLocalCss(attribute.value)) return false;
        }
      }
    }
    return true;
  } catch { return false; }
}
/** Only self-contained images are allowed; original file data URLs are retained byte-for-byte. */
export function sanitizeScene(json: string): { scene: ExcalidrawInitialDataState; removed: number } {
  const input = JSON.parse(json) as Record<string, unknown>;
  if (!input || typeof input !== 'object' || !Array.isArray(input.elements)) throw new Error('笔记画布格式无效，请检查 .excalidraw 文件。');
  let removed = 0;
  const elements = input.elements.filter((value: unknown) => {
    if (!value || typeof value !== 'object') { removed++; return false; }
    const type = (value as { type?: string }).type;
    if (type === 'iframe' || type === 'embeddable') { removed++; return false; }
    return true;
  }) as ExcalidrawElement[];
  const files: BinaryFiles = {};
  if (input.files && typeof input.files === 'object') {
    for (const [id, value] of Object.entries(input.files)) {
      const dataURL = value && typeof value === 'object' ? (value as { dataURL?: unknown }).dataURL : null;
      if (typeof dataURL === 'string' && (isEmbeddedBinary(dataURL) || isSelfContainedSvg(dataURL))) files[id] = value as BinaryFiles[string];
      else removed++;
    }
  }
  const appState = input.appState && typeof input.appState === 'object' ? input.appState as ExcalidrawInitialDataState['appState'] : {};
  return { scene: { elements, appState: { ...appState, activeTool: { type: 'selection', customType: null, locked: false, lastActiveTool: null }, openDialog: null, openSidebar: null }, files }, removed };
}
/** A stored scene must never become an editable, lossy filtered replacement. */
export function restoreStoredScene(json: string): ExcalidrawInitialDataState {
  const restored = sanitizeScene(json);
  if (restored.removed) throw new Error(`画布含 ${restored.removed} 个无法安全恢复的内容，已阻止编辑和覆盖。原始数据库内容未修改，请导出原始 JSON 检查或恢复。`);
  return restored.scene;
}
export function sceneSearchText(elements: readonly ExcalidrawElement[]): string {
  return elements.filter(element => !element.isDeleted && element.type === 'text').map(element => element.type === 'text' ? element.text : '').join('\n');
}