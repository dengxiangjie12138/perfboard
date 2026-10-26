/** Fixed-width integer helpers. Values remain BigInt throughout. */
export type BitWidth = 8 | 16 | 32 | 64
export type Radix = 2 | 8 | 10 | 16
export type IntegerMode = 'unsigned' | 'signed'
export type ParseResult = { status: 'valid'; bits: bigint } | { status: 'incomplete' | 'error'; message: string }
export type CalculationResult = { status: 'valid'; bits: bigint } | { status: 'error'; message: string }
export type BitOperation = 'and' | 'or' | 'xor' | 'not'
export type ShiftDirection = 'left' | 'logicalRight' | 'arithmeticRight'

export function maskForWidth(width: BitWidth): bigint {
  return (1n << BigInt(width)) - 1n
}

export function signedValue(bits: bigint, width: BitWidth): bigint {
  const normalized = bits & maskForWidth(width)
  const sign = 1n << BigInt(width - 1)
  return normalized & sign ? normalized - (1n << BigInt(width)) : normalized
}

export function parseIntegerInput(text: string, radix: Radix, width: BitWidth, mode: IntegerMode): ParseResult {
  let digits = text.trim()
  if (!digits) return { status: 'incomplete', message: '请输入整数' }
  let negative = false
  if (digits[0] === '+' || digits[0] === '-') {
    negative = digits[0] === '-'
    digits = digits.slice(1)
    if (!digits) return { status: 'incomplete', message: '请在符号后输入整数' }
  }
  const prefix = radix === 2 ? '0b' : radix === 8 ? '0o' : radix === 16 ? '0x' : undefined
  if (prefix && digits.slice(0, 2).toLowerCase() === prefix) {
    digits = digits.slice(2)
    if (!digits) return { status: 'incomplete', message: '请在进制前缀后输入整数' }
  }
  const pattern = radix === 2 ? /^[01]+$/ : radix === 8 ? /^[0-7]+$/ : radix === 10 ? /^[0-9]+$/ : /^[0-9a-f]+$/i
  if (!pattern.test(digits)) return { status: 'error', message: `请输入合法的 ${radix} 进制整数` }
  // Accumulation avoids Number conversion, including at the 64-bit boundary.
  let magnitude = 0n
  const mask = maskForWidth(width)
  for (const character of digits.toLowerCase()) {
    const digit = BigInt('0123456789abcdef'.indexOf(character))
    magnitude = magnitude * BigInt(radix) + digit
    if (magnitude > mask + 1n) return { status: 'error', message: `整数超出 ${width} 位范围` }
  }
  if (negative && mode === 'unsigned') return { status: 'error', message: '无符号模式不接受负数' }
  const value = negative ? -magnitude : magnitude
  const sign = 1n << BigInt(width - 1)
  const minimum = mode === 'signed' ? -sign : 0n
  const maximum = radix === 10 && mode === 'signed' ? sign - 1n : mask
  if (value < minimum || value > maximum) return { status: 'error', message: `整数超出 ${width} 位范围` }
  return { status: 'valid', bits: value & mask }
}

export function formatInteger(bits: bigint, radix: Radix, width: BitWidth, mode: IntegerMode): string {
  const normalized = bits & maskForWidth(width)
  if (radix === 10) return (mode === 'signed' ? signedValue(normalized, width) : normalized).toString(10)
  const length = radix === 2 ? width : radix === 8 ? Math.ceil(width / 3) : width / 4
  return normalized.toString(radix).toUpperCase().padStart(length, '0')
}

export function applyBitOperation(op: BitOperation, a: bigint, b: bigint, width: BitWidth): bigint {
  const result = op === 'and' ? a & b : op === 'or' ? a | b : op === 'xor' ? a ^ b : ~a
  return result & maskForWidth(width)
}

export function shiftBits(bits: bigint, count: number, width: BitWidth, direction: ShiftDirection): CalculationResult {
  if (!Number.isInteger(count) || count < 0 || count > width) {
    return { status: 'error', message: `移位数量须为 0 至 ${width} 的整数` }
  }
  const normalized = bits & maskForWidth(width)
  const amount = BigInt(count)
  const result = direction === 'left' ? normalized << amount : direction === 'logicalRight' ? normalized >> amount : signedValue(normalized, width) >> amount
  return { status: 'valid', bits: result & maskForWidth(width) }
}

export function flipBit(bits: bigint, index: number, width: BitWidth): CalculationResult {
  if (!Number.isInteger(index) || index < 0 || index >= width) {
    return { status: 'error', message: `位索引须为 0 至 ${width - 1} 的整数` }
  }
  return { status: 'valid', bits: (bits ^ (1n << BigInt(index))) & maskForWidth(width) }
}

export function resizeBits(bits: bigint, fromWidth: BitWidth, toWidth: BitWidth, mode: IntegerMode): { bits: bigint; truncated: boolean } {
  const original = mode === 'signed' ? signedValue(bits, fromWidth) : bits & maskForWidth(fromWidth)
  const resized = original & maskForWidth(toWidth)
  const restored = mode === 'signed' ? signedValue(resized, toWidth) : resized
  return { bits: resized, truncated: original !== restored }
}
