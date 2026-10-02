/**
 * A prediction row must parse on BOTH chain families.
 *
 * `logIndex` is an EVM concept. Solana locates a trade by (signature,
 * instruction index, inner index) and has no log index at all, so the feed
 * serves null — and this schema REQUIRED a number until 2026-09-13, which made
 * every Solana market unreadable through the SDK:
 *
 *   Response schema mismatch: data.0.logIndex: Expected number, received null
 *
 * That stopped the trading fleet building a snapshot for either Solana market,
 * one layer past the curve-field defect fixed the same night.
 *
 * Both fixtures are REAL rows copied from the staging feed rather than
 * hand-written, because the shape is exactly what was in dispute — a fixture
 * that agrees with the schema by construction cannot tell the two readings
 * apart (`.claude/rules/calibrate-your-instruments.md`).
 */
import { describe, expect, it } from 'vitest';

import { PredictionResourceSchema } from '../../src/schemas/market.js';

const base = {
  marketId: '657c372e-c0d6-46ed-9459-2d794b05c57d',
  outcomeIndex: 0,
  side: 'buy' as const,
  usdcIn: '1000000',
  usdcOut: null,
  tokensIn: null,
  tokensOut: '1657315038414359945',
  price: '0.6',
  probability: '0.6017572096839646',
  timestamp: '2026-09-13T06:17:18.000Z',
};

describe('PredictionResourceSchema across chain families', () => {
  it('accepts a SOLANA row, whose logIndex is null', () => {
    const solana = {
      ...base,
      id: '4PuVtUZxdqYFqDF9podeXcDa1owGk2198e9ZwPRMZJAu4LZbPVUHnVTXyH2WEB1kqWYeTYxAjVcKHtdM7Gi86rRQ-2-1',
      blockNumber: '497427872',
      transactionHash:
        '4PuVtUZxdqYFqDF9podeXcDa1owGk2198e9ZwPRMZJAu4LZbPVUHnVTXyH2WEB1kqWYeTYxAjVcKHtdM7Gi86rRQ',
      logIndex: null,
    };
    const parsed = PredictionResourceSchema.parse(solana);
    expect(parsed.logIndex).toBeNull();
  });

  it('still accepts an EVM row, whose logIndex is a number', () => {
    // The control. Widening a field is the change most likely to be "fixed" by
    // loosening it into uselessness, so the EVM case is asserted beside it.
    const evm = {
      ...base,
      marketId: 'dd2c17fd-3f6f-4922-b9c0-b9044652d4b2',
      id: '0x952c4245d8d1eca1dd8944dd9512df6d2f232acd80111d66c5242baa7972cd49-91',
      blockNumber: '46754806',
      transactionHash: '0x952c4245d8d1eca1dd8944dd9512df6d2f232acd80111d66c5242baa7972cd49',
      logIndex: 91,
    };
    expect(PredictionResourceSchema.parse(evm).logIndex).toBe(91);
  });

  it('still REFUSES a negative or fractional log index', () => {
    // Nullable is not "anything goes": a wrong number is still a wrong number,
    // and this is what separates the fix from deleting the validation.
    for (const bad of [-1, 1.5]) {
      expect(() =>
        PredictionResourceSchema.parse({
          ...base,
          id: 'x',
          blockNumber: '1',
          transactionHash: '0x',
          logIndex: bad,
        })
      ).toThrow();
    }
  });
});
