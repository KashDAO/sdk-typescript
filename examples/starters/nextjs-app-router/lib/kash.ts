import 'server-only';
import { KashClient } from '@kashdao/sdk';

/**
 * Server-only KashClient singleton.
 *
 * `import 'server-only'` makes Next.js fail the build if any client
 * component imports this file — a guardrail against accidentally
 * shipping the API key to the browser via tree-shaking surprises.
 */
export const kash = new KashClient({
  apiKey: process.env.KASH_API_KEY,
  userAgentSuffix: 'kash-sdk-starter-nextjs/0.1.0',
});
