/**
 * The result shapes of the keyed creates: the partner creates
 * (`partnerAccounts.create`, `partnerAccounts.withdrawals.create`) and the
 * market conversation writes (`marketConversations.start`,
 * `marketConversations.sendMessage`), defined once so they cannot drift
 * apart. Each nests its resource under its own key, so a field the API adds
 * to the resource can never collide with the facts beside it.
 */

/** Whether this answer is the server's stored answer to an earlier request with the same key. */
export type IdempotentReplayFact = {
  /**
   * `true` exactly when the server replayed its stored response for this
   * `Idempotency-Key` (the `Idempotent-Replay: true` header): an earlier
   * request already did this, this call changed nothing, and the resource
   * fields are as they were at the time of that answer. Read the resource
   * again for its current state.
   */
  readonly idempotentReplay: boolean;
};

/** Whether the request created a new resource or returned one that already existed. */
export type PartnerWriteOutcome = 'created' | 'existing';

/** The two facts every partner create reports beside its resource. */
export type PartnerCreateFacts = IdempotentReplayFact & {
  /**
   * What THIS request's answer says about the resource. `'created'`: the
   * request created it (`202`). `'existing'`: it already existed and was
   * returned, and nothing new was made (`200`, `_meta.idempotent: true`):
   * the account you already hold for that `externalId`, or the withdrawal an
   * earlier request with this `Idempotency-Key` made. On a replay it reports
   * what the original request did.
   */
  readonly outcome: PartnerWriteOutcome;
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
