import {expect,it} from 'vitest';
import {duration,endpoint,localDay} from './ActivityLogDayTable';
it('keeps saved local offset and next-day endpoint even after the current timezone changes',()=>{
 const t=Date.parse('2026-10-08T16:00:00Z');
 expect(endpoint(t,480,'2026-10-08')).toBe('2026-10-09 00:00:00');
 expect(endpoint(t,-420,'2026-10-08')).toBe('09:00:00');
});
it('uses calendar components for local day and supports durations beyond one day',()=>{
 expect(localDay(new Date(2026,9,8,12,0,0))).toBe('2026-10-08');
 expect(duration(90_000_000)).toBe('25:00:00');expect(duration(-1)).toBe('00:00:00');
});
