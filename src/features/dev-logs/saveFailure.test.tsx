import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { logApi } from './api';
import { LogAutosave, type LogSaveEvent } from './autosave';
import { LogSaveIndicator } from './LogSaveIndicator';
import type { LogPage } from './contracts';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const base: LogPage = {id:'p',projectId:'project',title:'Day',documentJson:'{"type":"doc","content":[{"type":"paragraph"}]}',schemaVersion:1,revision:4,position:0,deletedAt:null,createdAt:'date',updatedAt:'date'};
const schema = getSchema([StarterKit]);
const link = schema.marks.link.create({href:'https://example.com/spec.pdf'});
const linkedJson = JSON.stringify(schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, schema.text('specification', [link]))]).toJSON());
afterEach(() => { invoke.mockReset(); vi.useRealTimers(); });
function indicator(event: LogSaveEvent, dirty: boolean) { return renderToStaticMarkup(<LogSaveIndicator event={event} pageId="p" dirty={dirty} automatic/>); }

it('keeps the actual rejected native save dirty and visibly failed until a successful retry', async () => {
 vi.useFakeTimers();
 const events: LogSaveEvent[] = [];
 const autosave = new LogAutosave(logApi.savePage, event => events.push(event));
 autosave.adopt(base); autosave.queue({...base,documentJson:linkedJson});
 invoke.mockRejectedValueOnce('文本格式属性无效');
 await expect(autosave.flush('p')).rejects.toBe('文本格式属性无效');
 expect(invoke).toHaveBeenLastCalledWith('dev_log_page_save', {input:{id:'p',expectedRevision:4,title:'Day',documentJson:linkedJson,schemaVersion:1}});
 expect(autosave.isDirty('p')).toBe(true);
 expect(autosave.draft('p')?.documentJson).toBe(linkedJson);
 expect(autosave.draft('p')?.revision).toBe(4);
 expect(events.some(event => event.status === 'saved')).toBe(false);
 const failure = indicator(events.at(-1)!, autosave.isDirty('p'));
 expect(failure).toContain('保存失败，草稿保留在当前页');
 expect(failure).not.toContain('已保存');
 invoke.mockResolvedValueOnce({...base,documentJson:linkedJson,revision:5});
 await autosave.flush('p');
 expect(autosave.isDirty('p')).toBe(false);
 expect(events.at(-1)?.status).toBe('saved');
 expect(indicator(events.at(-1)!, false)).toContain('已保存');
});

it('does not label a partly saved queue as saved when the next native write fails', async () => {
 vi.useFakeTimers();
 let complete: ((page: LogPage) => void) | undefined;
 invoke.mockImplementationOnce(() => new Promise<LogPage>(resolve => { complete = resolve; })).mockRejectedValueOnce('文本格式属性无效');
 const events: LogSaveEvent[] = [];
 const autosave = new LogAutosave(logApi.savePage, event => events.push(event));
 autosave.adopt(base); autosave.queue({...base,title:'first'});
 const flushing = autosave.flush('p'); await Promise.resolve();
 autosave.queue({...base,title:'second',documentJson:linkedJson});
 complete!({...base,title:'first',revision:5});
 await expect(flushing).rejects.toBe('文本格式属性无效');
 expect(invoke.mock.calls.map(([,args]) => [args.input.title,args.input.expectedRevision])).toEqual([['first',4],['second',5]]);
 expect(autosave.draft('p')?.title).toBe('second');
 expect(autosave.draft('p')?.documentJson).toBe(linkedJson);
 expect(autosave.isDirty('p')).toBe(true);
 expect(events.some(event => event.status === 'saved')).toBe(false);
 expect(indicator(events.at(-1)!, true)).not.toContain('已保存');
});

it('renders the current draft as unsaved when a previous saved event is stale', () => {
 expect(indicator({id:'p',status:'saved'}, true)).toContain('等待保存');
 expect(indicator({id:'other-page',status:'saved'}, false)).toContain('已载入');
 expect(renderToStaticMarkup(<LogSaveIndicator event={{id:'p',status:'saved'}} pageId="p" dirty automatic={false}/>)).toContain('未保存');
});
