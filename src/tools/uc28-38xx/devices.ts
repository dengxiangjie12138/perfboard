export interface PwmDevice {
  id: string; family: 'ucc' | 'uc' | 'uc3841'; divide: 1 | 2; dutyClass: number; maxOscHz: number;
  on: readonly [number, number, number] | null; off: readonly [number, number, number] | null;
  startupMaxUa: number; delayTypicalNs: number; delayMaxNs: number; temperature: string;
}
const ucc = ['UCC28C40', 'UCC28C41', 'UCC28C42', 'UCC28C43', 'UCC28C44', 'UCC28C45', 'UCC38C40', 'UCC38C41', 'UCC38C42', 'UCC38C43', 'UCC38C44', 'UCC38C45'].map(id => {
  const suffix = id.slice(-2), high = suffix === '42' || suffix === '44', low = suffix === '40' || suffix === '41', half = ['41', '44', '45'].includes(suffix);
  return { id, family: 'ucc' as const, divide: half ? 2 as const : 1 as const, dutyClass: half ? 50 : 100, maxOscHz: 1e6,
    on: high ? [13.5, 14.5, 15.5] as const : low ? [6.5, 7, 7.5] as const : [7.8, 8.4, 9] as const,
    off: high ? [8, 9, 10] as const : low ? [6.1, 6.6, 7.1] as const : [7, 7.6, 8.2] as const,
    startupMaxUa: 100, delayTypicalNs: 35, delayMaxNs: 70, temperature: id.startsWith('UCC28') ? '−40～125 °C（TJ）' : '0～85 °C（TJ）' };
});
const uc = ['UC3842', 'UC3843', 'UC3844', 'UC3845'].map(id => {
  const high = id === 'UC3842' || id === 'UC3844', half = id === 'UC3844' || id === 'UC3845';
  return { id, family: 'uc' as const, divide: half ? 2 as const : 1 as const, dutyClass: half ? 50 : 100, maxOscHz: 5e5,
    on: high ? [14.5, 16, 17.5] as const : [7.8, 8.4, 9] as const, off: high ? [8.5, 10, 11.5] as const : [7, 7.6, 8.2] as const,
    startupMaxUa: 1000, delayTypicalNs: 150, delayMaxNs: 300, temperature: '0～70 °C（TA）' };
});
export const PWM_DEVICES: readonly PwmDevice[] = [...ucc, ...uc, { id: 'UC3841', family: 'uc3841', divide: 1, dutyClass: 100, maxOscHz: 5e5, on: null, off: null, startupMaxUa: 6000, delayTypicalNs: 200, delayMaxNs: 400, temperature: '0～70 °C（TA）' }];
export const pwmDevice = (id: string) => PWM_DEVICES.find(d => d.id === id);
export const pwmDocument = (id: string) => `https://www.ti.com.cn/cn/lit/gpn/${id}`;
export const pwmProduct = (id: string) => `https://www.ti.com.cn/product/cn/${id}`;
