import { listen } from '@tauri-apps/api/event';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api, native } from '../../services/api';
import { useData } from '../../state/DataContext';
import { ExternalToolsStore } from './store';
const Context = createContext<ExternalToolsStore | null>(null);
export function ExternalToolsProvider({ children }: { children: ReactNode }) {
  const { repo } = useData();
  const [store] = useState(() => new ExternalToolsStore({
    list: () => native ? api.externalToolsList() : Promise.resolve([]),
    save: api.externalToolsSave, remove: api.externalToolsDelete, launch: api.externalToolsLaunch,
  }));
  useEffect(() => {
    store.setRepository(repo.ready ? repo.path : null);
    if (native && repo.ready) void store.refresh().catch(() => undefined);
  }, [store, repo.ready, repo.path]);
  useEffect(() => {
    if (!native) return;
    let disposed = false, revision = 0;
    let cleanup: (() => void) | undefined;
    void listen<string>('perfboard:data-changed', event => {
      const ticket = ++revision;
      if (event.payload === 'repository') store.setRepository(null);
      void api.status().then(status => {
        if (disposed || ticket !== revision) return;
        store.setRepository(status.ready ? status.path : null);
        if (status.ready) void store.refresh().catch(() => undefined);
      }).catch(() => { if (!disposed && ticket === revision) store.setRepository(null); });
    }).then(unlisten => { if (disposed) unlisten(); else cleanup = unlisten; }).catch(() => undefined);
    return () => { disposed = true; cleanup?.(); };
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useExternalTools() {
  const store = useContext(Context);
  if (!store) throw new Error('ExternalToolsProvider is required');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...snapshot, refresh: store.refresh, save: store.save, remove: store.remove, launch: store.launch };
}
