// Shared, escaped SVG geometry from the accepted standalone prototype.
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clip=(v,n)=>Array.from(String(v||'')).slice(0,n).join('');
const group=v=>v==='PRI'||v==='SEC'?v:'unknown';
export function strandLabel(w){const n=Number(w.strands);return n===1?'单股并绕':Number.isInteger(n)&&n>1?n+'股并绕':'股数未注明';}
export function diagram(d){
const rows=d.windings.map((w,i)=>({...w,index:i,group:group(w.group)}));
if(!rows.length)return '';
const pin=(w,end)=>String(w[end]||'').trim();
const privateKey=(w,end)=>pin(w,end)||'@'+w.id+':'+end;
const ordered=rr=>rr.slice().sort((a,b)=>(Number(a.diagramOrder)||a.index+1)-(Number(b.diagramOrder)||b.index+1)||a.index-b.index);
const keys=['PRI','SEC','unknown'].filter(k=>rows.some(w=>w.group===k));
const groups=keys.map(key=>({key,rows:ordered(rows.filter(w=>w.group===key)),positions:new Map(),localNodes:new Map(),maxLane:0}));
groups.forEach(g=>{
const remaining=new Set(g.rows.map(w=>w.id));let cursor=0;
while(remaining.size){
 const seed=g.rows.find(w=>remaining.has(w.id)),component=[],stack=[seed];remaining.delete(seed.id);
 while(stack.length){const w=stack.pop();component.push(w);g.rows.forEach(other=>{if(!remaining.has(other.id))return;const ends=[pin(w,'start'),pin(w,'end')].filter(Boolean);if(ends.some(k=>k===pin(other,'start')||k===pin(other,'end'))){remaining.delete(other.id);stack.push(other);}});}
 const rr=ordered(component),levels=new Map();levels.set(privateKey(rr[0],'start'),0);levels.set(privateKey(rr[0],'end'),privateKey(rr[0],'end')===privateKey(rr[0],'start')?0:48);
 for(let pass=0;pass<rr.length;pass++)rr.forEach(w=>{const a=privateKey(w,'start'),b=privateKey(w,'end');if(levels.has(a)&&!levels.has(b))levels.set(b,levels.get(a)+48);else if(levels.has(b)&&!levels.has(a))levels.set(a,levels.get(b)-48);});
 let extra=Math.max(...levels.values())+32;
 const ps=rr.map(w=>{let startY=levels.get(privateKey(w,'start')),endY=levels.get(privateKey(w,'end'));const routed=!Number.isFinite(startY)||!Number.isFinite(endY)||Math.abs(endY-startY)!==48;if(routed){startY=extra;endY=extra+48;extra+=80;}return {w,startY,endY,lane:0,routed};});
 const low=Math.min(...levels.values(),...ps.flatMap(p=>[p.startY,p.endY])),offset=cursor-low,lanes=[];
 ps.forEach(p=>{const a=Math.min(p.startY,p.endY),b=Math.max(p.startY,p.endY);let lane=0;while(lanes[lane]&&lanes[lane].some(v=>a<v[1]&&b>v[0]))lane++;(lanes[lane]||(lanes[lane]=[])).push([a,b]);p.lane=lane;g.maxLane=Math.max(g.maxLane,lane);g.positions.set(p.w.id,{startY:p.startY+offset,endY:p.endY+offset,lane,routed:p.routed});});
 levels.forEach((y,k)=>{if(g.rows.some(w=>pin(w,'start')===k||pin(w,'end')===k))g.localNodes.set(k,y+offset);});
 cursor=Math.max(...levels.values(),...ps.flatMap(p=>[p.startY,p.endY]))+offset+42;
}
const occupied=[];[...g.localNodes.entries()].sort((a,b)=>a[1]-b[1]).forEach(([k,initial])=>{let y=initial;while(occupied.some(v=>Math.abs(v-y)<18))y+=18;occupied.push(y);g.localNodes.set(k,y);});
g.rows.forEach(w=>{const p=g.positions.get(w.id);if(!p.routed){if(pin(w,'start'))p.startY=g.localNodes.get(pin(w,'start'));if(pin(w,'end'))p.endY=g.localNodes.get(pin(w,'end'));}});
g.height=Math.max(cursor,...occupied.map(y=>y+42),...Array.from(g.positions.values()).flatMap(p=>[p.startY+42,p.endY+42]));g.pinMargin=Math.max(42,...Array.from(g.localNodes.keys()).map(k=>Array.from(clip(k,8)).length*14+18));g.width=g.pinMargin+188+30+g.maxLane*180;
});
const nodes=new Map();groups.forEach(g=>g.rows.forEach(w=>['start','end'].forEach(end=>{const k=pin(w,end);if(!k)return;if(!nodes.has(k))nodes.set(k,{key:k,home:g,refs:[]});nodes.get(k).refs.push({w,end,g});})));
const cross=[...nodes.values()].filter(n=>new Set(n.refs.map(r=>r.g.key)).size>1),top=58+cross.length*9;let totalWidth=0;
groups.forEach(g=>{g.left=totalWidth;totalWidth+=g.width;g.sign=g.key==='SEC'?-1:1;g.rows.forEach(w=>{const p=g.positions.get(w.id);p.x=g.left+(g.sign===1?g.pinMargin+188+p.lane*180:g.width-(g.pinMargin+188+p.lane*180));p.startY+=top;p.endY+=top;});});
nodes.forEach(n=>{const g=n.home;n.x=g.left+(g.sign===1?g.pinMargin:g.width-g.pinMargin);n.y=top+g.localNodes.get(n.key);const channel=[...nodes.values()].filter(v=>v.home===g).indexOf(n);n.busX=n.x+g.sign*(22+channel*10);n.crossY=27+cross.indexOf(n)*9;});
const textMeasure=typeof globalThis.document==='undefined'?null:globalThis.document.createElement('canvas').getContext('2d');
function information(text,x,y,size,anchor,maxWidth,bold){if(textMeasure)textMeasure.font=(bold?'600 ':'')+size+'px Microsoft YaHei,Segoe UI,sans-serif';const fitted=(textMeasure?textMeasure.measureText(text).width:Array.from(text).length*size)>maxWidth?' textLength="'+maxWidth+'" lengthAdjust="spacingAndGlyphs"':'';return '<text x="'+x+'" y="'+y+'" text-anchor="'+anchor+'" font-size="'+size+'"'+(bold?' font-weight="600"':'')+fitted+'>'+esc(text)+'</text>';}
let links='',coils='',terminals='',headings='';
nodes.forEach(n=>n.refs.forEach(r=>{const p=r.g.positions.get(r.w.id),y=r.end==='start'?p.startY:p.endY;let path;if(r.g===n.home&&y===n.y)path='M '+p.x+' '+y+' H '+n.x;else if(r.g===n.home)path='M '+p.x+' '+y+' H '+n.busX+' V '+n.y+' H '+n.x;else path='M '+p.x+' '+y+' H '+(p.x-r.g.sign*(24+cross.indexOf(n)*12))+' V '+n.crossY+' H '+n.busX+' V '+n.y+' H '+n.x;links+='<path data-pin-link="'+esc(n.key)+'" d="'+path+'" fill="none" stroke="#333" stroke-width="1.3"/>';}));
const height=top+Math.max(...groups.map(g=>g.height))+20;
groups.forEach((g,gi)=>{headings+='<text x="'+(g.left+g.width/2)+'" y="'+(top-22)+'" text-anchor="middle" font-size="15" font-weight="700">'+(g.key==='unknown'?'未指定 PRI/SEC':g.key)+'</text>';if(gi)headings+='<path d="M '+g.left+' '+(top-38)+' V '+(height-28)+'" stroke="#ddd" stroke-dasharray="3 4"/>';g.rows.forEach(w=>{const p=g.positions.get(w.id),sign=g.sign,dy=(p.endY-p.startY)/6;let path='M '+p.x+' '+p.startY;for(let i=0;i<6;i++){const y=p.startY+i*dy;path+=' C '+(p.x+sign*18)+' '+y+' '+(p.x+sign*18)+' '+(y+dy)+' '+p.x+' '+(y+dy);}const textX=p.x-sign*42,anchor=sign===1?'end':'start',y=Math.min(p.startY,p.endY),span=Math.abs(p.endY-p.startY),small=span<40,pinSideX=g.left+(sign===1?g.pinMargin:g.width-g.pinMargin),textWidth=Math.max(50,Math.min(p.lane>0?112:132,Math.abs(p.x-pinSideX)-56));
coils+='<g data-coil="'+esc(w.label)+'" data-group="'+g.key+'" data-coil-x="'+p.x+'" data-pin-side-x="'+pinSideX+'" data-start-y="'+p.startY+'" data-end-y="'+p.endY+'"><title>'+esc(w.label+' '+w.start+' → '+w.end)+'</title><path d="'+path+'" fill="none" stroke="#222" stroke-width="1.6"/><circle data-start-point="'+esc(w.id)+'" cx="'+(p.x-sign*7)+'" cy="'+p.startY+'" r="3.2" fill="#222"/>'+ '<g data-winding-info="'+esc(w.label)+'">'+information(clip(w.label||'绕组',10),textX,y+span*.30,small?10:13,anchor,textWidth,true)+information(clip((w.diameter||'?')+' mm · '+(w.turns||'?')+' 圈',24),textX,y+span*.59,small?8.5:10.5,anchor,textWidth,false)+information(strandLabel(w),textX,y+span*.88,small?8:10,anchor,textWidth,false)+'</g>';
if(w.tubeStart)coils+='<rect data-sleeve="start" x="'+(p.x+(sign===1?-31:16))+'" y="'+(p.startY-4)+'" width="15" height="8" fill="white" stroke="#222"/>';
if(w.tubeEnd)coils+='<rect data-sleeve="end" x="'+(p.x+(sign===1?-31:16))+'" y="'+(p.endY-4)+'" width="15" height="8" fill="white" stroke="#222"/>';
coils+='</g>';});});
nodes.forEach(n=>{const sign=n.home.sign;terminals+='<g data-terminal="'+esc(n.key)+'" data-terminal-x="'+n.x+'" data-terminal-y="'+n.y+'"><title>引脚 '+esc(n.key)+'</title><circle cx="'+n.x+'" cy="'+n.y+'" r="4.5" fill="white" stroke="#222" stroke-width="1.5"/><text x="'+(n.x-sign*10)+'" y="'+(n.y+4)+'" text-anchor="'+(sign===1?'end':'start')+'" font-size="14">'+esc(clip(n.key,8))+'</text></g>';});
return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+totalWidth+' '+height+'" role="img" aria-label="绕组连接示意图"><rect width="'+totalWidth+'" height="'+height+'" fill="white"/><g font-family="Microsoft YaHei,Segoe UI,sans-serif" fill="#222">'+headings+links+coils+terminals+'<text x="20" y="'+(height-8)+'" font-size="12">● 起绕点　○ 引脚　▭ 套管</text></g></svg>';
}
export function construction(d){
if(!d.windings.length)return '';
const positive=w=>String(w.tape).trim()!==''&&/^\d+$/.test(String(w.tape))&&Number(w.tape)>0;
const width=720,height=90+d.windings.length*54+d.windings.filter(positive).length*14,baseY=height-52;
let y=baseY,parts='';
d.windings.forEach((w,i)=>{const bottom=y;y-=54;parts+='<g data-construction-winding="'+esc(w.label)+'" data-sequence="'+(i+1)+'" data-bottom="'+bottom+'"><rect x="80" y="'+y+'" width="390" height="54" fill="white" stroke="#222" stroke-width="1.3"/><text x="95" y="'+(y+20)+'" font-size="14" font-weight="600">'+esc(clip(w.label||'绕组',15)+' · '+(w.turns||'?')+' 圈')+'</text><text x="95" y="'+(y+40)+'" font-size="12">'+esc(clip((w.diameter||'?')+' mm · '+strandLabel(w),38))+'</text></g>';
if(positive(w)){const count=Number(w.tape);y-=14;parts+='<g data-tape="'+esc(w.tape)+'" data-after="'+esc(w.label)+'"><rect x="80" y="'+y+'" width="390" height="14" fill="#f3f3f3" stroke="#222"/>';for(let j=1;j<Math.min(count,4);j++)parts+='<path d="M 80 '+(y+j*14/Math.min(count,4))+' H 470" stroke="#666" stroke-width=".6"/>';parts+='<path d="M 470 '+(y+7)+' H 493" stroke="#222"/><text x="500" y="'+(y+11)+'" font-size="12">'+esc(w.tape)+'TS TAPE（'+esc(w.tape)+' 层）</text></g>';}
else parts+='<text data-tape-note="'+esc(w.label)+'" x="500" y="'+(y+9)+'" font-size="11" fill="#555">'+(String(w.tape).trim()!==''&&Number(w.tape)===0?'不包胶（0 层）':'胶带层数未注明')+'</text>';
});
return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="BOBBIN 绕制层叠工艺示意图"><rect width="'+width+'" height="'+height+'" fill="white"/><g font-family="Microsoft YaHei,Segoe UI,sans-serif" fill="#222"><rect x="65" y="'+(y-9)+'" width="15" height="'+(baseY-y+37)+'" fill="white" stroke="#222" stroke-width="1.5"/><rect x="470" y="'+(y-9)+'" width="15" height="'+(baseY-y+37)+'" fill="white" stroke="#222" stroke-width="1.5"/>'+parts+'<rect x="65" y="'+baseY+'" width="420" height="28" fill="white" stroke="#222" stroke-width="1.5"/><text x="275" y="'+(baseY+19)+'" text-anchor="middle" font-size="14" font-weight="700">BOBBIN</text><text x="65" y="'+(height-7)+'" font-size="12">按绕组表顺序由内到外 · 等高非比例工艺示意</text></g></svg>';
}
export function exportDiagram(connection,build){
const size=svg=>svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number),a=size(connection),b=size(build),w=800,ah=a[1]*w/a[0],bh=b[1]*w/b[0],by=ah+72,h=by+bh+12;
const nested=(svg,y,height)=>svg.replace('<svg ','<svg x="0" y="'+y+'" width="'+w+'" height="'+height+'" ');
return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'"><rect width="'+w+'" height="'+h+'" fill="white"/><text x="20" y="22" font-family="Microsoft YaHei,sans-serif" font-size="18">绕组连接示意图</text>'+nested(connection,32,ah)+'<text x="20" y="'+(by-9)+'" font-family="Microsoft YaHei,sans-serif" font-size="18">绕制方式 COIL CONSTRUCTION</text>'+nested(build,by,bh)+'</svg>';
}
