/**
 * Turn a VERIFIED webhook body into the event `constructEvent` returns. Shared
 * by the client and the testing mock so the two cannot parse differently.
 *
 * A known `type` is parsed strictly by its own schema: a known event that does
 * not match its shape is a broken delivery, never a "newer" one. An unknown
 * `type` passes if its envelope is well formed and becomes an
 * `UnknownWebhookEvent` with `data` unparsed.
 */

import { KashValidationError } from '../errors.js';
import {
  KNOWN_WEBHOOK_EVENT_TYPES,
  WebhookEnvelopeSchema,
  WebhookEventSchema,
  type ConstructedWebhookEvent,
} from '../schemas/webhook-event.js';

import { joinIssuePath } from './zod-issues.js';

import type { z } from 'zod';

export function parseWebhookEvent(body: string): ConstructedWebhookEvent {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (err) {
    throw new KashValidationError('Webhook body is not valid JSON.', {
      code: 'SDK_PARSE',
      cause: err,
    });
  }
  const type = (json as { readonly type?: unknown } | null)?.type;
  if (typeof type === 'string' && KNOWN_WEBHOOK_EVENT_TYPES.has(type)) {
    const known = WebhookEventSchema.safeParse(json);
    if (!known.success) throw invalid(`a ${type} event`, known.error);
    return known.data;
  }
  const envelope = WebhookEnvelopeSchema.safeParse(json);
  if (!envelope.success) throw invalid('a webhook envelope', envelope.error);
  const { id, apiVersion, createdAt, data } = envelope.data;
  return { known: false, id, type: envelope.data.type, apiVersion, createdAt, data };
}

function invalid(what: string, error: z.ZodError): KashValidationError {
  const issues = error.issues.map((i) => `${joinIssuePath(i.path)}: ${i.message}`).join('; ');
  return new KashValidationError(`Webhook body is not ${what}: ${issues}`, {
    code: 'SDK_VALIDATION',
  });
}
