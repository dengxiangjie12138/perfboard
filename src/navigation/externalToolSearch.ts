import { OfflineSearch, type SearchResults } from '../services/search';
import type { AppRoute } from './routes';
export interface SearchableExternalTool { id: string; name: string; description: string }
const applicationSearch = new OfflineSearch<SearchableExternalTool>(tool => [tool.name, tool.description]);
export function searchExternalTools<T extends SearchableExternalTool>(tools: readonly T[], query: string): T[] {
  return applicationSearch.search(tools, query) as T[];
}
export function searchExternalToolResults<T extends SearchableExternalTool>(tools: readonly T[], query: string): SearchResults<T> {
  return applicationSearch.searchResults(tools, query) as SearchResults<T>;
}
export function externalToolRoute(id: string): AppRoute { return { page: 'external-tools', externalToolId: id }; }
