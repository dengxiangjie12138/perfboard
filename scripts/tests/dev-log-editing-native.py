"""Actual WebView2 regression for batch formatting and container-only deletion.
Uses an isolated debug identifier and synthetic repository. Never opens user data.
"""
from pathlib import Path
import json,os,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
from cdp_client import CDP

EXE=ROOT/'src-tauri/target/debug/perfboard.exe'
assert b'com.perfboard.log-editing-qa' in EXE.read_bytes(),'Build isolated QA identifier first'
OUT=ROOT/'.quality/log-editing-fix-20261022'/('native-'+time.strftime('%H%M%S'))
OUT.mkdir(parents=True,exist_ok=False)
env=os.environ.copy();env['PERFBOARD_TEST_CONFIG_DIR']=str(OUT/'config')
env['WEBVIEW2_USER_DATA_FOLDER']=str(OUT/'profile')
env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--remote-debugging-port=9351 --remote-allow-origins=*'
log=(OUT/'native.log').open('wb');checks=[];process=None;c=None
DOC={'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':line}]} for line in ['第一段：批量设置标题和文字样式','第二段：保留完整选区和所有文字','第三段：未选中的内容保持原样']]}

def check(name,condition):
    checks.append({'name':name,'passed':bool(condition)})
    (OUT/'checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
    if not condition:raise AssertionError(name)
def inv(name,args=None):return c.evaluate('window.__TAURI_INTERNALS__.invoke('+json.dumps(name)+','+json.dumps(args or {})+')')
def snap():return inv('dev_logs_snapshot')
def evaluate(script):return c.evaluate('(()=>{const e=document.querySelector(".tiptap").editor;'+script+'})()')
def ui_click(selector):
    point=c.evaluate('(()=>{const b=document.querySelector('+json.dumps(selector)+');if(!b||b.disabled)throw Error("Missing/enabled control: "+'+json.dumps(selector)+');b.scrollIntoView({block:"nearest",inline:"nearest"});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
    c.call('Input.dispatchMouseEvent',{'type':'mousePressed','button':'left','clickCount':1,**point})
    c.call('Input.dispatchMouseEvent',{'type':'mouseReleased','button':'left','clickCount':1,**point})
def button(text):
    c.evaluate('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==='+json.dumps(text)+'&&!b.disabled&&b.getClientRects().length);if(!b)throw Error("Missing button "+'+json.dumps(text)+');b.click()})()')
def reset(backwards=False):
    evaluate('e.chain().setContent('+json.dumps(DOC,ensure_ascii=False)+').setMeta("addToHistory",false).run();const end=e.state.doc.child(0).nodeSize+e.state.doc.child(1).nodeSize-2;e.commands.setTextSelection('+('{from:end,to:2}' if backwards else '{from:2,to:end}')+');e.commands.focus();return true')
    return selected()
def selected():return evaluate('return {text:e.state.doc.textBetween(e.state.selection.from,e.state.selection.to,"\\n"),empty:e.state.selection.empty,anchor:e.state.selection.anchor,head:e.state.selection.head}')
def doc():return evaluate('return e.getJSON()')
def heading(level):
    ui_click('[aria-label="Format text as heading"]')
    c.wait('Boolean(document.querySelector('+json.dumps('[aria-label="Heading '+str(level)+'"]')+'))')
    ui_click('[aria-label="Heading '+str(level)+'"]')
    c.wait('!document.querySelector(".tiptap-dropdown-menu") && document.body.style.pointerEvents!=="none"')
def list_style(label):
    ui_click('[aria-label="List options"]')
    c.wait('Boolean(document.querySelector('+json.dumps('[aria-label="'+label+'"]')+'))')
    ui_click('[aria-label="'+label+'"]')
    c.wait('!document.querySelector(".tiptap-dropdown-menu") && document.body.style.pointerEvents!=="none"')
def still_selected(name,before):
    after=selected();check(name,not after['empty'] and after['text']==before['text'])
def page_selector(key):return '.log-page-row[data-page-id="'+key+'"] .log-page-select'
def folder_context(key):
    c.evaluate('document.querySelector('+json.dumps('.log-folder-row[data-folder-id="'+key+'"]')+').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:1050,clientY:350}))')
    c.wait('Boolean(document.querySelector(".log-context-menu"))')

try:
    initialized=subprocess.run([str(EXE),'--initialize-repository',str(OUT/'repository')],env=env,cwd=ROOT,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW,timeout=20)
    check('isolated repository initialized',initialized.returncode==0)
    process=subprocess.Popen([str(EXE),'--autostart'],env=env,cwd=ROOT,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
    c=CDP(9351);c.wait('Boolean(document.querySelector(".status-dot.connected"))')
    check('QA repository isolated',str(OUT).replace('\\','/').lower() in inv('repo_status')['path'].replace('\\','/').lower())
    project=inv('dev_log_project_create',{'title':'批量样式与文件夹删除验证'})
    page=inv('dev_log_page_create',{'projectId':project['id'],'title':'多行文字验证'})
    button('开发日志');c.wait('Boolean(document.querySelector('+json.dumps(page_selector(page['id']))+'))')
    ui_click(page_selector(page['id']));c.wait('Boolean(document.querySelector(".tiptap[contenteditable=true]"))')
    if c.evaluate('document.querySelector("input[aria-label=自动保存]").checked'):ui_click('input[aria-label=自动保存]')
    selection=reset();heading(2)
    content=doc()['content']
    check('heading applies to both selected paragraphs only',[n['type'] for n in content]==['heading','heading','paragraph'] and all(n['attrs']['level']==2 for n in content[:2]))
    still_selected('heading keeps complete selected text',selection)
    ui_click('[aria-label="Bold"]');still_selected('bold retains multi-paragraph selection',selection)
    ui_click('[aria-label="文字颜色"]');ui_click('[aria-label="文字红色"]')
    still_selected('foreground color retains multi-paragraph selection',selection)
    marked=evaluate('const out=[];e.state.doc.nodesBetween(e.state.selection.from,e.state.selection.to,n=>{if(n.isText)out.push(n.marks.map(m=>({type:m.type.name,attrs:m.attrs})));});return out')
    check('bold and red cover selected text in both paragraphs',len(marked)>=2 and all(any(m['type']=='bold' for m in marks) and any(m['type']=='textStyle' and m['attrs']['color']=='#c43b3b' for m in marks) for marks in marked))
    ui_click('[aria-label="Align center"]');still_selected('alignment retains multi-paragraph selection',selection)
    content=doc()['content'];check('alignment updates selected paragraphs only',all(n['attrs']['textAlign']=='center' for n in content[:2]) and content[2]['attrs']['textAlign'] is None)
    c.screenshot(OUT/'batch-heading-color-alignment.png')
    selection=reset(backwards=True);heading(3);still_selected('backwards selection formats the whole range',selection)
    check('backwards heading covers two blocks',[n['type'] for n in doc()['content']]==['heading','heading','paragraph'])
    heading(3);check('same heading choice restores both paragraphs',[n['type'] for n in doc()['content']]==['paragraph','paragraph','paragraph'])
    for label,kind in [('Bullet List','bulletList'),('Ordered List','orderedList'),('Task List','taskList')]:
        selection=reset();list_style(label);content=doc()['content']
        check(label+' formats both selected paragraphs only',len(content)==2 and content[0]['type']==kind and len(content[0]['content'])==2 and content[1]['type']=='paragraph')
        still_selected(label+' preserves selection',selection)
        list_style(label);check(label+' toggles both selected items off',[n['type'] for n in doc()['content']]==['paragraph','paragraph','paragraph'])
    selection=reset();ui_click('[aria-label="Blockquote"]');content=doc()['content']
    check('blockquote wraps both selected paragraphs',content[0]['type']=='blockquote' and len(content[0]['content'])==2 and content[1]['type']=='paragraph')
    still_selected('blockquote preserves selection',selection)
    ui_click('[aria-label="Blockquote"]');check('blockquote unwraps without losing text',[n['type'] for n in doc()['content']]==['paragraph','paragraph','paragraph'])
    selection=reset();ui_click('[aria-label="Code Block"]');content=doc()['content']
    check('code blocks format all selected paragraphs only',[n['type'] for n in content]==['codeBlock','codeBlock','paragraph'])
    still_selected('code blocks preserve selected text',selection)
    selection=reset();evaluate('e.commands.setTextSelection(2);return true');heading(1)
    check('caret-only formatting still affects just its paragraph',[n['type'] for n in doc()['content']]==['heading','paragraph','paragraph'])
    selection=reset();evaluate('e.commands.selectAll();return true');all_text=selected();heading(4)
    content=doc()['content']
    check('select-all styles all original paragraphs',all(n['type']=='heading' for n in content[:3]) and all(n['type']=='paragraph' and not n.get('content') for n in content[3:]))
    # StarterKit's trailing-node plugin adds an empty typing paragraph after a
    # final heading. AllSelection maps across it, without losing selected text.
    after_all=selected()
    check('select-all remains selected after styling',not after_all['empty'] and after_all['text'].rstrip('\n')==all_text['text'].rstrip('\n'))
    selection=reset();heading(2);before_save=doc();ui_click('[aria-label="保存当前页面"]')
    c.wait('window.__TAURI_INTERNALS__.invoke("dev_log_page_get",{id:'+json.dumps(page['id'])+'}).then(p=>JSON.parse(p.documentJson).content[0].type==="heading")')
    folder=inv('dev_log_folder_create',{'projectId':project['id']})
    children=[]
    for title in ['文件夹内页面甲','文件夹内页面乙','原本在回收站的页面']:
        child=inv('dev_log_page_create',{'projectId':project['id'],'title':title})
        inv('dev_log_tree_move',{'input':{'kind':'page','id':child['id'],'expectedRevision':child['revision'],'projectId':project['id'],'folderId':folder['id'],'before':None}})
        children.append(inv('dev_log_page_get',{'id':child['id']}))
    inv('dev_log_page_delete',{'input':{'id':children[2]['id'],'expectedRevision':children[2]['revision']}})
    c.wait('Boolean(document.querySelector('+json.dumps('.log-folder-row[data-folder-id="'+folder['id']+'"]')+'))')
    originals={child['id']:{'page':inv('dev_log_page_get',{'id':child['id']}),'history':inv('dev_log_page_history',{'id':child['id']})} for child in children}
    folder_context(folder['id']);button('删除文件夹');c.wait('Boolean(document.querySelector("dialog[open]"))')
    check('delete dialog clearly preserves contents','页面将移回项目根目录' in c.evaluate('document.querySelector("dialog[open]").innerText'))
    button('取消');check('cancel keeps folder and memberships',any(f['id']==folder['id'] and len(f['pageIds'])==3 for f in snap()['folders']))
    folder_context(folder['id']);button('删除文件夹');c.wait('Boolean(document.querySelector("dialog[open]"))')
    inv('dev_log_folder_rename',{'input':{'id':folder['id'],'expectedRevision':folder['revision'],'title':'已在别处改名的文件夹'}})
    button('删除文件夹并保留页面');c.wait('Boolean(document.querySelector("dialog[open] .error-text"))')
    check('stale confirmation does not delete renamed folder',any(f['id']==folder['id'] for f in snap()['folders']))
    button('取消')
    c.wait('document.querySelector('+json.dumps('.log-folder-row[data-folder-id="'+folder['id']+'"]')+').innerText.includes("已在别处改名")')
    folder_context(folder['id']);button('删除文件夹');c.wait('Boolean(document.querySelector("dialog[open]"))')
    c.screenshot(OUT/'delete-folder-confirmation.png')
    button('删除文件夹并保留页面')
    c.wait('!document.querySelector("dialog[open]")')
    final=snap();check('folder removed',all(f['id']!=folder['id'] for f in final['folders']))
    check('all pages survive folder deletion',all(any(p['id']==child['id'] for p in final['pages']) for child in children))
    check('children leave folder memberships',all(not any(child['id'] in f['pageIds'] for f in final['folders']) for child in children))
    for child in children:
        fresh=inv('dev_log_page_get',{'id':child['id']});old=originals[child['id']]
        check(child['title']+' body, trash state and history retained',fresh['documentJson']==old['page']['documentJson'] and fresh['deletedAt']==old['page']['deletedAt'] and inv('dev_log_page_history',{'id':child['id']})==old['history'])
    check('current editor stays on the original page',evaluate('return e.getJSON()')==before_save)
    c.screenshot(OUT/'folder-deleted-pages-kept.png')
    draft_folder=inv('dev_log_folder_create',{'projectId':project['id']})
    draft_page=inv('dev_log_page_create',{'projectId':project['id'],'title':'删除文件夹时仍在编辑的页面'})
    inv('dev_log_tree_move',{'input':{'kind':'page','id':draft_page['id'],'expectedRevision':draft_page['revision'],'projectId':project['id'],'folderId':draft_folder['id'],'before':None}})
    c.wait('Boolean(document.querySelector('+json.dumps('.log-folder-row[data-folder-id="'+draft_folder['id']+'"]')+').parentElement.querySelector('+json.dumps(page_selector(draft_page['id']))+'))')
    ui_click(page_selector(draft_page['id']))
    c.wait('Boolean(document.querySelector('+json.dumps('.log-page-row.active[data-page-id="'+draft_page['id']+'"]')+')) && Boolean(document.querySelector(".tiptap[contenteditable=true]"))')
    evaluate('e.commands.insertContent("文件夹删除前尚未保存的草稿");return true');draft=doc()
    folder_context(draft_folder['id']);button('删除文件夹');c.wait('Boolean(document.querySelector("dialog[open]"))')
    button('删除文件夹并保留页面')
    c.wait('[...document.querySelectorAll("dialog[open]")].some(d=>d.innerText.includes("当前页面尚未保存"))')
    check('deleting current folder asks how to handle manual-save draft',any(f['id']==draft_folder['id'] for f in snap()['folders']))
    button('保存草稿');c.wait('!document.querySelector("dialog[open]")')
    check('delete saves pending draft and keeps editing its page',json.loads(inv('dev_log_page_get',{'id':draft_page['id']})['documentJson'])==draft and evaluate('return e.getJSON()')==draft)
    check('current folder removed without revision conflict',all(f['id']!=draft_folder['id'] for f in snap()['folders']) and not c.evaluate('Boolean(document.querySelector(".log-error"))'))
    empty=inv('dev_log_folder_create',{'projectId':project['id']})
    c.wait('Boolean(document.querySelector('+json.dumps('.log-folder-row[data-folder-id="'+empty['id']+'"]')+'))')
    folder_context(empty['id']);button('删除文件夹');c.wait('Boolean(document.querySelector("dialog[open]"))');button('删除文件夹并保留页面')
    c.wait('!document.querySelector("dialog[open]")')
    check('empty folder can also be deleted',all(f['id']!=empty['id'] for f in snap()['folders']))
    stable=json.dumps(snap(),sort_keys=True)
    c.close();c=None;process.terminate();process.wait(timeout=15);process=None
    process=subprocess.Popen([str(EXE),'--autostart'],env=env,cwd=ROOT,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
    c=CDP(9351);c.wait('Boolean(document.querySelector(".status-dot.connected"))')
    check('restart preserves style, pages and deleted folder state',json.dumps(snap(),sort_keys=True)==stable)
    print(json.dumps({'output':str(OUT),'passed':len(checks)},ensure_ascii=False))
except Exception:
    if c:
        try:
            c.screenshot(OUT/'failure.png')
            (OUT/'failure.json').write_text(json.dumps(c.evaluate('({text:document.body.innerText,buttons:[...document.querySelectorAll("button")].map(b=>({label:b.getAttribute("aria-label"),text:b.textContent,disabled:b.disabled}))})'),ensure_ascii=False,indent=2),encoding='utf-8')
        except Exception:pass
    print('Evidence: '+str(OUT),flush=True);raise
finally:
    if c:c.close()
    if process and process.poll() is None:process.terminate();process.wait(timeout=15)
    log.close()
