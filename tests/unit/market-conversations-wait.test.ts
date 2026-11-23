/**
 * `marketConversations.waitForReply` (slice plan 3.3, SDK-26 to SDK-30): the
 * outcome each state decides, the merge of rewritten turns, a multi-page
 * transcript read, and timeout and abort. The clock is faked, so no test
 * waits in real time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KashAbortedError, KashTimeoutError, KashValidationError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import {
  FIXTURE_MARKET_CONVERSATION,
  FIXTURE_MARKET_CONVERSATION_STATE,
} from '../contract/wire-shape.test.js';

import { META } from './_test-utils.js';

import type {
  MarketConversationState,
  MarketConversationTurn,
} from '../../src/schemas/market-conversation.js';

const ID = FIXTURE_MARKET_CONVERSATION.id;
const MESSAGE_ID = '6c2e3d4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f';
// Differs from MESSAGE_ID in its last digit only, so a loose comparison fails the test.
const OTHER_MESSAGE_ID = '6c2e3d4f-5a6b-4c7d-9e8f-0a1b2c3d4e5a';
const ACCOUNT = '3f2b8c1e-5d4a-4f6b-9c8d-7e6f5a4b3c2d';
const SENT_AT = '2026-11-21T09:00:05.000Z';
/** What sendMessage returned for the message waited on. */
const MESSAGE = {
  id: MESSAGE_ID,
  conversationId: FIXTURE_MARKET_CONVERSATION.id,
  createdAt: SENT_AT,
};

function state(
  status: string,
  latest: { id?: string; status?: string; createdAt?: string } | null = {}
): MarketConversationState {
  return {
    ...FIXTURE_MARKET_CONVERSATION_STATE,
    status,
    queuePosition: status === 'queued' ? 1 : null,
    estimatedWaitSeconds: status === 'queued' ? 20 : null,
    latestMessage:
      latest === null
        ? null
        : {
            id: latest.id ?? MESSAGE_ID,
            status: latest.status ?? 'published',
            createdAt: latest.createdAt ?? SENT_AT,
          },
  };
}

function turn(
  turnNumber: number,
  role: 'user' | 'assistant',
  revision = 1,
  createdAt = '2026-11-21T09:00:20.000Z'
): MarketConversationTurn {
  return {
    turnNumber,
    role,
    content: `${role} ${turnNumber} r${revision}`,
    revision,
    createdAt,
    updatedAt: createdAt,
  };
}

type TranscriptAnswer = {
  readonly data: readonly MarketConversationTurn[];
  readonly after: string | null;
  readonly hasMore: boolean;
};

/**
 * A client whose state GETs answer `states` in turn (repeating the last) and
 * whose transcript GETs answer from `transcript`, keyed by the `after` sent
 * (`''` for none), each key's answers in turn.
 */
function client(
  states: readonly MarketConversationState[],
  transcript: Record<string, readonly TranscriptAnswer[]>
): { kash: KashClient; requests: string[]; headers: Record<string, string>[] } {
  const requests: string[] = [];
  const headers: Record<string, string>[] = [];
  let s = 0;
  const served: Record<string, number> = {};
  const kash = new KashClient({
    apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    baseUrl: 'https://api.test.local/v1',
    maxRetries: 0,
    conditionalRequests: false,
    fetch: (async (url: string, init: RequestInit) => {
      const u = new URL(url);
      requests.push(`${u.pathname}${u.search}`);
      headers.push(init.headers as Record<string, string>);
      if (u.pathname.endsWith('/messages')) {
        const key = u.searchParams.get('after') ?? '';
        const answers = transcript[key];
        if (answers === undefined) throw new Error(`no transcript scripted for after=${key}`);
        const i = served[key] ?? 0;
        served[key] = i + 1;
        const answer = answers[Math.min(i, answers.length - 1)]!;
        return json({
          data: answer.data,
          pagination: { after: answer.after, hasMore: answer.hasMore, limit: 50 },
          _meta: META,
        });
      }
      const body = states[Math.min(s, states.length - 1)];
      s += 1;
      return json({ conversation: body, data: body, _meta: META });
    }) as unknown as typeof fetch,
  });
  return { kash, requests, headers };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T09:00:06Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('marketConversations.waitForReply', () => {
  it('SDK-27: queued, working, then idle resolves replied with the new turns and the new after', async () => {
    const { kash, requests } = client(
      [state('queued', { status: 'pending' }), state('working'), state('idle')],
      { p0: [{ data: [turn(2, 'assistant')], after: 'p1', hasMore: false }] }
    );
    const seen: string[] = [];

    const done = kash.marketConversations.waitForReply(ID, {
      message: MESSAGE,
      after: 'p0',
      pollIntervalMs: 1_000,
      onStatus: (st) => seen.push(st.status),
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const reply = await done;

    expect(reply.outcome).toBe('replied');
    expect(reply.turns).toEqual([turn(2, 'assistant')]);
    expect(reply.after).toBe('p1');
    expect(reply.state.status).toBe('idle');
    expect(seen).toEqual(['queued', 'working', 'idle']);
    // The transcript is read only once the conversation is idle.
    expect(requests.filter((r) => r.includes('/messages'))).toEqual([
      `/v1/market-conversations/${ID}/messages?after=p0&limit=50`,
    ]);
  });

  it('a message still marked pending (published marker only) resolves replied once idle', async () => {
    const { kash } = client([state('idle', { status: 'pending' })], {
      '': [{ data: [turn(1, 'user'), turn(2, 'assistant')], after: 'p1', hasMore: false }],
    });
    const reply = await kash.marketConversations.waitForReply(ID, { message: MESSAGE });
    expect(reply.outcome).toBe('replied');
  });

  it('SDK-26: a turn rewritten across pages comes back once, at its highest revision, in turn order', async () => {
    const { kash, requests } = client([state('idle')], {
      p0: [{ data: [turn(2, 'assistant', 1), turn(1, 'user')], after: 'p1', hasMore: true }],
      p1: [{ data: [turn(2, 'assistant', 3), turn(3, 'assistant')], after: 'p2', hasMore: true }],
      p2: [{ data: [turn(2, 'assistant', 2)], after: 'p3', hasMore: false }],
    });

    const reply = await kash.marketConversations.waitForReply(ID, {
      message: MESSAGE,
      after: 'p0',
    });

    expect(reply.turns).toEqual([turn(1, 'user'), turn(2, 'assistant', 3), turn(3, 'assistant')]);
    expect(reply.after).toBe('p3');
    expect(requests.filter((r) => r.includes('/messages'))).toHaveLength(3);
  });

  it('idle before the transcript shows the reply keeps polling until it does, resuming from its position', async () => {
    const { kash, requests } = client([state('idle')], {
      p0: [{ data: [turn(1, 'user', 1, SENT_AT)], after: 'p1', hasMore: false }],
      p1: [
        { data: [], after: 'p1', hasMore: false },
        { data: [turn(2, 'assistant')], after: 'p2', hasMore: false },
      ],
    });

    const done = kash.marketConversations.waitForReply(ID, {
      message: MESSAGE,
      after: 'p0',
      pollIntervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const reply = await done;

    expect(reply.outcome).toBe('replied');
    expect(reply.turns).toEqual([turn(1, 'user', 1, SENT_AT), turn(2, 'assistant')]);
    expect(reply.after).toBe('p2');
    expect(requests.filter((r) => r.includes('/messages'))).toEqual([
      `/v1/market-conversations/${ID}/messages?after=p0&limit=50`,
      `/v1/market-conversations/${ID}/messages?after=p1&limit=50`,
      `/v1/market-conversations/${ID}/messages?after=p1&limit=50`,
    ]);
  });

  it('an empty first read with after null (a turn being written) polls again from the start', async () => {
    const { kash, requests } = client([state('idle')], {
      '': [
        { data: [], after: null, hasMore: false },
        { data: [turn(1, 'user', 1, SENT_AT), turn(2, 'assistant')], after: 'p1', hasMore: false },
      ],
    });

    const done = kash.marketConversations.waitForReply(ID, {
      message: MESSAGE,
      pollIntervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const reply = await done;

    expect(reply.outcome).toBe('replied');
    expect(reply.turns).toEqual([turn(1, 'user', 1, SENT_AT), turn(2, 'assistant')]);
    expect(reply.after).toBe('p1');
    expect(requests.filter((r) => r.includes('/messages'))).toEqual([
      `/v1/market-conversations/${ID}/messages?limit=50`,
      `/v1/market-conversations/${ID}/messages?limit=50`,
    ]);
  });

  it('an assistant turn older than the message is not its reply', async () => {
    const { kash } = client([state('idle')], {
      '': [
        {
          data: [turn(0, 'assistant', 1, '2026-11-21T08:00:00.000Z')],
          after: 'p1',
          hasMore: false,
        },
      ],
      p1: [{ data: [], after: 'p1', hasMore: false }],
    });
    const done = kash.marketConversations
      .waitForReply(ID, { message: MESSAGE, timeoutMs: 2_000, pollIntervalMs: 1_000 })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await done).toBeInstanceOf(KashTimeoutError);
  });

  it('SDK-28: a failed message resolves failed at once, without reading the transcript', async () => {
    const { kash, requests } = client([state('idle', { status: 'failed' })], {});
    const reply = await kash.marketConversations.waitForReply(ID, { message: MESSAGE });
    expect(reply.outcome).toBe('failed');
    expect(reply.turns).toEqual([]);
    expect(reply.after).toBeNull();
    expect(requests.some((r) => r.includes('/messages'))).toBe(false);
  });

  it('SDK-28: failed is not mistaken for replied while another reply is being written', async () => {
    const { kash } = client([state('working', { status: 'failed' })], {});
    const reply = await kash.marketConversations.waitForReply(ID, {
      message: MESSAGE,
      after: 'p0',
    });
    expect([reply.outcome, reply.after]).toEqual(['failed', 'p0']);
  });

  it('SDK-29: a later message by another sender resolves superseded with what is there', async () => {
    const { kash } = client(
      [state('working', { id: OTHER_MESSAGE_ID, createdAt: '2026-11-21T09:00:30.000Z' })],
      { p0: [{ data: [turn(2, 'assistant')], after: 'p1', hasMore: false }] }
    );
    const done = kash.marketConversations
      .waitForReply(ID, {
        message: MESSAGE,
        after: 'p0',
        timeoutMs: 1_000,
        pollIntervalMs: 500,
      })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2_000);
    const reply = await done;
    expect(reply).toMatchObject({ outcome: 'superseded', after: 'p1' });
    expect((reply as { turns: unknown }).turns).toEqual([turn(2, 'assistant')]);
  });

  it('SDK-29: another message created in the same millisecond as ours is superseded, not a stranger', async () => {
    const { kash } = client([state('working', { id: OTHER_MESSAGE_ID, createdAt: SENT_AT })], {
      '': [{ data: [], after: null, hasMore: false }],
    });
    const reply = await kash.marketConversations.waitForReply(ID, { message: MESSAGE });
    expect(reply.outcome).toBe('superseded');
  });

  it('SDK-29: the message id is compared exactly, case aside', async () => {
    const { kash } = client([state('idle')], {
      '': [{ data: [turn(2, 'assistant')], after: 'p1', hasMore: false }],
    });
    const reply = await kash.marketConversations.waitForReply(ID, {
      message: { ...MESSAGE, id: MESSAGE_ID.toUpperCase(), conversationId: ID.toUpperCase() },
    });
    expect(reply.outcome).toBe('replied');
  });

  it('a reply written in the same millisecond as the message is its reply', async () => {
    const { kash } = client([state('idle')], {
      '': [{ data: [turn(2, 'assistant', 1, SENT_AT)], after: 'p1', hasMore: false }],
    });
    const reply = await kash.marketConversations.waitForReply(ID, { message: MESSAGE });
    expect(reply.outcome).toBe('replied');
  });

  it('an assistant turn one millisecond before the message is not its reply', async () => {
    const { kash } = client([state('idle')], {
      '': [
        {
          data: [turn(2, 'assistant', 1, '2026-11-21T09:00:04.999Z')],
          after: 'p1',
          hasMore: false,
        },
      ],
      p1: [{ data: [], after: 'p1', hasMore: false }],
    });
    const done = kash.marketConversations
      .waitForReply(ID, { message: MESSAGE, timeoutMs: 2_000, pollIntervalMs: 1_000 })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await done).toBeInstanceOf(KashTimeoutError);
  });

  it('only the newest assistant turn is the reply candidate, as the server reads it', async () => {
    // The server's awaiting_reply compares the message with the assistant
    // turn of the highest turn_number. A lower-numbered assistant turn dated
    // after the message (shaped only to pin the rule) does not count.
    const { kash } = client([state('idle')], {
      '': [
        {
          data: [
            turn(2, 'assistant', 1, '2026-11-21T09:00:20.000Z'),
            turn(4, 'assistant', 1, '2026-11-21T09:00:01.000Z'),
          ],
          after: 'p1',
          hasMore: false,
        },
      ],
      p1: [{ data: [], after: 'p1', hasMore: false }],
    });
    const done = kash.marketConversations
      .waitForReply(ID, { message: MESSAGE, timeoutMs: 2_000, pollIntervalMs: 1_000 })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await done).toBeInstanceOf(KashTimeoutError);
  });

  it('a message of another conversation is refused before any request', async () => {
    const { kash, requests } = client([state('idle')], {});
    const err = await kash.marketConversations
      .waitForReply(ID, { message: { ...MESSAGE, conversationId: OTHER_MESSAGE_ID } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashValidationError);
    expect(requests).toEqual([]);
  });

  it('a message id that is not the latest while the latest is older is not in the conversation', async () => {
    const { kash } = client(
      [state('idle', { id: OTHER_MESSAGE_ID, createdAt: '2026-11-21T09:00:00.000Z' })],
      {}
    );
    const err = await kash.marketConversations
      .waitForReply(ID, { message: MESSAGE })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).message).toContain('is not one of conversation');
  });

  it('a conversation with no message refuses the wait: the id is not one of its messages', async () => {
    const { kash } = client([state('idle', null)], {});
    const err = await kash.marketConversations
      .waitForReply(ID, { message: MESSAGE })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashValidationError);
  });

  it('a message id that is not a UUID is refused before any request', async () => {
    const { kash, requests } = client([state('idle')], {});
    const err = await kash.marketConversations
      .waitForReply(ID, { message: { ...MESSAGE, id: 'msg-1' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashValidationError);
    expect(requests).toEqual([]);
  });

  it.each([0, 1, 249, -1_000, Number.NaN, Number.NEGATIVE_INFINITY])(
    'a pollIntervalMs of %s, below the 250 ms floor, is refused before any request',
    async (pollIntervalMs) => {
      const { kash, requests } = client([state('working')], {});
      const err = await kash.marketConversations
        .waitForReply(ID, { message: MESSAGE, pollIntervalMs })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KashValidationError);
      expect((err as KashValidationError).message).toContain(
        'pollIntervalMs must be at least 250 ms'
      );
      expect((err as KashValidationError).issues).toEqual([
        { path: 'pollIntervalMs', message: 'must be at least 250' },
      ]);
      expect(requests).toEqual([]);
    }
  );

  // Node runs a delay of Infinity or over 2^31 - 1 ms after about 1 ms, and a
  // NaN timeout is never reached: each of these would poll without pause.
  it.each([
    [{ pollIntervalMs: Number.POSITIVE_INFINITY }, 'pollIntervalMs', 'must be at least 250'],
    [{ pollIntervalMs: 3e9 }, 'pollIntervalMs', 'must be at most 2147483647'],
    [{ timeoutMs: Number.NaN }, 'timeoutMs', 'must be a finite number of 0 or more'],
    [{ timeoutMs: Number.POSITIVE_INFINITY }, 'timeoutMs', 'must be a finite number of 0 or more'],
    [{ timeoutMs: -1 }, 'timeoutMs', 'must be a finite number of 0 or more'],
  ])('timing %o is refused before any request', async (timing, path, message) => {
    const { kash, requests } = client([state('working')], {});
    const err = await kash.marketConversations
      .waitForReply(ID, { message: MESSAGE, ...timing })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KashValidationError);
    expect((err as KashValidationError).message).toContain(
      `marketConversations.waitForReply: ${path}`
    );
    expect((err as KashValidationError).issues).toEqual([{ path, message }]);
    expect(requests).toEqual([]);
  });

  it('a pollIntervalMs of exactly 250 ms polls at that cadence', async () => {
    const { kash, requests } = client([state('working')], {});
    const done = kash.marketConversations
      .waitForReply(ID, { message: MESSAGE, timeoutMs: 1_000, pollIntervalMs: 250 })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await done).toBeInstanceOf(KashTimeoutError);
    expect(requests).toHaveLength(5);
  });

  it('SDK-30: a conversation that stays working times out with SDK_POLL_TIMEOUT, the last state on onStatus', async () => {
    const { kash } = client([state('working')], {});
    const seen: string[] = [];
    const done = kash.marketConversations
      .waitForReply(ID, {
        message: MESSAGE,
        timeoutMs: 5_000,
        pollIntervalMs: 1_000,
        onStatus: (st) => seen.push(st.status),
      })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(6_000);
    const err = await done;
    expect(err).toBeInstanceOf(KashTimeoutError);
    expect((err as KashTimeoutError).code).toBe('SDK_POLL_TIMEOUT');
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(new Set(seen)).toEqual(new Set(['working']));
  });

  it('the default budget is 180 s at a 3 s cadence', async () => {
    const { kash, requests } = client([state('working')], {});
    const done = kash.marketConversations
      .waitForReply(ID, { message: MESSAGE })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(179_000);
    expect(requests).toHaveLength(60);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await done).toBeInstanceOf(KashTimeoutError);
    expect(requests).toHaveLength(61);
  });

  it('SDK-30: an abort during the wait rejects with KashAbortedError', async () => {
    const { kash } = client([state('working')], {});
    const controller = new AbortController();
    const done = kash.marketConversations
      .waitForReply(ID, { message: MESSAGE, pollIntervalMs: 1_000, signal: controller.signal })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_500);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect(await done).toBeInstanceOf(KashAbortedError);
  });

  it('SDK-09: account is sent on every poll and every transcript read', async () => {
    const { kash, headers } = client([state('working'), state('idle')], {
      '': [{ data: [turn(2, 'assistant')], after: 'p1', hasMore: false }],
    });
    const done = kash.marketConversations.waitForReply(ID, {
      message: MESSAGE,
      account: ACCOUNT,
      pollIntervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(headers).toHaveLength(3);
    expect(headers.map((h) => h['Kash-Account'])).toEqual([ACCOUNT, ACCOUNT, ACCOUNT]);
  });
});
