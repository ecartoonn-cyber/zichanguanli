import { describe, expect, it } from 'vitest';
import { emptyState, importBackup, loadState, saveState, STORAGE_KEY } from './storage';

function storageWith(value: string | null): Storage {
  const data = new Map<string, string>();
  if (value !== null) data.set(STORAGE_KEY, value);
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, next) => { data.set(key, next); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
}

describe('backup and local storage contract', () => {
  it('migrates an existing single-file MVP backup while preserving the entered values', () => {
    const migrated = importBackup({
      holdings: [{
        id: 'legacy-1', platform: '理财通', name: '示例基金', code: '000001', assetType: '场外基金',
        market: '国内', value: 800, currency: 'CNY', pnlValue: -200, pnlBasis: '累计金额',
        updatedAt: '2026-10-17', manualName: true,
      }],
      profile: { goal: '长期财富增长' },
      profileSavedAt: '2026-10-17T10:00:00.000Z',
    }, '2026-10-17T12:00:00.000Z');
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.holdings[0]).toMatchObject({
      holdingId: 'legacy-1', platform: '理财通', productName: '示例基金', productCode: '000001',
      productType: '场外基金', currentAmount: 800, pnlValue: -200, pnlBasis: '累计金额',
      amountUpdatedAt: '2026-10-17', pnlUpdatedAt: '2026-10-17', manualName: true,
    });
    expect(migrated.profile).toEqual({ answers: { goal: '长期财富增长' }, savedAt: '2026-10-17T10:00:00.000Z' });
  });

  it('rejects malformed imports and never silently substitutes empty state for corrupt local data', () => {
    expect(() => importBackup({ holdings: [{ name: '缺金额' }] })).toThrow('金额无效');
    expect(() => loadState(storageWith('{bad-json'))).toThrow();
  });

  it('round trips a versioned state in local storage', () => {
    const storage = storageWith(null);
    const state = emptyState();
    saveState(state, storage);
    expect(loadState(storage)).toEqual(state);
  });
});
