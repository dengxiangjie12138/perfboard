export type StockStatus = 'in_stock'|'low'|'out_of_stock'|'unknown';
export type NoteCategory = '硬件错题本'|'软件错题本'|'随笔'|'学习笔记';
export type Theme = 'light'|'dark'|'codex';
export type ThemePreference = Theme|'system';
export interface Part {id:string;name:string;category:string;packageName:string;parameters:string;lcscNumber?:string;brand?:string;stockStatus:StockStatus;quantity:number|null;location:string;brief:string;url:string;createdAt:string;updatedAt:string}
export type PartInput = Omit<Part,'createdAt'|'updatedAt'>;
export interface NoteSummary {id:string;title:string;category:NoteCategory;searchText:string;createdAt:string;updatedAt:string;revision?:number}
export interface Note extends NoteSummary {sceneJson:string}
export interface NoteInput {id:string;title:string;category:NoteCategory;searchText:string;sceneJson:string|null;expectedRevision?:number}
export interface Attachment {id:string;partId:string;name:string;mime:string;size:number;relativePath:string;kind:'file'|'url';url:string|null}
export interface Snapshot {parts:Part[];notes:NoteSummary[];attachments:Attachment[];settings:Record<string,string>}
export interface RepoStatus {configured:boolean;ready:boolean;path:string|null;error:string|null}
export type Page = 'workbench'|'parts'|'hardware'|'feedback'|'stm32'|'timer'|'notes'|'appearance'|'repository'|'history'|'utilities'|'radix'|'led'|'resistor-series'|'resistor-parallel'|'json'|'cores'|'external-tools'|'wire-gauge'|'dev-logs'|'fitness'|'standing-reminder'|'transformer-design'|'opamp'|'voltage-divider'|'tl431'|'pullup-divider'|'uc28-38xx'|'pmos-switch';
