import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JsonPage } from './JsonPage';
import { JsonTree } from './JsonTree';

it('renders the Chinese toolbar and blank input without creating a browser editor during SSR', () => {
  const html = renderToStaticMarkup(<JsonPage />);
  for (const id of ['input', 'format', 'compact', 'escape', 'unescape', 'compact-escape', 'copy', 'search', 'expand', 'collapse', 'tree', 'status']) expect(html).toContain(`id="json-${id}"`);
  for (const label of ['格式化', '压缩', '转义', '反转义', '压缩并转义', '复制原文', '树形编辑']) expect(html).toContain(label);
  expect(html).toContain('等待 JSON 输入');
  expect(html).not.toContain('iframe');
  expect(html).not.toContain('18446744073709551615');
});
it('keeps the wrapper browser initialization inside effects', () => {
  const apiRef = { current: null };
  const html = renderToStaticMarkup(<JsonTree raw='{"big":18446744073709551615}' onChange={() => {}} onError={() => {}} apiRef={apiRef} />);
  expect(html).toContain('id="json-tree"');
  expect(apiRef.current).toBeNull();
});
