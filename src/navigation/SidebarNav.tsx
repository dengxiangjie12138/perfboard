import { Fragment, useEffect, useState, type ReactNode, type MouseEvent } from 'react';
import { Home, Box, Layers, FileText, Settings, Database, History, BookOpen, type LucideIcon } from 'lucide-react';
import type { NoteCategory, Page } from '../types';
import { TOOL_GROUPS, TOOL_SECTIONS, TOOLS } from '../tools/registry';
import type { AppRoute, Navigate, NavigationGroups } from './routes';
import { pageLabel } from './pages';
import { independentRoute } from './windowRoute';

const NOTE_CATEGORIES: NoteCategory[] = ['硬件错题本', '软件错题本', '随笔', '学习笔记'];
interface Props {
  route: AppRoute; disabled: boolean; groups: NavigationGroups;
  toggleGroup: (group: keyof NavigationGroups) => void; onNavigate: Navigate; onOpenWindow?: Navigate;
}
export function SidebarNav({ route, disabled, groups, toggleGroup, onNavigate, onOpenWindow }: Props) {
  const [context,setContext]=useState<{route:AppRoute;x:number;y:number}|null>(null);
  useEffect(()=>{if(!context)return;const dismiss=()=>setContext(null);document.addEventListener('pointerdown',dismiss);document.addEventListener('scroll',dismiss,true);document.addEventListener('keydown',dismiss);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('scroll',dismiss,true);document.removeEventListener('keydown',dismiss);}},[context]);
  function menu(event:MouseEvent,next:AppRoute){event.preventDefault();if(!disabled&&onOpenWindow&&independentRoute(next))setContext({route:next,x:Math.min(event.clientX,window.innerWidth-205),y:Math.min(event.clientY,window.innerHeight-50)});}
  function navButton(page: Page, Icon: LucideIcon, label = pageLabel(page)) {
    return <button disabled={disabled} className={'nav-row ' + (route.page === page ? 'active' : '')}
      aria-current={route.page === page ? 'page' : undefined} onClick={() => onNavigate({ page })} onContextMenu={event=>menu(event,{page})}>
      <Icon size={18} /><span>{label}</span>
    </button>;
  }
  function group(id: keyof NavigationGroups, label: string, Icon: LucideIcon, children: ReactNode, active: boolean) {
    return <div className="nav-group"><button className={'nav-row group-row ' + (active ? 'active-group' : '')}
      onClick={() => toggleGroup(id)} aria-expanded={groups[id]} aria-controls={'submenu-' + id}>
      <Icon size={18} /><span>{label}</span>
    </button><div id={'submenu-' + id} className="submenu" hidden={!groups[id]}>{children}</div></div>;
  }
  return <nav aria-label="主导航">
    <div className="nav-heading">工作空间</div>{navButton('workbench', Home)}{navButton('parts', Box)}{navButton('cores', Layers)}
    {TOOL_SECTIONS.map(section => <Fragment key={section.id}><div className="nav-heading">{section.title}</div>
    {TOOL_GROUPS.filter(toolGroup => toolGroup.section === section.id).map(toolGroup => <div key={toolGroup.page}>{group(
      toolGroup.page, toolGroup.title, toolGroup.icon,
      <><button disabled={disabled} className={route.page === toolGroup.page ? 'active' : ''}
        onClick={() => onNavigate({ page: toolGroup.page })}>概览</button>
      {TOOLS.filter(tool => tool.group === toolGroup.page).map(tool => <button key={tool.page} disabled={disabled}
        className={route.page === tool.page ? 'active' : ''} onClick={() => onNavigate({ page: tool.page })} onContextMenu={event=>menu(event,{page:tool.page})}>{tool.title}</button>)}</>,
      route.page === toolGroup.page || TOOLS.some(tool => tool.group === toolGroup.page && tool.page === route.page),
    )}</div>)}</Fragment>)}
    <div className="nav-heading">记录</div>
    {group('notes', '笔记', FileText, <><button disabled={disabled} className={route.page === 'notes' && !route.category ? 'active' : ''}
      onClick={() => onNavigate({ page: 'notes' })} onContextMenu={event=>menu(event,{page:'notes'})}>笔记概览</button>
      {NOTE_CATEGORIES.map(category => <button key={category} disabled={disabled}
        className={route.page === 'notes' && route.category === category ? 'active' : ''}
        onClick={() => onNavigate({ page: 'notes', category })} onContextMenu={event=>menu(event,{page:'notes',category})}>{category}</button>)}</>, route.page === 'notes')}
    {navButton('dev-logs',BookOpen)}
    <div className="nav-heading">设置</div>
    {navButton('appearance', Settings)}{navButton('repository', Database)}{navButton('history', History)}
    {context&&<div className="context-actions" role="menu" style={{left:context.x,top:context.y}} onPointerDown={event=>event.stopPropagation()}><button role="menuitem" onClick={()=>{onOpenWindow?.(context.route);setContext(null);}}>在独立窗口中打开</button></div>}
  </nav>;
}
