/**
 * CXSW Bridge Client Adapter
 * Bridges DevTools UI with CXSW / Local Companion WebSocket server (:8088).
 * Built upon the generic CompanionClient infrastructure to ensure 100% modular, generic compliance.
 */
import { CompanionClient, companionClient } from './companion-client';
import type {
  CompanionConnectionStatus,
  CompanionBridgeStatus,
  CompanionFrame,
  CompanionMetric,
  UnifiedIncidentMetadata,
  UnifiedTraceBundle,
} from '../types/companion';

export type CXSWConnectionStatus = CompanionConnectionStatus;
export type CXSWBridgeStatus = CompanionBridgeStatus;
export type CXSWFrame = CompanionFrame;

export class CXSWClient extends CompanionClient {
  constructor(options?: ConstructorParameters<typeof CompanionClient>[0]) {
    super(options);
  }
}

export const cxswClient = companionClient;
export default cxswClient;
