"""Version panels and live system themes in an isolated native WebView.
Uses CDP media emulation only; never changes Windows appearance or user data.
"""
from pathlib import Path
import json
import os
import subprocess
import sys
import time
import urllib.request
import websocket

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from cdp_client import CDP

EXE = ROOT / 'src-tauri/target/debug/perfboard.exe'
assert b'com.perfboard.log-pdf-qa' in EXE.read_bytes(), 'Build the isolated QA identifier first'
OUT = ROOT / '.quality' / ('settings-layout-theme-native-' + time.strftime('%Y%m%d-%H%M%S'))
OUT.mkdir(parents=True)
env = os.environ.copy()
env['PERFBOARD_TEST_CONFIG_DIR'] = str(OUT / 'config')
env['WEBVIEW2_USER_DATA_FOLDER'] = str(OUT / 'profile')
env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=9351 --remote-allow-origins=*'
log = (OUT / 'native.log').open('wb')
checks, clients = [], []
process, c = None, None


def check(name, condition):
    checks.append({'name': name, 'passed': bool(condition)})
    (OUT / 'checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
    if not condition:
        raise AssertionError(name)


def inv(command, args=None, client=None):
    return (client or c).evaluate('window.__TAURI_INTERNALS__.invoke(' + json.dumps(command) + ',' + json.dumps(args or {}) + ')')


def click(selector):
    c.evaluate('document.querySelector(' + json.dumps(selector) + ').click()')


def go(label, selector):
    c.evaluate('''(() => {const b=[...document.querySelectorAll('.sidebar button')].find(b=>b.textContent.trim()===''' + json.dumps(label) + ''');if(!b||b.disabled)throw Error('Navigation unavailable');b.click();})()''')
    c.wait('Boolean(document.querySelector(' + json.dumps(selector) + '))')
    c.wait("!document.querySelector('.sidebar button:disabled')")


def media(value):
    c.call('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-color-scheme', 'value': value}]})
    c.wait("matchMedia('(prefers-color-scheme: dark)').matches===" + str(value == 'dark').lower())


def theme(value, client=None):
    (client or c).wait('document.documentElement.dataset.theme===' + json.dumps(value))


def choose(value, resolved):
    click('[data-theme-choice=' + value + ']')
    c.wait('document.querySelector("[data-theme-choice=' + value + ']").getAttribute("aria-pressed")==="true"')
    c.wait("!document.querySelector('[data-theme-choice]:disabled')")
    theme(resolved)


def start():
    global process, c
    process = subprocess.Popen([str(EXE), '--autostart'], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    c = CDP(9351)
    c.wait("Boolean(document.querySelector('.sidebar')) && !document.querySelector('.sidebar button:disabled')")


def stop():
    global c, process
    try:
        inv('app_close_request', {'action': 'quit'})
    except websocket.WebSocketConnectionClosedException:
        pass
    c.close()
    c = None
    process.wait(timeout=20)
    process = None


def child_client():
    until = time.time() + 15
    while time.time() < until:
        pages = json.load(urllib.request.urlopen('http://127.0.0.1:9351/json/list', timeout=2))
        page = next((p for p in pages if 'radix' in p.get('url', '') and p.get('type') == 'page'), None)
        if page:
            client = CDP.__new__(CDP)
            client.port, client.seq, client.events = 9351, 0, []
            client.ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=40, suppress_origin=True)
            client.call('Runtime.enable')
            client.wait("Boolean(document.querySelector('[data-testid=radix-width]'))")
            clients.append(client)
            return client
        time.sleep(.1)
    raise RuntimeError('Isolated child not found')


try:
    start()
    check('fresh QA profile has no configured repository', not inv('repo_status')['configured'])
    go('软件设置', '[data-theme-choice=system]')
    check('four appearance choices are available', c.evaluate("document.querySelectorAll('[data-theme-choice]').length===4"))
    media('dark')
    choose('system', 'dark')
    check('system preference works without a repository', inv('app_theme_get') == 'dark')
    media('light')
    theme('light')
    check('live system change retains selected system preference', c.evaluate("document.querySelector('[data-theme-choice=system]').getAttribute('aria-pressed')==='true'"))
    for value in ['light', 'dark', 'codex']:
        choose(value, value)
        media('dark')
        media('light')
        theme(value)
        check('manual ' + value + ' ignores system changes', c.evaluate('document.documentElement.dataset.theme===' + json.dumps(value)))
    choose('system', 'light')
    c.screenshot(OUT / 'appearance-system-light.png')
    stop()
    start()
    go('软件设置', '[data-theme-choice=system]')
    media('dark')
    theme('dark')
    check('system preference survives restart without a repository', c.evaluate("document.querySelector('[data-theme-choice=system]').getAttribute('aria-pressed')==='true'"))

    repository = OUT / 'synthetic-repository'
    inv('repo_open', {'path': str(repository), 'create': True})
    c.wait("Boolean(document.querySelector('.status-dot.connected'))")
    check('connected warehouse is synthetic', str(OUT).lower().replace('\\', '/') in inv('repo_status')['path'].lower().replace('\\', '/'))
    go('软件设置', '[data-theme-choice=system]')
    choose('system', 'dark')
    check('repository stores system preference rather than resolved dark', inv('data_snapshot')['settings'].get('theme') == 'system')
    inv('tool_window_open', {'toolId': 'radix'})
    child = child_client()
    theme('dark', child)
    check('new independent window receives resolved theme', inv('app_theme_get', client=child) == 'dark')
    media('light')
    theme('light')
    theme('light', child)
    check('existing independent window follows live change', child.evaluate("document.body.dataset.theme==='light' && !document.body.classList.contains('dark')"))
    choose('codex', 'codex')
    theme('codex', child)
    media('dark')
    media('light')
    check('manual Codex is retained in both windows', c.evaluate("document.body.classList.contains('codex')") and child.evaluate("document.body.classList.contains('codex')"))
    choose('system', 'light')
    theme('light', child)
    inv('tool_window_close_request', client=child)
    child.close()

    go('版本与说明', '.version-toggle')
    check('version initially remains collapsed', c.evaluate("document.querySelector('.version-toggle').getAttribute('aria-expanded')==='false'"))
    click('.version-toggle')
    c.wait("document.querySelector('.version-toggle').getAttribute('aria-expanded')==='true'")
    layout = c.evaluate('''(() => {const groups=[...document.querySelectorAll('.version-change-group')];return groups.map(g=>{const s=g.querySelector('.version-change-scroll');return {height:g.getBoundingClientRect().height,width:g.clientWidth,scroll:s.scrollHeight,client:s.clientHeight,overflow:getComputedStyle(s).overflowY,tab:s.tabIndex,horizontal:s.scrollWidth>s.clientWidth};});})()''')
    (OUT / 'panel-layout.json').write_text(json.dumps(layout, indent=2), encoding='utf-8')
    check('four panels have equal fixed heights', len(layout) == 4 and max(p['height'] for p in layout) - min(p['height'] for p in layout) < 1)
    check('each panel scrolls independently and is keyboard reachable', all(p['overflow'] == 'auto' and p['tab'] == 0 for p in layout))
    check('long sections overflow inside their panels', sum(p['scroll'] > p['client'] for p in layout) >= 2)
    check('no panel clips text horizontally', all(not p['horizontal'] for p in layout))
    c.screenshot(OUT / 'version-light.png')
    metrics = c.evaluate('''(() => {const g=document.querySelector('.version-change-group'),s=g.querySelector('.version-change-scroll'),h=g.querySelector('h3');const before=h.getBoundingClientRect().top;const others=[...document.querySelectorAll('.version-change-scroll')].slice(1).map(s=>s.scrollTop);s.scrollTop=s.scrollHeight;return {before,after:h.getBoundingClientRect().top,scroll:s.scrollTop,others,now:[...document.querySelectorAll('.version-change-scroll')].slice(1).map(s=>s.scrollTop)};})()''')
    check('scrolling content keeps heading and other panels still', metrics['scroll'] > 0 and metrics['before'] == metrics['after'] and metrics['others'] == metrics['now'])
    c.evaluate("document.querySelector('.main-content').scrollTop=0")
    rect = c.evaluate("(() => {const r=document.querySelector('.version-change-scroll').getBoundingClientRect();return {x:r.x+20,y:r.y+30};})()")
    c.call('Input.dispatchMouseEvent', {'type': 'mouseWheel', 'x': rect['x'], 'y': rect['y'], 'deltaY': 600, 'deltaX': 0})
    time.sleep(.4)
    check('wheel at panel bottom does not move outer page', c.evaluate("document.querySelector('.main-content').scrollTop===0"))
    media('dark')
    theme('dark')
    check('system theme resolves to concrete dark on version page', c.evaluate("document.body.classList.contains('dark') && document.documentElement.dataset.theme==='dark'"))
    c.screenshot(OUT / 'version-dark.png')
    c.call('Emulation.setDeviceMetricsOverride', {'width': 860, 'height': 600, 'deviceScaleFactor': 1, 'mobile': False})
    check('narrow layout uses one column with bounded panels', c.evaluate("getComputedStyle(document.querySelector('.version-changes')).gridTemplateColumns.split(' ').length===1 && [...document.querySelectorAll('.version-change-group')].every(g=>g.getBoundingClientRect().height<=300)"))
    c.screenshot(OUT / 'version-narrow.png')
    c.call('Emulation.clearDeviceMetricsOverride')
    go('开发日志', '[data-testid=dev-logs-page]')
    check('editor receives resolved dark theme', c.evaluate("document.querySelector('[data-testid=dev-logs-page]').classList.contains('dark')"))
    media('light')
    theme('light')
    c.wait("!document.querySelector('[data-testid=dev-logs-page]').classList.contains('dark')")
    check('editor follows live system light', inv('data_snapshot')['settings'].get('theme') == 'system')
    stop()
    start()
    go('软件设置', '[data-theme-choice=system]')
    media('dark')
    theme('dark')
    check('repository system choice survives exit and reopen', inv('data_snapshot')['settings'].get('theme') == 'system' and c.evaluate("document.querySelector('[data-theme-choice=system]').getAttribute('aria-pressed')==='true'"))
    check('no uncaught runtime exceptions', not any(e.get('method') == 'Runtime.exceptionThrown' for e in c.events))
    stop()
    print(json.dumps({'output': str(OUT), 'passed': len(checks)}, ensure_ascii=False), flush=True)
except Exception:
    if c:
        try:
            c.screenshot(OUT / 'failure.png')
            (OUT / 'failure.json').write_text(json.dumps(c.evaluate('({text:document.body.innerText,theme:document.documentElement.dataset.theme})'), ensure_ascii=False), encoding='utf-8')
        except Exception:
            pass
    print('Evidence: ' + str(OUT), flush=True)
    raise
finally:
    for client in clients:
        try:
            client.close()
        except Exception:
            pass
    if c:
        c.close()
    if process and process.poll() is None:
        process.terminate()
        process.wait(timeout=15)
    log.close()
