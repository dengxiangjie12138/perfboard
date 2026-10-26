import { match, pinyin } from 'pinyin-pro';

export interface SearchAliases { original: string; full: string; first: string }

/** Case-fold identifiers and k/K without collapsing milli/mega quantities.
 * No unit conversion, zero stripping, spelling correction, or fuzzy matching. */
export function normalizeSearchText(value: string): string {
  const protect = (_match: string, before: string, prefix: string) => before + (prefix === 'm' ? '\uE000milli\uE001' : '\uE000mega\uE001');
  const unit = '(?:Ω|Ω|ohms?|Hz|[AVWFHS](?:h)?)(?![A-Za-z0-9])';
  return value
    .replace(new RegExp('(\\d+(?:[.,]\\d+)?\\s*)([mM])(?=' + unit + ')', 'giu'), protect)
    .replace(new RegExp('(^|[^A-Za-z0-9])([mM])(?=' + unit + ')', 'giu'), protect)
    .replace(/((?:^|[^A-Za-z0-9])[-+]?(?:\d+(?:[.,]\d+)?|\.\d+))([mM])(?=$|[^A-Za-z0-9])/gu, protect)
    .replace(/((?:^|[^A-Za-z0-9])\d+)([mM])(?=\d+(?:Ω|Ω)?(?:$|[^A-Za-z0-9]))/gu, protect)
    .toLowerCase();
}

export function searchAliases(value: string): SearchAliases {
  const original = normalizeSearchText(value);
  if (!/\p{Script=Han}/u.test(value)) return { original, full: original, first: original };
  const options = { toneType: 'none', nonZh: 'consecutive', type: 'array' } as const;
  return {
    original,
    full: normalizeSearchText(pinyin(value, options).join('')),
    first: normalizeSearchText(pinyin(value, { ...options, pattern: 'first' }).join('')),
  };
}

/** Literal substring matching; numeric fragments cannot splice into larger numbers. */
export function includesSearchTerm(value: string, term: string): boolean {
  let offset = value.indexOf(term);
  while (offset >= 0) {
    if (!/\d/u.test(term) || (!/\d/u.test(value[offset - 1] ?? '') && !/\d/u.test(value[offset + term.length] ?? ''))) return true;
    offset = value.indexOf(term, offset + 1);
  }
  return false;
}

/** Delegate mixed Han/full-pinyin/initials inside one term to the offline library.
 * Continuous matching preserves numeric strings and literal Han characters. */
export function matchesMixedTerm(value: string, term: string): boolean {
  if (!/\p{Script=Han}/u.test(value)) return false;
  const positions = match(value, term, { continuous: true, precision: 'first', lastPrecision: 'first', space: 'preserve' });
  return !!positions?.length && (!/\d/u.test(term) || (!/\d/u.test(value[positions[0] - 1] ?? '') && !/\d/u.test(value[positions[positions.length - 1] + 1] ?? '')));
}
