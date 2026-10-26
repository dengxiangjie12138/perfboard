import { OfflineSearch } from '../../services/search';
import { CATALOG, type CatalogEntry } from './catalog';
import { circuitDefinition } from './metadata';

const search = new OfflineSearch<CatalogEntry>(entry => [
  entry[0], entry[1], entry[2],
  ...(entry[4] ? circuitDefinition(entry[4]).keywords : []),
]);

export const searchCatalog = (query: string) => search.search(CATALOG, query);
