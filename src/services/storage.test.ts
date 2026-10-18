import { describe, expect, it } from 'vitest';
import { emptyState, importBackup, loadRestorePoint, loadState, migrateAppState, RESTORE_POINT_KEY, saveRestorePoint, saveState, STORAGE_KEY } from './storage';

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
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.holdings[0]).toMatchObject({
      holdingId: 'legacy-1', platform: '理财通', productName: '示例基金', productCode: '000001',
      productType: '场外基金', currentAmount: 800, pnlValue: -200, pnlBasis: '累计金额',
      amountUpdatedAt: '2026-10-17', pnlUpdatedAt: '2026-10-17', manualName: true,
    });
    expect(migrated.profile).toEqual({ answers: { goal: '长期财富增长' }, savedAt: '2026-10-17T10:00:00.000Z', allocationTargets: {} });
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

  it('saves and restores a pre-import recovery point', () => {
    const state = emptyState();
    const storage = storageWith(null);
    saveRestorePoint(state, storage);
    expect(storage.getItem(RESTORE_POINT_KEY)).toContain('restorePointAt');
    expect(loadRestorePoint(storage)).toEqual(state);
  });

  it('migrates cloud schema v2 without changing entered amounts or P&L', () => {
    const oldState = {
      schemaVersion: 2,
      holdings: [{
        holdingId: 'cloud-1', platform: '银行', productName: '旧持仓', productCode: '110001',
        productType: '场外基金', analysisAssetClass: '灵活资金', marketScope: '海外', countryOrRegion: '美国',
        currency: 'CNY', currentAmount: 1234.56, pnlValue: -234.56, pnlBasis: '累计金额',
        amountUpdatedAt: '2026-10-17', pnlUpdatedAt: '2026-10-17', productNameSource: null,
        productNameVerified: false, classificationSource: null, classificationAsOf: null,
        classificationConfidence: 'unknown', userNotes: '', manualName: true,
        createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z',
      }],
      profile: { answers: { goal: '养老' }, savedAt: null },
    };
    const migrated = migrateAppState(oldState)!;
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.holdings[0]).toMatchObject({
      currentAmount: 1234.56, pnlValue: -234.56, marketScope: '海外', countryOrRegion: '美国',
      analysisAssetClass: '未知', industry: null, liquidityProfile: '未知', classificationUserOverride: false,
    });
  });
});
