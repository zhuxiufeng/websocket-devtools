import { create } from 'zustand';
import type {
  CompanionConnectionStatus,
  CompanionBridgeStatus,
  CompanionFrame,
  CompanionMetric,
  UnifiedIncidentMetadata,
} from '../types/companion';
import { companionClient } from '../core/companion-client';

const MAX_FRAMES_BUFFER = 5000;
const MAX_METRIC_HISTORY = 100;

interface CompanionStoreState {
  connectionStatus: CompanionConnectionStatus;
  serverUrl: string;
  bridgeStatus: CompanionBridgeStatus | null;
  targetIp: string;
  rttMs: number;
  hardwareStatus: string;
  isHardwareObservabilityOpen: boolean;
  activeTab: 'stream' | 'metrics' | 'incident';
  frames: CompanionFrame[];
  metrics: Record<string, CompanionMetric>;
  metricsHistory: Record<string, Array<{ time: number; value: number }>>;
  searchQuery: string;
  selectedSource: string | null;
  selectedDirection: 'all' | 'in' | 'out' | 'tx' | 'rx';
  isAutoScroll: boolean;
  isRecording: boolean;

  // Actions
  setServerUrl: (url: string) => void;
  setConnectionStatus: (status: CompanionConnectionStatus) => void;
  setBridgeStatus: (status: CompanionBridgeStatus) => void;
  addFrame: (frame: CompanionFrame) => void;
  addFramesBatch: (newFrames: CompanionFrame[]) => void;
  clearFrames: () => void;
  updateMetric: (metric: CompanionMetric) => void;
  setSearchQuery: (query: string) => void;
  setSelectedSource: (source: string | null) => void;
  setSelectedDirection: (dir: 'all' | 'in' | 'out' | 'tx' | 'rx') => void;
  toggleHardwareObservability: () => void;
  setHardwareObservabilityOpen: (open: boolean) => void;
  setActiveTab: (tab: 'stream' | 'metrics' | 'incident') => void;
  setIsAutoScroll: (auto: boolean) => void;
  setIsRecording: (rec: boolean) => void;
  connect: (url?: string) => void;
  disconnect: () => void;
  exportUnifiedIncident: (
    webFrames: any[],
    metadata?: UnifiedIncidentMetadata
  ) => Promise<{ success: boolean; bundle: any; downloaded: boolean }>;
}

export const useCompanionStore = create<CompanionStoreState>((set, get) => ({
  connectionStatus: 'disconnected',
  serverUrl: 'ws://127.0.0.1:8088',
  bridgeStatus: null,
  targetIp: '127.0.0.1',
  rttMs: 0,
  hardwareStatus: 'idle',
  isHardwareObservabilityOpen: false,
  activeTab: 'stream',
  frames: [],
  metrics: {},
  metricsHistory: {},
  searchQuery: '',
  selectedSource: null,
  selectedDirection: 'all',
  isAutoScroll: true,
  isRecording: true,

  setServerUrl: (url: string) => {
    set({ serverUrl: url });
    companionClient.setUrl(url);
  },

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

  setBridgeStatus: (bridgeStatus) => {
    const targetIp = bridgeStatus.target || get().targetIp;
    const rttMs = bridgeStatus.rttMs ?? get().rttMs;
    const hardwareStatus =
      (bridgeStatus.metadata?.status as string) ||
      (bridgeStatus.metadata?.klipperState as string) ||
      (bridgeStatus.metadata?.klipper_state as string) ||
      'connected';
    set({ bridgeStatus, targetIp, rttMs, hardwareStatus });
  },

  addFrame: (frame) => {
    if (!get().isRecording) return;
    set((state) => {
      const frames = [...state.frames, frame];
      if (frames.length > MAX_FRAMES_BUFFER) {
        frames.splice(0, frames.length - MAX_FRAMES_BUFFER);
      }
      return { frames };
    });
  },

  addFramesBatch: (newFrames) => {
    if (!get().isRecording || newFrames.length === 0) return;
    set((state) => {
      let frames = state.frames.concat(newFrames);
      if (frames.length > MAX_FRAMES_BUFFER) {
        frames = frames.slice(frames.length - MAX_FRAMES_BUFFER);
      }
      return { frames };
    });
  },

  clearFrames: () => {
    companionClient.clearFrameBuffer();
    set({ frames: [] });
  },

  updateMetric: (metric) => {
    set((state) => {
      const nextMetrics = { ...state.metrics, [metric.name]: metric };
      const currentHist = state.metricsHistory[metric.name] || [];
      const updatedHist = [...currentHist, { time: metric.timestamp, value: metric.value }];
      if (updatedHist.length > MAX_METRIC_HISTORY) {
        updatedHist.shift();
      }
      return {
        metrics: nextMetrics,
        metricsHistory: {
          ...state.metricsHistory,
          [metric.name]: updatedHist,
        },
      };
    });
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedSource: (selectedSource) => set({ selectedSource }),
  setSelectedDirection: (selectedDirection) => set({ selectedDirection }),
  toggleHardwareObservability: () =>
    set((state) => ({ isHardwareObservabilityOpen: !state.isHardwareObservabilityOpen })),
  setHardwareObservabilityOpen: (isHardwareObservabilityOpen) =>
    set({ isHardwareObservabilityOpen }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setIsAutoScroll: (isAutoScroll) => set({ isAutoScroll }),
  setIsRecording: (isRecording) => set({ isRecording }),

  connect: (url?: string) => {
    const targetUrl = url || get().serverUrl;
    companionClient.connect(targetUrl);
  },

  disconnect: () => {
    companionClient.disconnect();
  },

  exportUnifiedIncident: async (webFrames = [], metadata) => {
    return companionClient.exportUnifiedIncident(webFrames, metadata);
  },
}));

// Wire companion client callbacks to the store
companionClient.onStatusChange((status) => {
  useCompanionStore.getState().setConnectionStatus(status);
});

companionClient.onBridgeStatus((status) => {
  useCompanionStore.getState().setBridgeStatus(status);
});

companionClient.onFramesBatch((frames) => {
  useCompanionStore.getState().addFramesBatch(frames);
});

companionClient.onMetric((metric) => {
  useCompanionStore.getState().updateMetric(metric);
});

// Auto-start connection to companion bridge (:8088)
if (typeof window !== 'undefined') {
  // Safe asynchronous connect
  setTimeout(() => {
    companionClient.connect();
  }, 100);
}
