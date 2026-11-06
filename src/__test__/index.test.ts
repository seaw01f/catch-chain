import { describe, expect, it } from 'vitest'

describe('package entry point', () => {
  it('exposes exactly the documented runtime API', async () => {
    const entryPoint = await import('../index.js')

    expect(Object.keys(entryPoint).sort()).toEqual(['onErr'])
  })
})
