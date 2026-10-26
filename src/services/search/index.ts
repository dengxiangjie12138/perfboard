import Fuse from 'fuse.js';
import { includesSearchTerm, matchesMixedTerm, searchAliases, type SearchAliases } from './text';
import { isTolerantSearchTerm, tolerantSearchWords } from './tolerant';

interface CachedRecord { values: readonly string[]; aliases: SearchAliases[]; fuzzyValues?: readonly string[]; words?: readonly string[] }
interface QueryTerm { text: string; aliases: SearchAliases; mixed: boolean }
export interface SearchCorrection { term: string; matched: string }
export interface SearchSuggestion<T> { record: T; score: number; corrections: SearchCorrection[] }
export interface SearchResults<T> { matches: T[]; suggestions: SearchSuggestion<T>[] }

const queryTerms = (query: string): QueryTerm[] => query.trim().split(/\s+/u).filter(Boolean).map(text => ({
  text, aliases: searchAliases(text),
  // Mixed Chinese + Latin can use the full-pinyin form. Pure Chinese stays literal.
  mixed: /\p{Script=Han}/u.test(text) && /[a-z]/iu.test(text),
}));
function matchScore(fields: readonly SearchAliases[], term: QueryTerm): number {
  let best = 0;
  for (const field of fields) {
    if (includesSearchTerm(field.original, term.aliases.original)) best = Math.max(best, 4);
    if (includesSearchTerm(field.full, term.aliases.original) || (term.mixed && includesSearchTerm(field.full, term.aliases.full))) best = Math.max(best, 2);
    if (includesSearchTerm(field.first, term.aliases.original) || (term.mixed && matchesMixedTerm(field.original, term.aliases.original))) best = Math.max(best, 1);
  }
  return best;
}

/** Cache phonetic aliases per record; verify source fields on reuse so refreshes
 * and in-place edits cannot go stale. Deterministic search retains its contract. */
export class OfflineSearch<T extends object> {
  private readonly cache = new WeakMap<T, CachedRecord>();
  private vocabulary?: { words: readonly string[]; index: Fuse<string> };
  constructor(
    private readonly fields: (record: T) => readonly (string | undefined | null)[],
    private readonly fuzzyFields = fields,
  ) {}

  private cached(record: T): CachedRecord {
    const values = this.fields(record).map(value => value ?? '');
    const previous = this.cache.get(record);
    if (previous && values.length === previous.values.length && values.every((value, index) => value === previous.values[index])) return previous;
    const current = { values, aliases: values.filter(Boolean).map(searchAliases) };
    this.cache.set(record, current);
    return current;
  }
  private words(record: T): readonly string[] {
    const cached = this.cached(record), values = this.fuzzyFields(record).map(value => value ?? '');
    if (cached.words && cached.fuzzyValues?.length === values.length && values.every((value, index) => value === cached.fuzzyValues![index])) return cached.words;
    cached.fuzzyValues = values;
    cached.words = [...new Set(values.flatMap(tolerantSearchWords))];
    return cached.words;
  }

  search(records: readonly T[], query: string, limit = Infinity, tieBreak?: (a: T, b: T) => number): T[] {
    const terms = queryTerms(query);
    if (!terms.length) return records.slice(0, limit);
    const hits: { record: T; score: number; order: number }[] = [];
    records.forEach((record, order) => {
      const fields = this.cached(record).aliases;
      let score = 0;
      for (const term of terms) {
        const best = matchScore(fields, term);
        if (!best) return;
        score += best;
      }
      hits.push({ record, score, order });
    });
    // Limit only after evaluating every record; never search a preview page.
    return hits.sort((a, b) => b.score - a.score || tieBreak?.(a.record, b.record) || a.order - b.order).slice(0, limit).map(hit => hit.record);
  }

  /** Approximate words are a separate result group, never part of deterministic
   * results. Every term must still match the same record, including strict IDs. */
  searchResults(records: readonly T[], query: string, limit = Infinity, suggestionLimit = 5, tieBreak?: (a: T, b: T) => number): SearchResults<T> {
    const deterministic = this.search(records, query, Infinity, tieBreak);
    const matches = deterministic.slice(0, limit), terms = queryTerms(query);
    if (!terms.length || !suggestionLimit || !terms.some(term => isTolerantSearchTerm(term.aliases.original))) return { matches, suggestions: [] };
    const exact = new Set(deterministic), wordLists = new Map(records.map(record => [record, this.words(record)]));
    const words = [...new Set([...wordLists.values()].flat())].sort();
    if (!this.vocabulary || words.length !== this.vocabulary.words.length || words.some((word, index) => word !== this.vocabulary!.words[index])) {
      this.vocabulary = { words, index: new Fuse(words, { includeScore: true, threshold: 0.34, ignoreLocation: true, ignoreFieldNorm: true }) };
    }
    const nearWords = terms.map(term => {
      if (!isTolerantSearchTerm(term.aliases.original)) return new Map<string, number>();
      return new Map(this.vocabulary!.index.search(term.aliases.original)
        // Match complete, similarly sized words rather than fragments of identifiers.
        .filter(hit => Math.abs(hit.item.length - term.aliases.original.length) <= 1)
        .map(hit => [hit.item, hit.score ?? 1]));
    });
    const hits: (SearchSuggestion<T> & { order: number; exactScore: number })[] = [];
    records.forEach((record, order) => {
      if (exact.has(record)) return;
      const fields = this.cached(record).aliases, recordWords = wordLists.get(record)!;
      let score = 0, exactScore = 0;
      const corrections: SearchCorrection[] = [];
      for (let index = 0; index < terms.length; index++) {
        const term = terms[index], exactMatch = matchScore(fields, term);
        if (exactMatch) { exactScore += exactMatch; continue; }
        let best: { word: string; score: number } | undefined;
        for (const word of recordWords) {
          const candidate = nearWords[index].get(word);
          if (candidate !== undefined && (!best || candidate < best.score)) best = { word, score: candidate };
        }
        if (!best) return;
        score += best.score;
        corrections.push({ term: term.text, matched: best.word });
      }
      if (corrections.length) hits.push({ record, score, corrections, order, exactScore });
    });
    const suggestions = hits.sort((a, b) => a.corrections.length - b.corrections.length || a.score - b.score || b.exactScore - a.exactScore || tieBreak?.(a.record, b.record) || a.order - b.order)
      .slice(0, suggestionLimit).map(({ record, score, corrections }) => ({ record, score, corrections }));
    return { matches, suggestions };
  }
}
