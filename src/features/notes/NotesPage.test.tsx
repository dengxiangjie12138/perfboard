import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotesPage, NOTE_CATEGORIES } from './NotesPage';

vi.mock('@excalidraw/excalidraw', () => ({ Excalidraw: () => null, MainMenu: () => null, serializeAsJSON: vi.fn() }));
vi.mock('../../state/DataContext', () => ({ useData: () => ({
  data: { notes: [
    { id: 'hardware', title: '硬件记录', category: '硬件错题本', searchText: '', updatedAt: '2026-10-01' },
    { id: 'essay', title: '随笔记录', category: '随笔', searchText: '', updatedAt: '2026-10-02' },
  ] }, repo: { ready: true }, refresh: vi.fn(), notify: vi.fn(),
}) }));
vi.mock('../../services/api', () => ({ api: {}, errorMessage: String }));
afterEach(() => vi.unstubAllGlobals());
function render(category?: (typeof NOTE_CATEGORIES)[number]) {
  vi.stubGlobal('document', { documentElement: { dataset: {} }, body: { dataset: {} } });
  return renderToStaticMarkup(<NotesPage category={category} />);
}
describe('notes overview and category layout', () => {
  it('keeps the full banner and notebook panel in the overview', () => {
    const html = render();
    expect(html).toContain('IDEAS &amp; NOTES');
    expect(html).toContain('class="notes-heading"');
    expect(html).toContain('class="notes-sidebar card"');
    expect(html).toContain('class="notes-count"');
    expect(html).toContain('硬件记录');
    expect(html).toContain('随笔记录');
    expect(html).not.toContain('notes-focused-controls');
  });
  it.each(NOTE_CATEGORIES)('shares one compact canvas toolbar and modal affordances in %s', category => {
    const html = render(category);
    expect(html).toContain('notes-page-focused notes-page-compact');
    for (const removed of ['IDEAS &amp; NOTES','notes-heading','notes-sidebar','notes-count','notes-search','notes-focused-controls','notes-editor-heading']) expect(html).not.toContain(removed);
    expect(html).toContain(`aria-label="${category}笔记操作"`);
    expect(html).toContain('aria-label="编辑笔记标题和分类"');
    expect(html).not.toContain('aria-label="切换当前分类笔记"');
    expect(html).not.toContain('data-testid="note-title"');
    expect(html.match(/class="notes-toolbar"/g)).toHaveLength(1);
    expect(html).toContain('data-testid="note-edit-metadata"');
    const newAt = html.indexOf('data-testid="note-new"');
    const openAt = html.indexOf('data-testid="note-open"');
    const saveAt = html.indexOf('data-testid="note-save-metadata"');
    expect(newAt).toBeGreaterThan(-1);
    expect(openAt).toBeGreaterThan(newAt);
    expect(saveAt).toBeGreaterThan(openAt);
    expect(html).toContain('aria-label="导入本地 Excalidraw 画布"');
    expect(html).toContain('aria-label="删除笔记"');
  });
  it.each(['light','dark','codex'] as const)('keeps all category entry structures compact in the %s theme', theme => {
    for(const category of NOTE_CATEGORIES){
      vi.stubGlobal('document', {documentElement:{dataset:{theme}},body:{dataset:{}}});
      const html=renderToStaticMarkup(<NotesPage category={category}/>);
      expect(html).toContain('notes-page-compact');
      expect(html.match(/role="toolbar"/g)).toHaveLength(1);
      expect(html).not.toContain('notes-focused-controls');
      expect(html).not.toContain('notes-editor-heading');
    }
  });
});
