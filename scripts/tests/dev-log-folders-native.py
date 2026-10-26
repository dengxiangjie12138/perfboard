"""Folder acceptance in the isolated com.perfboard.log-pdf-qa build.
No user repository or production application is opened. Requires websocket-client.
"""
from pathlib import Path
import json
import os
import sqlite3
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from cdp_client import CDP

EXE = ROOT / 'src-tauri/target/debug/perfboard.exe'
assert b'com.perfboard.log-pdf-qa' in EXE.read_bytes(), 'Build isolated QA identifier first'
OUT = ROOT / '.quality' / ('log-folders-native-' + time.strftime('%Y%m%d-%H%M%S'))
OUT.mkdir(parents=True)
env = os.environ.copy()
env['PERFBOARD_TEST_CONFIG_DIR'] = str(OUT / 'config')
env['WEBVIEW2_USER_DATA_FOLDER'] = str(OUT / 'profile')
env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=9348 --remote-allow-origins=*'
log = (OUT / 'native.log').open('wb')
checks = []
response_frames = []
process = None
c = None

def check(name, condition):
    checks.append({'name': name, 'passed': bool(condition)})
    (OUT / 'checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
    if not condition:
        raise AssertionError(name)

def inv(command, args=None):
    return c.evaluate('window.__TAURI_INTERNALS__.invoke(' + json.dumps(command) + ',' + json.dumps(args or {}) + ')')

def snap():
    return inv('dev_logs_snapshot')

def click(selector, count=1):
    c.evaluate('document.querySelector(' + json.dumps(selector) + ').dispatchEvent(new MouseEvent("click",{bubbles:true,detail:' + str(count) + '}))')

def click_next_frame(selector, expanded, name):
    result = c.evaluate('''(async () => {const target=document.querySelector(''' + json.dumps(selector) + ''');
      const row=target.closest('.log-project-row,.log-folder-row').parentElement;
      const start=performance.now();target.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      await new Promise(requestAnimationFrame);
      return {expanded:row.getAttribute('aria-expanded')==='true',elapsedMs:performance.now()-start};})()''')
    response_frames.append({'name': name, **result})
    (OUT / 'response-frames.json').write_text(json.dumps(response_frames, ensure_ascii=False, indent=2), encoding='utf-8')
    check(name, result['expanded'] == expanded)

def double_click_state(selector, kind, expanded):
    click(selector, 1)
    c.wait('document.querySelector(' + json.dumps(selector) + ').parentElement.getAttribute("aria-expanded")===' + json.dumps(str(not expanded).lower()))
    click(selector, 2)
    c.evaluate('document.querySelector(' + json.dumps(selector) + ').dispatchEvent(new MouseEvent("dblclick",{bubbles:true,detail:2}))')
    c.wait("Boolean(document.querySelector('.inline-rename-input'))")
    check(kind + ' double click restores ' + ('expanded' if expanded else 'collapsed') + ' state before rename', c.evaluate('document.querySelector(' + json.dumps(selector) + ').parentElement.getAttribute("aria-expanded")===' + json.dumps(str(expanded).lower())))
    c.evaluate("document.querySelector('.inline-rename-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
    c.wait("!document.querySelector('.inline-rename-input')")

def button(text):
    c.evaluate('''(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===''' + json.dumps(text) + '''&&!b.disabled&&b.getClientRects().length);if(!b)throw Error('Missing button');b.click();})()''')

def busy_done():
    c.wait("!document.querySelector('.log-project-tree .log-row-action:disabled')")

def set_input(selector, value):
    c.evaluate('''(() => {const e=document.querySelector(''' + json.dumps(selector) + ''');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,''' + json.dumps(value) + ''');e.dispatchEvent(new Event('input',{bubbles:true}));})()''')

def rename(selector, name, context=False):
    if context:
        c.evaluate('document.querySelector(' + json.dumps(selector) + ').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:1000,clientY:350}))')
        button('重命名')
    else:
        click(selector, 1)
        click(selector, 2)
        c.evaluate('document.querySelector(' + json.dumps(selector) + ').dispatchEvent(new MouseEvent("dblclick",{bubbles:true,detail:2}))')
    c.wait("Boolean(document.querySelector('.inline-rename-input'))")
    set_input('.inline-rename-input', name)
    c.evaluate("document.querySelector('.inline-rename-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))")
    c.wait("!document.querySelector('.inline-rename-input')")
    busy_done()

def drag(source, target):
    c.evaluate('''(() => {const s=document.querySelector(''' + json.dumps(source) + '''),t=document.querySelector(''' + json.dumps(target) + ''');const d=new DataTransfer();s.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:d}));t.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:d}));t.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}));s.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:d}));})()''')
    busy_done()

def page_selector(id):
    return '.log-page-row[data-page-id="' + id + '"]'

def folder_selector(id):
    return '.log-folder-row[data-folder-id="' + id + '"]'

def project_selector(id):
    return '.log-project-row[data-project-id="' + id + '"]'

def start():
    global process, c
    process = subprocess.Popen([str(EXE), '--autostart'], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    c = CDP(9348)
    c.wait("Boolean(document.querySelector('.app-shell'))")
    c.wait("Boolean(document.querySelector('.status-dot.connected'))")

try:
    result = subprocess.run([str(EXE), '--initialize-repository', str(OUT / 'repository')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW, timeout=20)
    check('initialized isolated warehouse', result.returncode == 0)
    original = json.dumps({'type': 'doc', 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': '升级前中文内容保留'}]}]}, ensure_ascii=False)
    db = sqlite3.connect(OUT / 'repository/perfboard.sqlite3')
    db.execute("INSERT INTO dev_log_projects(id,title,position,revision,created_at,updated_at) VALUES('existing-project','已有项目',0,1,'old','old')")
    for i in range(1, 3):
        db.execute('INSERT INTO dev_log_pages(id,project_id,title,document_json,schema_version,position,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,1,?,?)', (f'existing-page-{i}', 'existing-project', f'已有页面{i}', original, i-1, 'old', 'old'))
    db.executescript('DROP TABLE dev_log_page_folders; DROP TABLE dev_log_folders; PRAGMA user_version=5;')
    db.commit()
    db.close()
    start()
    status = inv('repo_status')
    check('running warehouse is isolated', str(OUT).lower().replace('\\', '/') in status['path'].lower().replace('\\', '/'))
    backups = list((OUT / 'repository/backups').glob('pre-migration-v5-to-v6-*'))
    check('native v5 to v6 startup created one pre-migration backup', len(backups) == 1)
    old = sqlite3.connect('file:' + str(backups[0] / 'perfboard.sqlite3') + '?mode=ro', uri=True)
    check('backup still uses v5', old.execute('PRAGMA user_version').fetchone()[0] == 5)
    check('backup retains original pages', old.execute('SELECT count(*) FROM dev_log_pages').fetchone()[0] == 2)
    old.close()
    check('upgraded pages retain exact document', all(p['documentJson'] == original for p in snap()['pages']))
    project = 'existing-project'
    first, second = 'existing-page-1', 'existing-page-2'
    other = inv('dev_log_project_create', {'title': '另一个项目'})
    button('开发日志')
    c.wait('Boolean(document.querySelector(' + json.dumps(page_selector(first)) + '))')
    click(page_selector(first) + ' .log-page-select')
    c.wait("Boolean(document.querySelector('.tiptap[contenteditable=true]'))")
    c.evaluate("(() => {const s=document.querySelector('input[aria-label=自动保存]');if(s.checked)s.click();const e=document.querySelector('.tiptap');e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(r);})()")
    c.call('Input.insertText', {'text': '保留草稿_FOLDER_DRAFT'})
    click_next_frame(project_selector(project) + ' .log-project-select', False, 'project name collapses by next animation frame')
    check('single click project name collapses without losing draft', c.evaluate("document.querySelector('.tiptap').textContent.includes('FOLDER_DRAFT')"))
    click_next_frame(project_selector(project), True, 'project background expands by next animation frame')
    check('project row background also expands', True)
    double_click_state(project_selector(project), 'project', True)
    click_next_frame(project_selector(project) + ' .log-project-collapse', False, 'project arrow collapses by next animation frame')
    double_click_state(project_selector(project), 'project', False)
    click_next_frame(project_selector(project) + ' .log-project-collapse', True, 'project arrow expands by next animation frame')
    click('[aria-label="在 已有项目 新建文件夹"]')
    c.wait("window.__TAURI_INTERNALS__.invoke('dev_logs_snapshot').then(s=>s.folders.length===1)")
    busy_done()
    f1 = snap()['folders'][0]['id']
    check('new folder immediately uses default name', snap()['folders'][0]['title'] == '新建文件夹')
    check('creating folder preserves unsaved content', c.evaluate("document.querySelector('.tiptap').textContent.includes('FOLDER_DRAFT') && !document.querySelector('[role=dialog]')"))
    click('[aria-label="在 已有项目 新建文件夹"]')
    c.wait("window.__TAURI_INTERNALS__.invoke('dev_logs_snapshot').then(s=>s.folders.length===2)")
    busy_done()
    f2 = next(f['id'] for f in snap()['folders'] if f['id'] != f1)
    check('default folder names are distinct', {f['title'] for f in snap()['folders']} == {'新建文件夹', '新建文件夹 2'})
    check('New Folder is immediately right of New Page', c.evaluate("document.querySelector('[aria-label=\"在 已有项目 新建页面\"]').nextElementSibling.getAttribute('aria-label')==='在 已有项目 新建文件夹'"))
    rename(folder_selector(f1), '图纸与照片')
    check('double click folder rename works with an unsaved draft', next(f for f in snap()['folders'] if f['id'] == f1)['title'] == '图纸与照片' and c.evaluate("document.querySelector('.tiptap').textContent.includes('FOLDER_DRAFT')"))
    rename(folder_selector(f2), '调试记录', context=True)
    check('right click folder rename persists', next(f for f in snap()['folders'] if f['id'] == f2)['title'] == '调试记录')
    double_click_state(folder_selector(f1), 'folder', True)
    click_next_frame(folder_selector(f1) + ' .log-project-select', False, 'folder name collapses by next animation frame')
    double_click_state(folder_selector(f1), 'folder', False)
    click_next_frame(folder_selector(f1) + ' .log-project-select', True, 'folder name expands by next animation frame')
    check('folder row toggles open and closed', True)
    rapid = c.evaluate('''(async () => {const selectors=''' + json.dumps([folder_selector(f1), folder_selector(f2)]) + ''';
      for(const selector of selectors) document.querySelector(selector).dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
      await new Promise(requestAnimationFrame);
      return selectors.every(selector=>document.querySelector(selector).parentElement.getAttribute('aria-expanded')==='false');})()''')
    check('rapid clicks on different folders both respond by next animation frame', rapid)
    click_next_frame(folder_selector(f1), True, 'first folder reopens by next animation frame')
    click_next_frame(folder_selector(f2), True, 'second folder reopens by next animation frame')
    click('[aria-label="保存当前页面"]')
    busy_done()
    c.wait("window.__TAURI_INTERNALS__.invoke('dev_log_page_get',{id:'existing-page-1'}).then(p=>p.documentJson.includes('FOLDER_DRAFT'))")
    preserved = inv('dev_log_page_get', {'id': first})['documentJson']
    history_count = len(inv('dev_log_page_history', {'id': first}))
    drag(page_selector(first), folder_selector(f1))
    check('existing page dragged into folder', first in next(f for f in snap()['folders'] if f['id'] == f1)['pageIds'])
    check('moved page is visible inside folder DOM', c.evaluate('document.querySelector(' + json.dumps(page_selector(first)) + ').closest(".log-folder").querySelector("[data-folder-id]").dataset.folderId===' + json.dumps(f1)))
    drag(page_selector(second), page_selector(first))
    order = c.evaluate('[...document.querySelector(' + json.dumps(folder_selector(f1)) + ').parentElement.querySelectorAll("[data-page-id]")].map(e=>e.dataset.pageId)')
    check('page can enter folder and reorder before a child', order == [second, first])
    drag(page_selector(first), folder_selector(f2))
    check('page moves between folders', first in next(f for f in snap()['folders'] if f['id'] == f2)['pageIds'])
    drag(page_selector(first), project_selector(project))
    check('page dragged back to project root', not any(first in f['pageIds'] for f in snap()['folders']))
    drag(folder_selector(f2), folder_selector(f1))
    positions = {f['id']: f['position'] for f in snap()['folders']}
    check('folder positions reorder', positions[f2] < positions[f1])
    drag(folder_selector(f1), page_selector(first))
    state = snap()
    check('folder can be positioned before a root page', next(f for f in state['folders'] if f['id'] == f1)['position'] < next(p for p in state['pages'] if p['id'] == first)['position'])
    before_cross = json.dumps(snap(), sort_keys=True)
    drag(page_selector(first), project_selector(other['id']))
    check('cross-project drop is rejected without changes', before_cross == json.dumps(snap(), sort_keys=True))
    check('dragging retains exact document and history', inv('dev_log_page_get', {'id': first})['documentJson'] == preserved and len(inv('dev_log_page_history', {'id': first})) == history_count)
    check('project number counts all pages, not folders', c.evaluate('document.querySelector(' + json.dumps(project_selector(project)) + ').querySelector("small").textContent==="2"'))
    time.sleep(0.6)  # The editor intentionally suppresses rename just after a drag.
    rename(project_selector(project), '项目整行双击改名')
    check('project double click still renames', next(p for p in snap()['projects'] if p['id'] == project)['title'] == '项目整行双击改名')
    check('double click did not collapse the project', c.evaluate('document.querySelector(' + json.dumps(project_selector(project)) + ').parentElement.getAttribute("aria-expanded")==="true"'))
    click('[aria-label="在文件夹 图纸与照片 新建页面"]')
    c.wait("window.__TAURI_INTERNALS__.invoke('dev_logs_snapshot').then(s=>s.pages.length===3)")
    busy_done()
    state = snap()
    created = next(p for p in state['pages'] if p['id'] not in [first, second])
    check('new page created directly inside folder', created['id'] in next(f for f in state['folders'] if f['id'] == f1)['pageIds'])
    c.wait("!!document.activeElement.closest('.tiptap')", 5)
    check('new page editor is focused', c.evaluate("!!document.activeElement.closest('.tiptap')"))
    check('count remains number of all pages after creation', c.evaluate('document.querySelector(' + json.dumps(project_selector(project)) + ').querySelector("small").textContent==="3"'))
    drag(project_selector(other['id']), project_selector(project))
    check('existing project drag ordering still works', min(snap()['projects'], key=lambda p: p['position'])['id'] == other['id'])
    c.screenshot(OUT / 'folders-before-restart.png')
    stable = json.dumps(snap(), sort_keys=True)
    c.close()
    c = None
    process.terminate()
    process.wait(timeout=15)
    process = None
    start()
    button('开发日志')
    c.wait('Boolean(document.querySelector(' + json.dumps(folder_selector(f1)) + '))')
    check('folders, ordering and memberships survive restart', stable == json.dumps(snap(), sort_keys=True))
    check('selected nested page restores and its folder expands', c.evaluate('Boolean(document.querySelector(' + json.dumps(page_selector(created['id']) + '.active') + '))'))
    check('reopen does not repeat migration', len(list((OUT / 'repository/backups').glob('pre-migration-v5-to-v6-*'))) == 1)
    button('版本与说明')
    c.wait("document.querySelector('.main-content').textContent.includes('Perfboard 0.1.0')")
    click('.version-toggle')
    c.wait("document.querySelector('.version-toggle').getAttribute('aria-expanded')==='true'")
    text = c.evaluate("document.querySelector('.main-content').innerText")
    check('About includes local PDF, original sizes, folders and whole-row folding', all(word in text for word in ['本地导出 PDF', '原图尺寸', '默认名称文件夹', '单击项目或文件夹']))
    check('About includes immediate folding response fix', '整行折叠立即响应' in text)
    c.screenshot(OUT / 'about-changes.png')
    print(json.dumps({'output': str(OUT), 'checks': len(checks)}, ensure_ascii=False))
except Exception:
    if c:
        try:
            c.screenshot(OUT / 'failure.png')
            (OUT / 'failure.json').write_text(json.dumps(c.evaluate('({text:document.body.innerText})'), ensure_ascii=False), encoding='utf-8')
        except Exception:
            pass
    print('Evidence: ' + str(OUT), flush=True)
    raise
finally:
    if c:
        c.close()
    if process and process.poll() is None:
        process.terminate()
        process.wait(timeout=15)
    log.close()
