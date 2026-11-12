/**
 * Each code named in `KASH_ERROR_CODE`, its status in the API catalogue
 * (`ERROR_CODE_HTTP_STATUS`) and the class a caller catches. Shared by
 * `partner-error-codes.test.ts` and the private catalogue drift test, kept
 * out of either so importing it registers no test suite twice.
 */

import {
  KashAuthenticationError,
  KashAuthorizationError,
  KashConflictError,
  KashMaintenanceError,
  KashNotFoundError,
  KashRateLimitError,
  KashServerError,
  KashValidationError,
  type KashError,
} from '../../src/errors.js';

import type { KnownKashErrorCode } from '../../src/error-codes.js';

type ErrorClass = abstract new (...args: never[]) => KashError;

/** Each named code, its catalogue status, and the class a caller catches. */
export const PARTNER_CODE_CASES: ReadonlyArray<
  readonly [code: KnownKashErrorCode, status: number, errorClass: ErrorClass]
> = [
  ['API_KEY_REVOKED', 401, KashAuthenticationError],
  ['INSUFFICIENT_SCOPE', 403, KashAuthorizationError],
  ['PARTNER_KEY_REQUIRES_IP_ALLOWLIST', 403, KashAuthorizationError],
  ['IP_NOT_ALLOWED', 403, KashAuthorizationError],
  ['VALIDATION_FAILED', 400, KashValidationError],
  ['IDEMPOTENCY_KEY_TOO_LONG', 400, KashValidationError],
  ['IDEMPOTENCY_KEY_FORMAT_INVALID', 400, KashValidationError],
  ['ACCOUNT_HEADER_NOT_ALLOWED', 400, KashValidationError],
  ['ACCOUNT_HEADER_REQUIRED', 400, KashValidationError],
  ['ACCOUNT_NOT_FOUND', 404, KashNotFoundError],
  ['ACCOUNT_NOT_ACTIVE', 409, KashConflictError],
  ['RELEASE_REQUIRES_EMPTY_ACCOUNT', 409, KashConflictError],
  ['DESTINATION_NOT_SUPPORTED', 422, KashValidationError],
  ['WITHDRAWAL_BELOW_MINIMUM', 400, KashValidationError],
  ['WITHDRAWALS_HELD', 409, KashConflictError],
  ['INSUFFICIENT_BALANCE', 409, KashConflictError],
  ['IDEMPOTENCY_KEY_CONFLICT', 409, KashConflictError],
  ['IDEMPOTENCY_REQUEST_IN_PROGRESS', 409, KashConflictError],
  ['CLIENT_REQUEST_ID_CONFLICT', 409, KashConflictError],
  ['IDEMPOTENCY_KEY_EXPIRED', 410, KashConflictError],
  ['RATE_LIMIT_EXCEEDED', 429, KashRateLimitError],
  ['ROUTE_DISABLED', 503, KashMaintenanceError],
  ['DEPENDENCY_UNAVAILABLE', 503, KashServerError],
];
