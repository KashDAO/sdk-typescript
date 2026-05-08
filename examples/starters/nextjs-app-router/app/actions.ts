'use server';

/**
 * Server actions — these run on the server only. The KashClient
 * (and the API key it carries) NEVER reaches the browser.
 *
 * Client components import these functions and call them; Next.js
 * handles the round-trip and serialisation.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { kash } from '@/lib/kash';
import { isAwaitingConfirmation, KashError } from '@kashdao/sdk';

import type { CreateTradeBody } from '@kashdao/sdk';

export type PlaceTradeResult =
  | { kind: 'placed'; tradeId: string }
  | { kind: 'awaiting_confirmation'; tradeId: string; confirmationToken: string }
  | { kind: 'error'; code: string; message: string };

export async function placeTrade(body: CreateTradeBody): Promise<PlaceTradeResult> {
  try {
    const trade = await kash.trades.create(body, {
      idempotencyKey: crypto.randomUUID(),
    });

    if (isAwaitingConfirmation(trade)) {
      return {
        kind: 'awaiting_confirmation',
        tradeId: trade.id,
        confirmationToken: trade.confirmation!.token,
      };
    }

    revalidatePath('/portfolio');
    return { kind: 'placed', tradeId: trade.id };
  } catch (err) {
    if (KashError.isKashError(err)) {
      return { kind: 'error', code: err.code ?? 'UNKNOWN', message: err.message };
    }
    return { kind: 'error', code: 'UNKNOWN', message: 'Unexpected error' };
  }
}

export async function confirmHighValueTrade(
  tradeId: string,
  token: string
): Promise<PlaceTradeResult> {
  try {
    const trade = await kash.trades.confirm(tradeId, { token });
    revalidatePath('/portfolio');
    revalidatePath(`/trades/${trade.id}`);
    return { kind: 'placed', tradeId: trade.id };
  } catch (err) {
    if (KashError.isKashError(err)) {
      return { kind: 'error', code: err.code ?? 'UNKNOWN', message: err.message };
    }
    return { kind: 'error', code: 'UNKNOWN', message: 'Unexpected error' };
  }
}

export async function navigateToMarket(marketId: string): Promise<void> {
  // Re-export of redirect for client convenience.
  redirect(`/markets/${marketId}`);
}
