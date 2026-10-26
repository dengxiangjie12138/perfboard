const refreshers=new Set<()=>Promise<void>>();
export function registerRepositoryView(refresh:()=>Promise<void>){refreshers.add(refresh);return()=>{refreshers.delete(refresh);};}
export async function refreshRepositoryViews(){await Promise.all([...refreshers].map(refresh=>refresh()));await new Promise<void>(resolve=>window.setTimeout(resolve,0));}
