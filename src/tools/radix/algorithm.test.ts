import { describe, expect, it } from 'vitest'
import { applyBitOperation, flipBit, formatInteger, maskForWidth, parseIntegerInput, resizeBits, shiftBits, signedValue } from './algorithm'
import type { BitWidth, Radix } from './algorithm'

describe('fixed-width integer conversion', () => {
  it('round-trips zero and all bits for every width and base without losing 64-bit precision', () => {
    for (const width of [8, 16, 32, 64] as BitWidth[]) {
      for (const radix of [2, 8, 10, 16] as Radix[]) {
        for (const bits of [0n, maskForWidth(width)]) {
          const formatted = formatInteger(bits, radix, width, 'unsigned')
          expect(parseIntegerInput(formatted, radix, width, 'unsigned')).toEqual({ status: 'valid', bits })
        }
      }
    }
    expect(parseIntegerInput('9007199254740993', 10, 64, 'unsigned')).toEqual({ status: 'valid', bits: 9007199254740993n })
    expect(formatInteger(18446744073709551615n, 10, 64, 'unsigned')).toBe('18446744073709551615')
  })

  it('uses signed decimal bounds and accepts nondecimal two\'s complement patterns', () => {
    expect(parseIntegerInput('-128', 10, 8, 'signed')).toEqual({ status: 'valid', bits: 128n })
    expect(parseIntegerInput('127', 10, 8, 'signed')).toEqual({ status: 'valid', bits: 127n })
    for (const text of ['128', '-129']) expect(parseIntegerInput(text, 10, 8, 'signed').status).toBe('error')
    expect(parseIntegerInput('FF', 16, 8, 'signed')).toEqual({ status: 'valid', bits: 255n })
    expect(parseIntegerInput('-0x80', 16, 8, 'signed')).toEqual({ status: 'valid', bits: 128n })
    expect(parseIntegerInput('-81', 16, 8, 'signed').status).toBe('error')
    expect(formatInteger(255n, 10, 8, 'signed')).toBe('-1')
    expect(signedValue(0x8000000000000000n, 64)).toBe(-9223372036854775808n)
    expect(parseIntegerInput('-9223372036854775808', 10, 64, 'signed')).toEqual({ status: 'valid', bits: 0x8000000000000000n })
    expect(parseIntegerInput('9223372036854775808', 10, 64, 'signed').status).toBe('error')
  })

  it('distinguishes intermediate drafts from malformed or out-of-range inputs', () => {
    for (const text of ['', '  ', '+', '-', '0x', '-0X', '+0x']) expect(parseIntegerInput(text, 16, 8, 'signed').status).toBe('incomplete')
    for (const text of ['1.5', '1e2', '1 2', '0b10', 'GG', '--1', '100']) expect(parseIntegerInput(text, 16, 8, 'unsigned').status).toBe('error')
    expect(parseIntegerInput('-1', 10, 8, 'unsigned').status).toBe('error')
    expect(parseIntegerInput('18446744073709551616', 10, 64, 'unsigned').status).toBe('error')
    expect(parseIntegerInput('  +0Xff  ', 16, 8, 'unsigned')).toEqual({ status: 'valid', bits: 255n })
    expect(parseIntegerInput('08', 8, 8, 'unsigned').status).toBe('error')
    expect(parseIntegerInput('102', 2, 8, 'unsigned').status).toBe('error')
  })

  it('pads nondecimal representations to the selected width', () => {
    expect(formatInteger(1n, 2, 8, 'signed')).toBe('00000001')
    expect(formatInteger(1n, 8, 8, 'unsigned')).toBe('001')
    expect(formatInteger(255n, 16, 16, 'unsigned')).toBe('00FF')
  })
})

describe('fixed-width bit operations', () => {
  it('masks every bitwise result', () => {
    expect(applyBitOperation('not', 0n, 0n, 8)).toBe(255n)
    expect(applyBitOperation('not', 255n, 0n, 8)).toBe(0n)
    expect(applyBitOperation('and', 0x1ffn, 0xaan, 8)).toBe(0xaan)
    expect(applyBitOperation('or', 0x100n, 1n, 8)).toBe(1n)
    expect(applyBitOperation('xor', 0xffn, 0x0fn, 8)).toBe(0xf0n)
  })

  it('handles zero, width, logical and arithmetic shifts explicitly', () => {
    for (const direction of ['left', 'logicalRight', 'arithmeticRight'] as const) {
      expect(shiftBits(0x80n, 0, 8, direction)).toEqual({ status: 'valid', bits: 0x80n })
      expect(shiftBits(0x80n, 8, 8, direction)).toEqual({ status: 'valid', bits: direction === 'arithmeticRight' ? 255n : 0n })
      for (const count of [-1, 9, 1.5, NaN, Infinity]) expect(shiftBits(1n, count, 8, direction).status).toBe('error')
    }
    expect(shiftBits(0x80n, 1, 8, 'logicalRight')).toEqual({ status: 'valid', bits: 0x40n })
    expect(shiftBits(0x80n, 1, 8, 'arithmeticRight')).toEqual({ status: 'valid', bits: 0xc0n })
    expect(shiftBits(0x7fn, 8, 8, 'arithmeticRight')).toEqual({ status: 'valid', bits: 0n })
    expect(shiftBits(0x8000000000000000n, 63, 64, 'logicalRight')).toEqual({ status: 'valid', bits: 1n })
  })

  it('flips bits with validated indices', () => {
    expect(flipBit(0n, 63, 64)).toEqual({ status: 'valid', bits: 0x8000000000000000n })
    expect(flipBit(0xffn, 0, 8)).toEqual({ status: 'valid', bits: 0xfen })
    for (const index of [-1, 8, 0.5, NaN]) expect(flipBit(0n, index, 8).status).toBe('error')
  })

  it('extends signed values and reports only meaningful narrowing loss', () => {
    expect(resizeBits(255n, 8, 16, 'signed')).toEqual({ bits: 65535n, truncated: false })
    expect(resizeBits(255n, 8, 16, 'unsigned')).toEqual({ bits: 255n, truncated: false })
    expect(resizeBits(65535n, 16, 8, 'signed')).toEqual({ bits: 255n, truncated: false })
    expect(resizeBits(65535n, 16, 8, 'unsigned')).toEqual({ bits: 255n, truncated: true })
    expect(resizeBits(128n, 16, 8, 'signed')).toEqual({ bits: 128n, truncated: true })
    expect(resizeBits(127n, 16, 8, 'signed')).toEqual({ bits: 127n, truncated: false })
    expect(resizeBits(1n, 8, 8, 'unsigned')).toEqual({ bits: 1n, truncated: false })
  })
})
