import {describe,it,expect,vi} from 'vitest';
import {CloseRequestRunner} from './closeRequestRunner';
import {SaveCancelledError,registerFlush,flushAll} from '../services/saveRegistry';
describe('production-sheet leave choices in shared close pipeline',()=>{
 it('supplies the native close context and treats continue-edit as cancellation, retaining the window',async()=>{
  const failed=vi.fn(),respond=vi.fn(async()=>{}),finished=vi.fn(),flush=vi.fn(async()=>{throw new SaveCancelledError();});
  const runner=new CloseRequestRunner({flush,respond,saveFailed:failed,responseFailed:vi.fn(),finished});
  const request={action:'close-tool' as const,requestId:1};await runner.run(request);
  expect(flush).toHaveBeenCalledWith('close-tool');expect(respond).toHaveBeenCalledWith(request,false);expect(failed).not.toHaveBeenCalled();expect(finished).toHaveBeenCalledWith(request,false,true);
 });
 it('still reports actual save failures and does not approve leaving',async()=>{
  const failed=vi.fn(),respond=vi.fn(async()=>{});
  const runner=new CloseRequestRunner({flush:async()=>{throw new Error('quota');},respond,saveFailed:failed,responseFailed:vi.fn()});
  await runner.run({action:'quit',requestId:2});expect(failed).toHaveBeenCalledOnce();expect(respond).toHaveBeenCalledWith({action:'quit',requestId:2},false);
 });
 it('passes context only as optional input, preserving older zero-argument savers',async()=>{
  const old=vi.fn(async()=>{}),newSaver=vi.fn(async()=>{});const off1=registerFlush(old),off2=registerFlush(newSaver);
  try{await flushAll('navigate');expect(old).toHaveBeenCalledOnce();expect(newSaver).toHaveBeenCalledWith('navigate');}finally{off1();off2();}
 });
});
