import {listen} from '@tauri-apps/api/event';
import {createContext,useContext,useState,useCallback,useEffect,useRef,type ReactNode} from 'react';
import {api,errorMessage,native} from '../services/api';
import {registerRepositoryView} from '../services/repositoryViews';
import type {Snapshot,RepoStatus} from '../types';
const empty:Snapshot={parts:[],notes:[],attachments:[],settings:{}};
interface DataContextValue {data:Snapshot;repo:RepoStatus;loading:boolean;error:string|null;refresh:()=>Promise<void>;reloadStatus:()=>Promise<void>;notify:(message:string)=>void;message:string;setError:(message:string|null)=>void}
const Context=createContext<DataContextValue|null>(null);
export function DataProvider({children}:{children:ReactNode}){
 const [data,setData]=useState(empty),[repo,setRepo]=useState<RepoStatus>({configured:false,ready:false,path:null,error:null}),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[message,setMessage]=useState('');
 const ticket=useRef(0);
 const refresh=useCallback(async()=>{const t=++ticket.current;const next=await api.snapshot();if(t===ticket.current)setData(next)},[]);
 const reloadStatus=useCallback(async()=>{const t=++ticket.current;try{const status=await api.status();const next=status.ready?await api.snapshot():empty;if(t===ticket.current){setRepo(status);setData(next)}}catch(e){if(t===ticket.current){const failure=errorMessage(e);setError(failure);setRepo(current=>({...current,ready:false,error:failure}));setData(empty)}}finally{if(t===ticket.current)setLoading(false)}},[]);
 useEffect(()=>registerRepositoryView(reloadStatus),[reloadStatus]);
 useEffect(()=>{if(native){void reloadStatus()}else{setLoading(false);setError('请在 Perfboard Windows 应用中打开。浏览器仅用于界面开发。')}},[reloadStatus]);
 useEffect(()=>{if(!native)return;let disposed=false;let cleanup:(()=>void)|undefined;void listen<string>('perfboard:data-changed',()=>{void reloadStatus()}).then(unlisten=>{if(disposed)unlisten();else cleanup=unlisten}).catch(e=>setError(errorMessage(e)));return()=>{disposed=true;cleanup?.()}},[reloadStatus]);
 const notify=useCallback((text:string)=>{setMessage(text);window.setTimeout(()=>setMessage(current=>current===text?'':current),5000)},[]);
 return <Context.Provider value={{data,repo,loading,error,refresh,reloadStatus,notify,message,setError}}>{children}</Context.Provider>;
}
export function useData(){const value=useContext(Context);if(!value)throw new Error('DataProvider missing');return value}
