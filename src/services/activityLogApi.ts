import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
export type ActivityMode = 'off'|'working'|'resting'|'systemRest'|'paused';
export type ActivityReason = 'idle'|'manual'|'system'|'control'|'restart';
export interface ActivitySummary { workingMs:number; restingMs:number; systemRestMs:number; pausedMs:number; offMs:number }
export interface ActivitySegment { id:string;mode:ActivityMode;reason:ActivityReason;startUtcMs:number;endUtcMs:number;durationMs:number;incomplete:boolean;ongoing:boolean;startOffsetMinutes?:number;endOffsetMinutes?:number }
export interface ActivityDay { day:string;segments:ActivitySegment[];summary:ActivitySummary }
export interface ActivityDays { days:{day:string;summary:ActivitySummary;segmentCount:number;incomplete:boolean}[] }
function native(){if(!isTauri())throw new Error('每日日志需在 Perfboard 桌面应用中查看。');}
export const activityLogApi={
  days:(options:{limit?:number;beforeDay?:string}={})=>{native();return invoke<ActivityDays>('activity_log_days',{limit:options.limit,beforeDay:options.beforeDay});},
  day:(day:string)=>{native();return invoke<ActivityDay>('activity_log_day',{day});},
  listenChanged:(handler:(day:string)=>void)=>listen<{day:string}>('perfboard:activity-log-changed',e=>handler(e.payload.day))
};
