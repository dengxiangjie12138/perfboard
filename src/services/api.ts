import type { CloseAction, ToolWindowContext, WindowContext, WindowRoute } from '../windows/contracts';
import {invoke, isTauri} from '@tauri-apps/api/core';
import {open,save} from '@tauri-apps/plugin-dialog';
import type {Part,PartInput,Note,NoteInput,Snapshot,RepoStatus,Attachment} from '../types';
export const native = isTauri();
export interface ExternalTool { id: string; name: string; path: string; description: string; available: boolean; status: string }
export interface ExternalToolInput { id?: string; name: string; path: string; description: string }
export const api = {
 openWindow:(route:WindowRoute)=>invoke<string>('window_open',{route}),
 windowContext:()=>invoke<WindowContext>('window_context'),
 windowReady:()=>invoke<void>('window_ready'),
 openToolWindow:(toolId:string)=>invoke<string>('tool_window_open',{toolId}),
 toolWindowContext:()=>invoke<ToolWindowContext>('tool_window_context'),
 closeToolWindow:()=>invoke<void>('tool_window_close_request'),
 showMainWindow:()=>invoke<void>('tool_window_show_main'),
 sharedTheme:()=>invoke<string>('app_theme_get'),
 setSharedTheme:(theme:string)=>invoke<void>('app_theme_set',{theme}),
 externalToolsList:()=>invoke<ExternalTool[]>('external_tools_list'),
 externalToolsSave:(tool:ExternalToolInput)=>invoke<void>('external_tools_save',{tool}),
 externalToolsDelete:(id:string)=>invoke<void>('external_tools_delete',{id}),
 externalToolsLaunch:(id:string)=>invoke<void>('external_tools_launch',{id}),
 status:()=>invoke<RepoStatus>('repo_status'),
 openRepo:(path:string,create:boolean)=>invoke<RepoStatus>('repo_open',{path,create}),
 snapshot:()=>invoke<Snapshot>('data_snapshot'),
 savePart:(part:PartInput)=>invoke<Part>('part_save',{part}),
 deletePart:(id:string)=>invoke<void>('part_delete',{id}),
 getNote:(id:string)=>invoke<Note>('note_get',{id}),
 saveNote:(note:NoteInput)=>invoke<Note>('note_save',{note}),
 deleteNote:(id:string)=>invoke<void>('note_delete',{id}),
 importAttachment:(partId:string,sourcePath:string)=>invoke<Attachment>('attachment_import',{partId,sourcePath}),
 addUrl:(partId:string,url:string,name:string)=>invoke<Attachment>('attachment_add_url',{partId,url,name}),
 deleteAttachment:(id:string)=>invoke<void>('attachment_delete',{id}),
 openAttachment:(id:string)=>invoke<void>('attachment_open',{id}),
 openUrl:(url:string)=>invoke<void>('external_url_open',{url}),
 setting:(key:string,value:string)=>invoke<void>('setting_save',{key,value}),
 backup:(destination:string)=>invoke<string>('repository_backup',{destination}),
 requestClose:(action:'hide'|'quit')=>invoke<void>('app_close_request',{action}),
 closeResponse:(action:CloseAction,requestId:number,saved=true)=>invoke<void>('close_response',{action,requestId,saved}),
};
export async function pickDirectory(title='选择仓库数据目录'){return open({directory:true,multiple:false,title}) as Promise<string|null>}
export async function pickAttachment(){return open({multiple:false,title:'导入图片或 PDF',filters:[{name:'图片和 PDF',extensions:['png','jpg','jpeg','webp','gif','pdf']}]}) as Promise<string|null>}
export async function pickBackup(){return save({title:'选择新备份目录名称',defaultPath:'Perfboard-backup'})}
export function errorMessage(e:unknown){return e instanceof Error?e.message:String(e)}

export async function pickExternalToolExecutable(){return open({multiple:false,title:'选择本机 EXE 程序',filters:[{name:'Windows 程序',extensions:['exe']}]}) as Promise<string|null>}
