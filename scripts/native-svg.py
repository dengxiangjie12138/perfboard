"""Native SVG persistence and blocked-scene regression; isolated fixtures only."""
from pathlib import Path
import os,json,time,subprocess,base64,urllib.parse
from cdp_client import CDP
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.quality'/('svg-'+time.strftime('%Y%m%d-%H%M%S'));OUT.mkdir()
env=os.environ.copy();env['PERFBOARD_TEST_CONFIG_DIR']=str(OUT/'config');env['WEBVIEW2_USER_DATA_FOLDER']=str(OUT/'cold-webview');env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--remote-debugging-port=9333 --remote-allow-origins=*'
exe=ROOT/'src-tauri/target/debug/perfboard.exe';results=[];proc=None;c=None

def check(name,ok,detail=None):
 results.append({'name':name,'passed':bool(ok),'detail':detail});(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
 if not ok:raise AssertionError(name+': '+str(detail))
def invoke(cmd,args=None):return c.evaluate('window.__TAURI_INTERNALS__.invoke('+json.dumps(cmd)+','+json.dumps(args or {})+')')
def click(selector):c.evaluate('document.querySelector('+json.dumps(selector)+').click()')
def button(text):c.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="+json.dumps(text)+"&&!b.disabled&&b.getClientRects().length).click()")
def start():
 global c,proc
 proc=subprocess.Popen([str(exe)],cwd=ROOT,env=env,creationflags=subprocess.CREATE_NO_WINDOW);c=CDP();c.wait("Boolean(document.querySelector('.status-dot.connected'))")
def quit():
 global c
 invoke('app_close_request',{'action':'quit'});proc.wait(timeout=15);c.close();c=None
def open_note(identifier,blocked=False):
 button('笔记列表');c.wait("Boolean(document.querySelector('[data-note-id=\""+identifier+"\"]'))")
 click('[data-note-id="'+identifier+'"]')
 selector='[data-testid=note-restore-blocked]' if blocked else '[data-testid=note-title]:not(:disabled)'
 c.wait('Boolean(document.querySelector('+json.dumps(selector)+'))',30)
def upload(path):
 doc=c.call('DOM.getDocument');node=c.call('DOM.querySelector',{'nodeId':doc['root']['nodeId'],'selector':'input[aria-label="导入本地 Excalidraw 画布"]'})['nodeId'];c.call('DOM.setFileInputFiles',{'nodeId':node,'files':[str(path)]})
try:
 check('initialize isolated SVG repository',subprocess.run([str(exe),'--initialize-repository',str(OUT/'repository')],env=env,capture_output=True,timeout=20).returncode==0)
 start()
 base=json.loads((ROOT/'.quality/native-20261002-022727/image-note.excalidraw').read_text(encoding='utf-8'))
 svg='<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120" viewBox="0 0 180 120"><defs><linearGradient id="g"><stop stop-color="#14532d"/><stop offset="1" stop-color="#22c55e"/></linearGradient></defs><rect width="180" height="120" fill="url(#g)"/><text x="15" y="65" fill="white" font-size="24">洞洞板 SVG</text></svg>'
 urls={'percentSvg':'data:image/svg+xml;charset=utf-8,'+urllib.parse.quote(svg,safe=''),'base64Svg':'data:image/svg+xml;base64,'+base64.b64encode(svg.encode()).decode()}
 scene={'type':'excalidraw','version':2,'source':'Perfboard QA','elements':[base['elements'][0]],'appState':base['appState'],'files':{}}
 for i,(identifier,url) in enumerate(urls.items()):
  element=dict(base['elements'][1],id='image-'+identifier,fileId=identifier,x=70+220*i,width=180,height=120)
  scene['elements'].append(element);scene['files'][identifier]={'id':identifier,'mimeType':'image/svg+xml','dataURL':url,'created':1,'lastRetrieved':1}
 safeid='qa-safe-svg';safe={'id':safeid,'title':'SAFE SVG','category':'学习笔记','searchText':'NATIVE_SCENE_RECOVERY','sceneJson':json.dumps(scene,ensure_ascii=False)}
 invoke('note_save',{'note':safe})
 unsafe_scene=json.loads(json.dumps(scene));unsafe_scene['files']['percentSvg']['dataURL']='data:image/svg+xml,'+urllib.parse.quote('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><image href="https://example.com/tracking.png"/></svg>',safe='')
 unsafeid='qa-unsafe-svg';unsafe={'id':unsafeid,'title':'UNSAFE ORIGINAL','category':'随笔','searchText':'','sceneJson':json.dumps(unsafe_scene)}
 invoke('note_save',{'note':unsafe});original=invoke('note_get',{'id':unsafeid})['sceneJson']
 c.evaluate('location.reload()');c.wait("Boolean(document.querySelector('.status-dot.connected'))")
 open_note(safeid);check('actual DOMParser accepts safe SVG encodings',True)
 c.screenshot(OUT/'safe-svg-rendered.png')
 c.evaluate("(function(){const e=document.querySelector('[data-testid=note-title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'SAFE SVG SAVED');e.dispatchEvent(new Event('input',{bubbles:true}));})()")
 click('[data-testid=note-save-metadata]');c.wait("window.__TAURI_INTERNALS__.invoke('note_get',{id:'qa-safe-svg'}).then(n=>n.title==='SAFE SVG SAVED')")
 saved=json.loads(invoke('note_get',{'id':safeid})['sceneJson']);check('edit preserves complete SVG files exactly',all(saved['files'][key]['dataURL']==value for key,value in urls.items()) and len(saved['elements'])==3)
 fixture=OUT/'unsafe-import.excalidraw';fixture.write_text(json.dumps(unsafe_scene),encoding='utf-8');before=invoke('note_get',{'id':safeid})['sceneJson'];upload(fixture)
 c.wait("Boolean(document.querySelector('[data-testid=note-import-filter-confirm]'))")
 check('unsafe import requires explicit confirmation',invoke('note_get',{'id':safeid})['sceneJson']==before)
 button('取消导入');c.wait("!document.querySelector('[data-testid=note-import-filter-confirm]')")
 check('cancel unsafe import preserves all saved files',invoke('note_get',{'id':safeid})['sceneJson']==before)
 quit();start();open_note(safeid);time.sleep(1)
 restored=json.loads(invoke('note_get',{'id':safeid})['sceneJson']);check('restart restores both SVG encodings without loss',all(restored['files'][key]['dataURL']==value for key,value in urls.items()) and len(restored['elements'])==3)
 c.screenshot(OUT/'safe-svg-restored.png')
 button('工作台');c.wait("Boolean(document.querySelector('[data-testid=workbench-search]'))");open_note(unsafeid,True)
 check('existing unsafe scene blocks editing',not c.evaluate("Boolean(document.querySelector('[data-testid=note-title]'))"))
 check('blocked scene offers original JSON export',c.evaluate("Boolean(document.querySelector('[data-testid=note-export-original]'))"))
 c.screenshot(OUT/'unsafe-scene-blocked.png');button('工作台');c.wait("Boolean(document.querySelector('[data-testid=workbench-search]'))")
 check('navigation does not overwrite blocked original',invoke('note_get',{'id':unsafeid})['sceneJson']==original)
 requests=[e['params']['request']['url'] for e in c.events if e.get('method')=='Network.requestWillBeSent' and e.get('params',{}).get('request',{}).get('url','').startswith(('http://','https://')) and urllib.parse.urlparse(e['params']['request']['url']).hostname not in {'127.0.0.1','localhost','tauri.localhost','ipc.localhost'}]
 check('SVG recovery causes no external HTTP requests',not requests,requests)
 quit();start();check('quit and restart preserve unsafe original byte-for-byte',invoke('note_get',{'id':unsafeid})['sceneJson']==original);quit()
 print(json.dumps({'output':str(OUT),'passed':len(results),'results':results},ensure_ascii=True))
except Exception as e:
 (OUT/'failure.txt').write_text(repr(e),encoding='utf-8')
 if c:
  try:c.screenshot(OUT/'failure.png')
  except Exception:pass
 print('SVG FAILED '+repr(e)+'; '+str(OUT));raise
finally:
 if c:c.close()
 if proc and proc.poll() is None:proc.terminate()
