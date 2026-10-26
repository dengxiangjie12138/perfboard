import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoreLibraryPage } from './CoreLibraryPage';
import { coreLibrary, coreLibraryAudit, coreRecords } from './library';

describe('core library filter options', () => {
  it('starts with filters and presents specific models with full original provenance', () => {
    const markup = renderToStaticMarkup(createElement(CoreLibraryPage));
    expect(markup).toMatch(/^<section class="core-library"><div class="core-filters">/);
    expect(markup).not.toContain('<h1>');
    expect(markup).not.toContain('page-heading');
    expect(markup).toContain(coreLibraryAudit.modelCount + ' 个结果');
    expect(markup).toContain('选择具体磁芯型号');
    const detail = renderToStaticMarkup(createElement(CoreLibraryPage, { initialCoreId: coreRecords[0].id }));
    expect(detail).toContain(coreLibrary.source.filename);
    expect(detail).toContain(coreLibrary.source.sha256);
  });
  it('filters by distinct shapes and retains original category labels in source details', () => {
    const markup = renderToStaticMarkup(createElement(CoreLibraryPage));
    for (const shape of ['EE', 'EF', 'EFD', 'ETD', 'PQ']) {
      expect(markup).toContain(`<option value="${shape}">${shape}</option>`);
    }
    const detail = renderToStaticMarkup(createElement(CoreLibraryPage, { initialCoreId: 'Sheet1:133' }));
    expect(detail).toContain('TYPE  PQ  CORE');
    for (const material of new Set(coreRecords.map(record => String(record.values[1])))) {
      expect(markup).toContain(`<option value="${material}">${material}</option>`);
    }
  });
});