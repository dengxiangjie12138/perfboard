import { useEffect, useState } from 'react';
import { errorMessage } from '../services/api';
type TextTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
interface ClipboardContext { x:number;y:number;target:TextTarget|null;editable:boolean;selection:Range|null;start:number|null;end:number|null;error?:string }
export function ClipboardMenu(){
 const [menu,setMenu]=useState<ClipboardContext|null>(null);
 useEffect(()=>{
  const context=(event:MouseEvent)=>{
   if(event.defaultPrevented)return;
   event.preventDefault();
   const element=event.target instanceof Element?event.target:null;
   const target=element?.closest('input,textarea,[contenteditable="true"]') as TextTarget|null;
   const input=target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement?target:null;
   const editable=!!target&&(input?!input.disabled&&!input.readOnly:target.isContentEditable);
   const selection=window.getSelection();const range=selection?.rangeCount?selection.getRangeAt(0).cloneRange():null;
   if(!target&&!selection?.toString()){setMenu(null);return;}
   setMenu({x:Math.max(0,Math.min(event.clientX,innerWidth-190)),y:Math.max(0,Math.min(event.clientY,innerHeight-190)),target,editable,selection:range,start:input?.selectionStart??null,end:input?.selectionEnd??null});
  };
  const dismiss=()=>setMenu(null);
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape')dismiss();};
  document.addEventListener('contextmenu',context);document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',key);document.addEventListener('scroll',dismiss,true);
  return()=>{document.removeEventListener('contextmenu',context);document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',key);document.removeEventListener('scroll',dismiss,true);};
 },[]);
 async function action(command:'copy'|'cut'|'paste'|'selectAll'){
  if(!menu)return;
  try{
   menu.target?.focus();
   const input=menu.target instanceof HTMLInputElement||menu.target instanceof HTMLTextAreaElement?menu.target:null;
   if(input&&menu.start!==null&&menu.end!==null)input.setSelectionRange(menu.start,menu.end);
   else if(menu.selection){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(menu.selection);}
   if(command==='paste'){
    const text=await navigator.clipboard.readText();
    if(!document.execCommand('insertText',false,text)&&input){
     const start=input.selectionStart??0,end=input.selectionEnd??start;
     const value=input.value.slice(0,start)+text+input.value.slice(end);
     const prototype=input instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype;
     Object.getOwnPropertyDescriptor(prototype,'value')?.set?.call(input,value);
     input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
     input.setSelectionRange(start+text.length,start+text.length);
    }
   }else if(command==='selectAll'&&input){input.select();}
   else if(!document.execCommand(command)){
    if(command==='copy')await navigator.clipboard.writeText(input?input.value.slice(input.selectionStart??0,input.selectionEnd??0):window.getSelection()?.toString()??'');
    else throw new Error('当前选择无法执行此操作。');
   }
   setMenu(null);
  }catch(error){setMenu(current=>current?{...current,error:errorMessage(error)}:null);}
 }
 if(!menu)return null;
 return <div className="context-actions clipboard-menu" role="menu" aria-label="文本操作" style={{left:menu.x,top:menu.y}} onPointerDown={event=>{event.preventDefault();event.stopPropagation();}}>
  <button role="menuitem" onClick={()=>void action('copy')}>复制</button>
  {menu.editable&&<><button role="menuitem" onClick={()=>void action('cut')}>剪切</button><button role="menuitem" onClick={()=>void action('paste')}>粘贴</button></>}
  <button role="menuitem" onClick={()=>void action('selectAll')}>全选</button>
  {menu.error&&<p className="error-text" role="alert">{menu.error}</p>}
 </div>;
}