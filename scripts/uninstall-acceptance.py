"""Strict project-only release uninstaller acceptance; no normal-mode shortcut cleanup."""
from pathlib import Path
import os,json,subprocess,hashlib,time,winreg
ROOT=Path(__file__).resolve().parents[1].resolve();OUT=ROOT/'.quality/installation-20261002-034836';state=json.loads((OUT/'installation-state.json').read_text(encoding='utf-8'))
PROGRAM=Path(state['program']).resolve();REPO=Path(state['repository']).resolve();PRIVATE=Path(state['appdata'])/'com.perfboard.toolbox/repository.json';NORMAL=Path(os.environ['APPDATA'])/'com.perfboard.toolbox/repository.json'
assert PROGRAM.is_relative_to(ROOT/'.quality') and REPO.is_relative_to(ROOT/'.quality') and not REPO.is_relative_to(PROGRAM) and not PROGRAM.is_relative_to(REPO)
UNINSTALL=PROGRAM/'uninstall.exe';assert UNINSTALL.is_file()
script=(ROOT/'src-tauri/target/release/nsis/x64/installer.nsi').read_text(encoding='utf-8-sig');section=script.split('Section Uninstall',1)[1].split('SectionEnd',1)[0]
assert 'Delete "$INSTDIR\\${MAINBINARYNAME}.exe"' in section and 'Delete "$INSTDIR\\uninstall.exe"' in section and 'RMDir "$INSTDIR"' in section
assert 'rmdir /r' not in section.lower() and '${If} $UpdateMode <> 1' in section and 'Perfboard: no repository or app configuration deletion' in section
for parent in [PROGRAM,*PROGRAM.parents]:
 if parent.is_relative_to(ROOT):assert not (parent.lstat().st_file_attributes & 0x400),'No reparse ancestry'
key=r'Software\Microsoft\Windows\CurrentVersion\Uninstall\Perfboard'
with winreg.OpenKey(winreg.HKEY_CURRENT_USER,key,0,winreg.KEY_READ|winreg.KEY_WOW64_64KEY) as reg:assert winreg.QueryValueEx(reg,'InstallLocation')[0].strip('"')==str(PROGRAM)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def tree(path):return {str(p.relative_to(path)):sha(p) for p in path.rglob('*') if p.is_file()}
before=tree(REPO);private_before=sha(PRIVATE);normal_before=sha(NORMAL)
sentinel=PROGRAM/'keep-unrecognized-file.txt';assert not sentinel.exists();sentinel.write_text('Owned acceptance sentinel: the uninstaller must preserve unknown files.',encoding='utf-8');sentinel_before=sha(sentinel)
env=os.environ.copy();env['APPDATA']=state['appdata'];env['TEMP']=str(OUT/'uninstall-temp');env['TMP']=env['TEMP'];Path(env['TEMP']).mkdir()
command=subprocess.list2cmdline([str(UNINSTALL),'/S','/UPDATE'])+' _?='+str(PROGRAM)
(OUT/'uninstall-command.txt').write_text(command,encoding='utf-8')
process=subprocess.Popen(command,cwd=ROOT,env=env,creationflags=subprocess.CREATE_NO_WINDOW)
try:code=process.wait(timeout=30)
except subprocess.TimeoutExpired:process.terminate();raise RuntimeError('Uninstaller did not finish; no unknown Windows prompt was confirmed')
results=[]
def check(name,ok,detail=None):
 results.append({'name':name,'passed':bool(ok),'detail':detail});(OUT/'uninstall-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
 if not ok:raise AssertionError(name+': '+str(detail))
check('strict project-only UPDATE uninstaller exits zero',code==0)
check('known installed program removed',not (PROGRAM/'perfboard.exe').exists())
check('unknown project program file preserved',sentinel.is_file() and sha(sentinel)==sentinel_before)
check('all synthetic repository bytes preserved',tree(REPO)==before)
check('isolated installer path configuration preserved',sha(PRIVATE)==private_before)
check('standard app path configuration preserved',sha(NORMAL)==normal_before)
try:
 with winreg.OpenKey(winreg.HKEY_CURRENT_USER,key,0,winreg.KEY_READ|winreg.KEY_WOW64_64KEY):removed=False
except FileNotFoundError:removed=True
check('only test installation uninstall registration removed',removed)
residual=UNINSTALL.exists()
if residual:
 resolved=UNINSTALL.resolve();assert resolved.is_relative_to(ROOT/'.quality') and resolved.parent==PROGRAM and resolved.name=='uninstall.exe';resolved.unlink()
check('known self-uninstaller residue safely cleared within project',not UNINSTALL.exists(),{'residueAfterExit':residual})
(OUT/'uninstall-state.json').write_text(json.dumps({'program':str(PROGRAM),'repository':str(REPO),'mode':'S UPDATE','normalUninstallNotExecuted':True,'repositoryHashes':before,'privatePointerSha256':private_before,'standardPointerSha256':normal_before,'selfUninstallerResidue':residual},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'output':str(OUT),'passed':len(results)},ensure_ascii=True))
