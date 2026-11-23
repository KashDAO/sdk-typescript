/**
 * `sendMessage` bodies and whether the SDK and the API accept each. Shared by
 * the SDK unit test and the private drift test, which runs the same list
 * through the API's own schema, so the client can never be stricter than the
 * server unnoticed.
 *
 * The one deliberate difference: the SDK checks `timezone` for length only
 * and leaves the IANA lookup to the API (its result depends on the runtime's
 * ICU data), so a zone the API refuses can still pass the SDK.
 */

const MAX = 2000;
const PAIR = '\u{1F600}'; // one code point, two UTF-16 code units

export type MessageBodyCase = {
  readonly label: string;
  readonly body: unknown;
  readonly sdk: boolean;
  readonly api: boolean;
};

export const MESSAGE_BODY_CASES: readonly MessageBodyCase[] = [
  { label: 'a plain message', body: { content: 'Snow in Calgary?' }, sdk: true, api: true },
  { label: 'exactly 2000 units', body: { content: 'a'.repeat(MAX) }, sdk: true, api: true },
  {
    label: 'a surrogate pair ending exactly at the limit',
    body: { content: 'a'.repeat(MAX - 2) + PAIR },
    sdk: true,
    api: true,
  },
  { label: '2001 units', body: { content: 'a'.repeat(MAX + 1) }, sdk: false, api: false },
  {
    label: 'a surrogate pair one unit past the limit',
    body: { content: 'a'.repeat(MAX - 1) + PAIR },
    sdk: false,
    api: false,
  },
  { label: 'empty', body: { content: '' }, sdk: false, api: false },
  { label: 'blank', body: { content: ' \n\t ' }, sdk: false, api: false },
  { label: 'a NUL character', body: { content: 'a\u0000b' }, sdk: false, api: false },
  { label: 'a lone high surrogate', body: { content: 'a\uD83Db' }, sdk: false, api: false },
  { label: 'a lone low surrogate', body: { content: 'a\uDE00b' }, sdk: false, api: false },
  { label: 'a reversed pair', body: { content: '\uDE00\uD83D' }, sdk: false, api: false },
  { label: 'no content', body: {}, sdk: false, api: false },
  { label: 'content not a string', body: { content: 42 }, sdk: false, api: false },
  { label: 'an extra key', body: { content: 'hi', contnet: 'x' }, sdk: false, api: false },
  {
    label: 'declaredAction create_market',
    body: { content: 'hi', declaredAction: 'create_market' },
    sdk: true,
    api: true,
  },
  {
    label: 'declaredAction in another case',
    body: { content: 'hi', declaredAction: 'Create_Market' },
    sdk: false,
    api: false,
  },
  {
    label: 'an IANA zone',
    body: { content: 'hi', timezone: 'America/Edmonton' },
    sdk: true,
    api: true,
  },
  {
    label: 'a legacy zone the API canonicalises',
    body: { content: 'hi', timezone: 'US/Mountain' },
    sdk: true,
    api: true,
  },
  { label: 'an empty zone', body: { content: 'hi', timezone: '' }, sdk: false, api: false },
  {
    label: 'a 65-character zone',
    body: { content: 'hi', timezone: 'a'.repeat(65) },
    sdk: false,
    api: false,
  },
  {
    label: 'a UTC offset (left to the API)',
    body: { content: 'hi', timezone: '+05:30' },
    sdk: true,
    api: false,
  },
  {
    label: 'an unknown zone (left to the API)',
    body: { content: 'hi', timezone: 'Mars/Olympus_Mons' },
    sdk: true,
    api: false,
  },
];
