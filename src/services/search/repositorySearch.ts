import type { NoteSummary, Part } from '../../types';
import { OfflineSearch, type SearchResults } from './index';

const parts = new OfflineSearch<Part>(
  part => [part.name, part.category, part.packageName, part.brand, part.lcscNumber, part.parameters, part.location, part.brief],
  // Packages and supplier IDs never enter the approximate vocabulary.
  part => [part.name, part.category, part.brand, part.parameters, part.location, part.brief],
);
const notes = new OfflineSearch<NoteSummary>(note => [note.title, note.category, note.searchText]);
const notesByUpdate = (a: NoteSummary, b: NoteSummary) => b.updatedAt.localeCompare(a.updatedAt);

/** The input is the full SQLite snapshot. Global search limits its preview afterwards. */
export function searchParts(records: readonly Part[], query: string, limit = 5): Part[] {
  return parts.search(records, query, limit);
}
export function searchNotes(records: readonly NoteSummary[], query: string, limit = 5): NoteSummary[] {
  return notes.search(records, query, limit, notesByUpdate);
}
export function searchPartsResults(records: readonly Part[], query: string, limit = 5, suggestionLimit = 5): SearchResults<Part> {
  return parts.searchResults(records, query, limit, suggestionLimit);
}
export function searchNotesResults(records: readonly NoteSummary[], query: string, limit = 5, suggestionLimit = 5): SearchResults<NoteSummary> {
  return notes.searchResults(records, query, limit, suggestionLimit, notesByUpdate);
}
