import { normalizeSearchText } from './text';

const strictWords = new Set([
  // Package identifiers and physical unit/prefix words are technical constraints.
  'tssop', 'ssop', 'msop', 'tsop', 'soic', 'lqfp', 'tqfp', 'vqfn', 'wson', 'plcc', 'pdip', 'hsop',
  'ohms', 'volt', 'volts', 'amps', 'ampere', 'amperes', 'farad', 'farads', 'henry', 'henries',
  'hertz', 'watt', 'watts', 'milli', 'mega', 'micro', 'nano', 'pico', 'kilo',
]);
/** Short abbreviations, quantities, packages and any token containing a digit
 * stay deterministic. Only ordinary alphabetic words can be typo suggestions. */
export function isTolerantSearchTerm(value: string): boolean {
  return /^[a-z]{4,32}$/u.test(value) && !strictWords.has(value);
}

/** Keep digit-bearing identifiers whole before considering individual words.
 * STM32F103, LQFP-48 and 100k never contribute approximate vocabulary. */
export function tolerantSearchWords(value: string): string[] {
  const text = normalizeSearchText(value).replace(/\uE000(?:milli|mega)\uE001[a-z]*/gu, '');
  const tokens = text.match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/gu) ?? [];
  return tokens.filter(token => !/\d/u.test(token)).flatMap(token => token.split(/[-_.]/u)).filter(isTolerantSearchTerm);
}
