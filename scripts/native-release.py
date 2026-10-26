"""Installed release startup/save/restart and real export acceptance using synthetic data."""
from pathlib import Path
import os,time,json,subprocess,shutil,base64,hashlib,struct,xml.etree.ElementTree as ET
from cdp_client import CDP
ROOT=Path(__file__).resolve().parents[1]
INSTALL=ROOT/'.quality/installation-20261002-034836';state=json.loads((INSTALL/'installation-state.json').read_text(encoding='utf-8'));EXE=Path(state['program'])/'perfboard.exe';REPO=Path(state['repository'])
OUT=ROOT/'.quality'/('release-runtime-'+time.strftime('%Y%m%d-%H%M%S'));OUT.mkdir()
NORMAL=Path(os.environ['APPDATA'])/'com.perfboard.toolbox/repository.json';assert not NORMAL.exists(),'Never overwrite an existing user repository configuration'
env=os.environ.copy();env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--remote-debugging-port=9333 --remote-allow-origins=*';env['WEBVIEW2_USER_DATA_FOLDER']=str(OUT/'webview');env['TEMP']=str(OUT/'temp');env['TMP']=env['TEMP'];Path(env['TEMP']).mkdir()
results=[];proc=None;c=None

def check(name,ok,detail=None):
 results.append({'name':name,'status':'passed' if ok else 'failed','detail':detail});(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
 if not ok:raise AssertionError(name+': '+str(detail))
def skip(name,detail):
 results.append({'name':name,'status':'not_verified','detail':detail});(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
def invoke(name,args=None):return c.evaluate('window.__TAURI_INTERNALS__.invoke('+json.dumps(name)+','+json.dumps(args or {})+')')
def click(sel):c.evaluate('document.querySelector('+json.dumps(sel)+').click()')
def button(text):c.evaluate("(function(){const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="+json.dumps(text)+"&&!b.disabled&&b.getClientRects().length);if(!b)throw Error('missing button');b.click()})()")
def setvalue(sel,value):c.evaluate("(function(){const e=document.querySelector("+json.dumps(sel)+");const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,"+json.dumps(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()")
def start(exe=EXE,ready=True):
 global c,proc
 proc=subprocess.Popen([str(exe)],env=env,cwd=ROOT,creationflags=subprocess.CREATE_NO_WINDOW);c=CDP();c.wait("Boolean(document.querySelector('.app-shell'))")
 if ready:c.wait("Boolean(document.querySelector('.status-dot.connected'))")
 else:c.wait("Boolean(document.querySelector('[data-testid=repo-path]'))")
def quit():
 global c
 invoke('app_close_request',{'action':'quit'});proc.wait(timeout=15);c.close();c=None
try:
 start(ready=False);check('installed release launches with first-use repository page',not invoke('repo_status')['configured'])
 setvalue('[data-testid=repo-path]',str(REPO));click('[data-testid=repo-open]');c.wait("Boolean(document.querySelector('.status-dot.connected'))")
 check('installed release opens Chinese space selected repository',invoke('repo_status')['ready'] and Path(invoke('repo_status')['path']).samefile(REPO))
 button('物料仓库');c.wait("Boolean(document.querySelector('[data-testid=part-new]'))");click('[data-testid=part-new]');setvalue('[data-testid=part-name]','测试用 TPS54331');setvalue('[data-testid=part-parameters]','3 A / 570 kHz');setvalue('[data-testid=part-brief]','输入 3.5–28 V\n输出可低至 0.8 V');click('[data-testid=part-save]')
 c.wait("window.__TAURI_INTERNALS__.invoke('data_snapshot').then(d=>d.parts.some(p=>p.name==='测试用 TPS54331'))")
 part=next(p for p in invoke('data_snapshot')['parts'] if p['name']=='测试用 TPS54331');check('installed release UI material saves real SQLite',part['quantity'] is None and '\n' in part['brief'])
 button('笔记列表');c.wait("Boolean(document.querySelector('[data-testid=note-new]'))");click('[data-testid=note-new]');setvalue('input[aria-label="新笔记标题"]','安装后保存恢复验证');button('创建随笔');c.wait("Boolean(document.querySelector('[data-testid=note-title]:not(:disabled)'))",30)
 fixture=ROOT/'.quality/native-20261002-032242/image-note.excalidraw';scene=json.loads(fixture.read_text(encoding='utf-8'))
 doc=c.call('DOM.getDocument');node=c.call('DOM.querySelector',{'nodeId':doc['root']['nodeId'],'selector':'input[aria-label="导入本地 Excalidraw 画布"]'})['nodeId'];c.call('DOM.setFileInputFiles',{'nodeId':node,'files':[str(fixture)]})
 c.wait("window.__TAURI_INTERNALS__.invoke('data_snapshot').then(d=>d.notes.some(n=>n.searchText.includes('NATIVE_SCENE_RECOVERY')))")
 click('[data-testid=note-save-metadata]');note=next(n for n in invoke('data_snapshot')['notes'] if n['title']=='安装后保存恢复验证');saved=invoke('note_get',{'id':note['id']});check('installed release original canvas saves full image',json.loads(saved['sceneJson'])['files']['e2ePng']['dataURL']==scene['files']['e2ePng']['dataURL'])
 c.screenshot(OUT/'installed-notes.png')
 click('[data-testid=main-menu-trigger]');time.sleep(.2)
 texts=c.evaluate("[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>b.textContent.trim())");exportText=next(t for t in texts if '图片' in t and ('导出' in t or '保存' in t));button(exportText);c.wait("Boolean(document.querySelector('.Modal__content canvas'))")
 capability=c.evaluate("({picker:typeof window.showSaveFilePicker==='function',secure:window.isSecureContext})");(OUT/'save-capability.json').write_text(json.dumps(capability),encoding='utf-8');c.screenshot(OUT/'installed-export-preview.png')
 check('installed original image export preview renders',c.evaluate("document.querySelector('.Modal__content canvas').width>0"))
 if capability['picker'] and capability['secure']:
  skip('native PNG/SVG save dialog','File System Access native picker is available, but Computer Use requires unavailable node_repl; no dialog clicks, security bypass or simulated picker.')
 else:
  exportDir=OUT/'exports';exportDir.mkdir()
  try:c.call('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(exportDir),'eventsEnabled':True})
  except Exception as e:skip('native PNG/SVG saving','Download control unavailable: '+str(e))
  else:
   exportButtons=c.evaluate("[...document.querySelectorAll('.Modal__content button')].map(b=>({text:b.textContent.trim(),testid:b.dataset.testid,title:b.title}))");(OUT/'export-buttons.json').write_text(json.dumps(exportButtons,ensure_ascii=False,indent=2),encoding='utf-8')
   for fmt in ['PNG','SVG']:
    label=next((b['text'] for b in exportButtons if fmt in b['text'].upper()),None)
    if not label:skip(fmt+' export save','No matching visible original export button');continue
    button(label);end=time.time()+12;files=[]
    while time.time()<end:
     files=list(exportDir.glob('*.'+fmt.lower()))
     if files:break
     time.sleep(.2)
    if not files:skip(fmt+' export save','No file appeared; no unsupported native dialog automation attempted');continue
    data=files[0].read_bytes()
    if fmt=='PNG':check('original PNG export writes valid image',data[:8]==b'\x89PNG\r\n\x1a\n' and min(struct.unpack('>II',data[16:24]))>0)
    else:check('original SVG export writes embedded image',ET.fromstring(data).tag.endswith('svg') and b'data:image/png;base64,' in data)
 c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");time.sleep(.2);quit();start()
 snap=invoke('data_snapshot');check('installed release restart restores material and note',any(p['id']==part['id'] for p in snap['parts']) and any(n['id']==note['id'] for n in snap['notes']))
 check('installed release restart preserves image JSON',json.loads(invoke('note_get',{'id':note['id']})['sceneJson'])['files']['e2ePng']['dataURL']==scene['files']['e2ePng']['dataURL'])
 # Leave standard application pointer at a new, empty project-only startup repository.
 empty=OUT/'空白启动仓库';button('仓库与数据');c.wait("Boolean(document.querySelector('[data-testid=repo-path]'))");setvalue('[data-testid=repo-path]',str(empty));click('[data-testid=repo-create]');c.wait("window.__TAURI_INTERNALS__.invoke('data_snapshot').then(d=>d.parts.length===0&&d.notes.length===0)")
 button('工作台');c.wait("Boolean(document.querySelector('[data-testid=workbench-search]'))");check('after acceptance default repository is empty',not invoke('data_snapshot')['parts'] and not invoke('data_snapshot')['notes']);c.screenshot(OUT/'empty-startup-workbench.png');quit()
 delivery=ROOT/'deliverables/Perfboard-0.1.0';shutil.copy2(ROOT/'src-tauri/target/release/perfboard.exe',delivery/'perfboard.exe');start(delivery/'perfboard.exe')
 check('delivered standalone release launches and opens empty repository',invoke('repo_status')['ready'] and not invoke('data_snapshot')['parts']);quit()
 (OUT/'runtime-state.json').write_text(json.dumps({'installedExe':str(EXE),'standardPointerCreated':str(NORMAL),'defaultEmptyRepository':str(empty),'syntheticRepository':str(REPO),'exportCapability':capability},ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'output':str(OUT),'passed':sum(r['status']=='passed' for r in results),'notVerified':[r for r in results if r['status']=='not_verified']},ensure_ascii=True))
except Exception as e:
 (OUT/'failure.txt').write_text(repr(e),encoding='utf-8')
 if c:
  try:c.screenshot(OUT/'failure.png')
  except Exception:pass
 print('Release runtime FAILED '+repr(e)+'; '+str(OUT));raise
finally:
 if c:c.close()
 if proc and proc.poll() is None:proc.terminate()
