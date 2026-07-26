/**
 * Re-export module for backup-validation to avoid circular deps.
 * This file simply re-exports from ivx-data-vault.ts.
 */
export { listSnapshots, readSnapshot, readManifest, detectDataLoss, getDataVaultState, } from './ivx-data-vault';
