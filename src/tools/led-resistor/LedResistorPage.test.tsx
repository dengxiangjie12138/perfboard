import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LedResistorPage } from './LedResistorPage';
vi.mock('../../state/DataContext', () => ({ useData: () => ({ data: { parts: [] } }) }));
it.each(['light', 'dark', 'codex'])('renders shared theme-compatible LED fields and schematic in %s', theme => {
  const html = renderToStaticMarkup(<div data-theme={theme}><LedResistorPage /></div>);
  for (const id of ['supply', 'forward', 'current', 'count', 'margin', 'source', 'calculate']) expect(html).toContain(`id="led-${id}"`);
  expect(html).toContain('LED 限流电阻'); expect(html).toContain('电源、串联 LED 与限流电阻电路');
  expect(html).toContain('不能保证绝对不超流'); expect(html).toContain('10 Ω–1 MΩ');
});
