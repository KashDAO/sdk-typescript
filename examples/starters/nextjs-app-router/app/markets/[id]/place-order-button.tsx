'use client';

/**
 * Client component — interactive button that calls a server action.
 * The KashClient stays server-side; the action handles the SDK call.
 *
 * State machine: idle → submitting → placed | awaiting_confirmation | error
 */

import { useState, useTransition } from 'react';

import { confirmHighValueTrade, placeTrade } from '@/app/actions';

type State =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'placed'; tradeId: string }
  | { kind: 'awaiting_confirmation'; tradeId: string; confirmationToken: string }
  | { kind: 'error'; message: string };

export function PlaceOrderButton(props: {
  readonly marketId: string;
  readonly outcomeIndex: number;
  readonly amountUsdc: string;
}) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  function submit() {
    setState({ kind: 'submitting' });
    startTransition(async () => {
      const result = await placeTrade({
        marketId: props.marketId,
        outcomeIndex: props.outcomeIndex,
        amount: props.amountUsdc,
        side: 'buy',
      });
      if (result.kind === 'error') {
        setState({ kind: 'error', message: `${result.code}: ${result.message}` });
      } else if (result.kind === 'awaiting_confirmation') {
        setState({
          kind: 'awaiting_confirmation',
          tradeId: result.tradeId,
          confirmationToken: result.confirmationToken,
        });
      } else {
        setState({ kind: 'placed', tradeId: result.tradeId });
      }
    });
  }

  function confirm() {
    if (state.kind !== 'awaiting_confirmation') return;
    const { tradeId, confirmationToken } = state;
    setState({ kind: 'submitting' });
    startTransition(async () => {
      const result = await confirmHighValueTrade(tradeId, confirmationToken);
      if (result.kind === 'error') {
        setState({ kind: 'error', message: `${result.code}: ${result.message}` });
      } else {
        setState({ kind: 'placed', tradeId: result.tradeId });
      }
    });
  }

  if (state.kind === 'placed') return <span>✓ trade {state.tradeId.slice(0, 8)}…</span>;
  if (state.kind === 'error') return <span style={{ color: 'crimson' }}>✗ {state.message}</span>;
  if (state.kind === 'awaiting_confirmation') {
    return (
      <button onClick={confirm} disabled={pending}>
        Confirm high-value trade
      </button>
    );
  }
  return (
    <button onClick={submit} disabled={pending}>
      Buy {props.amountUsdc} USDC
    </button>
  );
}
