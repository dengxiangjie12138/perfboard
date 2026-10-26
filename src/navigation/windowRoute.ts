import type { AppRoute } from './routes';
import type { WindowRoute } from '../windows/contracts';
import { toolWindowDefinition } from '../windows/definitions';
export function independentRoute(route: AppRoute): WindowRoute | null {
 if(route.page==='parts') return {kind:'parts',...(route.partId?{partId:route.partId}:{})};
 if(route.page==='notes') return {kind:'notes',...(route.category?{category:route.category}:{}),...(route.noteId?{noteId:route.noteId}:{})};
 if(route.page==='dev-logs') return {kind:'dev-logs',...(route.projectId?{projectId:route.projectId}:{}),...(route.logPageId?{pageId:route.logPageId}:{})};
 return toolWindowDefinition(route.page)?{kind:'tool',toolId:route.page,...(route.page==='external-tools'&&route.externalToolId?{externalToolId:route.externalToolId}:{})}:null;
}
