import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { wrapInList, splitListItem } from '@tiptap/pm/schema-list';
import { collectLogicalLines, orderedMove, parseStoredDocument } from './document';
const schema=getSchema([StarterKit,TaskList,TaskItem.configure({nested:true})]);
const paragraph = (text='') => ({type:'paragraph',content:text ? [{type:'text',text}] : []});
describe('log document gutter and editor structure', () => {
 it('numbers logical paragraphs and nested list items in document order', () => {
  const document=schema.nodeFromJSON({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'very long text '.repeat(100)},{type:'hardBreak'},{type:'text',text:'same paragraph'}]},{type:'bulletList',content:[{type:'listItem',content:[paragraph('one'),{type:'orderedList',content:[{type:'listItem',content:[paragraph('nested')]}]}]},{type:'listItem',content:[paragraph('two')]}]},{type:'taskList',content:[{type:'taskItem',attrs:{checked:true},content:[paragraph('checked')]}]},paragraph('final')]});
  const lines=collectLogicalLines(document); expect(lines.map(line => line.number)).toEqual([1,2,3,4,5,6]); expect(lines.map(line => line.type)).toEqual(['paragraph','listItem','listItem','listItem','taskItem','paragraph']); expect(JSON.stringify(document.toJSON())).not.toContain('lineNumber');
 });
 it('counts an empty paragraph and softwrapped content once, independently of viewport width', () => {
  const document=schema.nodeFromJSON({type:'doc',content:[paragraph(),paragraph('word '.repeat(1000))]}); expect(collectLogicalLines(document)).toHaveLength(2);
 });
 it.each(['bulletList','orderedList'])('continues %s with Enter list-item splitting', type => {
  let state=EditorState.create({schema,doc:schema.nodeFromJSON({type:'doc',content:[paragraph('item')]})});
  expect(wrapInList(schema.nodes[type])(state,transaction => {state=state.apply(transaction)})).toBe(true);
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,7)));
  expect(splitListItem(schema.nodes.listItem)(state,transaction => {state=state.apply(transaction)})).toBe(true); expect(state.doc.firstChild?.childCount).toBe(2);
 });
 it('keeps independent undo histories for different editor instances', () => {
  const doc=schema.nodeFromJSON({type:'doc',content:[paragraph()]}); let first=EditorState.create({schema,doc,plugins:[history()]}); let second=EditorState.create({schema,doc,plugins:[history()]}); first=first.apply(first.tr.insertText('A',1)); second=second.apply(second.tr.insertText('B',1));
  expect(undo(first,transaction => {first=first.apply(transaction)})).toBe(true); expect(first.doc.textContent).toBe(''); expect(second.doc.textContent).toBe('B');
 });
 it('fails closed for unsupported schema versions without transforming original data', () => { expect(() => parseStoredDocument('{"type":"doc"}',2)).toThrow('原始内容已保留'); expect(() => parseStoredDocument('{"type":"excalidraw"}',1)).toThrow('原始内容已保留'); });
 it('moves entries immutably and ignores IDs outside the sibling group', () => { const values=[{id:'a'},{id:'b'},{id:'c'}]; expect(orderedMove(values,'c','a').map(value => value.id)).toEqual(['c','a','b']); expect(values.map(value => value.id)).toEqual(['a','b','c']); expect(orderedMove(values,'outside','b')).toBe(values); });
});

it('reads older href-only links and current Tiptap metadata without rewriting the original document', () => {
 const current = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, schema.text('reference', [schema.marks.link.create({href:'https://example.com',class:'reference-link',title:'Documentation'})]))]).toJSON();
 expect(current.content?.[0].content?.[0].marks?.[0].attrs).toEqual({href:'https://example.com',target:'_blank',rel:'noopener noreferrer nofollow',class:'reference-link',title:'Documentation'});
 const legacy = {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'old reference',marks:[{type:'link',attrs:{href:'http://example.com/legacy'}}]}]}]};
 for(const original of [legacy,current]) expect(parseStoredDocument(JSON.stringify(original),1)).toEqual(original);
});
