"""Local CDP helper for Perfboard validation; uses existing websocket-client."""
import json,time,urllib.request,websocket,base64
class CDP:
 def __init__(self,port=9333):
  self.port=port;self.seq=0;self.events=[];self.ws=None
  end=time.time()+30
  while time.time()<end:
   try:
    pages=json.load(urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/json/list',timeout=2))
    page=next(p for p in pages if p.get('type')=='page' and 'webSocketDebuggerUrl' in p)
    self.ws=websocket.create_connection(page['webSocketDebuggerUrl'],timeout=40,suppress_origin=True)
    break
   except Exception:time.sleep(.2)
  if self.ws is None:raise RuntimeError('No local WebView/Chrome debug page')
  self.call('Runtime.enable');self.call('Network.enable');self.call('Page.enable')
 def call(self,method,params=None):
  self.seq+=1;identifier=self.seq
  self.ws.send(json.dumps({'id':identifier,'method':method,'params':params or {}}))
  while True:
   result=json.loads(self.ws.recv())
   if result.get('id')==identifier:
    if 'error' in result:raise RuntimeError(str(result['error']))
    return result.get('result',{})
   self.events.append(result)
 def evaluate(self,expression):
  r=self.call('Runtime.evaluate',{'expression':expression,'awaitPromise':True,'returnByValue':True,'userGesture':True})
  if 'exceptionDetails' in r:raise RuntimeError(str(r['exceptionDetails']))
  result=r.get('result',{})
  if result.get('subtype')=='error':raise RuntimeError(result.get('description'))
  return result.get('value')
 def screenshot(self,path):
  b=self.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})['data']
  path.write_bytes(base64.b64decode(b))
 def wait(self,expression,seconds=15):
  end=time.time()+seconds
  while time.time()<end:
   try:
    if self.evaluate(expression):return True
   except Exception:pass
   time.sleep(.2)
  raise RuntimeError('Timed out: '+expression)
 def close(self):
  if self.ws:self.ws.close()
