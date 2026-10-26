import definitions from './tool-windows.json';
import type { ToolWindowDefinition, WindowRoute } from './contracts';
export const TOOL_WINDOWS: readonly ToolWindowDefinition[] = definitions;
const categories = ['硬件错题本', '软件错题本', '随笔', '学习笔记'];
export function toolWindowDefinition(id: string): ToolWindowDefinition | undefined { return TOOL_WINDOWS.find(tool => tool.id === id); }
export function toolIdFromHash(hash: string): string | undefined {
  if (!hash.startsWith('#tool=')) return undefined;
  return toolWindowDefinition(hash.slice(6))?.id;
}
function recordId(value: unknown): boolean { return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\\/#]/.test(value) && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) && !value.includes('://'); }
export function isWindowRoute(value: unknown): value is WindowRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const route = value as Record<string, unknown>;
  const keys: Record<string, readonly string[]> = { tool: ['kind', 'toolId', 'externalToolId'], parts: ['kind', 'partId'], notes: ['kind', 'category', 'noteId'], 'dev-logs': ['kind', 'projectId', 'pageId'] };
  if (typeof route.kind !== 'string' || !Object.hasOwn(keys, route.kind) || Object.keys(route).some(key => !keys[route.kind as string].includes(key))) return false;
  if (route.kind === 'tool') return typeof route.toolId === 'string' && !!toolWindowDefinition(route.toolId) && (!('externalToolId' in route) || (route.toolId === 'external-tools' && recordId(route.externalToolId)));
  if ('category' in route && (typeof route.category !== 'string' || !categories.includes(route.category))) return false;
  return ['partId', 'noteId', 'projectId', 'pageId'].every(key => !(key in route) || recordId(route[key]));
}
export function windowHash(route: WindowRoute): string {
  if (!isWindowRoute(route)) throw new Error('Unsupported independent window route');
  return '#window=' + encodeURIComponent(JSON.stringify(route));
}
export function windowRouteFromHash(hash: string): WindowRoute | undefined {
  const legacy = toolIdFromHash(hash);
  if (legacy) return { kind: 'tool', toolId: legacy };
  if (!hash.startsWith('#window=')) return undefined;
  try { const value: unknown = JSON.parse(decodeURIComponent(hash.slice(8))); return isWindowRoute(value) ? value : undefined; } catch { return undefined; }
}
export function sameWindowRoute(left: WindowRoute, right: WindowRoute): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => left[key as keyof WindowRoute] === right[key as keyof WindowRoute]);
}
