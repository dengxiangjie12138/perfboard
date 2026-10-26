"""Isolated WebView2 PDF acceptance. Build with TAURI_CONFIG identifier
com.perfboard.log-pdf-qa and custom-protocol first. Never opens a user repository.
Run using the bundled Python (Pillow, websocket-client, pypdf).
"""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import time
from PIL import Image, ImageDraw
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from cdp_client import CDP

EXE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'src-tauri/target/debug/perfboard.exe'
assert b'com.perfboard.log-pdf-qa' in EXE.read_bytes(), 'Build the isolated QA identifier first'
OUT = ROOT / '.quality' / ('log-pdf-' + time.strftime('%Y%m%d-%H%M%S'))
OUT.mkdir(parents=True)
env = os.environ.copy()
env['PERFBOARD_TEST_CONFIG_DIR'] = str(OUT / 'config')
env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=9347 --remote-allow-origins=*'
env['WEBVIEW2_USER_DATA_FOLDER'] = str(OUT / 'webview-profile')
results = []

def check(name, condition):
    results.append({'name': name, 'passed': bool(condition)})
    (OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    if not condition:
        raise AssertionError(name)

def inv(command, args=None):
    return c.evaluate('window.__TAURI_INTERNALS__.invoke(' + json.dumps(command) + ',' + json.dumps(args or {}) + ')')

def button(label):
    c.evaluate('''(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ''' + json.dumps(label) + ''' && !b.disabled && b.getClientRects().length); if (!b) throw Error('Missing button'); b.click(); })()''')

def para(text):
    return {'type': 'paragraph', 'content': [{'type': 'text', 'text': text}]}

def export(path, action):
    c.evaluate('window.__pdfPath=' + json.dumps(str(path)) + ';window.__pdfDone=false;window.__pdfError=null;')
    action()
    c.wait('Boolean(window.__pdfDone || window.__pdfError)', 100)
    check('native PDF succeeded: ' + path.name, not c.evaluate('window.__pdfError'))
    check('real PDF written: ' + path.name, path.read_bytes().startswith(b'%PDF-'))
    return PdfReader(path)

def context_export(page_id):
    selector = '.log-page-row[data-page-id="' + page_id + '"]'
    c.evaluate('document.querySelector(' + json.dumps(selector) + ').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:1000,clientY:350}))')
    check('page context menu has PDF export', c.evaluate("document.querySelector('.log-context-menu').textContent.includes('导出为 PDF')"))
    button('导出为 PDF')

process = None
c = None
log = (OUT / 'native.log').open('wb')
try:
    init = subprocess.run([str(EXE), '--initialize-repository', str(OUT / 'repository')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW, timeout=20)
    check('isolated repository initialized', init.returncode == 0)
    process = subprocess.Popen([str(EXE), '--autostart'], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    c = CDP(9347)
    c.wait("Boolean(document.querySelector('.app-shell'))")
    c.wait("Boolean(document.querySelector('.status-dot.connected'))")
    key = inv('dev_log_selection_get')['repositoryKey']
    check('QA repository is isolated', key.replace('\\', '/').lower().startswith(str(OUT).replace('\\', '/').lower()))
    project = inv('dev_log_project_create', {'title': 'PDF 验证项目'})
    current = inv('dev_log_page_create', {'projectId': project['id'], 'title': '中文开发日志：图文与分页'})
    other = inv('dev_log_page_create', {'projectId': project['id'], 'title': '右键另一页'})
    inv('edit_lease_acquire', {'resource': 'log:' + current['id']})
    resources = []
    for ext, size in [('png', (1600, 800)), ('jpg', (800, 600)), ('webp', (800, 600)), ('gif', (600, 3000))]:
        image = Image.new('RGB', size, '#eff6ff')
        draw = ImageDraw.Draw(image)
        for i in range(6):
            top = i * size[1] // 6
            draw.rectangle((0, top, size[0] - 1, (i + 1) * size[1] // 6 - 1), outline='#1e40af', width=8)
            draw.text((30, top + 20), 'ORIGINAL IMAGE ' + ext.upper() + ' BLOCK ' + str(i + 1), fill='#1e3a8a', font_size=30)
        source = OUT / ('原图.' + ext)
        image.save(source)
        context = {'repositoryKey': key, 'pageId': current['id'], 'expectedRevision': current['revision']}
        resource = inv('log_resource_import_path', {'context': context, 'sourcePath': str(source)})
        check('original resource accepted: ' + ext, resource['isImage'])
        check('original bytes retained: ' + ext, resource['sha256'] == hashlib.sha256(source.read_bytes()).hexdigest())
        resources.append(resource)
    attachment = OUT / '中文附件.txt'
    attachment.write_text('附件内容单独保留，不内嵌至 PDF', encoding='utf-8')
    file = inv('log_resource_import_path', {'context': context, 'sourcePath': str(attachment)})
    nodes = [
        {'type': 'heading', 'attrs': {'level': 2}, 'content': [{'type': 'text', 'text': '中文、样式与分页验收'}]},
        {'type': 'paragraph', 'attrs': {'textAlign': 'center'}, 'content': [
            {'type': 'text', 'text': '中文粗体与颜色', 'marks': [{'type': 'bold'}, {'type': 'textStyle', 'attrs': {'color': '#db2777'}}]},
            {'type': 'hardBreak'},
            {'type': 'text', 'text': '高亮与下划线', 'marks': [{'type': 'highlight', 'attrs': {'color': '#fff08a'}}, {'type': 'underline'}]},
        ]},
        {'type': 'taskList', 'content': [{'type': 'taskItem', 'attrs': {'checked': status}, 'content': [para('已经完成' if status else '尚未完成')]} for status in [True, False]]},
        {'type': 'orderedList', 'attrs': {'start': 3}, 'content': [{'type': 'listItem', 'content': [para('编号从第三项开始'), {'type': 'bulletList', 'content': [{'type': 'listItem', 'content': [para('嵌套列表中文内容')]}]}]}]},
        {'type': 'image', 'attrs': {'resourceId': resources[0]['id'], 'displayWidth': 440}},
    ]
    for i in range(1, 61):
        nodes.append(para(f'段落{i:03d}：这是中文开发日志分页测试。电路设计、元件选型与调试记录；长文需要完整换行与连续分页。' * 2))
        if i in [20, 40, 60]:
            nodes.append({'type': 'image', 'attrs': {'resourceId': resources[i // 20]['id'], 'displayWidth': 640}})
    nodes += [
        {'type': 'fileAttachment', 'attrs': {'resourceId': file['id']}},
        {'type': 'codeBlock', 'content': [{'type': 'text', 'text': '\n'.join(f'const 测试编号{i:03d} = {i};' for i in range(1, 81)) + '\n代码结束标记'}]},
        para('正文结束标记'),
    ]
    current = inv('dev_log_page_save', {'input': {'id': current['id'], 'expectedRevision': current['revision'], 'title': current['title'], 'schemaVersion': 1, 'documentJson': json.dumps({'type': 'doc', 'content': nodes}, ensure_ascii=False)}})
    inv('edit_lease_acquire', {'resource': 'log:' + other['id']})
    other = inv('dev_log_page_save', {'input': {'id': other['id'], 'expectedRevision': other['revision'], 'title': other['title'], 'schemaVersion': 1, 'documentJson': json.dumps({'type': 'doc', 'content': [para('仅属于另一页的中文内容 OTHER_PAGE_ONLY')]}, ensure_ascii=False)}})
    button('开发日志')
    c.wait("Boolean(document.querySelector('[data-testid=dev-logs-page]'))")
    c.wait('Boolean(document.querySelector(' + json.dumps('.log-page-row[data-page-id="' + current['id'] + '"] button') + '))')
    c.evaluate('document.querySelector(' + json.dumps('.log-page-row[data-page-id="' + current['id'] + '"] button') + ').dispatchEvent(new MouseEvent("click",{bubbles:true,detail:1}))')
    c.wait("Boolean(document.querySelector('.tiptap[contenteditable=true]'))")
    check('PDF button immediately follows Save', c.evaluate("document.querySelector('[aria-label=\"保存当前页面\"]').nextElementSibling.getAttribute('aria-label') === '导出当前页面为 PDF'"))
    c.evaluate("(() => { const s=document.querySelector('input[aria-label=自动保存]'); if(s.checked)s.click(); const e=document.querySelector('.tiptap');e.focus();const range=document.createRange();range.selectNodeContents(e);range.collapse(false);const s2=window.getSelection();s2.removeAllRanges();s2.addRange(range); })()")
    marker = '未保存草稿标记 UNSAVED_DRAFT_ONLY'
    c.call('Input.insertText', {'text': marker})
    c.wait("document.querySelector('.tiptap').textContent.includes('UNSAVED_DRAFT_ONLY')")
    c.evaluate("""(() => {
        const original=window.fetch;
        window.__pdfCalls=[];
        window.fetch=(url,options)=>{
            if(!String(url).includes('ipc.localhost'))return original(url,options);
            const command=decodeURIComponent(new URL(url).pathname.slice(1));
            if(command==='plugin:dialog|save')return Promise.resolve(new Response(JSON.stringify(window.__pdfPath),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}}));
            window.__pdfCalls.push(command);
            const result=original(url,options);
            if(command==='dev_log_export_pdf')return result.then(async response=>{if(response.headers.get('Tauri-Response')==='ok')window.__pdfDone=true;else window.__pdfError=await response.clone().text();return response;});
            return result;
        };
    })()""")
    c.screenshot(OUT / 'editor-before-export.png')
    first = export(OUT / '当前草稿.pdf', lambda: c.evaluate("document.querySelector('[aria-label=\"导出当前页面为 PDF\"]').click()"))
    text = ''.join(p.extract_text() for p in first.pages)
    check('Chinese title and body are selectable text', '中文开发日志' in text and '中文、样式与分页验收' in text)
    check('current draft included', 'UNSAVED_DRAFT_ONLY' in text)
    check('long document spans multiple pages', len(first.pages) >= 5)
    check('all sixty paragraphs exported', all(f'段落{i:03d}' in text for i in range(1, 61)))
    compact_text = ''.join(text.split())
    check('code spans pages without truncation', all(f'测试编号{i:03d}' in compact_text for i in range(1, 81)) and '代码结束标记' in compact_text)
    check('all four original image formats exported', sum(len(p.images) for p in first.pages) >= 4)
    import pdfplumber
    with pdfplumber.open(OUT / '当前草稿.pdf') as laid_out:
        check('PDF ignores editor zoom and fits the original to A4 width', 490 < laid_out.pages[0].images[0]['width'] < 510)
    check('ordinary attachment described', '中文附件.txt' in text)
    check('every page is A4', all(abs(float(p.mediabox.width) - 595.28) < 1 and abs(float(p.mediabox.height) - 841.89) < 1 for p in first.pages))
    check('editor chrome absent', '自动保存' not in text and '另存为' not in text)
    persisted = inv('dev_log_page_get', {'id': current['id']})
    check('export did not save draft or change revision', persisted['revision'] == current['revision'] and 'UNSAVED_DRAFT_ONLY' not in persisted['documentJson'])
    second = export(OUT / '另一页面.pdf', lambda: context_export(other['id']))
    other_text = ''.join(p.extract_text() for p in second.pages)
    check('right click targets requested page', 'OTHER_PAGE_ONLY' in other_text and 'UNSAVED_DRAFT_ONLY' not in other_text)
    check('right click keeps current page and draft', c.evaluate("document.querySelector('.tiptap').textContent.includes('UNSAVED_DRAFT_ONLY')"))
    third = export(OUT / '右键当前草稿.pdf', lambda: context_export(current['id']))
    check('right click current page also includes draft', 'UNSAVED_DRAFT_ONLY' in ''.join(p.extract_text() for p in third.pages))
    check('export never issued log saves or selection writes', c.evaluate("!window.__pdfCalls.some(c=>['dev_log_page_save','dev_log_selection_save','edit_lease_acquire'].includes(c))"))
    c.evaluate("window.__pdfPath=null;window.__pdfDone=false")
    before = c.evaluate('window.__pdfCalls.filter(c=>c==="dev_log_export_pdf").length')
    c.evaluate("document.querySelector('[aria-label=\"导出当前页面为 PDF\"]').click()")
    c.wait("!document.querySelector('[aria-label=\"导出当前页面为 PDF\"]').disabled")
    check('cancel avoids PDF generation', c.evaluate('window.__pdfCalls.filter(c=>c==="dev_log_export_pdf").length') == before)
    check('cancel preserves unsaved draft', c.evaluate("document.querySelector('.tiptap').textContent.includes('UNSAVED_DRAFT_ONLY')"))
    c.screenshot(OUT / 'editor-after-export.png')
    print(json.dumps({'output': str(OUT), 'checks': len(results), 'pages': len(first.pages)}, ensure_ascii=False))
except Exception:
    if c:
        try:
            c.screenshot(OUT / 'failure.png')
            (OUT / 'failure-state.json').write_text(json.dumps(c.evaluate('({error:window.__pdfError,text:document.body.innerText})'), ensure_ascii=False), encoding='utf-8')
        except Exception:
            pass
    print('Evidence: ' + str(OUT), flush=True)
    raise
finally:
    if c:
        c.close()
    if process and process.poll() is None:
        process.terminate()  # Only our disposable QA process, never a user instance.
        process.wait(timeout=15)
    log.close()
