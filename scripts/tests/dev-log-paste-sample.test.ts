import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Slice } from '@tiptap/pm/model';
import { normalizePastedLogSlice } from '../../src/features/dev-logs/documentFormatting';
import { parseStoredDocument } from '../../src/features/dev-logs/document';
const schema = getSchema([StarterKit, TaskList, TaskItem.configure({nested:true}), TextStyle, Color, TextAlign.configure({types:['paragraph','heading']}), Highlight.configure({multicolor:true})]);
function body(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(body);
 if (!value || typeof value !== 'object') return value;
 return Object.fromEntries(Object.entries(value).filter(([key]) => !['attrs','marks'].includes(key)).map(([key,val]) => [key,body(val)]));
}
function emphasis(value: unknown): unknown[] {
 if (!value || typeof value !== 'object') return [];
 const node = value as {text?:string;marks?:{type:string}[];content?:unknown[]};
 return [...(node.marks?.filter(mark => ['bold','code'].includes(mark.type)).map(mark => [node.text,mark.type]) ?? []), ...(node.content?.flatMap(emphasis) ?? [])];
}
it.skipIf(!process.env.PERFBOARD_PASTE_SAMPLE)('regresses the actual externally supplied pasted document without checking its contents into git', () => {
  const original = JSON.parse(readFileSync(process.env.PERFBOARD_PASTE_SAMPLE!, 'utf8'));
  expect(original.content).toHaveLength(56);
  expect(JSON.stringify(original).match(/var\(--color-fg-default\)/g)).toHaveLength(53);
  const normalized = parseStoredDocument(JSON.stringify(original),1);
  expect(body(normalized)).toEqual(body(original)); expect(emphasis(normalized)).toEqual(emphasis(original));
  expect(JSON.stringify(normalized)).not.toContain('var(');
  const pasted = normalizePastedLogSlice(new Slice(schema.nodeFromJSON(original).content,0,0),schema);
  expect(body(pasted.content.toJSON())).toEqual(body(schema.nodeFromJSON(original).content.toJSON()));
  expect(emphasis({content:pasted.content.toJSON()})).toEqual(emphasis(original));
 });
