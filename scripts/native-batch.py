"""Focused native acceptance. Run only after an isolated batch debug build gate exists.

No installs, production paths, global configuration, force-kills, or broad suites.
Gate .quality/batch-native-build.json: identifier, exe, exeSha256 (required).
The build's companion Tauri config must be .quality/batch-native-tauri.json.
"""
from pathlib import Path
import hashlib,json,os,socket,subprocess,time
from cdp_client import CDP

ROOT=Path(__file__).resolve().parents[1]
QUALITY=ROOT/'.quality'
PORT=9347
IDENTIFIER='com.perfboard.toolbox.batchtest'
OUT=QUALITY/('batch-native-'+time.strftime('%Y%m%d-%H%M%S'))
results=[]
proc=cdp=log=None

def check(name,condition,detail=None):
    results.append(dict(name=name,passed=bool(condition),detail=detail))
    (OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    if not condition:
        raise AssertionError(name+': '+str(detail))

def invoke(name,args=None):
    return cdp.evaluate("window.__TAURI_INTERNALS__.invoke("+json.dumps(name)+","+json.dumps(args or {})+")")

def click(selector):
    cdp.evaluate("document.querySelector("+json.dumps(selector)+").click()")

def value(selector,text):
    cdp.evaluate("""(()=>{const e=document.querySelector(%s);if(!e)throw Error('Missing field');
    const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(p,'value').set.call(e,%s);
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()"""%(json.dumps(selector),json.dumps(text)))

def wait(expression,seconds=15):
    cdp.wait(expression,seconds)

def snapshot():
    return invoke('data_snapshot')

def route(selector):
    click(selector)
    time.sleep(.3)

def newpart(name,package='',location='',brand='',lcsc='',brief='',category=''):
    click('[data-testid=part-new]')
    wait("Boolean(document.querySelector('[data-testid=part-name]'))")
    for field,text in [('name',name),('package',package),('location',location),('brand',brand),('lcsc',lcsc),('brief',brief),('category',category)]:
        value('[data-testid=part-'+field+']',text)
    click('[data-testid=part-save]')
    wait("!document.querySelector('[data-testid=part-form]')")
    return next(p for p in snapshot()['parts'] if p['name']==name)

def newnote(title):
    click('[data-testid=note-new]')
    wait("Boolean(document.querySelector('.notes-new input'))")
    value('.notes-new input',title)
    click('.notes-new button[type=submit]')
    wait("document.querySelector('[data-testid=note-title]')?.value==="+json.dumps(title)+"&&Boolean(document.querySelector('[data-testid=note-save-metadata]:not(:disabled)'))",30)
    return next(n for n in snapshot()['notes'] if n['title']==title)

def quit_owned():
    global proc,cdp
    if proc is None or proc.poll() is not None:
        if cdp: cdp.close();cdp=None
        return
    if cdp is None:
        raise RuntimeError('Owned PID remains running; no safe IPC connection. No process was killed.')
    # Only the debug process launched here, with checked identifier and dedicated port.
    try:
        invoke('app_close_request',{'action':'quit'})
    except Exception:
        if proc.poll() is None:
            raise
    proc.wait(timeout=20)
    cdp.close();cdp=None
    # WebView's own child process may release its port shortly after native exit.
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1',PORT))!=0: break
        time.sleep(.2)
    else: raise RuntimeError('Owned WebView CDP port did not close after safe IPC quit.')
    proc=None

def start(exe,env):
    global proc,cdp
    with socket.socket() as sock:
        if sock.connect_ex(('127.0.0.1',PORT))==0:
            raise RuntimeError('Dedicated CDP port already occupied; refusing attachment.')
    proc=subprocess.Popen([str(exe)],cwd=ROOT,env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
    (OUT/'owned-process.json').write_text(json.dumps({'pid':proc.pid,'identifier':IDENTIFIER,'exe':str(exe)}),encoding='utf-8')
    cdp=CDP(PORT)
    check('owned debug process alive',proc.poll() is None,proc.pid)
    wait("Boolean(document.querySelector('.status-dot.connected'))")
    repo=invoke('repo_status')
    check('repository exclusively in fixture',Path(repo['path'].removeprefix('\\\\?\\')).resolve()==(OUT/'repository').resolve(),repo)

def main():
    global log
    gate=json.loads((QUALITY/'batch-native-build.json').read_text(encoding='utf-8-sig'))
    config=json.loads((QUALITY/'batch-native-tauri.json').read_text(encoding='utf-8-sig'))
    if gate.get('identifier')!=IDENTIFIER or config.get('identifier')!=IDENTIFIER:
        raise RuntimeError('Missing isolated debug identifier confirmation.')
    exe=Path(gate['exe']).resolve()
    if ROOT not in exe.parents or 'debug' not in exe.parts or exe.name!='perfboard.exe':
        raise RuntimeError('Refusing executable outside project debug directory.')
    if hashlib.sha256(exe.read_bytes()).hexdigest()!=gate.get('exeSha256'):
        raise RuntimeError('Build gate hash does not match executable.')
    OUT.mkdir(parents=True,exist_ok=False)
    log=(OUT/'native.log').open('wb')
    env=os.environ.copy()
    env['PERFBOARD_TEST_CONFIG_DIR']=str(OUT/'config')
    env['WEBVIEW2_USER_DATA_FOLDER']=str(OUT/'webview-profile')
    env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--remote-debugging-port=9347 --remote-allow-origins=*'
    initialized=subprocess.run([str(exe),'--initialize-repository',str(OUT/'repository')],cwd=ROOT,env=env,stdout=log,stderr=log,timeout=30)
    check('isolated repository initialized',initialized.returncode==0)
    start(exe,env)
    check('fresh repository empty',snapshot()['parts']==[] and snapshot()['notes']==[])
    route('.sidebar nav > button.nav-row:nth-of-type(2)')
    wait("Boolean(document.querySelector('[data-testid=part-new]'))")
    a=newpart('0Ω','0805','0805电阻盒',brief='零欧跳线\n第二行')
    check('model and package independent columns',cdp.evaluate("(()=>{const r=document.querySelector('.part-row');return r.children[0].textContent==='0Ω'&&r.children[1].textContent==='0805'&&document.querySelectorAll('.parts-table th').length===6})()"))
    click('[data-testid=part-new]')
    wait("Boolean(document.querySelector('[data-testid=part-name]'))")
    check('no parameters field',not cdp.evaluate("Boolean(document.querySelector('[data-testid=part-parameters]'))"))
    check('compact independent model/package inputs',cdp.evaluate("(()=>{const a=document.querySelector('[data-testid=part-name]').getBoundingClientRect(),b=document.querySelector('[data-testid=part-package]').getBoundingClientRect();return Math.abs(a.top-b.top)<5&&b.left>a.left})()"))
    check('optional metadata text inputs',cdp.evaluate("['brand','lcsc'].every(x=>{const e=document.querySelector('[data-testid=part-'+x+']');return e.type==='text'&&!e.required})"))
    value('[data-testid=part-location]','0')
    check('typing 0 offers 0805 box',cdp.evaluate("[...document.querySelectorAll('#part-locations option')].some(e=>e.value==='0805电阻盒')"))
    for field,text in [('name','STM32F103C8T6'),('package','LQFP48'),('brand','ST'),('lcsc','00C123ABC'),('location','新位置批次验证'),('brief','微控制器\n多行简介')]:
        value('[data-testid=part-'+field+']',text)
    click('[data-testid=part-save]')
    wait("!document.querySelector('[data-testid=part-form]')")
    b=next(p for p in snapshot()['parts'] if p['name']=='STM32F103C8T6')
    check('optional empty metadata accepted',not a.get('brand') and not a.get('lcscNumber'))
    check('metadata exact leading zeroes and letters',b.get('brand')=='ST' and b.get('lcscNumber')=='00C123ABC')
    click('[data-testid=part-new]')
    check('new free location becomes next candidate',cdp.evaluate("[...document.querySelectorAll('#part-locations option')].some(e=>e.value==='新位置批次验证')"))
    click('[data-testid=part-form] .modal-actions button[type=button]')
    click('[data-part-id="'+b['id']+'"] td:last-child button')
    click('.modal-actions.split button:last-child')
    wait("Boolean(document.querySelector('[data-testid=part-brief]'))")
    value('[data-testid=part-brief]','编辑后的第一行\n编辑后的第二行')
    value('[data-testid=part-lcsc]','000A9Z')
    click('[data-testid=part-save]')
    wait("!document.querySelector('[data-testid=part-form]')")
    check('multiline brief edit saved',next(p for p in snapshot()['parts'] if p['id']==b['id'])['brief']=='编辑后的第一行\n编辑后的第二行')
    # Detail may remain open after edit; its accessible close button is first.
    if cdp.evaluate("Boolean(document.querySelector('dialog[open]'))"):
        click('dialog[open] .modal-heading button')
    newpart('100 kΩ','0805',category='resistor')
    newpart('32 kΩ','0805',category='resistor')
    route('#submenu-notes button:first-child')
    wait("Boolean(document.querySelector('.notes-heading'))")
    check('overview full heading/sidebar',cdp.evaluate("Boolean(document.querySelector('.notes-heading')&&document.querySelector('.notes-sidebar'))"))
    # All category routes must remove internal heading/list, retain global navigation.
    for index in range(2,6):
        route('#submenu-notes button:nth-child('+str(index)+')')
        wait("Boolean(document.querySelector('[data-testid=notes-focused-controls]'))")
        check('category '+str(index-1)+' focused layout',cdp.evaluate("!document.querySelector('.notes-heading')&&!document.querySelector('.notes-sidebar')&&Boolean(document.querySelector('.sidebar')&&document.querySelector('.topbar')&&document.querySelector('[data-testid=notes-focused-controls] select'))"))
        check('category '+str(index-1)+' full width workspace',cdp.evaluate("(()=>{const a=document.querySelector('.notes-layout').getBoundingClientRect(),b=document.querySelector('.notes-workspace').getBoundingClientRect();return Math.abs(a.width-b.width)<3})()"))
    route('#submenu-notes button:nth-child(2)')
    n1=newnote('批次笔记一')
    scene={'type':'excalidraw','version':2,'source':'Perfboard batch acceptance','elements':[{'id':'batch-rectangle','type':'rectangle','x':50,'y':50,'width':120,'height':80,'angle':0,'strokeColor':'#1e1e1e','backgroundColor':'transparent','fillStyle':'hachure','strokeWidth':1,'strokeStyle':'solid','roughness':1,'opacity':100,'groupIds':[],'frameId':None,'roundness':None,'seed':1,'version':1,'versionNonce':1,'isDeleted':False,'boundElements':None,'updated':1,'link':None,'locked':False}], 'appState':{'viewBackgroundColor':'#ffffff'},'files':{}}
    fixture=OUT/'batch-scene.excalidraw'
    fixture.write_text(json.dumps(scene),encoding='utf-8')
    root=cdp.call('DOM.getDocument')['root']['nodeId']
    node=cdp.call('DOM.querySelector',{'nodeId':root,'selector':'.notes-import input[type=file]'})['nodeId']
    cdp.call('DOM.setFileInputFiles',{'nodeId':node,'files':[str(fixture)]})
    wait("Boolean(document.querySelector('[data-testid=note-save-metadata]:not(:disabled)'))")
    value('[data-testid=note-title]','批次笔记一已编辑')
    click('[data-testid=note-save-metadata]')
    wait("window.__TAURI_INTERNALS__.invoke('note_get',{id:"+json.dumps(n1['id'])+"}).then(n=>n.title==='批次笔记一已编辑'&&JSON.parse(n.sceneJson).elements.some(e=>e.id==='batch-rectangle'))")
    n2=newnote('批次笔记二')
    value('[data-testid=notes-focused-controls] select',n1['id'])
    wait("document.querySelector('[data-testid=note-title]')?.value==='批次笔记一已编辑'")
    check('switch preserves first note canvas',any(e['id']=='batch-rectangle' for e in json.loads(invoke('note_get',{'id':n1['id']})['sceneJson'])['elements']))
    cdp.screenshot(OUT/'focused-note.png')
    route('#submenu-notes button:first-child')
    wait("Boolean(document.querySelector('.notes-heading'))")
    check('route exit preserves note title',invoke('note_get',{'id':n1['id']})['title']=='批次笔记一已编辑')
    # Feedback only: limit field, rendered current/power, invalid input and both sources.
    if not cdp.evaluate("!document.querySelector('#submenu-hardware').hidden"):
        click('[aria-controls=submenu-hardware]')
    route('#submenu-hardware button:nth-child(2)')
    wait("Boolean(document.querySelector('.calc-formula'))")
    inputs=cdp.evaluate("document.querySelectorAll('.calc-card form input').length")
    check('feedback cap input present',inputs>=4)
    click('.calc-card form button[type=submit]')
    wait("Boolean(document.querySelector('.calc-table tbody tr'))")
    check('feedback candidate current and powers',cdp.evaluate("document.querySelector('.calc-table tbody tr').children.length===5&&document.querySelector('.calc-table tbody tr').textContent.includes('mA')&&document.querySelector('.calc-table tbody tr').textContent.includes('mW')"))
    # NumberField labels each wrap an input; select by the containing form's input index.
    cdp.evaluate("document.querySelectorAll('.calc-card form input')[3].setAttribute('data-batch-cap','')")
    value('[data-batch-cap]','0')
    click('.calc-card form button[type=submit]')
    wait("!document.querySelector('.calc-table tbody tr')")
    check('invalid zero cap has no candidates',not cdp.evaluate("Boolean(document.querySelector('.calc-table tbody tr'))"))
    value('[data-batch-cap]','0.1')
    value('.calc-card form select','inventory')
    click('.calc-card form button[type=submit]')
    wait("Boolean(document.querySelector('.calc-table tbody tr'))")
    check('inventory candidates show current and powers',cdp.evaluate("document.querySelector('.calc-card form select').value==='inventory'&&document.querySelector('.calc-table tbody tr').textContent.includes('mA')&&document.querySelector('.calc-table tbody tr').textContent.includes('mW')"))
    value('[data-batch-cap]','')
    click('.calc-card form button[type=submit]')
    wait("!document.querySelector('.calc-table tbody tr')")
    check('empty inventory cap has no candidates',not cdp.evaluate("Boolean(document.querySelector('.calc-table tbody tr'))"))
    cdp.screenshot(OUT/'feedback-inventory.png')
    quit_owned()
    start(exe,env)
    parts=snapshot()['parts']
    restored=next(p for p in parts if p['id']==b['id'])
    check('restart material metadata and multiline persisted',restored['brief']=='编辑后的第一行\n编辑后的第二行' and restored.get('lcscNumber')=='000A9Z' and restored.get('brand')=='ST')
    restored_note=invoke('note_get',{'id':n1['id']})
    check('restart note title and canvas persisted',restored_note['title']=='批次笔记一已编辑' and any(e['id']=='batch-rectangle' for e in json.loads(restored_note['sceneJson'])['elements']))
    route('#submenu-notes button:nth-child(2)')
    wait("Boolean(document.querySelector('[data-testid=notes-focused-controls] select:not(:disabled)'))")
    value('[data-testid=notes-focused-controls] select',n1['id'])
    wait("document.querySelector('[data-testid=note-title]')?.value==='批次笔记一已编辑'&&Boolean(document.querySelector('[data-testid=note-save-metadata]:not(:disabled)'))",30)
    check('restart note hydration preserves canvas',any(e['id']=='batch-rectangle' for e in json.loads(invoke('note_get',{'id':n1['id']})['sceneJson'])['elements']))
    cdp.screenshot(OUT/'restarted-note.png')
    quit_owned()
    print(json.dumps({'output':str(OUT),'passed':len(results)},ensure_ascii=False))

if __name__=='__main__':
    try:
        main()
    except Exception as error:
        if OUT.exists():
            (OUT/'failure.txt').write_text(repr(error),encoding='utf-8')
            if cdp:
                try: cdp.screenshot(OUT/'failure.png')
                except Exception: pass
        raise
    finally:
        if proc and proc.poll() is None:
            try: quit_owned()
            except Exception as error:
                print('Safe IPC cleanup failed for owned PID '+str(proc.pid)+': '+str(error)+'. No process force-killed.')
        if cdp: cdp.close()
        if log: log.close()
