import { Fragment, Slice, type Node, type Schema } from '@tiptap/pm/model';
import { validImageDisplayWidth } from './imageSizing';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
const marks = new Set(['bold', 'italic', 'strike', 'code', 'underline', 'superscript', 'subscript', 'textStyle', 'highlight', 'link']);
const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** Storage uses opaque hex colors. Browsers serialize copied hex colors as RGB. */
export function normalizeLogColor(value: unknown): string | undefined {
 if (typeof value !== 'string') return;
 if (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return value;
 const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(1(?:\.0+)?)\s*)?\)$/i.exec(value);
 if (!rgb || /^(rgba)/i.test(value) !== (rgb[4] !== undefined)) return;
 const channels = rgb.slice(1, 4).map(Number);
 if (channels.some(channel => channel > 255)) return;
 return '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
}
function safeLink(value: unknown): boolean {
 if (typeof value !== 'string') return false;
 try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password; } catch { return false; }
}
function optionalLinkText(value: unknown, maxBytes: number): boolean {
 // Reject control characters in pasted link metadata, matching the storage validator.
 // eslint-disable-next-line no-control-regex
 return value === null || (typeof value === 'string' && byteLength(value) <= maxBytes && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value));
}
function validNodeAttribute(kind: unknown, key: string, value: unknown): boolean {
 if ((kind === 'image' || kind === 'fileAttachment') && key === 'resourceId') return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
 if (kind === 'image' && key === 'displayWidth') return validImageDisplayWidth(value);
 if (key === 'textAlign' && (kind === 'paragraph' || kind === 'heading')) return value === null || ['left', 'center', 'right', 'justify'].includes(value as string);
 if (kind === 'heading' && key === 'level') return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 6;
 if (kind === 'orderedList' && key === 'start') return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 1_000_000;
 if (kind === 'orderedList' && key === 'type') return value === null || ['1', 'a', 'A', 'i', 'I'].includes(value as string);
 if (kind === 'taskItem' && key === 'checked') return typeof value === 'boolean';
 if (kind === 'codeBlock' && key === 'language') return value === null || (typeof value === 'string' && byteLength(value) < 100);
 return false;
}
function normalizeMark(value: unknown): JsonObject | undefined {
 if (!object(value) || typeof value.type !== 'string' || !marks.has(value.type)) return;
 const kind = value.type;
 const source = object(value.attrs) ? value.attrs : {};
 const attrs: JsonObject = {};
 if (kind === 'textStyle' || kind === 'highlight') {
  if (source.color === null) attrs.color = null;
  else if (source.color !== undefined) {
   const color = normalizeLogColor(source.color);
   if (!color) return; // Unsupported color becomes ordinary text, not a default highlight.
   attrs.color = color;
  }
  if (kind === 'textStyle' && !attrs.color) return;
 } else if (kind === 'link') {
  if (!safeLink(source.href)) return;
  attrs.href = source.href;
  if (source.target === null || ['_blank', '_self'].includes(source.target as string)) attrs.target = source.target;
  for (const [key, limit] of [['rel', 99], ['class', 512], ['title', 2048]] as const) if (optionalLinkText(source[key], limit)) attrs[key] = source[key];
 }
 return Object.keys(attrs).length ? { type: kind, attrs } : { type: kind };
}
/** Remove only unsupported presentation. Never flatten/drop body nodes or line breaks.
 * Structural errors and unknown document versions still fail explicitly on load/save. */
export function normalizeLogFormatting(value: unknown, depth = 0): unknown {
 if (depth > 64) throw new Error('日志文档结构过大或嵌套过深');
 if (!object(value)) return value;
 const result: JsonObject = { ...value };
 if ('attrs' in value) result.attrs = object(value.attrs) ? Object.fromEntries(Object.entries(value.attrs).filter(([key, val]) => validNodeAttribute(value.type, key, val))) : {};
 if (Array.isArray(value.marks)) result.marks = value.marks.map(normalizeMark).filter(mark => mark !== undefined);
 if (Array.isArray(value.content)) result.content = value.content.map(child => normalizeLogFormatting(child, depth + 1));
 return result;
}
/** Runs after ProseMirror has parsed clipboard HTML, preserving open list/paragraph slices. */
export function normalizePastedLogSlice(slice: Slice, schema: Schema): Slice {
 const content: Node[] = [];
 slice.content.forEach(node => content.push(schema.nodeFromJSON(normalizeLogFormatting(node.toJSON()))));
 return new Slice(Fragment.fromArray(content), slice.openStart, slice.openEnd);
}
