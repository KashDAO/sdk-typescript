/**
 * `@kashdao/sdk/testing`: the mock client's `marketConversations` surface
 * (SDK-36). Defaults are wire-shape-valid, every method the real client has
 * exists on the mock, overrides receive the call's arguments, and the
 * client-side checks match the real client's.
 */

import { describe, expect, it } from 'vitest';

import { KashValidationError } from '../../src/errors.js';
import { KashClient } from '../../src/index.js';
import {
  MarketConversationMessageResourceSchema,
  MarketConversationResourceSchema,
  MarketConversationStateSchema,
  MarketConversationTurnSchema,
} from '../../src/schemas/market-conversation.js';
import {
  createMockKashClient,
  DEFAULT_MARKET_CONVERSATION,
  DEFAULT_MARKET_CONVERSATION_MESSAGE,
  DEFAULT_MARKET_CONVERSATION_STATE,
  DEFAULT_MARKET_CONVERSATION_TURN,
} from '../../src/testing/index.js';

const ID = DEFAULT_MARKET_CONVERSATION.id;
const ACCOUNT = '3f2b8c1e-5d4a-4f6b-9c8d-7e6f5a4b3c2d';

describe('testing fixtures: market conversation defaults are wire-shape-valid', () => {
  it.each([
    ['DEFAULT_MARKET_CONVERSATION', MarketConversationResourceSchema, DEFAULT_MARKET_CONVERSATION],
    [
      'DEFAULT_MARKET_CONVERSATION_MESSAGE',
      MarketConversationMessageResourceSchema,
      DEFAULT_MARKET_CONVERSATION_MESSAGE,
    ],
    [
      'DEFAULT_MARKET_CONVERSATION_STATE',
      MarketConversationStateSchema,
      DEFAULT_MARKET_CONVERSATION_STATE,
    ],
    [
      'DEFAULT_MARKET_CONVERSATION_TURN',
      MarketConversationTurnSchema,
      DEFAULT_MARKET_CONVERSATION_TURN,
    ],
  ] as const)('%s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });
});

describe('createMockKashClient: market conversations', () => {
  it('has every method of the real client', () => {
    const real = new KashClient({ apiKey: 'kash_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(real.marketConversations))
      .filter((n) => n !== 'constructor')
      .sort();
    expect(names).toEqual(['get', 'list', 'messages', 'sendMessage', 'start', 'waitForReply']);
    expect(Object.keys(createMockKashClient().marketConversations).sort()).toEqual(names);
  });

  it('defaults: a started conversation, a queued message, an idle state, one reply', async () => {
    const mock = createMockKashClient();
    expect(await mock.marketConversations.start()).toEqual({
      conversation: DEFAULT_MARKET_CONVERSATION,
      idempotentReplay: false,
    });
    const sent = await mock.marketConversations.sendMessage(ID, { content: 'hi' });
    expect(sent).toEqual({ message: DEFAULT_MARKET_CONVERSATION_MESSAGE, idempotentReplay: false });
    expect((await mock.marketConversations.get(ID)).status).toBe('idle');
    expect((await mock.marketConversations.list()).data).toEqual([DEFAULT_MARKET_CONVERSATION]);
    const page = await mock.marketConversations.messages(ID);
    expect([page.data, page.after, page.hasMore, page.limit]).toEqual([
      [DEFAULT_MARKET_CONVERSATION_TURN],
      'mock-after',
      false,
      50,
    ]);
    const states: string[] = [];
    const reply = await mock.marketConversations.waitForReply(ID, {
      message: sent.message,
      onStatus: (s) => states.push(s.status),
    });
    expect([reply.outcome, reply.turns, states]).toEqual([
      'replied',
      [DEFAULT_MARKET_CONVERSATION_TURN],
      ['idle'],
    ]);
  });

  it('overrides receive the arguments, the conversation id lower-cased as the real client sends it', async () => {
    const seen: unknown[] = [];
    const mock = createMockKashClient({
      marketConversations: {
        sendMessage: (id, body, opts) => {
          seen.push([id, body, opts]);
          return {
            message: { ...DEFAULT_MARKET_CONVERSATION_MESSAGE, conversationId: id },
            idempotentReplay: true,
          };
        },
        list: (params, opts) => {
          seen.push([params, opts]);
          return [];
        },
        get: (id, opts) => {
          seen.push([id, opts]);
          return { ...DEFAULT_MARKET_CONVERSATION_STATE, id };
        },
        messages: (id, params, opts) => {
          seen.push([id, params, opts]);
          return { data: [], after: 'p-9', hasMore: false };
        },
      },
    });
    const sent = await mock.marketConversations.sendMessage(
      ID.toUpperCase(),
      { content: 'hi' },
      { idempotencyKey: 'k-1' }
    );
    const page = await mock.marketConversations.messages(
      ID,
      { after: 'p-8' },
      { account: ACCOUNT }
    );
    await mock.marketConversations.list({ limit: 5 }, { account: ACCOUNT });
    await mock.marketConversations.get(ID.toUpperCase(), { account: ACCOUNT });
    expect(sent.idempotentReplay).toBe(true);
    expect(page.after).toBe('p-9');
    expect(seen).toEqual([
      [ID, { content: 'hi' }, { idempotencyKey: 'k-1' }],
      [ID, { after: 'p-8' }, { account: ACCOUNT }],
      [{ limit: 5 }, { account: ACCOUNT }],
      [ID, { account: ACCOUNT }],
    ]);
  });

  it('applies the real client checks: ids, the body, limits, keys and account', async () => {
    const mock = createMockKashClient();
    const refusals = [
      () => mock.marketConversations.get('not-a-uuid'),
      () => mock.marketConversations.sendMessage(ID, { content: '  ' }),
      () =>
        mock.marketConversations.sendMessage(ID, { content: 'hi' }, { idempotencyKey: 'bad key' }),
      () => mock.marketConversations.start({ account: 'acct-1' }),
      () => mock.marketConversations.list({ limit: 101 }),
      () => mock.marketConversations.messages(ID, { limit: 0 }),
      () =>
        mock.marketConversations.waitForReply(ID, {
          message: { ...DEFAULT_MARKET_CONVERSATION_MESSAGE, id: 'm-1' },
        }),
      () =>
        mock.marketConversations.waitForReply(ID, {
          message: { ...DEFAULT_MARKET_CONVERSATION_MESSAGE, conversationId: ACCOUNT },
        }),
      () => mock.marketConversations.list({}, { account: 'acct-1' }),
      () => mock.marketConversations.get(ID, { account: 'acct-1' }),
      () => mock.marketConversations.messages(ID, {}, { account: 'acct-1' }),
      () =>
        mock.marketConversations.waitForReply(ID, {
          message: DEFAULT_MARKET_CONVERSATION_MESSAGE,
          account: 'acct-1',
        }),
    ];
    for (const call of refusals) {
      await expect(call()).rejects.toBeInstanceOf(KashValidationError);
    }
  });
});
