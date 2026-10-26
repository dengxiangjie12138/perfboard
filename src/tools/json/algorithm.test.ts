import { describe, expect, it, vi } from 'vitest';
import { isLosslessNumber, parse } from 'lossless-json';
import { isObject, valueType } from 'vanilla-jsoneditor';
import { contentToRaw, copyJson, losslessParser, MAX_JSON_LENGTH, searchJson, transformJson, validateJson } from './algorithm';

describe('lossless JSON processing', () => {
  const source = '{"u64":18446744073709551615,"negative":-9223372036854775809,"beyond":9007199254740993,"fraction":0.123456789012345678901,"exponent":1e400,"other":"旧值"}';
  it('preserves every numeric token through format, compact, and tree leaf edits', () => {
    const formatted = transformJson(source, 'format');
    expect(transformJson(formatted, 'compact')).toBe(source);
    const json = losslessParser.parse(source) as Record<string, unknown>;
    json.other = '新值';
    const updated = contentToRaw({ json, text: undefined });
    expect(transformJson(updated, 'compact')).toBe(source.replace('旧值', '新值'));
    expect(isLosslessNumber(json.u64)).toBe(true);
    json.u64 = losslessParser.parse('18446744073709551616');
    expect(transformJson(contentToRaw({ json }), 'compact')).toBe(source.replace('旧值', '新值').replace('18446744073709551615', '18446744073709551616'));
  });
  it('uses the official editor primitive handling for custom numeric objects', () => {
    const value = (parse(source) as Record<string, unknown>).u64;
    expect(isObject(value)).toBe(false);
    expect(valueType(value, losslessParser)).toBe('number');
  });
  it('round trips string escapes without deleting meaningful backslashes', () => {
    const raw = '中文\\路径\n"引用"\t😀';
    const escaped = transformJson(raw, 'escape');
    expect(transformJson(escaped, 'unescape')).toBe(raw);
    expect(transformJson(transformJson(source, 'compact-escape'), 'unescape')).toBe(source);
    expect(() => transformJson('{"a":1}', 'unescape')).toThrow('JSON 字符串');
    expect(() => transformJson('"bad\\q"', 'unescape')).toThrow();
  });
  it('does not treat incomplete input as an empty object or repair it', () => {
    for (const raw of ['', ' ', '{', '[1,', '{"a":}', '{"a":1,}']) {
      expect(validateJson(raw).status).not.toBe('valid');
      expect(() => transformJson(raw, 'format')).toThrow();
      expect(contentToRaw({ text: raw })).toBe(raw);
    }
    expect(validateJson('{\n  "a": }').message).toContain('第 2 行');
  });
  it('accepts root primitives and empty containers', () => {
    for (const raw of ['null', 'false', '18446744073709551615', '"hello"', '{}', '[]']) expect(validateJson(raw).status).toBe('valid');
  });
  it('stops before parsing oversized input and limits search results', () => {
    expect(validateJson('x'.repeat(MAX_JSON_LENGTH + 1)).status).toBe('large');
    expect(() => transformJson('x'.repeat(MAX_JSON_LENGTH + 1), 'escape')).toThrow('超过');
    const value = parse('{"name":"hello","big":18446744073709551615,"items":["hello"]}');
    expect(searchJson(value, 'hello').map(match => match.path)).toEqual([['name'], ['items', 0]]);
    expect(searchJson(value, '18446744073709551615')[0].path).toEqual(['big']);
    expect(searchJson(Array(500).fill('match'), 'match')).toHaveLength(200);
  });
  it('reports clipboard failures without touching the global clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyJson(source, { writeText })).toContain('已复制');
    expect(writeText).toHaveBeenCalledWith(source);
    expect(await copyJson(source, { writeText: vi.fn().mockRejectedValue(new Error('denied')) })).toContain('复制失败');
    expect(await copyJson(source, undefined)).toContain('复制失败');
  });
});


