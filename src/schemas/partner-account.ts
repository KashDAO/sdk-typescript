/**
 * Partner account schemas: the wire shapes for `/v1/partner/accounts`.
 *
 * A partner organisation creates one Kash account per user it onboards. The
 * account is named by Kash's `accountId` (the value a partner sends as
 * `account` on calls made for that user) and by the partner's own
 * `externalId`. Requires a partner API key with the `partner:accounts`
 * scope.
 *
 * Request bodies mirror the API's strict schemas, so a typo'd or malformed
 * field fails client-side. Responses accept fields and values this SDK
 * version does not know: an unknown field is stripped, and `status` and
 * `destination.network` are open enums.
 */

import { z } from 'zod';

import { openEnum } from './_open-enum.js';
import { MetaSchema } from './envelope.js';
import { PartnerDestinationSchema, type PartnerDestinationNetwork } from './webhook-event.js';

/** No control characters anywhere, no whitespace at either end (the API's rule). */
const OPAQUE_ID = /^(?!\s)[^\p{Cc}]*(?<!\s)$/u;

/**
 * The partner's own id for its user: 1-128 characters, no control
 * characters, no surrounding whitespace. Matched exactly, case included.
 */
export const PartnerExternalIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(OPAQUE_ID, 'must have no control characters and no surrounding whitespace');

/** Up to 32 characters, typed as the open network set so the known ones autocomplete. */
const destinationNetworkInputSchema: z.ZodType<PartnerDestinationNetwork, string> = z
  .string()
  .min(1)
  .max(32);

/**
 * A withdrawal destination as a request sends it. `network` is `'solana'`
 * (a base58 address) or `'arc'` (a `0x` address). The type stays open so a
 * network Kash adds later can be sent without an SDK release; one Kash does
 * not support is refused by the API with `422 DESTINATION_NOT_SUPPORTED`,
 * and an address that is wrong for its network with `400 VALIDATION_FAILED`.
 */
export const PartnerDestinationInputSchema = z
  .object({
    network: destinationNetworkInputSchema,
    address: z.string().min(1).max(64),
  })
  .strict();

export type PartnerDestinationInput = z.infer<typeof PartnerDestinationInputSchema>;

const countrySchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code in upper case, such as GB');

/** A calendar date, leap years included. */
const ISO_DATE =
  '((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|' +
  '\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))';

/**
 * The consent time the API accepts: exactly zod 3's `datetime({ offset: true })`,
 * which the API's own schema uses. Seconds and their fraction are optional;
 * the zone is `Z` or an offset with or without the colon (`+01:00`, `+0100`).
 * Zod 4's `z.iso.datetime` is narrower (it refuses `09:00Z` and `+0100`), so
 * the rule is spelled out rather than borrowed; a contract test runs the same
 * cases through the API's schema.
 */
const CONSENT_TIMESTAMP = new RegExp(
  `^${ISO_DATE}T([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?(Z|([+-]\\d{2}:?\\d{2}))$`
);

const CONSENT_TIMESTAMP_MESSAGE =
  'must be an ISO 8601 date-time with Z or an offset, such as 2026-11-07T09:57:00Z';

/** Body for {@link PartnerAccountsClient.create}. */
export const CreatePartnerAccountBodySchema = z
  .object({
    /** Your own id for the user, unique within your organisation. */
    externalId: PartnerExternalIdSchema,
    /** Where the account's withdrawals go: the user's own address in your app. */
    destination: PartnerDestinationInputSchema,
    /**
     * The user's country, ISO 3166-1 alpha-2 in upper case. It drives Kash's
     * country rules, including the block on sanctioned countries, so it must
     * be the user's real country.
     */
    country: countrySchema,
    /** The user's agreement: when (not in the future) and to which terms. */
    consent: z
      .object({
        acceptedAt: z.string().regex(CONSENT_TIMESTAMP, CONSENT_TIMESTAMP_MESSAGE),
        termsVersion: z.string().min(1).max(64).regex(OPAQUE_ID),
      })
      .strict(),
    /** Optional. Kept with the account for reaching the user; not a login. */
    email: z.email().max(320).optional(),
  })
  .strict();

export type CreatePartnerAccountBody = z.infer<typeof CreatePartnerAccountBodySchema>;

/**
 * Body for {@link PartnerAccountsClient.update}: a new destination, a new
 * country, or both. A new destination holds the account's withdrawals for 24
 * hours (`409 WITHDRAWALS_HELD`); re-sending the current one does not.
 */
export const UpdatePartnerAccountBodySchema = z
  .object({
    destination: PartnerDestinationInputSchema.optional(),
    country: countrySchema.optional(),
  })
  .strict()
  .refine((b) => b.destination !== undefined || b.country !== undefined, {
    message: 'send destination, country or both',
  });

export type UpdatePartnerAccountBody = z.infer<typeof UpdatePartnerAccountBodySchema>;

/**
 * Where an account is in its life. `provisioning` until its wallet is ready
 * (the `account.active` webhook), then `active`; `suspended` after a suspend;
 * `provisioning_failed` if it could not be set up; `released` only in the
 * response to a release. Open: a status added later parses as its string.
 */
export const PartnerAccountStatusSchema = openEnum([
  'provisioning',
  'active',
  'suspended',
  'provisioning_failed',
  'released',
]);

export type PartnerAccountStatus = z.infer<typeof PartnerAccountStatusSchema>;

export const PartnerAccountResourceSchema = z.object({
  /** Kash's id for the account. Pass it as `account` on calls made for this user. */
  accountId: z.guid(),
  /** Your own id for the user, as sent when the account was created. */
  externalId: z.string(),
  status: PartnerAccountStatusSchema,
  /** The account's Solana wallet, where you send its USDC. `null` until the account is active. */
  depositAddress: z.string().nullable(),
  /** Where the account's withdrawals go. */
  destination: PartnerDestinationSchema,
  /** The user's country, ISO 3166-1 alpha-2. */
  country: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});

export type PartnerAccountResource = z.infer<typeof PartnerAccountResourceSchema>;

/** Wire envelope for reading one account (`GET /v1/partner/accounts/{accountId}`). */
export const GetPartnerAccountResponseSchema = z.object({
  account: PartnerAccountResourceSchema,
  /** Cross-endpoint dual-key alias: identical to `account` when present. */
  data: PartnerAccountResourceSchema.optional(),
  _meta: MetaSchema,
});

export type GetPartnerAccountResponse = z.infer<typeof GetPartnerAccountResponseSchema>;

/**
 * Wire envelope for every account write: create (`202` new, `200` existing),
 * update, suspend, reactivate and release (`200`). `_meta.idempotent` is
 * `true` when the call changed nothing: an existing account for the
 * `externalId`, or an account already in the status asked for.
 */
export const WritePartnerAccountResponseSchema = z.object({
  account: PartnerAccountResourceSchema,
  /** Cross-endpoint dual-key alias: identical to `account` when present. */
  data: PartnerAccountResourceSchema.optional(),
  _meta: MetaSchema.extend({ idempotent: z.boolean() }),
});

export type WritePartnerAccountResponse = z.infer<typeof WritePartnerAccountResponseSchema>;

/** Wire envelope for `GET /v1/partner/accounts`: newest first, cursor-paginated. */
export const ListPartnerAccountsResponseSchema = z.object({
  data: z.array(PartnerAccountResourceSchema),
  pagination: z.object({
    cursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int().positive(),
  }),
  _meta: MetaSchema,
});

export type ListPartnerAccountsResponse = z.infer<typeof ListPartnerAccountsResponseSchema>;
