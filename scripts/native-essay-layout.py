"""Focused essay layout/status validation in a uniquely identified project-only app.
No installed application, personal data, repository imports, or process force-kills.
"""
from pathlib import Path
import hashlib, importlib.util, json, os, sqlite3, subprocess, sys, time
spec=importlib.util.spec_from_file_location("native_batch",Path(__file__).with_name("native-batch.py"))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.PORT=9349
m.IDENTIFIER="com.perfboard.toolbox.essaytest"
m.OUT=m.QUALITY/("essay-native-"+time.strftime("%Y%m%d-%H%M%S"))
check,invoke,click,value,wait,route=m.check,m.invoke,m.click,m.value,m.wait,m.route

def retry():
    m.cdp.evaluate("[...document.querySelectorAll('.button-row button')].find(e=>e.textContent.includes('重试连接')).click()")

def scene():
    return {"type":"excalidraw","version":2,"source":"Perfboard isolated UI fixture","elements":[
      {"id":"essay-rectangle","type":"rectangle","x":80,"y":100,"width":120,"height":80,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"hachure","strokeWidth":1,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":None,"roundness":None,"seed":1,"version":1,"versionNonce":1,"isDeleted":False,"boundElements":None,"updated":1,"link":None,"locked":False}],
      "appState":{"viewBackgroundColor":"#ffffff"},"files":{}}

def note_by_id(id):
    return invoke("note_get",{"id":id})

def open_note(id):
    click("[data-testid=note-open]")
    wait("Boolean(document.querySelector('dialog[open] select[aria-label=\"切换当前分类笔记\"]'))")
    value('dialog[open] select[aria-label="切换当前分类笔记"]',id)
    wait("!document.querySelector('dialog[open]')&&Boolean(document.querySelector('[data-testid=note-save-metadata]:not(:disabled)'))",30)

def metadata(title):
    click("[data-testid=note-edit-metadata]")
    wait("Boolean(document.querySelector('dialog[open] [data-testid=note-title]'))")
    value("[data-testid=note-title]",title)

def new_note(title):
    click("[data-testid=note-new]")
    wait("Boolean(document.querySelector('dialog[open] input[aria-label=\"新笔记标题\"]'))")
    value('dialog[open] input[aria-label="新笔记标题"]',title)
    click('dialog[open] button[type=submit]')
    wait("!document.querySelector('dialog[open]')&&Boolean(document.querySelector('[data-testid=note-save-metadata]:not(:disabled)'))",30)
    return next(n for n in m.snapshot()["notes"] if n["title"]==title)

def layout(width,height):
    m.cdp.call("Emulation.setDeviceMetricsOverride",{"width":width,"height":height,"deviceScaleFactor":1,"mobile":False})
    time.sleep(.3)
    metrics=m.cdp.evaluate("""(()=>{
      const main=document.querySelector('.main-content'),canvas=document.querySelector('.notes-canvas'),toolbar=document.querySelector('.notes-toolbar'),excal=document.querySelector('.excalidraw .App-toolbar');
      const r=e=>{const a=e.getBoundingClientRect();return {top:a.top,bottom:a.bottom,left:a.left,right:a.right,height:a.height,width:a.width}};
      return {viewport:[innerWidth,innerHeight],main:r(main),canvas:r(canvas),toolbar:r(toolbar),excal:excal?r(excal):null,padding:getComputedStyle(main).padding,scroll:main.scrollHeight,client:main.clientHeight,documentScroll:document.documentElement.scrollHeight};
    })()""")
    check("essay fills available viewport "+str(width),metrics["padding"]=="0px" and metrics["canvas"]["height"]>200 and metrics["canvas"]["bottom"]<=height+2 and metrics["scroll"]<=metrics["client"]+2 and metrics["documentScroll"]<=height+2,metrics)
    check("native canvas toolbar visible "+str(width),metrics["excal"] is not None and metrics["excal"]["top"]>=metrics["canvas"]["top"] and metrics["excal"]["bottom"]<=height,metrics["excal"])
    m.cdp.screenshot(m.OUT/("essay-"+str(width)+".png"))

def connection(theme):
    route(".sidebar nav > button.nav-row:nth-of-type(3)")
    wait("Boolean(document.querySelector('[data-theme-choice="+theme+"]:not(:disabled)'))")
    click("[data-theme-choice="+theme+"]")
    wait("document.documentElement.dataset.theme==="+json.dumps(theme)+"&&Boolean(document.querySelector('[data-theme-choice="+theme+"]:not(:disabled)'))")
    color=m.cdp.evaluate("getComputedStyle(document.querySelector('.status-dot')).backgroundColor")
    expected="rgb(34, 131, 68)" if theme=="light" else "rgb(74, 222, 128)"
    check("successful connection green in "+theme,color==expected,color)
    route(".sidebar nav > button.nav-row:nth-of-type(4)")
    wait("Boolean(document.querySelector('[data-testid=repo-path]'))")
    # Only the new empty test repository is modified; rename its empty notes table
    # temporarily to exercise a real read failure without changing production IPC.
    db=sqlite3.connect(m.OUT/"repository/perfboard.sqlite3")
    try:
        db.execute("ALTER TABLE notes RENAME TO notes_fixture_unavailable")
        db.commit()
        retry()
        wait("document.querySelector('[data-testid=repo-connection-status]').textContent.includes('仓库连接失败')")
        failed=m.cdp.evaluate("({color:getComputedStyle(document.querySelector('.status-dot')).backgroundColor,green:!!document.querySelector('.status-dot.connected')})")
        check("failed repository read has no success green in "+theme,not failed["green"] and failed["color"]!=expected,failed)
    finally:
        db.execute("ALTER TABLE notes_fixture_unavailable RENAME TO notes")
        db.commit()
        db.close()
    retry()
    wait("Boolean(document.querySelector('.status-dot.connected'))")
    check("real retry restores connected status in "+theme,invoke("repo_status")["ready"])
    if m.cdp.evaluate("Boolean(document.querySelector('[aria-label=\"关闭错误提示\"]'))"):
        click('[aria-label="关闭错误提示"]')

def main():
    gate=json.loads((m.QUALITY/"essay-native-build.json").read_text(encoding="utf-8-sig"))
    config=json.loads((m.QUALITY/"essay-native-tauri.json").read_text(encoding="utf-8-sig"))
    if gate["identifier"]!=m.IDENTIFIER or config["identifier"]!=m.IDENTIFIER:
        raise RuntimeError("Missing isolated application identifier.")
    exe=Path(gate["exe"]).resolve()
    if m.ROOT not in exe.parents or "debug" not in exe.parts or exe.name!="perfboard.exe" or hashlib.sha256(exe.read_bytes()).hexdigest()!=gate["exeSha256"]:
        raise RuntimeError("Invalid isolated debug executable gate.")
    m.OUT.mkdir(parents=True,exist_ok=False)
    m.log=(m.OUT/"native.log").open("wb")
    env=os.environ.copy()
    env["PERFBOARD_TEST_CONFIG_DIR"]=str(m.OUT/"config")
    env["WEBVIEW2_USER_DATA_FOLDER"]=str(m.OUT/"webview-profile")
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"]="--remote-debugging-port=9349 --remote-allow-origins=*"
    r=subprocess.run([str(exe),"--initialize-repository",str(m.OUT/"repository")],cwd=m.ROOT,env=env,stdout=m.log,stderr=m.log,timeout=30)
    check("project-only empty repository initialized",r.returncode==0)
    m.start(exe,env)
    check("no personal data loaded",m.snapshot()["parts"]==[] and m.snapshot()["notes"]==[])
    route(".sidebar nav > button.nav-row:nth-of-type(2)")
    wait("Boolean(document.querySelector('[data-testid=part-new]'))")
    part=m.newpart("编号列验证","0805",lcsc="00C123A")
    empty=m.newpart("空编号验证","LQFP48")
    check("supplier-number header follows stock",m.cdp.evaluate("[...document.querySelectorAll('.parts-table th')].map(e=>e.textContent).join('|')==='型号|封装|分类|位置|库存|嘉立创编号|操作'"))
    check("supplier number exact text and empty dash",m.cdp.evaluate("document.querySelector('[data-part-id=\\\""+part["id"]+"\\\"] .part-lcsc').textContent==='00C123A'&&document.querySelector('[data-part-id=\\\""+empty["id"]+"\\\"] .part-lcsc').textContent==='—'"))
    click('[data-part-id="'+part["id"]+'"] .part-name')
    check("expanded brief spans all seven columns",m.cdp.evaluate("document.querySelector('.brief-row td').colSpan===7"))
    m.cdp.call("Emulation.setDeviceMetricsOverride",{"width":1320,"height":860,"deviceScaleFactor":1,"mobile":False})
    time.sleep(.2)
    widths=m.cdp.evaluate("(()=>{const e=document.querySelector('.table-scroll');return {scroll:e.scrollWidth,client:e.clientWidth,columns:document.querySelectorAll('.parts-table th').length}})()")
    check("compact seven-column table fits normal window",widths["scroll"]<=widths["client"]+2 and widths["columns"]==7,widths)
    m.cdp.screenshot(m.OUT/"parts-supplier-column.png")
    m.cdp.call("Emulation.clearDeviceMetricsOverride")
    if "--parts-only" in sys.argv:
        m.quit_owned()
        print(json.dumps({"output":str(m.OUT),"passed":len(m.results),"scope":"parts-only"},ensure_ascii=False))
        return
    for theme in ["codex","dark","light"]:
        connection(theme)
    fixture=invoke("note_save",{"note":{"id":"essay-fixture-a","title":"隔离随笔一","category":"随笔","searchText":"","sceneJson":json.dumps(scene())}})
    retry()
    wait("Boolean(document.querySelector('.status-dot.connected'))")
    route("#submenu-notes button:nth-child(4)")
    wait("Boolean(document.querySelector('.notes-page-essay'))")
    check("essay removes only two permanent rows",m.cdp.evaluate("!document.querySelector('.notes-focused-controls')&&!document.querySelector('.notes-editor-heading')&&!document.querySelector('.notes-heading')&&!document.querySelector('.notes-sidebar')&&document.querySelectorAll('.notes-toolbar').length===1"))
    check("New Open directly precede Save",m.cdp.evaluate("(()=>{const save=document.querySelector('[data-testid=note-save-metadata]');return save.previousElementSibling.dataset.testid==='note-open'&&save.previousElementSibling.previousElementSibling.dataset.testid==='note-new'})()"))
    open_note(fixture["id"])
    check("seeded canvas restores without loss",any(e["id"]=="essay-rectangle" for e in json.loads(note_by_id(fixture["id"])["sceneJson"])["elements"]))
    for viewport in [(1320,860),(900,600)]:
        layout(*viewport)
    m.cdp.call("Emulation.clearDeviceMetricsOverride")
    metadata("隔离随笔一已编辑")
    m.cdp.evaluate("[...document.querySelectorAll('dialog[open] button')].find(e=>e.textContent==='完成').click()")
    wait("!document.querySelector('dialog[open]')")
    check("metadata dialog completion flushes title",note_by_id(fixture["id"])["title"]=="隔离随笔一已编辑")
    second=new_note("隔离随笔二")
    open_note(fixture["id"])
    check("New/Open roundtrip retains canvas",any(e["id"]=="essay-rectangle" for e in json.loads(note_by_id(fixture["id"])["sceneJson"])["elements"]))
    # Close metadata by its heading close, then switch immediately; both flows must await flush.
    metadata("隔离随笔一切换保存")
    click("dialog[open] .modal-heading button")
    wait("!document.querySelector('dialog[open]')")
    open_note(second["id"])
    check("switch keeps the edited original note",note_by_id(fixture["id"])["title"]=="隔离随笔一切换保存")
    # Force a save failure in this owned debug window; retain the dialog/editor and allow retry.
    metadata("隔离随笔二保存重试")
    lock=sqlite3.connect(m.OUT/"repository/perfboard.sqlite3")
    try:
        lock.execute("BEGIN IMMEDIATE")
        m.cdp.evaluate("[...document.querySelectorAll('dialog[open] button')].find(e=>e.textContent==='完成').click()")
        wait("document.querySelector('dialog[open]')?.textContent.includes('保存失败')",15)
        check("failed metadata save retains current draft and dialog",m.cdp.evaluate("document.querySelector('[data-testid=note-title]').value==='隔离随笔二保存重试'"))
    finally:
        lock.rollback()
        lock.close()
    m.cdp.evaluate("[...document.querySelectorAll('dialog[open] button')].find(e=>e.textContent==='完成').click()")
    wait("!document.querySelector('dialog[open]')")
    check("metadata retry persists the retained draft",note_by_id(second["id"])["title"]=="隔离随笔二保存重试")
    metadata("隔离随笔二移入学习")
    value('dialog[open] select[aria-label="当前笔记分类"]',"学习笔记")
    wait("!document.querySelector('dialog[open]')&&!document.querySelector('.notes-canvas')")
    check("category edit moves only selected note and flushes title",note_by_id(second["id"])["category"]=="学习笔记" and note_by_id(second["id"])["title"]=="隔离随笔二移入学习")
    for index,name in [(2,"hardware"),(3,"software"),(5,"study")]:
        route("#submenu-notes button:nth-child("+str(index)+")")
        wait("Boolean(document.querySelector('.notes-focused-controls'))")
        check("original category layout retained "+name,m.cdp.evaluate("!document.querySelector('.main-content-essay')&&Boolean(document.querySelector('.notes-focused-controls select'))&&getComputedStyle(document.querySelector('.main-content')).padding!=='0px'"))
    value('.notes-focused-controls select',second["id"])
    wait("Boolean(document.querySelector('.notes-editor-heading [data-testid=note-title]'))")
    check("other category permanent metadata row retained",m.cdp.evaluate("document.querySelector('[data-testid=note-title]').value==='隔离随笔二移入学习'"))
    route("#submenu-notes button:first-child")
    wait("Boolean(document.querySelector('.notes-heading'))")
    check("overview banner and notebook panel retained",m.cdp.evaluate("Boolean(document.querySelector('.notes-heading')&&document.querySelector('.notes-sidebar'))&&!document.querySelector('.main-content-essay')"))
    route("#submenu-notes button:nth-child(4)")
    wait("Boolean(document.querySelector('.notes-page-essay'))")
    open_note(fixture["id"])
    metadata("隔离随笔一退出保存")
    # Quit with dialog still open; normal close IPC flushes outstanding draft operations.
    m.quit_owned()
    m.start(exe,env)
    restored=note_by_id(fixture["id"])
    check("normal exit and restart preserve title and canvas",restored["title"]=="隔离随笔一退出保存" and any(e["id"]=="essay-rectangle" for e in json.loads(restored["sceneJson"])["elements"]))
    m.quit_owned()
    print(json.dumps({"output":str(m.OUT),"passed":len(m.results)},ensure_ascii=False))

if __name__=="__main__":
    try:
        main()
    except Exception as error:
        if m.OUT.exists():
            (m.OUT/"failure.txt").write_text(repr(error),encoding="utf-8")
            if m.cdp:
                try:m.cdp.screenshot(m.OUT/"failure.png")
                except Exception:pass
        raise
    finally:
        if m.proc and m.proc.poll() is None:
            try:m.quit_owned()
            except Exception as error:print("Safe IPC cleanup failed for owned PID "+str(m.proc.pid)+": "+str(error)+". No process force-killed.")
        if m.cdp:m.cdp.close()
        if m.log:m.log.close()
