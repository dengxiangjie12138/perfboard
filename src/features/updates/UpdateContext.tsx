import {createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode} from 'react';
import {listen} from '@tauri-apps/api/event';
import {native} from '../../services/api';
import {initialUpdateStatus, updateApi, type UpdateStatus} from './updateApi';
import {UpdateClient, type UpdateSnapshot} from './updateClient';

export interface UpdateContextValue extends UpdateSnapshot {
  check: () => Promise<void>;
  setAutoCheck: (enabled: boolean) => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  openInstaller: () => Promise<void>;
}
const noop = async () => {};
const Context = createContext<UpdateContextValue>({status: initialUpdateStatus(), supported: false,
  loading: false, pendingAction: null, check: noop, setAutoCheck: noop, download: noop, install: noop, openInstaller: noop});

export function UpdateProvider({children}: {children: ReactNode}) {
  const [client] = useState(() => new UpdateClient({status: updateApi.status,
    listen: receive => listen<UpdateStatus>('perfboard:update-state', event => receive(event.payload)),
  }, native));
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => {void client.start(); return () => client.stop()}, [client]);
  const actions = useMemo(() => ({
    check: () => client.perform('check', updateApi.check),
    setAutoCheck: (enabled: boolean) => client.perform('set-auto', () => updateApi.setAutoCheck(enabled)),
    download: () => client.perform('download', updateApi.download),
    install: () => client.perform('install', updateApi.install),
    openInstaller: () => client.perform('open', updateApi.openInstaller),
  }), [client]);
  return <Context.Provider value={{...snapshot, ...actions}}>{children}</Context.Provider>;
}
export function useUpdates(): UpdateContextValue {return useContext(Context)}
