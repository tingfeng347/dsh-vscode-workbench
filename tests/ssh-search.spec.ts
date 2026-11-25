import { describe, expect, test } from 'vitest'
import { parseGrepSearchOutput } from '../src/ssh.ts'

describe('parseGrepSearchOutput', () => {
  test('parses NUL-delimited grep records and finds every match on a line', () => {
    const output = './src/app.ts\x004:const remote = value\n./src/other.ts\x0010:REMOTE\n'
    const result = parseGrepSearchOutput(output, { query: 'remote' })

    expect(result.limited).toBe(false)
    expect(result.matches).toEqual([
      expect.objectContaining({ path: 'src/app.ts', line: 4, column: 7, preview: 'const remote = value', match: 'remote' }),
      expect.objectContaining({ path: 'src/other.ts', line: 10, column: 1, preview: 'REMOTE', match: 'REMOTE' }),
    ])
    expect(result.matches[0]?.lineHash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('honors regex, case-sensitive and whole-word options for columns', () => {
    const output = './src/app.ts\x002:remotely remote 42\n'
    const result = parseGrepSearchOutput(output, {
      query: 'remote|42',
      regex: true,
      caseSensitive: true,
      wholeWord: true,
    })

    expect(result.matches.map(match => [match.column, match.match])).toEqual([[10, 'remote'], [17, '42']])
  })
})
