import { describe, expect, it } from 'vitest';
import { memoryChoice, readMemory, restoreMemoryShape, viewMemoryKey, writeMemory, type MemoryStorage } from './viewMemory';
const storage = (): MemoryStorage => { const values = new Map<string,string>(); return { getItem: key => values.get(key) ?? null, setItem: (key,value) => { values.set(key,value); } }; };
describe('remembered views', () => {
  it('separates windows, repositories and features without delimiter collisions', () => {
    expect(viewMemoryKey('main','logs','D:\\仓库\\')).toBe(viewMemoryKey('main','logs','d:/仓库'));
    expect(viewMemoryKey('main','logs','\\\\?\\D:\\仓库')).toBe(viewMemoryKey('main','logs','d:/仓库'));
    expect(viewMemoryKey('main','logs','\\\\?\\UNC\\server\\share')).toBe(viewMemoryKey('main','logs','\\\\server\\share'));
    expect(new Set([viewMemoryKey('main','logs','a'),viewMemoryKey('tool-dev-logs','logs','a'),viewMemoryKey('main','logs','b'),viewMemoryKey('main','notes','a')]).size).toBe(4);
    expect(viewMemoryKey('main','a.b','c')).not.toBe(viewMemoryKey('main','b','c.a'));
  });
  it('round trips preferences including an intentionally empty selection', () => {
    const s = storage(); expect(writeMemory(s,'key',{selected:'',folded:['folder']})).toBe(true);
    expect(readMemory(s,'key',{selected:'other',folded:[] as string[]})).toEqual({selected:'',folded:['folder']});
  });
  it('keeps new defaults and refuses wrong field types and unknown fields', () => {
    expect(restoreMemoryShape({a:true,n:2,inner:{text:'new'}},{a:'false',n:Infinity,inner:{text:'kept',extra:4},extra:7})).toEqual({a:true,n:2,inner:{text:'kept'}});
  });
  it('does not overwrite corrupt or future-version records while opening a view', () => {
    const s = storage(); for(const raw of ['{bad','{"version":2,"value":8}','{"version":1}']) { s.setItem('key',raw); expect(readMemory(s,'key',3)).toBe(3); expect(s.getItem('key')).toBe(raw); }
  });
  it('validates enum values and tolerates unavailable/full storage', () => {
    const s=storage(); writeMemory(s,'key','deleted-tab'); expect(readMemory(s,'key','main',memoryChoice(['main','other']))).toBe('main');
    const failed={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('full');}};
    expect(readMemory(failed,'key',false)).toBe(false); expect(writeMemory(failed,'key',true)).toBe(false);
    expect(writeMemory(s,'large','x'.repeat(2*1024*1024))).toBe(false);
  });
});
