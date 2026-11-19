export type CompanionConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export interface CompanionBridgeStatus {
  name?: string;
  version?: string;
  connected: boolean;
  target?: string;
  rttMs?: number;
  sources?: string[];
  metadata?: Record<string, any>;
  lastSeen?: number;
}

export interface CompanionFrame {
  id: string;
  timestamp: number;
  timeFormatted: string;
  source: string;
  type?: string;
  direction: 'in' | 'out' | 'tx' | 'rx' | 'event';
  payload: string | any;
  hex?: string;
  status?: string;
  latencyUs?: number;
  deltaMs?: number;
  metadata?: Record<string, any>;
}

export interface CompanionMetric {
  name: string;
  value: number;
  unit?: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface UnifiedIncidentMetadata {
  title?: string;
  description?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  targetIp?: string;
  tags?: string[];
  timestamp?: number;
  userNotes?: string;
  [key: string]: any;
}

export interface UnifiedTraceBundle {
  version: 1;
  bundleType: 'unified_companion_trace';
  createdAt: string;
  metadata: UnifiedIncidentMetadata;
  bridgeStatus?: CompanionBridgeStatus | null;
  sidecarFrames: CompanionFrame[];
  webFrames: any[];
}
