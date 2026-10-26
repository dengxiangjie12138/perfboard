export type FlushContext = 'navigate' | 'quit' | 'hide' | 'close-tool' | 'flush';
export class SaveCancelledError extends Error { readonly cancelled=true; constructor(){super('已取消离开，继续编辑。');} }
export function isSaveCancelled(error:unknown):boolean {return error instanceof SaveCancelledError;}
const savers = new Set<(context?:FlushContext)=>Promise<void>>();
export function registerFlush(fn:(context?:FlushContext)=>Promise<void>){savers.add(fn);return ()=>{savers.delete(fn)}}
export async function flushAll(context?:FlushContext){for(const flush of savers)await flush(context)}
