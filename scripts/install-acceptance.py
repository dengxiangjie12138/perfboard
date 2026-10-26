"""Actual release NSIS command-line installation acceptance; project fixtures only.
Windows GUI dialogs require supported Computer Use and are not claimed here.
"""
from pathlib import Path
import os,sys,subprocess,time,json,hashlib,sqlite3,winreg
ROOT=Path(__file__).resolve().parents[1]
RESUME=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else None
if RESUME:
 assert RESUME.parent.resolve()==(ROOT/'.quality').resolve() and RESUME.name.startswith('installation-')
 OUT=RESUME
else:
 OUT=ROOT/'.quality'/('installation-'+time.strftime('%Y%m%d-%H%M%S'));OUT.mkdir()
PROGRAM=OUT/'安装程序 中文 空格';REPOSITORY=OUT/'仓库 数据 中文';REPOSITORY.mkdir(exist_ok=bool(RESUME))
ENVDIR=OUT/'appdata';ENVDIR.mkdir(exist_ok=bool(RESUME))
SETUP=ROOT/'src-tauri/target/release/bundle/nsis/Perfboard_0.1.0_x64-setup.exe'
env=os.environ.copy();env['APPDATA']=str(ENVDIR);TEMPDIR=OUT/'temp';TEMPDIR.mkdir(exist_ok=bool(RESUME));env['TEMP']=str(TEMPDIR);env['TMP']=str(TEMPDIR)
results=[]
if RESUME:
 original_results=(OUT/'results.json').read_text(encoding='utf-8')
 if not (OUT/'results-initial-assertion.json').exists():(OUT/'results-initial-assertion.json').write_text(original_results,encoding='utf-8')
 results=[r for r in json.loads(original_results) if r['passed']]
def check(name,ok,detail=None):
 results[:]=[r for r in results if r['name']!=name];results.append({'name':name,'passed':bool(ok),'detail':detail});(OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
 if not ok:raise AssertionError(name+': '+str(detail))
def registry(path):
 try:
  with winreg.OpenKey(winreg.HKEY_CURRENT_USER,path,0,winreg.KEY_READ|winreg.KEY_WOW64_64KEY) as key:return {winreg.EnumValue(key,i)[0]:winreg.EnumValue(key,i)[1] for i in range(winreg.QueryInfoKey(key)[1])}
 except FileNotFoundError:return None
PRODUCT=r'Software\perfboard\Perfboard';UNINSTALL=r'Software\Microsoft\Windows\CurrentVersion\Uninstall\Perfboard'
if not RESUME:check('no existing product installation before test',registry(PRODUCT) is None and registry(UNINSTALL) is None)
else:assert Path(registry(PRODUCT)['']).resolve()==PROGRAM.resolve(), 'Do not resume against any other installation'
# NSIS /D must be the last unquoted command-line item; repository value is quoted after '='.
def install(reuse=False):
 args=[str(SETUP),'/S','/NS'];command=subprocess.list2cmdline(args)+' /REPOSITORY="'+str(REPOSITORY)+'"'+(' /REUSE' if reuse else '')+' /D='+str(PROGRAM)
 (OUT/('reuse-command.txt' if reuse else 'new-command.txt')).write_text(command,encoding='utf-8')
 process=subprocess.Popen(command,cwd=ROOT,env=env,creationflags=subprocess.CREATE_NO_WINDOW)
 try:return process.wait(timeout=60)
 except subprocess.TimeoutExpired:
  (OUT/'blocked-process.json').write_text(json.dumps({'pid':process.pid,'command':command,'reason':'Installer did not finish within 60 seconds; do not confirm an unknown GUI prompt.'}),encoding='utf-8');process.terminate();raise
if not RESUME:check('actual release silent NSIS new install exits zero',install()==0)
EXE=PROGRAM/'perfboard.exe';installed=EXE.read_bytes();source=(ROOT/'src-tauri/target/release/perfboard.exe').read_bytes();marker=b'__TAURI_BUNDLE_TYPE_VAR_';check('installed release payload exact except official NSIS marker',installed.count(marker+b'NSS')==1 and source.count(marker+b'UNK')==1 and installed.replace(marker+b'NSS',marker+b'UNK')==source)
check('generated uninstaller stays in test program directory',(PROGRAM/'uninstall.exe').is_file())
pointer=ENVDIR/'com.perfboard.toolbox/repository.json';check('installer pointer isolated in project',pointer.exists() and Path(json.loads(pointer.read_text(encoding='utf-8'))['path']).samefile(REPOSITORY))
check('Chinese space repository contains initialized schema',(REPOSITORY/'perfboard.sqlite3').exists() and (REPOSITORY/'attachments').is_dir())
check('installed release readonly repository validation',subprocess.run([str(EXE),'--validate-repository',str(REPOSITORY)],env=env,capture_output=True,timeout=20).returncode==0)
with sqlite3.connect(REPOSITORY/'perfboard.sqlite3') as db:
 db.execute('INSERT INTO parts (id,name,category,package_name,parameters,stock_status,quantity,location,brief,url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',('installer-keep','合成安装测试电源','电源','SOT-23','3 A','unknown',None,'测试抽屉','仅用于验证复装保留','','2026-10-01','2026-10-01'));db.commit()
original=(REPOSITORY/'perfboard.sqlite3').read_bytes();before=registry(UNINSTALL)
check('actual release reuse install exits zero',install(True)==0)
with sqlite3.connect(REPOSITORY/'perfboard.sqlite3') as db:preserved=db.execute("SELECT name,brief FROM parts WHERE id='installer-keep'").fetchone()
check('reuse preserves original repository data',preserved==('合成安装测试电源','仅用于验证复装保留') and (REPOSITORY/'perfboard.sqlite3').read_bytes()==original)
check('installation location remains project isolated',Path(registry(PRODUCT)['']).resolve()==PROGRAM.resolve())
(OUT/'installation-state.json').write_text(json.dumps({'program':str(PROGRAM),'repository':str(REPOSITORY),'appdata':str(ENVDIR),'productRegistry':registry(PRODUCT),'uninstallRegistry':registry(UNINSTALL),'setupSha256':hashlib.sha256(SETUP.read_bytes()).hexdigest()},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'output':str(OUT),'program':str(PROGRAM),'repository':str(REPOSITORY),'passed':len(results)},ensure_ascii=True))
