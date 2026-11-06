import type { AsyncReasonMapper, ErrorEffect, ReasonMapper } from '../catch-chain.types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ErrorMatcher } from '../error-matcher.types.js'
import { faker } from '@faker-js/faker'
import { onErr } from '../catch-chain.js'

describe('onErr', () => {
  afterEach(() => vi.clearAllMocks())

  const asyncFn = (reason: 'matchError' | 'ignoreError'): Promise<never> => Promise.reject(new Error(reason))
  const matcher: ErrorMatcher<Error> = (reason: unknown): reason is Error => reason instanceof Error && reason.message === 'matchError'

  describe('return sink', () => {
    const randomReturnValue = faker.helpers.arrayElement([
      () => undefined,
      () => null,
      () => faker.datatype.boolean(),
      () => faker.number.int(),
      () => faker.number.bigInt(),
      () => faker.number.float(),
      () => faker.lorem.text(),
      () => Symbol('unique'),
      () => ['foo', 'bar', 'baz'],
      () => ({ foo: 'bar' }),
      // () => (x: number) => x + 1, // function is considered to be a return value producer
    ])

    describe('constant return value', () => {
      const returnValue = randomReturnValue()

      it('should return the constant value when error match', async () => {
        await expect(asyncFn('matchError').catch(onErr(matcher).return(returnValue))).resolves.toBe(returnValue)
      })

      it('should throw the original error when error miss', async () => {
        await expect(asyncFn('ignoreError').catch(onErr(matcher).return(returnValue))).rejects.toThrow('ignoreError')
      })
    })

    describe('sync return value mapper', () => {
      const returnValue = randomReturnValue()
      const returnValueMapper: ReasonMapper<Error, typeof returnValue> = () => returnValue

      it('should return the mapper value when error match', async () => {
        await expect(asyncFn('matchError').catch(onErr(matcher).return(returnValueMapper))).resolves.toBe(returnValue)
      })

      it('should throw the original error when error miss', async () => {
        await expect(asyncFn('ignoreError').catch(onErr(matcher).return(returnValueMapper))).rejects.toThrow('ignoreError')
      })

      it('should throw mapper error (instead of recovering) when the mapper fails', async () => {
        const failingMapper: ReasonMapper<Error, never> = (): never => {
          throw new Error('Mapper failed')
        }

        await expect(asyncFn('matchError').catch(onErr(matcher).return(failingMapper))).rejects.toThrow('Mapper failed')
      })
    })

    describe('async return value mapper', () => {
      const returnValue = randomReturnValue()
      const returnValueMapper: AsyncReasonMapper<Error, typeof returnValue> = () => Promise.resolve(returnValue)

      it('should return the mapper value when error match', async () => {
        await expect(asyncFn('matchError').catch(onErr(matcher).return(returnValueMapper))).resolves.toBe(returnValue)
      })

      it('should throw the original error when error miss', async () => {
        await expect(asyncFn('ignoreError').catch(onErr(matcher).return(returnValueMapper))).rejects.toThrow('ignoreError')
      })

      it('should throw mapper error (instead of recovering) when the mapper fails', async () => {
        const failingMapper: AsyncReasonMapper<Error, never> = (): Promise<never> => Promise.reject(new Error('Mapper failed'))

        await expect(asyncFn('matchError').catch(onErr(matcher).return(failingMapper))).rejects.toThrow('Mapper failed')
      })
    })
  })

  describe('throw sink', () => {
    describe('no error value', () => {
      it('should throw the original error when error match', async () => {
        await expect(asyncFn('matchError').catch(onErr(matcher).throw())).rejects.toThrow('matchError')
      })

      it('should throw the original error when error miss', async () => {
        await expect(asyncFn('ignoreError').catch(onErr(matcher).throw())).rejects.toThrow('ignoreError')
      })
    })

    describe('constant error value', () => {
      const error = new Error('Ooops')

      it('should throw the constant error when error match', async () => {
        await expect(asyncFn('matchError').catch(onErr(matcher).throw(error))).rejects.toThrow(error)
      })

      it('should throw the original error when error miss', async () => {
        await expect(asyncFn('ignoreError').catch(onErr(matcher).throw(error))).rejects.toThrow('ignoreError')
      })
    })

    describe('sync throw error mapper', () => {
      const errorMapper: ReasonMapper<Error, Error> = (reason: Error) => new Error(`Ooops: ${reason.message}`)

      it('should throw the mapped error when error match', async () => {
        await expect(asyncFn('matchError').catch(onErr(matcher).throw(errorMapper))).rejects.toThrow('Ooops: matchError')
      })

      it('should throw the original error when error miss', async () => {
        await expect(asyncFn('ignoreError').catch(onErr(matcher).throw(errorMapper))).rejects.toThrow('ignoreError')
      })

      it('should throw mapper error (instead of the mapped error) when the mapper fails', async () => {
        const failingMapper: ReasonMapper<Error, never> = (): never => {
          throw new Error('Mapper failed')
        }

        await expect(asyncFn('matchError').catch(onErr(matcher).throw(failingMapper))).rejects.toThrow('Mapper failed')
      })
    })

    describe('async throw error mapper', () => {
      const errorMapper: AsyncReasonMapper<Error, Error> = (reason: Error) => Promise.resolve(new Error(`Ooops: ${reason.message}`))

      it('should throw the mapped error when error match', async () => {
        await expect(asyncFn('matchError').catch(onErr(matcher).throw(errorMapper))).rejects.toThrow('Ooops: matchError')
      })

      it('should throw the original error when error miss', async () => {
        await expect(asyncFn('ignoreError').catch(onErr(matcher).throw(errorMapper))).rejects.toThrow('ignoreError')
      })

      it('should throw mapper error (instead of the mapped error) when the mapper fails', async () => {
        const failingMapper: AsyncReasonMapper<Error, never> = (): Promise<never> => Promise.reject(new Error('Mapper failed'))

        await expect(asyncFn('matchError').catch(onErr(matcher).throw(failingMapper))).rejects.toThrow('Mapper failed')
      })
    })
  })

  describe('do effect', () => {
    const error = new Error('Ooops')

    describe('sync effect', () => {
      const effect = vi.fn<ErrorEffect<Error>>(() => {})

      it('should execute sync effect when error match', async () => {
        await expect(asyncFn('matchError').catch(onErr(matcher).do(effect).throw(error))).rejects.toThrow()

        expect(effect).toHaveBeenCalledOnce()
        expect(effect).toHaveBeenCalledWith(expect.objectContaining({ message: 'matchError' }))
      })

      it('should not execute sync effect when error miss', async () => {
        await expect(asyncFn('ignoreError').catch(onErr(matcher).do(effect).throw(error))).rejects.toThrow()

        expect(effect).not.toHaveBeenCalled()
      })

      it('should throw effect error (instead of the intended error) when the effect fails', async () => {
        const failingEffect: ErrorEffect<Error> = (): never => {
          throw new Error('Effect failed')
        }

        await expect(asyncFn('matchError').catch(onErr(matcher).do(failingEffect).throw(error))).rejects.toThrow('Effect failed')
      })
    })

    describe('async effect', () => {
      const effect = vi.fn<ErrorEffect<Error>>(async () => {})

      it('should execute async effect when error match', async () => {
        await expect(asyncFn('matchError').catch(onErr(matcher).do(effect).throw(error))).rejects.toThrow()

        expect(effect).toHaveBeenCalledOnce()
        expect(effect).toHaveBeenCalledWith(expect.objectContaining({ message: 'matchError' }))
      })

      it('should not execute async effect when error miss', async () => {
        await expect(asyncFn('ignoreError').catch(onErr(matcher).do(effect).throw(error))).rejects.toThrow()

        expect(effect).not.toHaveBeenCalled()
      })

      it('should throw effect error (instead of the intended error) when the effect fails', async () => {
        const failingEffect: ErrorEffect<Error> = (): Promise<never> => Promise.reject(new Error('Effect failed'))

        await expect(asyncFn('matchError').catch(onErr(matcher).do(failingEffect).throw(error))).rejects.toThrow('Effect failed')
      })
    })

    describe('sync and async effect', () => {
      const effect1 = vi.fn<ErrorEffect<Error>>(() => {})
      const effect2 = vi.fn<ErrorEffect<Error>>(async () => {})

      it('should execute multiple chained effects in order when error match', async () => {
        await expect(asyncFn('matchError').catch(onErr(matcher).do(effect1).do(effect2).throw(error))).rejects.toThrow()

        expect(effect1).toHaveBeenCalledOnce()
        expect(effect2).toHaveBeenCalledOnce()
        expect(effect1).toHaveBeenCalledBefore(effect2)
      })

      it('should not execute any chained effects when error miss', async () => {
        await expect(asyncFn('ignoreError').catch(onErr(matcher).do(effect1).do(effect2).throw(error))).rejects.toThrow()

        expect(effect1).not.toHaveBeenCalled()
        expect(effect2).not.toHaveBeenCalled()
      })

      it('should throw effect error (instead of the intended error) when the sync effect fails', async () => {
        const failingEffect: ErrorEffect<Error> = (): never => {
          throw new Error('Effect failed')
        }

        await expect(asyncFn('matchError').catch(onErr(matcher).do(failingEffect).do(effect2).throw(error))).rejects.toThrow('Effect failed')
      })

      it('should throw effect error (instead of the intended error) when the async effect fails', async () => {
        const failingEffect: ErrorEffect<Error> = (): Promise<never> => Promise.reject(new Error('Effect failed'))

        await expect(asyncFn('matchError').catch(onErr(matcher).do(effect1).do(failingEffect).throw(error))).rejects.toThrow('Effect failed')
      })
    })
  })

  it('calls the matcher without a this', async () => {
    const thisSeen = vi.fn<(self: unknown) => void>()
    const matcherReadingThis = function (this: unknown, reason: unknown): reason is Error {
      thisSeen(this)
      return reason instanceof Error
    }

    await Promise.reject(new Error(faker.lorem.sentence())).catch(onErr(matcherReadingThis).return(null))

    expect(thisSeen).toHaveBeenCalledWith(undefined)
  })

  describe('immutability', () => {
    it('refuses to replace the catches of a handler', () => {
      const handler = onErr(matcher).return(null)

      expect(() => Object.assign(handler, { catches: () => false })).toThrow(TypeError)
    })

    it('refuses to replace the chains of a handler', () => {
      const handler = onErr(matcher).return(null)

      expect(() => Object.assign(handler, { [Symbol.for('catch-chain.chains')]: [] })).toThrow(TypeError)
    })

    it('refuses to add a chain to a handler', () => {
      const handler = onErr(matcher).return(null)
      const chains = Reflect.get(handler, Symbol.for('catch-chain.chains')) as unknown[]

      expect(() => chains.push(chains[0])).toThrow(TypeError)
    })
  })

  describe('catches', () => {
    const effect = vi.fn<ErrorEffect<Error>>()
    const handler = onErr(matcher).do(effect).return(null)

    it('accepts a reason its matcher accepts', () => {
      expect(handler.catches(new Error('matchError'))).toBe(true)
    })

    it('rejects a reason its matcher rejects', () => {
      expect(handler.catches(new Error('ignoreError'))).toBe(false)
    })

    it('runs no effect', () => {
      handler.catches(new Error('matchError'))

      expect(effect).not.toHaveBeenCalled()
    })
  })

  it('handles a reason caught as unknown when called directly', async () => {
    const recovery = faker.string.uuid()
    const caught: unknown = new Error('matchError')

    await expect(onErr(matcher).return(recovery)(caught)).resolves.toBe(recovery)
  })

  describe('error identity', () => {
    it('re-throws the very same unmatched error instance', async () => {
      const unmatched = new Error('ignoreError')

      await expect(Promise.reject(unmatched).catch(onErr(matcher).return(null))).rejects.toBe(unmatched)
    })

    it('re-throws the very same matched error instance from a bare throw', async () => {
      const matched = new Error('matchError')

      await expect(Promise.reject(matched).catch(onErr(matcher).throw())).rejects.toBe(matched)
    })
  })
})
