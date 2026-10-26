"""Run isolated native Perfboard integration tests. Build debug first; all data stay in .quality."""
from pathlib import Path
import json,os,subprocess,time,base64,sys,hashlib
from cdp_client import CDP
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.quality'/('native-'+time.strftime('%Y%m%d-%H%M%S'))
OUT.mkdir(parents=True)
env=os.environ.copy()
env['PERFBOARD_TEST_CONFIG_DIR']=str(OUT/'config')
env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--remote-debugging-port=9333 --remote-allow-origins=*'
env['WEBVIEW2_USER_DATA_FOLDER']=str(OUT/'webview-profile')
EXE=ROOT/'src-tauri/target/debug/perfboard.exe'
LOG=(OUT/'native.log').open('wb')
results=[]
def check(name,condition,detail=None):
 results.append({'name':name,'passed':bool(condition),'detail':detail})
 (OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
 if not condition:raise AssertionError(name+': '+str(detail))
def start():
 p=subprocess.Popen([str(EXE)],cwd=ROOT,env=env,stdout=LOG,stderr=LOG,creationflags=subprocess.CREATE_NO_WINDOW)
 c=CDP(9333);c.wait("Boolean(document.querySelector('.app-shell'))");c.wait("Boolean(document.querySelector('.status-dot.connected'))")
 return p,c
def invoke(c,name,args=None):
 return c.evaluate("window.__TAURI_INTERNALS__.invoke("+json.dumps(name)+","+json.dumps(args or {})+")")
def click(c,selector):
 c.evaluate("document.querySelector("+json.dumps(selector)+").click()")
def setvalue(c,selector,value):
 c.evaluate("(function(){const e=document.querySelector("+json.dumps(selector)+");const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,"+json.dumps(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()")
def button(c,text):
 c.evaluate("(function(){const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==="+json.dumps(text)+"&&!e.disabled&&e.getClientRects().length);if(!e)throw Error('Button missing: '+"+json.dumps(text)+");e.click()})()")
proc=None;cdp=None
try:
 init=subprocess.run([str(EXE),'--initialize-repository',str(OUT/'repository')],cwd=ROOT,env=env,stdout=LOG,stderr=LOG,timeout=20)
 check('installer-init CLI succeeds',init.returncode==0)
 proc,cdp=start()
 check('native repository ready',invoke(cdp,'repo_status')['ready'])
 check('empty first run no fake seed',len(invoke(cdp,'data_snapshot')['parts'])==0)
 cdp.wait("document.documentElement.dataset.theme==='codex'")
 check('Codex default theme',cdp.evaluate("getComputedStyle(document.body).backgroundColor"))
 button(cdp,'物料仓库');cdp.wait("Boolean(document.querySelector('[data-testid=part-new]'))")
 click(cdp,'[data-testid=part-new]')
 cdp.wait("Boolean(document.querySelector('[data-testid=part-name]'))")
 setvalue(cdp,'[data-testid=part-name]','E2E-TPS54331')
 setvalue(cdp,'[data-testid=part-category]','电源')
 setvalue(cdp,'[data-testid=part-parameters]','3 A / 570 kHz')
 setvalue(cdp,'[data-testid=part-brief]','输入 3.5–28 V\n输出可低至 0.8 V')
 click(cdp,'[data-testid=part-save]')
 cdp.wait("window.__TAURI_INTERNALS__.invoke('data_snapshot').then(x=>x.parts.some(p=>p.name==='E2E-TPS54331'))")
 snapshot=invoke(cdp,'data_snapshot');part=snapshot['parts'][0];check('UI part committed nullable quantity',part['quantity'] is None)
 check('UI multiline brief committed','\n' in part['brief'])
 invoke(cdp,'attachment_import',{'partId':part['id'],'sourcePath':str(ROOT/'src-tauri/icons/icon.png')})
 snapshot=invoke(cdp,'data_snapshot');attachment=snapshot['attachments'][0]
 copied=OUT/'repository'/attachment['relativePath']
 check('managed image copied source retained',copied.exists() and (ROOT/'src-tauri/icons/icon.png').exists())
 check('copy exact bytes',hashlib.sha256(copied.read_bytes()).digest()==hashlib.sha256((ROOT/'src-tauri/icons/icon.png').read_bytes()).digest())
 invoke(cdp,'attachment_add_url',{'partId':part['id'],'url':'https://www.ti.com/product/TPS54331','name':'官方规格'})
 button(cdp,'工作台');cdp.wait("Boolean(document.querySelector('[data-testid=workbench-search]'))")
 setvalue(cdp,'[data-testid=workbench-search]','E2E-TPS54331')
 cdp.wait("document.querySelector('.main-content').textContent.includes('E2E-TPS54331')")
 check('dynamic workbench part result',True)
 button(cdp,'笔记列表');cdp.wait("Boolean(document.querySelector('[data-testid=note-new]'))")
 click(cdp,'[data-testid=note-new]');setvalue(cdp,'input[aria-label="新笔记标题"]','E2E image note')
 button(cdp,'创建随笔')
 cdp.wait("Boolean(document.querySelector('[data-testid=note-save-metadata]:not(:disabled)'))",30)
 common={'angle':0,'strokeColor':'#222222','backgroundColor':'transparent','fillStyle':'hachure','strokeWidth':1,'strokeStyle':'solid','roughness':1,'opacity':100,'groupIds':[],'frameId':None,'roundness':None,'seed':11,'version':1,'versionNonce':11,'isDeleted':False,'boundElements':None,'updated':1,'link':None,'locked':False}
 text=dict(common,id='e2eText',type='text',x=60,y=50,width=310,height=25,text='NATIVE_SCENE_RECOVERY',originalText='NATIVE_SCENE_RECOVERY',fontSize=20,fontFamily=1,textAlign='left',verticalAlign='top',containerId=None,lineHeight=1.25,autoResize=True)
 image=dict(common,id='e2eImage',type='image',x=70,y=100,width=128,height=128,fileId='e2ePng',status='saved',scale=[1,1],crop=None)
 scene={'type':'excalidraw','version':2,'source':'Perfboard QA','elements':[text,image],'appState':{'viewBackgroundColor':'#ffffff','scrollX':0,'scrollY':0,'zoom':{'value':1}},'files':{'e2ePng':{'id':'e2ePng','mimeType':'image/png','dataURL':'data:image/png;base64,'+base64.b64encode((ROOT/'src-tauri/icons/icon.png').read_bytes()).decode(),'created':1,'lastRetrieved':1}}}
 fixture=OUT/'image-note.excalidraw';fixture.write_text(json.dumps(scene),encoding='utf-8')
 doc=cdp.call('DOM.getDocument');node=cdp.call('DOM.querySelector',{'nodeId':doc['root']['nodeId'],'selector':'input[aria-label="导入本地 Excalidraw 画布"]'})['nodeId']
 cdp.call('DOM.setFileInputFiles',{'nodeId':node,'files':[str(fixture)]})
 cdp.wait("window.__TAURI_INTERNALS__.invoke('data_snapshot').then(x=>x.notes.some(n=>n.searchText.includes('NATIVE_SCENE_RECOVERY')))",20)
 click(cdp,'[data-testid=note-save-metadata]')
 note=next(n for n in invoke(cdp,'data_snapshot')['notes'] if n['title']=='E2E image note')
 saved=invoke(cdp,'note_get',{'id':note['id']});parsed=json.loads(saved['sceneJson'])
 check('UI Excalidraw import saved image+text',len(parsed['elements'])==2 and 'e2ePng' in parsed['files'])
 cdp.screenshot(OUT/'notes-with-image.png')
 setvalue(cdp,'[data-testid=note-title]','E2E image note renamed')
 button(cdp,'工作台');cdp.wait("Boolean(document.querySelector('[data-testid=workbench-search]'))")
 setvalue(cdp,'[data-testid=workbench-search]','NATIVE_SCENE_RECOVERY')
 cdp.wait("document.querySelector('.main-content').textContent.includes('E2E image note renamed')")
 check('note title flush and internal scene search dynamic',True)
 backup=OUT/'backup';invoke(cdp,'repository_backup',{'destination':str(backup)})
 check('online SQLite backup complete', (backup/'perfboard.sqlite3').exists() and (backup/attachment['relativePath']).exists())
 invoke(cdp,'app_close_request',{'action':'quit'})
 proc.wait(timeout=15);cdp.close();cdp=None
 proc,cdp=start()
 snapshot=invoke(cdp,'data_snapshot')
 check('restart part note attachment restored',len(snapshot['parts'])==1 and len(snapshot['notes'])==1 and len(snapshot['attachments'])==2)
 restored=invoke(cdp,'note_get',{'id':note['id']})
 check('restart image JSON preserved',json.loads(restored['sceneJson'])['files']['e2ePng']['dataURL']==scene['files']['e2ePng']['dataURL'])
 button(cdp,'笔记列表');cdp.wait("Boolean(document.querySelector('[data-note-id]'))")
 click(cdp,'[data-note-id="'+note['id']+'"]')
 cdp.wait("Boolean(document.querySelector('[data-testid=note-save-metadata]:not(:disabled)'))",30)
 time.sleep(4)
 restored2=invoke(cdp,'note_get',{'id':note['id']})
 check('hydration does not overwrite with empty scene',len(json.loads(restored2['sceneJson'])['elements'])==2)
 cdp.screenshot(OUT/'restored-notes.png')
 attempted=[e['params']['request']['url'] for e in cdp.events if e.get('method')=='Network.requestWillBeSent' and e.get('params',{}).get('request',{}).get('url','').startswith('https://')]
 (OUT/'network-events.json').write_text(json.dumps(cdp.events,ensure_ascii=False,indent=2),encoding='utf-8')
 check('cold restore no external HTTPS requests',not attempted,attempted[:5])
 invoke(cdp,'app_close_request',{'action':'quit'});proc.wait(timeout=15);cdp.close();cdp=None
 print(json.dumps({'output':str(OUT),'passed':len(results),'results':results},ensure_ascii=True))
except Exception as e:
 (OUT/'failure.txt').write_text(repr(e),encoding='utf-8')
 if cdp:
  try:cdp.screenshot(OUT/'failure.png')
  except Exception:pass
 print('Native E2E FAILED: '+str(e)[:1200]+'; output '+str(OUT))
 raise
finally:
 if cdp:cdp.close()
 if proc and proc.poll() is None:proc.terminate()
 LOG.close()
