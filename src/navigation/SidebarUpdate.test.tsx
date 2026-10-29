import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {SidebarNav} from './SidebarNav';

const render = (version?: string | null) => renderToStaticMarkup(<SidebarNav route={{page: 'parts'}} disabled={false}
  groups={{hardware: false, stm32: false, utilities: false, notes: false}} toggleGroup={() => {}} onNavigate={() => {}}
  availableUpdateVersion={version}/>);

it('shows one accessible update indicator on the version navigation row even while viewing another page', () => {
  const html = render('0.2.0');
  expect(html.match(/class="nav-update-badge"/g)).toHaveLength(1);
  expect(html).toContain('版本与说明</span><span class="nav-update-badge"');
  expect(html).toContain('aria-label="有新版本 0.2.0"');
  expect(html).toContain('title="有新版本 0.2.0"');
});
it('does not display an update indicator before a newer version has been discovered', () => {
  expect(render(null)).not.toContain('nav-update-badge');
  expect(render()).not.toContain('nav-update-badge');
});
