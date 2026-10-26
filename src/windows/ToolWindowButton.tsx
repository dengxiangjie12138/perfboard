import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api, errorMessage, native } from '../services/api';
import { toolWindowDefinition } from './definitions';
import type { WindowRoute } from './contracts';
export function OpenWindowButton({ route, disabled, onError }: { route: WindowRoute; disabled: boolean; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return <button className="tool-window-trigger small" aria-label="在独立窗口打开" title="新开独立窗口；输入和当前窗口相互独立" disabled={disabled || busy || !native} onClick={() => {
    setBusy(true); void api.openWindow(route).catch(error => onError(errorMessage(error))).finally(() => setBusy(false));
  }}><ExternalLink size={14} /><span>独立窗口</span></button>;
}
export function ToolWindowButton({ toolId, disabled, onError }: { toolId: string; disabled: boolean; onError: (message: string) => void }) {
  return toolWindowDefinition(toolId) ? <OpenWindowButton route={{ kind: 'tool', toolId }} disabled={disabled} onError={onError} /> : null;
}
