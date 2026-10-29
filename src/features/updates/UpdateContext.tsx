import {createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode} from 'react';
import {listen} from '@tauri-apps/api/event';
import {native} from '../../services/api';
import {initialUpdateStatus, updateApi, type UpdateSource, type UpdateStatus} from './updateApi';
import {UpdateClient, type UpdateSnapshot} from './updateClient';

export interface UpdateContextValue extends UpdateSnapshot {
  check: () => Promise<void>;
  setSource: (source: UpdateSource) => Promise<void>;
  setAutoCheck: (enabled: boolean) => Promise<void>;
  download: () => Promise<void>;
  install: (allowRollback?: boolean) => Promise<void>;
  openInstaller: (allowRollback?: boolean) => Promise<void>;
  listVersions: () => Promise<void>;
  downloadVersion: (tag: string) => Promise<void>;
  openRelease: (tag: string) => Promise<void>;
}
const noop = async () => {};
const Context = createContext<UpdateContextValue>({status: initialUpdateStatus(), supported: false,
  loading: false, pendingAction: null, versions: null, versionsLoading: false, versionsError: null,
  check: noop, setSource: noop, setAutoCheck: noop, download: noop, install: noop, openInstaller: noop,
  listVersions: noop, downloadVersion: noop, openRelease: noop});

export function UpdateProvider({children}: {children: ReactNode}) {
  const [client] = useState(() => new UpdateClient({status: updateApi.status,
    listen: receive => listen<UpdateStatus>('perfboard:update-state', event => receive(event.payload)),
  }, native));
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => {void client.start(); return () => client.stop()}, [client]);
  const actions = useMemo(() => ({
    check: () => client.perform('check', updateApi.check),
    setSource: (source: UpdateSource) => client.perform('set-source', () => updateApi.setSource(source)),
    setAutoCheck: (enabled: boolean) => client.perform('set-auto', () => updateApi.setAutoCheck(enabled)),
    download: () => client.perform('download', updateApi.download),
    install: (allowRollback = false) => client.perform('install', () => updateApi.install(allowRollback)),
    openInstaller: (allowRollback = false) => client.perform('open', () => updateApi.openInstaller(allowRollback)),
    listVersions: () => client.listVersions(updateApi.listVersions),
    downloadVersion: (tag: string) => client.perform('download', () => updateApi.downloadVersion(tag)),
    openRelease: (tag: string) => client.perform('manual', () => updateApi.openRelease(tag)),
  }), [client]);
  return <Context.Provider value={{...snapshot, ...actions}}>{children}</Context.Provider>;
}
export function useUpdates(): UpdateContextValue {return useContext(Context)}
