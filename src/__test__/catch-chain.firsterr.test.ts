import { type CatchHandler, firstErr } from '../catch-handler.js'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { ErrorEffect } from '../catch-chain.types.js'
import type { ErrorMatcher } from '../error-matcher.types.js'
import { faker } from '@faker-js/faker'
import { onErr } from '../catch-chain.js'

describe('firstErr', () => {
  class NotFoundError extends Error {}
  class RateLimitedError extends Error {}
  class RetryableError extends Error {}
  class AppError extends Error {}

  const isNotFound: ErrorMatcher<NotFoundError> = (reason: unknown): reason is NotFoundError => reason instanceof NotFoundError
  const isRateLimited: ErrorMatcher<RateLimitedError> = (reason: unknown): reason is RateLimitedError => reason instanceof RateLimitedError
  const isError: ErrorMatcher<Error> = (reason: unknown): reason is Error => reason instanceof Error

  afterEach(() => vi.clearAllMocks())

  it('resolves with the recovery value of the first handler that matches', async () => {
    const firstRecovery = faker.string.uuid()
    const handler = firstErr(onErr(isNotFound).return(firstRecovery), onErr(isError).return(faker.string.uuid()))

    await expect(Promise.reject(new NotFoundError(faker.lorem.sentence())).catch(handler)).resolves.toBe(firstRecovery)
  })

  describe('given a rate-limited fetch with not-found, rate-limit and catch-all handlers', () => {
    const logWarning = vi.fn<ErrorEffect<RateLimitedError>>()
    const reportToSentry = vi.fn<ErrorEffect<Error>>()
    const retryable = new RetryableError(faker.lorem.sentence())
    const handler = firstErr(
      onErr(isNotFound).return(null),
      onErr(isRateLimited).do(logWarning).throw(retryable),
      onErr(isError).do(reportToSentry).throw(err => new AppError(`Unexpected: ${err.message}`)),
    )
    const fetchUser = (): Promise<never> => Promise.reject(new RateLimitedError(faker.lorem.sentence()))

    it('rejects with the rate-limit replacement error rather than one the catch-all derives from it', async () => {
      await expect(fetchUser().catch(handler)).rejects.toBe(retryable)
    })

    it('logs the rate-limit warning once', async () => {
      await expect(fetchUser().catch(handler)).rejects.toThrow()

      expect(logWarning).toHaveBeenCalledOnce()
    })

    it('does not report the rate-limited rejection to Sentry', async () => {
      await expect(fetchUser().catch(handler)).rejects.toThrow()

      expect(reportToSentry).not.toHaveBeenCalled()
    })
  })

  describe('given a matching handler that re-throws the original rejection', () => {
    const laterEffect = vi.fn<ErrorEffect<Error>>()
    const handler = firstErr(
      onErr(isRateLimited).throw(),
      onErr(isError).do(laterEffect).throw(new AppError(faker.lorem.sentence())),
    )

    it('rejects with the original rejection', async () => {
      const original = new RateLimitedError(faker.lorem.sentence())

      await expect(Promise.reject(original).catch(handler)).rejects.toBe(original)
    })

    it('does not hand the re-thrown rejection to a later matching handler', async () => {
      await expect(Promise.reject(new RateLimitedError(faker.lorem.sentence())).catch(handler)).rejects.toThrow()

      expect(laterEffect).not.toHaveBeenCalled()
    })
  })

  describe('given a rejection the first handler does not match', () => {
    const skippedEffect = vi.fn<ErrorEffect<NotFoundError>>()
    const laterRecovery = faker.string.uuid()
    const handler = firstErr(
      onErr(isNotFound).do(skippedEffect).return(faker.string.uuid()),
      onErr(isRateLimited).return(laterRecovery),
    )
    const rateLimited = (): Promise<never> => Promise.reject(new RateLimitedError(faker.lorem.sentence()))

    it('resolves with the recovery value of a later matching handler', async () => {
      await expect(rateLimited().catch(handler)).resolves.toBe(laterRecovery)
    })

    it('runs no effect of the skipped handler', async () => {
      await rateLimited().catch(handler)

      expect(skippedEffect).not.toHaveBeenCalled()
    })
  })

  describe('given a rejection no handler matches', () => {
    it('rejects with the original error', async () => {
      const original = new AppError(faker.lorem.sentence())
      const handler = firstErr(onErr(isNotFound).return(null), onErr(isRateLimited).return(null))

      await expect(Promise.reject(original).catch(handler)).rejects.toBe(original)
    })

    it.each([
      ['a string', faker.lorem.word()],
      ['null', null],
      ['undefined', undefined],
      ['a plain object', { message: faker.lorem.sentence() }],
    ])('rejects with %s reason unchanged', async (_description, reason) => {
      const handler = firstErr(onErr(isNotFound).return(null), onErr(isError).return(null))

      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the rejection reason is deliberately not an Error
      await expect(Promise.reject(reason).catch(handler)).rejects.toBe(reason)
    })
  })

  it('recovers through a handler combined from another firstErr', async () => {
    const nestedRecovery = faker.string.uuid()
    const handler = firstErr(
      firstErr(onErr(isNotFound).return(faker.string.uuid()), onErr(isRateLimited).return(nestedRecovery)),
      onErr(isError).return(faker.string.uuid()),
    )

    await expect(Promise.reject(new RateLimitedError(faker.lorem.sentence())).catch(handler)).resolves.toBe(nestedRecovery)
  })

  it('recovers independent rejections with the same handler', async () => {
    const recovery = faker.string.uuid()
    const handler = firstErr(onErr(isNotFound).return(recovery))

    await expect(Promise.all([
      Promise.reject(new NotFoundError(faker.lorem.sentence())).catch(handler),
      Promise.reject(new NotFoundError(faker.lorem.sentence())).catch(handler),
    ])).resolves.toEqual([recovery, recovery])
  })

  describe('catches', () => {
    const effect = vi.fn<ErrorEffect<Error>>()
    const handler = firstErr(onErr(isNotFound).do(effect).return(null), onErr(isRateLimited).do(effect).return(null))

    it('accepts a reason a later handler matches', () => {
      expect(handler.catches(new RateLimitedError(faker.lorem.sentence()))).toBe(true)
    })

    it('rejects a reason no handler matches', () => {
      expect(handler.catches(new AppError(faker.lorem.sentence()))).toBe(false)
    })

    it('runs no effect', () => {
      handler.catches(new NotFoundError(faker.lorem.sentence()))

      expect(effect).not.toHaveBeenCalled()
    })
  })

  it('rejects with the error a throwing matcher raises', async () => {
    const matcherError = new Error(faker.lorem.sentence())
    const matchers = { isError }
    vi.spyOn(matchers, 'isError').mockImplementation(() => {
      throw matcherError
    })
    const handler = firstErr(onErr(matchers.isError).return(null))

    await expect(Promise.reject(new AppError(faker.lorem.sentence())).catch(handler)).rejects.toBe(matcherError)
  })

  describe('evaluating matchers for a rate-limited rejection', () => {
    const matchers = { isNotFound, isRateLimited, isError }
    const isNotFoundSpy = vi.spyOn(matchers, 'isNotFound')
    const isRateLimitedSpy = vi.spyOn(matchers, 'isRateLimited')
    const isErrorSpy = vi.spyOn(matchers, 'isError')
    const handler = firstErr(
      onErr(matchers.isNotFound).return(null),
      onErr(matchers.isRateLimited).return(null),
      onErr(matchers.isError).return(null),
    )
    const rateLimited = (): Promise<never> => Promise.reject(new RateLimitedError(faker.lorem.sentence()))

    it('consults a non-matching earlier matcher once', async () => {
      await rateLimited().catch(handler)

      expect(isNotFoundSpy).toHaveBeenCalledOnce()
    })

    it('consults the matching matcher once', async () => {
      await rateLimited().catch(handler)

      expect(isRateLimitedSpy).toHaveBeenCalledOnce()
    })

    it('consults no matcher after the first match', async () => {
      await rateLimited().catch(handler)

      expect(isErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('evaluating matchers of a nested handler for a rate-limited rejection', () => {
    const matchers = { isNotFound, isRateLimited, isError }
    const isRateLimitedSpy = vi.spyOn(matchers, 'isRateLimited')
    const isErrorSpy = vi.spyOn(matchers, 'isError')
    const handler = firstErr(
      firstErr(onErr(matchers.isNotFound).return(null), onErr(matchers.isRateLimited).return(null)),
      onErr(matchers.isError).return(null),
    )
    const rateLimited = (): Promise<never> => Promise.reject(new RateLimitedError(faker.lorem.sentence()))

    it('consults the matching nested matcher once', async () => {
      await rateLimited().catch(handler)

      expect(isRateLimitedSpy).toHaveBeenCalledOnce()
    })

    it('consults no matcher after the first nested match', async () => {
      await rateLimited().catch(handler)

      expect(isErrorSpy).not.toHaveBeenCalled()
    })
  })

  it('leaves a combined handler handling only what it handled on its own', async () => {
    const standalone = onErr(isNotFound).return(null)
    firstErr(standalone, onErr(isError).return(faker.string.uuid()))
    const unmatched = new RateLimitedError(faker.lorem.sentence())

    await expect(Promise.reject(unmatched).catch(standalone)).rejects.toBe(unmatched)
  })

  describe('types', () => {
    it('resolves with the union of the original value and every recovery value', () => {
      const recovered = Promise.resolve(faker.number.int())
        .catch(firstErr(onErr(isNotFound).return(null), onErr(isRateLimited).return(faker.lorem.word())))

      expectTypeOf(recovered).resolves.toEqualTypeOf<number | null | string>()
    })

    it('adds no recovery value for a handler that throws', () => {
      const handler = firstErr(onErr(isNotFound).return(null), onErr(isRateLimited).throw())

      expectTypeOf(handler).toEqualTypeOf<CatchHandler<null>>()
    })

    it('requires at least one handler', () => {
      // @ts-expect-error -- firstErr has nothing to match against without a handler
      expectTypeOf(firstErr).toBeCallableWith()
    })
  })
})
