import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { allWireCandidates, awgArea, awgDiameter, calculateWire, nominalMatch } from './algorithm';
import reference from './current-reference.json';
import { WireGaugePage } from './WireGaugePage';
describe('wire reference comparison', () => {
  it('retains every original three-column current value separately from geometry', () => {
    const all = allWireCandidates();
    expect(all).toHaveLength(50);
    expect(all.map(row => row.n)).toEqual(Array.from({ length: 50 }, (_, i) => i - 3));
    expect(all.map(({ n, conservative, normal, maximum }) => ({ n, conservative, normal, maximum }))).toEqual(reference.rows);
    expect(all.find(row => row.n === 2)).toMatchObject({ conservative: 94.797, normal: 132.716, maximum: 151.333 });
    expect(all.find(row => row.n === 46)).toMatchObject({ conservative: .004, normal: .005, maximum: .006 });
    for (let i=0; i<all.length; i++) {
      expect(all[i].conservative).toBeLessThanOrEqual(all[i].normal);
      expect(all[i].normal).toBeLessThanOrEqual(all[i].maximum);
      if (i) expect(all[i].maximum).toBeLessThan(all[i-1].maximum);
    }
  });
  it('uses NIST geometry including fine wires without copying source area errors', () => {
    expect(awgDiameter(36)).toBeCloseTo(.127,12);
    expect(awgArea(19)).toBeCloseTo(.6527,3);
    expect(awgArea(46)).toBeCloseTo(.0012463116154,12);
    expect(nominalMatch(awgArea(21))).toBeNull();
    expect(nominalMatch(.5)).toBe(.5);
    for (let n=-3;n<46;n++) expect(awgArea(n)).toBeGreaterThan(awgArea(n+1));
    expect(() => awgArea(47)).toThrow();
  });
  it('shows all 50 rows when empty and only the 100A window with one neighbor each', () => {
    const empty=calculateWire('','A');
    expect(empty.ok && empty.candidates.length).toBe(50);
    const result=calculateWire('100','A');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.current).toBe(100);
    expect(result.matchCount).toBe(2);
    expect(result.candidates.map(row => [row.n,row.status])).toEqual([[1,'below'],[2,'within'],[3,'within'],[4,'above']]);
    expect(calculateWire('100000','mA')).toEqual(result);
  });
  it('uses closed source bounds, handles no-match and small-current edges', () => {
    const exact=calculateWire('94.797','A');
    expect(exact.ok && exact.candidates.some(row=>row.n===2 && row.status==='within')).toBe(true);
    for (const [raw,n,status] of [['1000',-3,'above'],['.001',46,'below']] as const) {
      const result=calculateWire(raw,'A');
      expect(result.ok && result.matchCount).toBe(0);
      expect(result.ok && result.candidates.map(row=>[row.n,row.status])).toEqual([[n,status]]);
    }
    const small=calculateWire('5','mA');
    expect(small.ok && small.candidates.filter(row=>row.status==='within').map(row=>row.n)).toEqual([45,46]);
  });
  it('rejects invalid current without substituting a default', () => {
    for (const raw of ['0','-1','NaN','Infinity','1e309','0x10','1 A']) expect(calculateWire(raw,'A').ok).toBe(false);
    expect(calculateWire('1e-323','mA').ok).toBe(false);
  });
  it('renders all rows, only current controls, sources and column units', () => {
    const markup=renderToStaticMarkup(<WireGaugePage />);
    expect((markup.match(/data-reference-status="all"/g)??[]).length).toBe(50);
    expect(markup).toContain('data-testid="wire-current"');
    expect(markup).toContain('data-testid="wire-current-unit"');
    expect(markup).not.toContain('wire-j-');
    expect(markup).not.toContain('wire-calculate');
    expect(markup).toContain('适用条件未注明');
    expect(markup).toContain('https://www.liuwenhao.me/?p=5554');
    expect(markup).toContain('<details');
    expect(markup).toContain('平方数 <span>mm²</span>');
  });
});
