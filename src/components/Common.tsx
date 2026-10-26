import {useEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {useData} from '../state/DataContext';
export function Heading({eyebrow,title,description,action}:{eyebrow:string;title:string;description?:string;action?:ReactNode}){return <header className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{action}</header>}
export function Empty({children}:{children:ReactNode}){return <div className="empty-state">{children}</div>}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){const {error}=useData();const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal()},[]);return <dialog ref={ref} className={wide?'modal wide':'modal'} onCancel={e=>{e.preventDefault();onClose()}}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18}/></button></div>{error&&<p className="error-text" role="alert">{error}</p>}{children}</dialog>}
export function formatDate(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
