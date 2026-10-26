from pathlib import Path
import os,sys,json,time,subprocess,shutil,sqlite3
from cdp_client import CDP
ROOT=Path(__file__).resolve().parents[1]
BASE=sorted((ROOT/'.quality').glob('native-20*'))[-1]
OUT=ROOT/'.quality'/('extended-'+time.strftime('%Y%m%d-%H%M%S'));OUT.mkdir()
shutil.copytree(BASE/'backup',OUT/'repository')
env=os.environ.copy();env['PERFBOARD_TEST_CONFIG_DIR']=str(OUT/'config');env['WEBVIEW2_USER_DATA_FOLDER']=str(OUT/'cold-webview');env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--remote-debugging-port=9333 --remote-allow-origins=*'
exe=ROOT/'src-tauri/target/debug/perfboard.exe';results=[];proc=None;c=None;write_lock=None
def check(name,ok,detail=None):
 results.append({'name':name,'passed':bool(ok),'detail':detail});(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
 if not ok:raise AssertionError(name+': '+str(detail))
def invoke(name,args=None):return c.evaluate('window.__TAURI_INTERNALS__.invoke('+json.dumps(name)+','+json.dumps(args or {})+')')
def click(sel):c.evaluate('document.querySelector('+json.dumps(sel)+').click()')
def button(text):c.evaluate("(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==="+json.dumps(text)+"&&!x.disabled&&x.getClientRects().length);if(!b)throw Error('missing button '+"+json.dumps(text)+");b.click()})()")
def setvalue(sel,v):c.evaluate("(function(){const e=document.querySelector("+json.dumps(sel)+");const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,"+json.dumps(v)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()")
def start(expect_ready=True):
 global proc,c
 proc=subprocess.Popen([str(exe)],cwd=ROOT,env=env,creationflags=subprocess.CREATE_NO_WINDOW);c=CDP();c.wait("Boolean(document.querySelector('.app-shell'))")
 if expect_ready:c.wait("Boolean(document.querySelector('.status-dot.connected'))")
def quit():
 global c
 invoke('app_close_request',{'action':'quit'});proc.wait(timeout=15);c.close();c=None
try:
 check('bootstrap existing repository CLI',subprocess.run([str(exe),'--initialize-repository',str(OUT/'repository')],env=env,capture_output=True,timeout=20).returncode==0)
 start();button('物料仓库');c.wait("Boolean(document.querySelector('[data-testid=part-new]'))")
 click('[data-testid=part-new]');setvalue('[data-testid=part-name]','CANCELLED-PART');button('取消')
 check('cancel new part makes no row',len(invoke('data_snapshot')['parts'])==1)
 click('[data-testid=part-new]');setvalue('[data-testid=part-name]','E2E-R10K');setvalue('[data-testid=part-category]','电阻');setvalue('[data-testid=part-parameters]','10 kΩ 1%');click('[data-testid=part-save]')
 c.wait("window.__TAURI_INTERNALS__.invoke('data_snapshot').then(x=>x.parts.length===2)");c.wait("document.querySelectorAll('tr[data-part-id]').length===2")
 rows=c.evaluate("[...document.querySelectorAll('tr[data-part-id]')].map(x=>x.dataset.partId)")
 for i,id in enumerate(rows):
  click('tr[data-part-id="'+id+'"]');c.wait("document.querySelectorAll('.brief-row').length==="+str(i+1))
 check('two independently expanded rows',c.evaluate("document.querySelectorAll('.brief-row').length")==2)
 click('tr[data-part-id="'+rows[0]+'"]');c.wait("document.querySelectorAll('.brief-row').length===1");check('collapse retains other row',c.evaluate("document.querySelectorAll('.brief-row').length")==1)
 p=next(p for p in invoke('data_snapshot')['parts'] if p['id']==rows[1])
 c.evaluate("document.querySelector('#brief-"+p['id']+" .brief-actions button').click()")
 setvalue('#brief-'+p['id']+' textarea','CANCELLED-BRIEF')
 c.evaluate("[...document.querySelectorAll('#brief-"+p['id']+" button')].find(b=>b.textContent.trim()==='取消').click()")
 check('cancel brief preserves saved text',next(x for x in invoke('data_snapshot')['parts'] if x['id']==p['id'])['brief']==p['brief'])
 c.screenshot(OUT/'parts-expanded.png')
 # PDF copied into managed storage, original fixture stays unchanged.
 objs=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',b'<< /Length 0 >>\nstream\n\nendstream']
 pdf=b'%PDF-1.4\n';offsets=[]
 for i,o in enumerate(objs,1):offsets.append(len(pdf));pdf+=str(i).encode()+b' 0 obj\n'+o+b'\nendobj\n'
 xref=len(pdf);pdf+=b'xref\n0 5\n0000000000 65535 f \n'+b''.join(('%010d 00000 n \n'%o).encode() for o in offsets)+('trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n'%xref).encode()
 source=OUT/'fixture.pdf';source.write_bytes(pdf)
 a=invoke('attachment_import',{'partId':p['id'],'sourcePath':str(source)});check('PDF managed copy exact',source.read_bytes()==(OUT/'repository'/a['relativePath']).read_bytes())
 invoke('attachment_delete',{'id':a['id']});check('delete attachment retains source',source.exists() and not (OUT/'repository'/a['relativePath']).exists())
 button('外观');c.wait("Boolean(document.querySelector('[data-theme-choice]'))")
 for theme in ['light','dark','codex']:
  click('[data-theme-choice="'+theme+'"]');c.wait("document.documentElement.dataset.theme==="+json.dumps(theme))
  check('theme '+theme+' persisted',invoke('data_snapshot')['settings']['theme']==theme)
 click('[data-theme-choice="light"]');c.wait("document.documentElement.dataset.theme==='light'")
 # Native hide waits for frontend save; single instance shows same running window again.
 invoke('app_close_request',{'action':'hide'})
 c.wait("window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'}).then(v=>!v)")
 check('hide keeps app running',proc.poll() is None)
 second=subprocess.Popen([str(exe)],env=env,creationflags=subprocess.CREATE_NO_WINDOW);second.wait(timeout=15)
 c.wait("window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'})")
 check('single instance restores hidden window',second.returncode==0)
 button('笔记列表');c.wait("Boolean(document.querySelector('[data-note-id]'))");click('[data-note-id]')
 c.wait("Boolean(document.querySelector('[data-testid=note-title]:not(:disabled)'))",30)
 note=invoke('data_snapshot')['notes'][0]
 # Hold an actual isolated SQLite write lock until the native busy timeout; no production bridge monkeypatch.
 write_lock=sqlite3.connect(OUT/'repository/perfboard.sqlite3',timeout=.2);write_lock.execute('BEGIN IMMEDIATE')
 setvalue('[data-testid=note-title]','RECOVERED-NOTE-TITLE');button('工作台')
 c.wait("document.querySelector('.global-error')?.textContent.includes('保存失败')")
 check('failed save blocks navigation',c.evaluate("Boolean(document.querySelector('[data-testid=note-title]'))") and invoke('note_get',{'id':note['id']})['title']!='RECOVERED-NOTE-TITLE')
 write_lock.rollback();write_lock.close();write_lock=None;click('[data-testid=note-save-metadata]');c.wait("window.__TAURI_INTERNALS__.invoke('note_get',{id:"+json.dumps(note['id'])+"}).then(n=>n.title==='RECOVERED-NOTE-TITLE')")
 check('retry commits retained draft',True)
 # Original editor image export dialog, cold font resources.
 click('[data-testid=main-menu-trigger]');time.sleep(.2)
 visible=c.evaluate("[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>b.textContent.trim())")
 (OUT/'menu-buttons.json').write_text(json.dumps(visible,ensure_ascii=False,indent=2),encoding='utf-8')
 exportText=next((s for s in visible if '图片' in s and ('保存' in s or '导出' in s)),None)
 if exportText:
  button(exportText);c.wait("Boolean(document.querySelector('.image-export-modal, .ImageExportModal, .Modal__content'))")
  time.sleep(2);c.screenshot(OUT/'cold-image-export.png')
  images=c.evaluate("[...document.querySelectorAll('.Modal__content canvas,.Modal__content img')].map(e=>({tag:e.tagName,width:e.width,height:e.height,src:e.tagName==='IMG'?e.src.substring(0,40):null}))")
  check('original image export preview renders',len(images)>0,images)
  c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");time.sleep(.2)
 else:check('original image export menu found',False,visible)
 requests=[e['params']['request']['url'] for e in c.events if e.get('method')=='Network.requestWillBeSent' and e.get('params',{}).get('request',{}).get('url','').startswith('https://')]
 check('cold export no external HTTPS requests',not requests,requests[:3])
 quit();start();check('light theme survives restart',c.evaluate("document.documentElement.dataset.theme")=='light')
 quit()
 db=OUT/'repository/perfboard.sqlite3';hold=OUT/'repository/perfboard.sqlite3.hold';db.rename(hold)
 start(False);status=invoke('repo_status');check('missing DB shows recovery without new empty DB',status['configured'] and not status['ready'] and not db.exists())
 c.wait("document.querySelector('.main-content').textContent.includes('恢复仓库连接')")
 quit();hold.rename(db)
 print(json.dumps({'output':str(OUT),'passed':len(results),'results':results},ensure_ascii=True))
except Exception as e:
 (OUT/'failure.txt').write_text(repr(e),encoding='utf-8')
 if c:
  try:c.screenshot(OUT/'failure.png')
  except Exception:pass
 print('Extended FAILED '+repr(e)+'; '+str(OUT));raise
finally:
 if write_lock:write_lock.rollback();write_lock.close()
 if c:c.close()
 if proc and proc.poll() is None:proc.terminate()
