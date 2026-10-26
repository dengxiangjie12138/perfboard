import {useLayoutEffect,useRef,type ReactNode} from 'react';
import './row-limited-table.css';
/** Keep every record mounted; cap the viewport at the measured first 20 rows. */
export function RowLimitedTable({children,className,label}:{children:ReactNode;className:string;label:string}){
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const viewport=ref.current,table=viewport?.querySelector('table');
  if(!viewport||!table)return;
  const rows=[...table.querySelectorAll('thead tr'),...Array.from(table.querySelectorAll('tbody tr')).slice(0,20)];
  const measure=()=>{const height=rows.reduce((sum,row)=>sum+row.getBoundingClientRect().height,0);if(height>0)viewport.style.maxHeight=Math.ceil(height+viewport.offsetHeight-viewport.clientHeight)+'px';};
  measure();const observer=new ResizeObserver(measure);
  observer.observe(table);rows.forEach(row=>observer.observe(row));
  return()=>observer.disconnect();
 },[children]);
 return <div ref={ref} className={'row-limited-table '+className} tabIndex={0} role="region" aria-label={label}>{children}</div>;
}
