/**
 * `@kashdao/sdk/partner`: the types of the partner surface (accounts acting
 * through `Kash-Account`, their balances and withdrawals). The methods are on
 * the client as always (`kash.partnerAccounts`, its
 * `kash.partnerAccounts.withdrawals`, and `kash.balance`); import from here only to name their arguments and
 * results. Their Zod schemas are in `@kashdao/sdk/schemas`.
 */

export type { AccountRequestOverrides } from './internal/request-options.js';
export type { BalanceClient } from './clients/balance.js';
export type { BalanceResource, GetBalanceResponse, UsdcAtomic } from './schemas/balance.js';
export type {
  PartnerAccountsClient,
  ListPartnerAccountsParams,
  PartnerAccountCreateResult,
  PartnerAccountWriteOptions,
  WaitUntilActiveOptions,
} from './clients/partner-accounts.js';
export type {
  PartnerCreateFacts,
  PartnerCreateResult,
  PartnerWriteOutcome,
} from './clients/partner-create-result.js';
export type {
  PartnerWithdrawalsClient,
  CreatePartnerWithdrawalOptions,
  ListPartnerWithdrawalsParams,
  PartnerWithdrawalCreateResult,
  PartnerWithdrawalQuoteParams,
  WaitForWithdrawalOptions,
} from './clients/partner-withdrawals.js';
export type {
  CreatePartnerAccountBody,
  GetPartnerAccountResponse,
  ListPartnerAccountsResponse,
  PartnerAccountResource,
  PartnerAccountStatus,
  PartnerDestinationInput,
  UpdatePartnerAccountBody,
  WritePartnerAccountResponse,
} from './schemas/partner-account.js';
export type {
  CreatePartnerWithdrawalBody,
  CreatePartnerWithdrawalResponse,
  GetPartnerWithdrawalResponse,
  ListPartnerWithdrawalsResponse,
  PartnerWithdrawalQuote,
  PartnerWithdrawalQuoteResponse,
  PartnerWithdrawalResource,
  PartnerWithdrawalStatus,
} from './schemas/partner-withdrawal.js';
export type { PartnerDestination, PartnerDestinationNetwork } from './schemas/webhook-event.js';
