import { parse, stringify, isLosslessNumber } from 'lossless-json';
import type { Content, JSONParser } from 'vanilla-jsoneditor';

// Bound synchronous tree work; larger inputs remain available for manual copying.
export const MAX_JSON_LENGTH = 256 * 1024;
export const losslessParser: JSONParser = { parse, stringify };
export type Validation = { status: 'empty' | 'large' | 'invalid'; message: string } | { status: 'valid'; message: string; value: unknown };
export function validateJson(raw: string): Validation {
  if (raw.length > MAX_JSON_LENGTH) return { status: 'large', message: '原文超过 256 Ki 个字符；已暂停解析和树形编辑，请缩小文档。原文仍可复制。' };
  if (!raw.trim()) return { status: 'empty', message: '输入 JSON 后查看树形结构。' };
  try { return { status: 'valid', message: 'JSON 有效 · 数字精度完整保留', value: parse(raw) }; }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const match = /position\s+(\d+)/i.exec(detail);
    const position = match ? Number(match[1]) : undefined;
    const prefix = position === undefined ? '' : raw.slice(0, position);
    const line = prefix.split('\n').length;
    const column = prefix.length - prefix.lastIndexOf('\n');
    return { status: 'invalid', message: position === undefined ? `JSON 无效：${detail}` : `JSON 无效：第 ${line} 行，第 ${column} 列（位置 ${position}）。${detail}` };
  }
}
export type JsonOperation = 'format' | 'compact' | 'escape' | 'unescape' | 'compact-escape';
export function transformJson(raw: string, operation: JsonOperation): string {
  if (raw.length > MAX_JSON_LENGTH) throw new Error('原文超过 256 Ki 个字符，请缩小文档后操作。');
  if (operation === 'escape') return JSON.stringify(raw);
  if (operation === 'unescape') {
    const value: unknown = parse(raw);
    if (typeof value !== 'string') throw new Error('反转义需要一个完整的 JSON 字符串（包含外层双引号）。');
    return value;
  }
  const validation = validateJson(raw);
  if (validation.status !== 'valid') throw new Error(validation.message);
  const text = stringify(validation.value, undefined, operation === 'format' ? 2 : undefined);
  if (text === undefined) throw new Error('无法序列化 JSON。');
  return operation === 'compact-escape' ? JSON.stringify(text) : text;
}
export function contentToRaw(content: Content): string {
  if ('text' in content && typeof content.text === 'string') return content.text;
  if (!('json' in content)) throw new Error('编辑器未返回有效 JSON 内容。');
  const text = stringify(content.json, undefined, 2);
  if (text === undefined) throw new Error('无法序列化树形内容。');
  return text;
}
export type SearchMatch = { path: (string | number)[]; label: string };
export function searchJson(value: unknown, query: string, limit = 200): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (!query) return matches;
  const needle = query.toLocaleLowerCase();
  const stack: { value: unknown; path: (string | number)[] }[] = [{ value, path: [] }];
  while (stack.length && matches.length < limit) {
    const item = stack.pop()!;
    const key = item.path.at(-1);
    const leaf = item.value === null || typeof item.value !== 'object' || isLosslessNumber(item.value);
    if ((key !== undefined && String(key).toLocaleLowerCase().includes(needle)) || (leaf && String(item.value).toLocaleLowerCase().includes(needle))) {
      matches.push({ path: item.path, label: item.path.length ? '$' + item.path.map(part => typeof part === 'number' ? `[${part}]` : `[${JSON.stringify(part)}]`).join('') : '$' });
    }
    if (!leaf) {
      const entries = Object.entries(item.value as Record<string, unknown>);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [name, child] = entries[i];
        stack.push({ value: child, path: [...item.path, Array.isArray(item.value) ? Number(name) : name] });
      }
    }
  }
  return matches;
}
export async function copyJson(raw: string, clipboard: Pick<Clipboard, 'writeText'> | undefined): Promise<string> {
  try { if (!clipboard) throw new Error('unavailable'); await clipboard.writeText(raw); return '原文已复制。'; }
  catch { return '复制失败，请选中原文手动复制。'; }
}

