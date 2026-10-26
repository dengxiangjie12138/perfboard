import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { api, errorMessage, native } from '../services/api';
import { refreshRepositoryViews } from '../services/repositoryViews';
import { flushAll } from '../services/saveRegistry';
import type { CloseRequest } from './contracts';
import { CloseRequestRunner } from './closeRequestRunner';

/** Each webview saves only its own work. Native quit waits for every acknowledgement. */
export function useWindowClose(setError: (message: string | null) => void): void {
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const add = (cleanup: () => void) => { if (disposed) cleanup(); else cleanups.push(cleanup); };
    let frozenRequest = 0;
    const root = document.getElementById('root');
    const release = (requestId?: number) => {
      if (requestId !== undefined && requestId !== frozenRequest) return;
      frozenRequest = 0; if (root) root.inert = false; delete document.documentElement.dataset.windowSavePending;
    };
    const runner = new CloseRequestRunner({
      started: request => { frozenRequest = request.requestId; if (root) root.inert = true; document.documentElement.dataset.windowSavePending = 'true'; },
      finished: (request, saved, responded) => { if (!saved || !responded || request.action === 'hide') release(request.requestId); },
      flush: flushAll,
      respond: async (request, saved) => {
        try { await api.closeResponse(request.action, request.requestId, saved); }
        catch (error) {
          // Cancel a still-pending native request after a transport failure so retry works.
          if (saved) await api.closeResponse(request.action, request.requestId, false).catch(() => {});
          throw error;
        }
      },
      saveFailed: error => setError('保存失败，窗口保持打开：' + errorMessage(error)),
      responseFailed: error => setError('关闭请求未完成，窗口保持打开：' + errorMessage(error)),
    });
    const subscriptions = [
      getCurrentWebviewWindow().listen<CloseRequest>('perfboard:close-request', event => { if (!disposed) void runner.run(event.payload); }).then(add),
      listen<{ window: string; action?: string; requestId?: number }>('perfboard:close-failed', event => {
        if (disposed) return; release(event.payload.requestId);
        const operation = event.payload.action === 'flush' ? '跨窗口操作' : event.payload.action === 'close-tool' ? '关闭' : '退出';
        setError(`窗口 ${event.payload.window} 有内容未保存，${operation}已取消。请在该窗口处理后重试。`);
      }).then(add),
      listen<{ requestId: number }>('perfboard:flush-completed', event => { if (!disposed) void refreshRepositoryViews().then(()=>{if(!disposed)release(event.payload.requestId);}).catch(error=>{if(!disposed){release(event.payload.requestId);setError(errorMessage(error));}}); }).then(add),
    ];
    // Readiness comes after every listener, including cancellation/thaw notifications.
    void Promise.all(subscriptions).then(() => { if (!disposed) return api.windowReady(); }).catch(error => { if (!disposed) { release(); setError(errorMessage(error)); } });
    return () => { disposed = true; runner.dispose(); release(); cleanups.forEach(cleanup => cleanup()); };
  }, [setError]);
}
