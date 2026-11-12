/**
 * The one result shape of the partner creates (`partnerAccounts.create`,
 * `partnerAccounts.withdrawals.create`), defined once so the two cannot
 * drift apart.
 */

/** Whether the request created a new resource or returned one that already existed. */
export type PartnerWriteOutcome = 'created' | 'existing';

/** The two facts every partner create reports beside its resource. */
export type PartnerCreateFacts = {
  /**
   * What THIS request's answer says about the resource. `'created'`: the
   * request created it (`202`). `'existing'`: it already existed and was
   * returned, and nothing new was made (`200`, `_meta.idempotent: true`):
   * the account you already hold for that `externalId`, or the withdrawal an
   * earlier request with this `Idempotency-Key` made.
   */
  readonly outcome: PartnerWriteOutcome;
  /**
   * `true` exactly when the server replayed its stored response for this
   * `Idempotency-Key` (the `Idempotent-Replay: true` header). `outcome` then
   * reports what the original request did, this call changed nothing, and
   * the resource fields are as they were at the time of that answer: read
   * the resource again for its current state.
   */
  readonly idempotentReplay: boolean;
};

/**
 * A partner create's result: the resource under its own key, nested rather
 * than spread so a field the API adds to the resource can never collide with
 * the two facts beside it.
 */
export type PartnerCreateResult<K extends string, R> = {
  readonly [P in K]: R;
} & PartnerCreateFacts;

/** The facts, read from the response: `_meta.idempotent` and the replay header. */
export function partnerCreateFacts(response: {
  readonly data: { readonly _meta: { readonly idempotent: boolean } };
  readonly idempotentReplay: boolean;
}): PartnerCreateFacts {
  return {
    outcome: response.data._meta.idempotent ? 'existing' : 'created',
    idempotentReplay: response.idempotentReplay,
  };
}
