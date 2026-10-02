import { describe, expect, it } from 'vitest';

import {
  KashValidationError,
  SOLANA_CLUSTERS,
  formatChainRef,
  parseChainRef,
  tryParseChainRef,
} from '../../src/index.js';

describe('parseChainRef', () => {
  it('parses the Solana mainnet reference the API sends', () => {
    expect(parseChainRef('solana:mainnet-beta')).toEqual({
      type: 'solana',
      cluster: 'mainnet-beta',
    });
  });

  it.each(SOLANA_CLUSTERS)('parses solana:%s', (cluster) => {
    expect(parseChainRef(`solana:${cluster}`)).toEqual({ type: 'solana', cluster });
  });

  it('parses the EVM wire form', () => {
    expect(parseChainRef('evm:8453')).toEqual({ type: 'evm', chainId: 8453 });
  });

  it('accepts the CAIP-2 eip155 namespace as an alias of evm', () => {
    expect(parseChainRef('eip155:8453')).toEqual(parseChainRef('evm:8453'));
  });

  it.each([
    ['', 'empty'],
    ['8453', 'a bare chain id has no namespace'],
    ['solana:mainnet', 'the cluster is mainnet-beta, not mainnet'],
    ['solana:', 'no cluster'],
    ['evm:', 'no chain id'],
    ['evm:0x2105', 'hex'],
    ['evm:08453', 'leading zero'],
    ['evm: 8453', 'whitespace'],
    ['evm:0', 'zero is not a chain'],
    ['evm:9000001', 'an internal Solana surrogate id is not an EVM chain'],
    ['evm:99999999999999999999', 'beyond a safe integer'],
    ['cosmos:cosmoshub-4', 'unknown namespace'],
    ['SOLANA:mainnet-beta', 'namespaces are case-sensitive'],
  ])('refuses %j (%s)', (value) => {
    expect(tryParseChainRef(value)).toBeUndefined();
    expect(() => parseChainRef(value)).toThrow(KashValidationError);
  });

  it('throws VALIDATION_FAILED with a chainRef issue', () => {
    try {
      parseChainRef('solana:mainnet');
      expect.unreachable('parseChainRef accepted an unknown cluster');
    } catch (err) {
      expect(err).toBeInstanceOf(KashValidationError);
      const e = err as KashValidationError;
      expect(e.code).toBe('VALIDATION_FAILED');
      expect(e.issues[0]?.path).toBe('chainRef');
    }
  });
});

describe('formatChainRef', () => {
  it('renders the form the API sends', () => {
    expect(formatChainRef({ type: 'solana', cluster: 'mainnet-beta' })).toBe('solana:mainnet-beta');
    expect(formatChainRef({ type: 'evm', chainId: 8453 })).toBe('evm:8453');
  });

  it('normalises a CAIP-2 eip155 reference to the evm wire form', () => {
    expect(formatChainRef(parseChainRef('eip155:84532'))).toBe('evm:84532');
  });

  it('round-trips every wire reference', () => {
    for (const ref of ['solana:mainnet-beta', 'solana:devnet', 'evm:8453', 'evm:84532']) {
      expect(formatChainRef(parseChainRef(ref))).toBe(ref);
    }
  });
});
