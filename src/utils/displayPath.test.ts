import { describe, expect, it } from 'vitest';
import { formatDisplayPath } from './displayPath';

describe('Windows repository path display', () => {
  it.each([
    ['\\\\?\\D:\\洞洞板\\洞洞板仓库', 'D:\\洞洞板\\洞洞板仓库'],
    ['\\\\?\\c:\\My Projects\\仓库 😀', 'c:\\My Projects\\仓库 😀'],
    ['\\\\?\\C:\\', 'C:\\'],
    ['\\\\?\\UNC\\server\\share\\洞洞板', '\\\\server\\share\\洞洞板'],
    ['\\\\?\\unc\\服务器\\共享', '\\\\服务器\\共享'],
    ['\\\\?\\UNC\\server\\share\\', '\\\\server\\share\\'],
    ['D:\\洞洞板\\洞洞板仓库', 'D:\\洞洞板\\洞洞板仓库'],
    ['\\\\server\\share\\洞洞板', '\\\\server\\share\\洞洞板'],
    ['/home/user/repository', '/home/user/repository'],
    ['relative/path', 'relative/path'],
    ['', ''],
    ['\\\\?\\Volume{abc}\\仓库', '\\\\?\\Volume{abc}\\仓库'],
    ['\\\\.\\PhysicalDrive0', '\\\\.\\PhysicalDrive0'],
    ['\\\\?\\UNC\\server', '\\\\?\\UNC\\server'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatDisplayPath(input)).toBe(expected);
  });
});
