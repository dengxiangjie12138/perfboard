import {PDFDocument,PDFFont,PDFPage,rgb} from 'pdf-lib';
import type {TransformerDesignDocument,PdfExportOptions} from './types';
import {INDUCTANCE_UNITS,wireLabel,sleeveLabel} from './sheet';
import {diagram,construction} from './sheetDrawing';
import {wrapPdfText} from './pdf';
const W=595.28,H=841.89,M=32,B=35,INK=rgb(.09,.09,.09),MUTED=rgb(.38,.38,.38),LINE=rgb(.74,.74,.74);
type Column={title:string;ratio:number;left?:boolean;nowrap?:boolean};
export async function rasterizeSheetSvg(svg:string):Promise<Uint8Array> {
 await document.fonts.ready;
 const match=svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);if(!match)throw new Error('图示尺寸无效。');
 const width=Number(match[1]),height=Number(match[2]),scale=Math.min(3,2400/Math.max(width,height));
 const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
 await image.decode();const canvas=document.createElement('canvas');canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);
 const context=canvas.getContext('2d');if(!context)throw new Error('图示导出不可用。');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('图示导出失败。')),'image/png'));
 return new Uint8Array(await blob.arrayBuffer());
}
class Paper {
 page!:PDFPage;y=0;readonly width=W-M*2;
 constructor(readonly pdf:PDFDocument,readonly font:PDFFont,readonly d:TransformerDesignDocument){this.newPage();}
 newPage(){this.page=this.pdf.addPage([W,H]);this.y=H-M;for(const line of wrapPdfText(this.d.title.trim()||'未命名制作单',this.font,17,this.width)){this.text(line,M,this.y-17,17);this.y-=23;}this.y-=4;this.page.drawLine({start:{x:M,y:this.y},end:{x:W-M,y:this.y},color:INK,thickness:1});this.y-=15;}
 text(text:string,x:number,y:number,size=9){this.page.drawText(text,{x,y,size,font:this.font,color:INK});}
 ensure(height:number){if(this.y-height<B)this.newPage();}
 paragraph(text:string,size=8.5){for(const line of wrapPdfText(text,this.font,size,this.width)){this.ensure(size+5);this.text(line,M,this.y-size,size);this.y-=size+5;}this.y-=5;}
 heading(title:string){this.ensure(42);this.text(title,M,this.y-12,11);this.y-=22;}
 table(columns:Column[],rows:string[][]){
  const size=8.1,lineHeight=12,headerHeight=23;
  const header=()=>{this.ensure(headerHeight+24);this.page.drawRectangle({x:M,y:this.y-headerHeight,width:this.width,height:headerHeight,color:rgb(.95,.95,.95)});let x=M;
   columns.forEach(c=>{const width=this.width*c.ratio/100,tx=x+(width-this.font.widthOfTextAtSize(c.title,size))/2;this.text(c.title,tx,this.y-15,size);x+=width;});this.y-=headerHeight;};
  header();
  for(const row of rows){
   const cells=columns.map((c,i)=>c.nowrap?[row[i]||'—']:wrapPdfText(row[i]||'—',this.font,size,this.width*c.ratio/100-8));
   const total=Math.max(1,...cells.map(c=>c.length));let offset=0;
   while(offset<total){
    if(this.y-24<B){this.newPage();header();}
    const count=Math.min(total-offset,Math.max(1,Math.floor((this.y-B-10)/lineHeight))),rh=count*lineHeight+10;let x=M;
    columns.forEach((c,i)=>{const width=this.width*c.ratio/100;
     this.page.drawRectangle({x,y:this.y-rh,width,height:rh,borderColor:LINE,borderWidth:.4});
     for(let j=0;j<count;j++){const value=cells[i][offset+j];if(value===undefined)continue;
      const fitted=c.nowrap?Math.min(size,(width-8)/Math.max(1,this.font.widthOfTextAtSize(value,1))):size;
      const tx=c.left?x+4:x+(width-this.font.widthOfTextAtSize(value,fitted))/2;
      this.text(value,tx,this.y-5-size-j*lineHeight,fitted);
     }x+=width;});this.y-=rh;offset+=count;
   }
  }this.y-=8;
 }
 async figure(svg:string,title:string,caption:string,options:PdfExportOptions){
  if(!svg)return;const m=svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
  const scale=Math.min(this.width/Number(m[1]),250/Number(m[2])),width=Number(m[1])*scale,height=Number(m[2])*scale;
  this.ensure(height+65);this.heading(title);
  const png=await this.pdf.embedPng(await (options.rasterizeSvg||rasterizeSheetSvg)(svg));
  this.page.drawImage(png,{x:M+(this.width-width)/2,y:this.y-height,width,height});this.y-=height+6;this.paragraph(caption,7.5);
 }
 finalize(){this.pdf.getPages().forEach((p,i)=>p.drawText((i+1)+' / '+this.pdf.getPageCount(),{x:W-M-28,y:18,font:this.font,size:7,color:MUTED}));}
}
export async function drawProductionSheetPdf(pdf:PDFDocument,font:PDFFont,d:TransformerDesignDocument,options:PdfExportOptions):Promise<Uint8Array>{
 const s=d.productionSheet!,p=new Paper(pdf,font,d);
 p.paragraph('磁芯型号：'+(s.core||'未填')+(s.material?'    磁芯材质：'+s.material:''));
 if(s.bobbinDescription?.trim())p.paragraph('骨架描述：'+s.bobbinDescription);
 if(s.transformerDescription?.trim())p.paragraph('变压器描述：'+s.transformerDescription);
 if(d.exampleFlag)p.paragraph('仅示例 / 未审核 / 不可用于生产。参数与分组仅供演示。');
 p.heading('绕组表（按绕制顺序）');
 p.table(['序号','绕组','起止脚','线径 / 股数','圈数','胶带','套管','分组 / 备注'].map((title,i)=>({title,ratio:[6,7,11,24,7,7,8,30][i],left:i===7,nowrap:i===3})),s.windings.map((w,i)=>[String(i+1),w.label,w.start+' → '+w.end,wireLabel(w),w.turns,w.tape||'—',sleeveLabel(w),[w.group==='unknown'?'未指定':w.group,w.wireType,w.direction,w.note].filter(Boolean).join('；')]));
 p.paragraph('胶带单位为层，0=不包胶，—=未注明；套管“起 / 止 / 起止”表示对应引出端，—=未勾选。',7.5);
 if(s.electrical.length){p.heading('电气性能目标');p.table(['测量脚对','目标电感','测试频率','测试条件 / 备注'].map((title,i)=>({title,ratio:[19,23,22,36][i],left:i===3})),s.electrical.map(e=>[e.start+' → '+e.end,e.inductance+' '+(INDUCTANCE_UNITS[e.unit]||e.unit),'@'+e.frequency+' kHz',e.note||'—']));}
 if(s.showDiagram)await p.figure(diagram(s),'绕组连接示意图','共脚抽头连续排列；图上排列与绕制顺序分开。黑点表示起绕点，不作为电气同名端证明；矩形表示套管。',options);
 await p.figure(construction(s),'绕制方式 COIL CONSTRUCTION','从 BOBBIN 向上按表格顺序由内到外；等高非比例工艺示意，不表示真实厚度。',options);
 if(d.source?.warnings.length){p.heading('历史导入说明');d.source.warnings.forEach(v=>p.paragraph(v));}
 if(d.coreSnapshot?.conflictNotes.length){p.heading('保留的磁芯来源说明');d.coreSnapshot.conflictNotes.forEach(v=>p.paragraph(v));}
 if(d.notes?.trim()){p.heading('备注信息');p.paragraph(d.notes);}
 p.paragraph('按录入参数制作；本单不计算或推断参数。',7.5);p.finalize();return pdf.save();
}
