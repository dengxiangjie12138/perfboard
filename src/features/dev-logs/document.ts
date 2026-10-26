import type { Node } from '@tiptap/pm/model';
import { getSchema } from '@tiptap/core';
import { normalizeLogFormatting } from './documentFormatting';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Superscript } from '@tiptap/extension-superscript';
import { Subscript } from '@tiptap/extension-subscript';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import { LogImage, LogFileAttachment } from './resourceSchema';
const logSchema = getSchema([StarterKit, TaskList, TaskItem.configure({nested:true}), TextAlign.configure({types:['heading','paragraph']}), Highlight.configure({multicolor:true}), Superscript, Subscript, TextStyle, Color, LogImage, LogFileAttachment]);
export interface LogicalLine { number: number; position: number; type: string }
/** One number per paragraph/text block or list item. The first paragraph inside
 * an item shares its item number; soft wrapping and hard breaks do not add one. */
export function collectLogicalLines(document: Node): LogicalLine[] {
 const lines: LogicalLine[] = [];
 document.descendants((node, position, parent, index) => {
  const kind = node.type.name;
  const firstItemParagraph = kind === 'paragraph' && index === 0 && !!parent && ['listItem', 'taskItem'].includes(parent.type.name);
  if (['listItem', 'taskItem'].includes(kind) || (node.isTextblock && !firstItemParagraph)) lines.push({ number: lines.length + 1, position, type: kind });
 });
 return lines;
}
export function parseStoredDocument(json: string, schemaVersion: number): object {
 if (schemaVersion !== 1) throw new Error('不支持的日志文档版本，原始内容已保留');
 const document: unknown = normalizeLogFormatting(JSON.parse(json));
 if (!document || typeof document !== 'object' || Array.isArray(document) || (document as {type?:unknown}).type !== 'doc') throw new Error('日志内容格式错误，原始内容已保留');
 try {
  const node = logSchema.nodeFromJSON(document); node.check();
  node.descendants(child => {
   if (['image', 'fileAttachment'].includes(child.type.name) && (typeof child.attrs.resourceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(child.attrs.resourceId))) throw new Error('附件引用格式错误');
  });
 } catch { throw new Error('日志内容节点结构错误，原始内容已保留'); }
 return document;
}
export function orderedMove<T extends { id: string }>(items: T[], fromId: string, toId: string): T[] {
 const from = items.findIndex(item => item.id === fromId); const to = items.findIndex(item => item.id === toId);
 if (from < 0 || to < 0 || from === to) return items;
 const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
