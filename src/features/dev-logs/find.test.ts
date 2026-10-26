import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { searchDocument } from '@tiptap/extension-find-and-replace';
const schema=getSchema([StarterKit]);
const options={caseSensitive:false,useRegex:false,wholeWord:false};
describe('official free FindAndReplace document search', () => {
 it('finds text across mark boundaries within the current mounted document', () => {
  const doc=schema.nodeFromJSON({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Dev '},{type:'text',marks:[{type:'bold'}],text:'log'},{type:'text',text:' ready'}]}]});
  expect(searchDocument(doc,'DEV LOG',options)).toEqual([{from:1,to:8}]);
 });
 it('does not search another page or cross paragraph boundaries', () => {
  const doc=schema.nodeFromJSON({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'page one'}]},{type:'paragraph',content:[{type:'text',text:'page two'}]}]});
  expect(searchDocument(doc,'onepage',options)).toEqual([]); expect(searchDocument(doc,'other page',options)).toEqual([]);
 });
});
