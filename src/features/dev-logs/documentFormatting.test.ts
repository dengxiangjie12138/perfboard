import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight } from '@tiptap/extension-highlight';
import { Fragment, Slice } from '@tiptap/pm/model';
import { normalizeLogColor, normalizeLogFormatting, normalizePastedLogSlice } from './documentFormatting';
import { parseStoredDocument } from './document';
const schema = getSchema([StarterKit, TaskList, TaskItem.configure({nested:true}), TextStyle, Color, TextAlign.configure({types:['paragraph','heading']}), Highlight.configure({multicolor:true})]);
const text = (text: string, marks: object[] = []) => ({type:'text',text,marks});
const paragraph = (...content: object[]) => ({type:'paragraph',attrs:{textAlign:null},content});
const sample = {type:'doc',content:[paragraph(text('first', [{type:'textStyle',attrs:{color:'var(--color-fg-default)'}},{type:'bold'}]),{type:'hardBreak'},text('second', [{type:'code'}])),{type:'bulletList',content:[{type:'listItem',content:[paragraph(text('item', [{type:'textStyle',attrs:{color:'var(--color-fg-default)'}}]))]}]},paragraph()]};
// Compare all body nodes/text/line breaks and supported formatting without storing private text in fixtures.
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
describe('pasted log presentation normalization', () => {
 it('removes unsupported color only, retaining every text node, newline, list and supported mark', () => {
  const original = JSON.stringify(sample);
  const result = parseStoredDocument(original, 1);
  expect(body(result)).toEqual(body(sample)); expect(emphasis(result)).toEqual(emphasis(sample));
  expect(JSON.stringify(result)).not.toContain('var('); expect(JSON.stringify(sample)).toBe(original);
  expect(normalizeLogFormatting(result)).toEqual(result);
 });
 it('preserves supported color and link metadata, and makes unknown or unsafe formatting plain text', () => {
  const supported = {type:'link',attrs:{href:'https://example.com',target:'_blank',title:'Reference',class:'docs',rel:null}};
  const doc = {type:'doc',content:[paragraph(text('styles', [{type:'textStyle',attrs:{color:'rgb(18, 52, 86)',fontFamily:'external'}},{type:'bold',attrs:{unsupported:true}},{type:'externalStyle'},{type:'highlight',attrs:{color:'var(--background)'}},{type:'link',attrs:{href:'javascript:alert(1)'}},supported]))]};
  const result = normalizeLogFormatting(doc) as typeof doc;
  expect(result.content[0].content).toEqual([text('styles',[{type:'textStyle',attrs:{color:'#123456'}},{type:'bold'},supported])]);
  expect(body(result)).toEqual(body(doc));
 });
 it.each([['#AbC','#AbC'],['#abcdef','#abcdef'],['rgba(12, 34, 56, 1.0)','#0c2238'],['rgb(300, 1, 2)',undefined],['rgba(0,0,0,0.5)',undefined],['var(--color-fg-default)',undefined]])('normalizes color %s consistently with storage', (input, expected) => { expect(normalizeLogColor(input)).toBe(expected); });
 it('cleans the actual clipboard Slice hook without changing partial paragraph/list boundaries', () => {
  const doc = schema.nodeFromJSON(sample);
  for (const slice of [new Slice(Fragment.from(doc), 0, 0), doc.slice(2, doc.content.size - 2)]) {
   const cleaned = normalizePastedLogSlice(slice,schema);
   expect(cleaned.openStart).toBe(slice.openStart); expect(cleaned.openEnd).toBe(slice.openEnd);
   expect(body(cleaned.toJSON())).toEqual(body(slice.toJSON())); expect(emphasis({content:cleaned.content.toJSON()})).toEqual(emphasis({content:slice.content.toJSON()}));
   expect(JSON.stringify(cleaned.toJSON())).not.toContain('var(');
  }
 });
 it('still refuses malformed body structure and unknown versions instead of replacing the document', () => {
  expect(() => parseStoredDocument('{"type":"doc","content":[{"type":"unknownNode","text":"preserve me"}]}',1)).toThrow('原始内容已保留');
  expect(() => parseStoredDocument(JSON.stringify(sample),2)).toThrow('原始内容已保留');
 });
});
