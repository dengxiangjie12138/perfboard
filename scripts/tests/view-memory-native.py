"""Real WebView persistence checks. Only the isolated QA identifier/config/repositories.
Requires websocket-client; never opens a production profile or real user warehouse.
"""
from pathlib import Path
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.request
import urllib.parse
import websocket

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from cdp_client import CDP

EXE = ROOT / 'src-tauri/target/debug/perfboard.exe'
assert b'com.perfboard.log-pdf-qa' in EXE.read_bytes(), 'Build the isolated QA identifier first'
OUT = ROOT / '.quality' / ('view-memory-native-' + time.strftime('%Y%m%d-%H%M%S'))
OUT.mkdir(parents=True)
env = os.environ.copy()
env['PERFBOARD_TEST_CONFIG_DIR'] = str(OUT / 'config')
env['WEBVIEW2_USER_DATA_FOLDER'] = str(OUT / 'profile')
env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=9350 --remote-allow-origins=*'
log = (OUT / 'native.log').open('wb')
checks, clients = [], []
process, c = None, None
calculator_samples = [
    ('TL431 基准电压计算', '.hw-input-card input', '7.5'),
    ('带上拉分压计算', '.hw-input-card input', '8.5'),
    ('PMOS 开关电阻计算', '.hw-input-card input', '16'),
    ('定时器计算', '.calc-split form input', '48'),
    ('电阻串联计算', '.network-page input', '.5'),
    ('电阻并联计算', '.network-page input', '.75'),
    ('反馈电阻', '.calc-split form input', '9'),
    ('LED限流计算', '.led-fields input', '11.5'),
]

def check(name, value):
    checks.append({'name': name, 'passed': bool(value)})
    (OUT / 'checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
    if not value:
        raise AssertionError(name)

def inv(command, args=None, client=None):
    return (client or c).evaluate('window.__TAURI_INTERNALS__.invoke(' + json.dumps(command) + ',' + json.dumps(args or {}) + ')')

def click(selector, client=None):
    (client or c).evaluate('document.querySelector(' + json.dumps(selector) + ').click()')

def button(text, sidebar=False):
    c.evaluate('''(() => {const b=[...document.querySelectorAll(''' + json.dumps('.sidebar button' if sidebar else '.main-content button') + ''')].find(e=>e.textContent.trim()===''' + json.dumps(text) + '''&&!e.disabled);if(!b)throw Error('Missing button: '+''' + json.dumps(text) + ''');b.click();})()''')

def go(text, selector):
    button(text, True)
    c.wait('Boolean(document.querySelector(' + json.dumps(selector) + '))')
    c.wait("!document.querySelector('.sidebar button:disabled')")

def field(selector, value, client=None):
    (client or c).evaluate('''(() => {const e=document.querySelector(''' + json.dumps(selector) + ''');if(!e)throw Error('Missing input');const prototype=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,''' + json.dumps(str(value)) + ''');e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()''')

def value(selector, client=None):
    return (client or c).evaluate('document.querySelector(' + json.dumps(selector) + ').value')

def memory(feature, repository=None, client=None):
    return (client or c).evaluate('''(() => {const label=window.__TAURI_INTERNALS__.metadata.currentWindow.label;const repo=''' + json.dumps(str(repository).replace('\\', '/').rstrip('/').lower() if repository else '') + ''';const raw=localStorage.getItem('perfboard.view.v1.'+JSON.stringify([label,repo,''' + json.dumps(feature) + ''']));return raw?JSON.parse(raw).value:null;})()''')

def start():
    global process, c
    process = subprocess.Popen([str(EXE), '--autostart'], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    c = CDP(9350)
    c.wait("Boolean(document.querySelector('.status-dot.connected'))")
    c.wait("!document.querySelector('.sidebar button:disabled')")

def stop(crash=False):
    global c, process
    if crash:
        process.terminate()
    else:
        try:
            inv('app_close_request', {'action': 'quit'})
        except websocket.WebSocketConnectionClosedException:
            pass
    c.close()
    c = None
    process.wait(timeout=20)
    process = None

def tool_client():
    until = time.time() + 15
    while time.time() < until:
        pages = json.load(urllib.request.urlopen('http://127.0.0.1:9350/json/list'))
        page = next((p for p in pages if 'radix' in urllib.parse.unquote(p.get('url', '')) and p.get('type') == 'page'), None)
        if page:
            client = CDP.__new__(CDP)
            client.port, client.seq, client.events = 9350, 0, []
            client.ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=40, suppress_origin=True)
            client.call('Runtime.enable')
            client.wait("Boolean(document.querySelector('[data-testid=radix-width]'))")
            clients.append(client)
            return client
        time.sleep(.1)
    raise RuntimeError('Missing isolated radix child window')

def seed(repository):
    db = sqlite3.connect(repository / 'perfboard.sqlite3')
    for i in range(22):
        id = 'project' if i == 0 else 'project-' + str(i)
        db.execute('INSERT INTO dev_log_projects(id,title,position,revision,created_at,updated_at) VALUES(?,?,?,1,?,?)', (id, '记忆测试项目' if i == 0 else '滚动项目 ' + str(i), i, 'old', 'old'))
    document = json.dumps({'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'记忆正文 '+str(i)}]} for i in range(100)]}, ensure_ascii=False)
    db.execute('INSERT INTO dev_log_pages(id,project_id,title,document_json,schema_version,position,revision,created_at,updated_at) VALUES(?,?,?,?,1,0,1,?,?)', ('page', 'project', '折叠中的当前页', document, 'old', 'old'))
    for i in range(2):
        db.execute('INSERT INTO dev_log_folders(id,project_id,title,position,revision) VALUES(?,?,?,?,1)', ('folder-'+str(i), 'project', '文件夹 '+str(i), i))
    db.execute('INSERT INTO dev_log_page_folders(page_id,folder_id) VALUES(?,?)', ('page','folder-0'))
    scene = json.dumps({'type':'excalidraw','version':2,'source':'Perfboard QA','elements':[],'appState':{},'files':{}})
    db.execute('INSERT INTO notes(id,title,category,search_text,scene_json,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,1)', ('note','画布记忆','学习笔记','',scene,'old','old'))
    db.commit()
    db.close()

try:
    repo_a, repo_b = OUT / 'repository-a', OUT / 'repository-b'
    for repo in [repo_a, repo_b]:
        initialize_env = env.copy()
        if repo == repo_b:
            initialize_env['PERFBOARD_TEST_CONFIG_DIR'] = str(OUT / 'config-b')
        result = subprocess.run([str(EXE),'--initialize-repository',str(repo)], cwd=ROOT, env=initialize_env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW, timeout=20)
        check('initialized synthetic ' + repo.name, result.returncode == 0)
        seed(repo)
    start()
    check('native warehouse is isolated', str(OUT).lower().replace('\\','/') in inv('repo_status')['path'].lower().replace('\\','/'))

    go('进制转换','[data-testid=radix-width]')
    field('[data-testid=radix-width]',8)
    field('[data-testid=radix-a-dec]',42)
    field('[data-testid=radix-a-dec]',300)
    field('[data-testid=radix-width]',16)
    check('widening does not silently accept a previously invalid draft', c.evaluate("document.querySelector('[data-testid=radix-a-dec]').getAttribute('aria-invalid')==='true' && document.querySelector('[data-testid=radix-a-hex]').value==='002A'"))
    go('线径计算','.wire-page')
    go('进制转换','[data-testid=radix-width]')
    check('invalid radix draft remains pending on return', c.evaluate("document.querySelector('[data-testid=radix-a-dec]').getAttribute('aria-invalid')==='true' && document.querySelector('[data-testid=radix-a-dec]').value==='300'"))
    field('[data-testid=radix-width]',64)
    field('[data-testid=radix-a-dec]','18446744073709551615')
    field('[data-testid=radix-b-hex]','0x')
    field('[data-testid=radix-group]',8)
    field('[data-testid=radix-shift-count]',7)
    go('线径计算','.wire-page')
    field('[data-testid=wire-current]','123')
    field('[data-testid=wire-current-unit]','mA')
    go('进制转换','[data-testid=radix-width]')
    check('radix navigation restores exact uint64 and unfinished input', value('[data-testid=radix-a-dec]') == '18446744073709551615' and value('[data-testid=radix-b-hex]') == '0x')
    check('radix width, grouping and shift count restored', [value('[data-testid=radix-width]'),value('[data-testid=radix-group]'),value('[data-testid=radix-shift-count]')] == ['64','8','7'])
    label = inv('tool_window_open', {'toolId':'radix'})
    child = tool_client()
    check('new child window does not inherit main input', value('[data-testid=radix-a-dec]',child) == '0')
    field('[data-testid=radix-width]',16,child)
    field('[data-testid=radix-a-dec]',99,child)
    inv('tool_window_close_request',client=child)
    child.close()
    c.wait("window.__TAURI_INTERNALS__.invoke('tool_window_open',{toolId:'radix'}).then(Boolean)")
    child = tool_client()
    check('reopened child slot restores its own inputs', value('[data-testid=radix-a-dec]',child) == '99' and value('[data-testid=radix-width]',child) == '16')
    check('child did not overwrite main input', value('[data-testid=radix-a-dec]') == '18446744073709551615')
    inv('tool_window_close_request',client=child)
    child.close()

    go('分压计算器','.divider-input-card')
    field('.divider-input-card input','12.5')
    go('UC28/38xx 计算','.hw-page')
    field('.hw-input-card select','UC3842')
    button('启动电压')
    check('hardware tab and model are remembered', memory('uc28-38xx-tab') == 'startup' and memory('uc28-38xx')['part'] == 'UC3842')
    for title, selector, raw in calculator_samples:
        go(title, selector)
        field(selector, raw)
        if title == '反馈电阻':
            click('.main-content button[type=submit]')
        elif title == 'LED限流计算':
            click('#led-calculate')
        go('进制转换','[data-testid=radix-width]')
        go(title, selector)
        check(title + ' input survives feature navigation', value(selector) == raw)
    go('反馈电阻','.calc-split form input')
    check('feedback candidate results restored by fresh calculation', c.evaluate("!document.querySelector('.main-content').innerText.includes('设置参数后更新候选') && !document.querySelector('.main-content').innerText.includes('参数已改变')"))
    go('LED限流计算','.led-fields input')
    check('LED candidate results restored by fresh calculation', c.evaluate("document.querySelector('#led-candidates').innerText.includes('理论电阻')"))

    go('笔记概览','.notes-list')
    field('.notes-search input','画布')
    click('[data-note-id=note]')
    c.wait("Boolean(document.querySelector('.notes-canvas canvas')) && document.querySelector('[data-testid=note-save-metadata]').disabled===false",30)
    point = c.evaluate("(() => {const r=document.querySelector('.notes-canvas').getBoundingClientRect();return {x:r.x+r.width*.55,y:r.y+r.height*.55};})()")
    c.call('Input.dispatchMouseEvent', {'type':'mouseWheel', **point, 'deltaX':0,'deltaY':-250,'modifiers':2})
    c.wait('Object.keys(localStorage).some(k=>k.includes("note-canvas-note")&&JSON.parse(localStorage.getItem(k)).value.zoom!==1)')
    c.call('Input.dispatchMouseEvent', {'type':'mouseWheel', **point, 'deltaX':180,'deltaY':130})
    time.sleep(.2)
    camera = memory('note-canvas-note',repo_a)
    check('note camera remembers zoom and pan', camera['zoom'] != 1 and (camera['x'] != 0 or camera['y'] != 0))
    go('分压计算器','.divider-input-card')
    go('笔记概览','.notes-canvas canvas')
    c.wait("document.querySelector('[data-testid=note-save-metadata]').disabled===false",30)
    restored_camera = memory('note-canvas-note',repo_a)
    check('note selection and search restored on return', value('.notes-search input') == '画布' and c.evaluate("document.querySelector('[data-note-id=note]').classList.contains('active')"))
    check('note camera restored on return', all(abs(camera[k]-restored_camera[k]) < .01 for k in camera))

    go('开发日志','[data-project-id=project]')
    click('[data-page-id=page] .log-page-select')
    c.wait("Boolean(document.querySelector('.tiptap[contenteditable=true]'))")
    click('[data-folder-id=folder-0] .log-project-select')
    click('[data-project-id=project] .log-project-select')
    c.evaluate("document.querySelector('.log-tree-content').scrollTop=330;document.querySelector('.log-editor-scroll').scrollTop=420")
    c.wait('Object.keys(localStorage).some(k=>k.includes("scroll-dev-log-page-page")&&JSON.parse(localStorage.getItem(k)).value.top===420)')
    check('current page can remain selected inside a collapsed folder and project', c.evaluate("document.querySelector('[data-project-id=project]').parentElement.getAttribute('aria-expanded')==='false' && document.querySelector('.tiptap').textContent.includes('记忆正文')"))
    tree_top = c.evaluate("document.querySelector('.log-tree-content').scrollTop")
    button('硬件计算选型',True)
    check('navigation group collapsed before exit', c.evaluate("document.querySelector('[aria-controls=submenu-hardware]').getAttribute('aria-expanded')==='false'"))
    c.screenshot(OUT / 'logs-before-restart.png')
    stop()
    start()
    c.wait("Boolean(document.querySelector('.tiptap'))")
    check('startup restores last feature', c.evaluate("Boolean(document.querySelector('.dev-logs-page'))"))
    check('startup preserves collapsed selected project', c.evaluate("document.querySelector('[data-project-id=project]').parentElement.getAttribute('aria-expanded')==='false'"))
    check('startup preserves collapsed navigation group', c.evaluate("document.querySelector('[aria-controls=submenu-hardware]').getAttribute('aria-expanded')==='false'"))
    c.wait("Math.abs(document.querySelector('.log-editor-scroll').scrollTop-420)<2")
    check('editor scroll survives process restart', True)
    check('tree scroll survives process restart', abs(c.evaluate("document.querySelector('.log-tree-content').scrollTop")-tree_top) < 2)
    click('[data-project-id=project] .log-project-collapse')
    check('nested folder stays collapsed after parent reopened', c.evaluate("document.querySelector('[data-folder-id=folder-0]').parentElement.getAttribute('aria-expanded')==='false'"))
    c.screenshot(OUT / 'logs-restored.png')
    go('进制转换','[data-testid=radix-width]')
    check('radix process restart retains 64-bit input and draft', value('[data-testid=radix-a-dec]') == '18446744073709551615' and value('[data-testid=radix-b-hex]') == '0x')
    go('线径计算','.wire-page')
    check('wire gauge process restart retains input and unit', value('[data-testid=wire-current]') == '123' and value('[data-testid=wire-current-unit]') == 'mA')
    go('分压计算器','.divider-input-card')
    check('divider process restart retains input', value('.divider-input-card input') == '12.5')
    go('UC28/38xx 计算','.hw-page')
    check('hardware process restart retains model and active tab', value('.hw-input-card select') == 'UC3842' and c.evaluate("[...document.querySelectorAll('.main-content button')].some(e=>e.textContent.trim()==='启动电压'&&e.getAttribute('aria-pressed')==='true')"))
    for title, selector, raw in calculator_samples:
        go(title, selector)
        check(title + ' input survives process restart', value(selector) == raw)

    go('变压器设计记录','.td-production-tool')
    button('新建')
    field('[data-sheet=name]','必须放弃的新草稿 QA')
    button('工作台',True)
    c.wait("Boolean(document.querySelector('dialog[open]'))")
    button('放弃修改并离开')
    c.wait("!document.querySelector('.td-production-tool')")
    go('变压器设计记录','.td-welcome')
    check('discarding a brand new draft restores the inactive view', not c.evaluate("Boolean(document.querySelector('[data-sheet=name]'))"))
    button('查看虚构示例')
    field('[data-sheet=name]','未保存制作单 QA')
    field('[data-sheet=bobbinDescription]','骨架记忆 QA')
    check('transformer draft stored locally without a warehouse write', memory('transformer-design',repo_a)['dirty'] and len(inv('transformer_design_list')) == 0)
    stop(crash=True)
    start()
    c.wait("Boolean(document.querySelector('[data-sheet=name]'))")
    check('transformer unsaved draft survives abrupt restart', value('[data-sheet=name]') == '未保存制作单 QA' and value('[data-sheet=bobbinDescription]') == '骨架记忆 QA')
    check('draft recovery does not write a warehouse record or reopen dialogs', len(inv('transformer_design_list')) == 0 and not c.evaluate("Boolean(document.querySelector('dialog[open]'))"))
    button('保存记录')
    c.wait("document.querySelector('[aria-label=选择已保存制作单]').value!==''")
    design_id = value('[aria-label=选择已保存制作单]')
    first_revision = inv('transformer_design_get', {'id':design_id})['revision']
    field('[data-sheet=name]','应被放弃的修改 QA')
    button('工作台',True)
    c.wait("Boolean(document.querySelector('dialog[open]'))")
    button('放弃修改并离开')
    c.wait("!document.querySelector('.td-production-tool')")
    go('变压器设计记录','[data-sheet=name]')
    check('explicit discard is not resurrected from local memory', value('[data-sheet=name]') == '未保存制作单 QA' and inv('transformer_design_get', {'id':design_id})['revision'] == first_revision)
    button('结束编辑')
    go('工作台','[data-testid=workbench-search]')
    go('变压器设计记录','.td-welcome')
    check('explicit end editing remains inactive on return', not c.evaluate("Boolean(document.querySelector('[data-sheet=name]'))"))
    field('[aria-label=选择已保存制作单]',design_id)
    c.wait("Boolean(document.querySelector('[data-sheet=name]'))")
    field('[data-sheet=name]','保存后重开 QA')
    inv('app_close_request', {'action':'quit'})
    c.wait("Boolean(document.querySelector('dialog[open]'))")
    button('保存并离开')
    c.close()
    c = None
    process.wait(timeout=20)
    process = None
    start()
    c.wait("Boolean(document.querySelector('[data-sheet=name]'))")
    check('save-and-quit restores last saved transformer record', value('[data-sheet=name]') == '保存后重开 QA' and value('[aria-label=选择已保存制作单]') == design_id)
    check('save-and-quit writes exactly one new revision', inv('transformer_design_get', {'id':design_id})['revision'] == first_revision + 1)
    c.screenshot(OUT / 'transformer-restored.png')

    go('开发日志','[data-project-id=project]')
    click('[data-project-id=project] .log-project-collapse')
    inv('repo_open', {'path':str(repo_b),'create':False})
    c.wait('window.__TAURI_INTERNALS__.invoke("repo_status").then(s=>s.ready&&s.path.endsWith("repository-b"))')
    c.wait("Boolean(document.querySelector('[data-testid=workbench-search]'))")
    go('开发日志','[data-project-id=project]')
    check('second warehouse does not inherit folded IDs with the same names', c.evaluate("document.querySelector('[data-project-id=project]').parentElement.getAttribute('aria-expanded')==='true' && document.querySelector('[data-folder-id=folder-0]').parentElement.getAttribute('aria-expanded')==='true'"))
    go('笔记概览','.notes-list')
    check('second warehouse does not inherit note selection or query', value('.notes-search input') == '' and not c.evaluate("Boolean(document.querySelector('.notes-canvas'))"))
    go('变压器设计记录','.td-welcome')
    check('second warehouse does not inherit transformer drafts', not c.evaluate("Boolean(document.querySelector('[data-sheet=name]'))"))
    inv('repo_open', {'path':str(repo_a),'create':False})
    c.wait("Boolean(document.querySelector('.dev-logs-page'))")
    check('switching back restores first warehouse route and folding', c.evaluate("document.querySelector('[data-project-id=project]').parentElement.getAttribute('aria-expanded')==='false'"))
    go('版本与说明','.version-toggle')
    click('.version-toggle')
    check('version notes include interface memory', c.evaluate("document.querySelector('.main-content').innerText.includes('本地界面记忆') && document.querySelector('.main-content').innerText.includes('2026-10-23')"))
    stop()
    print(json.dumps({'output':str(OUT),'checks':len(checks)},ensure_ascii=False))
except Exception:
    if c:
        try:
            c.screenshot(OUT / 'failure.png')
            (OUT / 'failure.json').write_text(json.dumps(c.evaluate('({text:document.body.innerText,memoryKeys:Object.keys(localStorage),inputs:[...document.querySelectorAll("input,select")].map(e=>({tag:e.tagName,label:e.getAttribute("aria-label"),value:e.value}))})'),ensure_ascii=False),encoding='utf-8')
        except Exception:
            pass
    print('Evidence: '+str(OUT),flush=True)
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
