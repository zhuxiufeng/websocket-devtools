import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  WSFrame,
  WSConnection,
  CustomColumn,
  TelemetrySeries,
  HighlightRule,
  FilterCriteria,
  MockStreamSpeed,
  MethodStat,
} from '../types/websocket';
import { parseFilterQuery, matchesFilter } from '../core/filter-engine';
import { extractFrameField } from '../core/field-extractor';
import { getDisambiguatedPathAndName } from '../utils/path-helper';
import { globalFrameProcessor } from '../core/frame-processor';
import { parseTraceJson } from '../core/trace-io';

const MAX_FRAMES = 10000;
const MAX_TELEMETRY_POINTS = 1000;

const DEFAULT_HIGHLIGHT_COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6'];

interface WSStoreState {
  frames: WSFrame[];
  connections: Record<string, WSConnection>;
  selectedFrameId: string | null;
  filterQuery: string;
  filterCriteria: FilterCriteria;
  customColumns: CustomColumn[];
  telemetrySeries: TelemetrySeries[];
  highlightRules: HighlightRule[];
  isRecording: boolean;
  isMockActive: boolean;
  mockSpeed: MockStreamSpeed;

  enableRowTinting: boolean;
  enableCarryForward: boolean;
  isAutoScrollPaused: boolean;
  unseenNewFramesCount: number;
  followLatestInspector: boolean;
  maxFrames: number;
  setMaxFrames: (limit: number) => void;

  // Frame actions
  addFramesBatch: (newFrames: Partial<WSFrame>[]) => void;
  clearFrames: () => void;
  setSelectedFrameId: (id: string | null) => void;
  jumpToFrameId: (id: string) => void;
  setFilterQuery: (query: string) => void;
  setIsRecording: (recording: boolean) => void;
  toggleRecording: () => void;
  setMockActive: (active: boolean) => void;
  setMockSpeed: (speed: MockStreamSpeed) => void;
  setIsAutoScrollPaused: (paused: boolean) => void;
  resetUnseenCount: () => void;
  setFollowLatestInspector: (follow: boolean) => void;
  jumpToLatestFrame: () => void;

  // Column management
  addCustomColumn: (path: string, name?: string) => void;
  updateCustomColumnWidth: (id: string, width: number) => void;
  removeCustomColumn: (id: string) => void;
  setEnableCarryForward: (enable: boolean) => void;

  // Telemetry series management
  addTelemetrySeries: (fieldPath: string, label?: string) => void;
  removeTelemetrySeries: (id: string) => void;
  clearTelemetryPoints: () => void;

  // Highlights
  addHighlightRule: (text: string, color?: string) => void;
  toggleHighlightRule: (id: string) => void;
  toggleHighlightRuleTint: (id: string) => void;
  removeHighlightRule: (id: string) => void;
  setEnableRowTinting: (enable: boolean) => void;

  // Filter Presets & History
  filterPresets: { id: string; name: string; query: string }[];
  filterHistory: string[];
  addFilterPreset: (name: string, query: string) => void;
  removeFilterPreset: (id: string) => void;
  addFilterHistory: (query: string) => void;

  // Keyboard navigation helper
  selectAdjacentFrame: (step: number) => void;

  // Stats & Snapshot helpers
  getMethodStats: () => MethodStat[];
  getSnapshotAtSeq: (connectionId: string, seq: number) => Record<string, any>;

  // Import
  importTraceData: (jsonStr: string) => void;
}

// In-memory quick lookup cache
const framesLookupMap = new Map<string, WSFrame>();

export const useWSStore = create<WSStoreState>()(
  persist(
    (set, get) => ({
      frames: [],
      connections: {},
      selectedFrameId: null,
      followLatestInspector: false,
      filterQuery: '',
      filterCriteria: parseFilterQuery(''),
      customColumns: [],
      telemetrySeries: [],
      highlightRules: [
        { id: 'hl-error', text: 'error', color: '#ef4444', active: true, tintRow: false },
        { id: 'hl-warn', text: 'warn', color: '#f59e0b', active: true, tintRow: false },
        { id: 'hl-event', text: 'event', color: '#10b981', active: true, tintRow: false },
      ],
      enableRowTinting: false,
      enableCarryForward: true,
      isAutoScrollPaused: false,
      unseenNewFramesCount: 0,
      isRecording: true,
      isMockActive: false,
      mockSpeed: '20Hz',
      maxFrames: 10000,
      setMaxFrames: (limit: number) => {
        const validLimit = Math.max(1000, Math.min(200000, limit));
        const frames = get().frames;
        if (frames.length > validLimit) {
          const dropCount = frames.length - validLimit;
          for (let i = 0; i < dropCount; i++) {
            framesLookupMap.delete(frames[i].id);
          }
          set({
            maxFrames: validLimit,
            frames: frames.slice(dropCount),
          });
        } else {
          set({ maxFrames: validLimit });
        }
      },

      filterPresets: [
        { id: 'pre-1', name: '🚨 Errors & Warnings', query: 'error' },
        { id: 'pre-2', name: '📤 Outgoing Commands', query: 'dir:out' },
        { id: 'pre-3', name: '📥 Incoming Updates', query: 'dir:in' },
        { id: 'pre-4', name: '⚡ JSON-RPC Events', query: 'json:method' },
      ],
      filterHistory: [],

      addFilterPreset: (name, query) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        set((state) => ({
          filterPresets: [
            ...state.filterPresets,
            { id: `preset-${Date.now()}`, name: name.trim() || trimmed, query: trimmed },
          ],
        }));
      },

      removeFilterPreset: (id) => {
        set((state) => ({
          filterPresets: state.filterPresets.filter((p) => p.id !== id),
        }));
      },

      addFilterHistory: (query) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        set((state) => ({
          filterHistory: [trimmed, ...state.filterHistory.filter((q) => q !== trimmed)].slice(0, 8),
        }));
      },

      selectAdjacentFrame: (step) => {
        const { frames, selectedFrameId, filterCriteria } = get();
        if (frames.length === 0) return;

        const visibleFrames = frames.filter((f) => matchesFilter(f, filterCriteria));
        const targetList = visibleFrames.length > 0 ? visibleFrames : frames;

        let currentIndex = targetList.findIndex((f) => f.id === selectedFrameId);
        if (currentIndex === -1) {
          currentIndex = step > 0 ? -1 : targetList.length;
        }

        const nextIndex = Math.max(0, Math.min(targetList.length - 1, currentIndex + step));
        set({
          selectedFrameId: targetList[nextIndex].id,
          followLatestInspector: false,
        });
      },

      setEnableRowTinting: (enable) => set({ enableRowTinting: enable }),
      setEnableCarryForward: (enable) => set({ enableCarryForward: enable }),
      setIsAutoScrollPaused: (paused) =>
        set((state) => ({
          isAutoScrollPaused: paused,
          unseenNewFramesCount: paused ? state.unseenNewFramesCount : 0,
        })),
      resetUnseenCount: () => set({ unseenNewFramesCount: 0, isAutoScrollPaused: false }),

      toggleHighlightRuleTint: (id) => {
        set((state) => ({
          highlightRules: state.highlightRules.map((r) =>
            r.id === id ? { ...r, tintRow: !r.tintRow } : r
          ),
        }));
      },

      setFollowLatestInspector: (follow) => set({ followLatestInspector: follow }),

      jumpToLatestFrame: () => {
        const frames = get().frames;
        if (frames.length > 0) {
          set({
            selectedFrameId: frames[frames.length - 1].id,
            followLatestInspector: false,
          });
        }
      },

      jumpToFrameId: (id) => {
        if (!id) return;
        set({
          selectedFrameId: id,
          followLatestInspector: false,
        });
      },

      addFramesBatch: (rawFrames: Partial<WSFrame>[]) => {
        if (rawFrames.length === 0 || !get().isRecording) return;

        const currentCustomCols = get().customColumns;
        // Ingest through FrameProcessor
        const processedFrames = globalFrameProcessor.ingestBatch(
          rawFrames,
          currentCustomCols,
          framesLookupMap
        );

        set((state) => {
          let nextSelectedId = state.selectedFrameId;
          if (!nextSelectedId && processedFrames.length > 0) {
            nextSelectedId = processedFrames[0].id;
          }

          // 1. Update connections
          const nextConnections = { ...state.connections };
          for (const f of processedFrames) {
            if (!nextConnections[f.connectionId]) {
              nextConnections[f.connectionId] = {
                id: f.connectionId,
                url: f.connectionId,
                status: 'open',
                frameCount: 0,
                inCount: 0,
                outCount: 0,
                startTime: f.timestamp,
              };
            }
            const conn = nextConnections[f.connectionId];
            conn.frameCount += 1;
            if (f.direction === 'in') conn.inCount += 1;
            else conn.outCount += 1;
          }

          // 2. Append frames with ring buffer
          let updatedFrames = [...state.frames, ...processedFrames];
          const cap = state.maxFrames || 10000;
          if (updatedFrames.length > cap) {
            const dropCount = updatedFrames.length - cap;
            for (let i = 0; i < dropCount; i++) {
              framesLookupMap.delete(updatedFrames[i].id);
            }
            updatedFrames = updatedFrames.slice(dropCount);
          }

          // 3. Update telemetry points
          let nextSeries = state.telemetrySeries;
          if (nextSeries.length > 0) {
            nextSeries = nextSeries.map((s) => {
              const newPoints = [...s.dataPoints];
              const lastRecorded = newPoints[newPoints.length - 1];
              let lastVal = lastRecorded ? lastRecorded.value : null;
              let lastPointTime = lastRecorded ? lastRecorded.time : 0;

              for (const frame of processedFrames) {
                const rawVal = extractFrameField(frame, s.fieldPath);
                let valNum: number | null = null;

                if (typeof rawVal === 'number') {
                  valNum = rawVal;
                } else if (typeof rawVal === 'string' && rawVal.trim() !== '') {
                  const parsed = parseFloat(rawVal);
                  if (!isNaN(parsed)) valNum = parsed;
                } else if (Array.isArray(rawVal) && s.subIndex !== undefined) {
                  const subVal = rawVal[s.subIndex];
                  if (typeof subVal === 'number') {
                    valNum = subVal;
                  } else if (typeof subVal === 'string' && subVal.trim() !== '') {
                    const parsed = parseFloat(subVal);
                    if (!isNaN(parsed)) valNum = parsed;
                  }
                }

                if (valNum !== null && !isNaN(valNum)) {
                  lastVal = valNum;
                  lastPointTime = frame.timestamp;
                  newPoints.push({
                    time: frame.timestamp,
                    value: valNum,
                    formattedTime: frame.timeFormatted,
                  });
                } else if (lastVal !== null && frame.timestamp - lastPointTime >= 1000) {
                  // Heartbeat / Carry-forward for telemetry:
                  // When a field is unchanged across delta frames, add a heartbeat point every 1s
                  // to keep the time-axis rolling forward rather than freezing!
                  lastPointTime = frame.timestamp;
                  newPoints.push({
                    time: frame.timestamp,
                    value: lastVal,
                    formattedTime: frame.timeFormatted,
                  });
                }
              }

              const trimmed =
                newPoints.length > MAX_TELEMETRY_POINTS
                  ? newPoints.slice(newPoints.length - MAX_TELEMETRY_POINTS)
                  : newPoints;

              return { ...s, dataPoints: trimmed };
            });
          }

          const unseen = state.isAutoScrollPaused
            ? state.unseenNewFramesCount + processedFrames.length
            : 0;

          return {
            frames: updatedFrames,
            connections: nextConnections,
            telemetrySeries: nextSeries,
            unseenNewFramesCount: unseen,
            selectedFrameId: state.followLatestInspector
              ? updatedFrames[updatedFrames.length - 1]?.id ?? nextSelectedId
              : nextSelectedId,
          };
        });
      },

      clearFrames: () => {
        framesLookupMap.clear();
        globalFrameProcessor.reset();
        set({
          frames: [],
          selectedFrameId: null,
          unseenNewFramesCount: 0,
          telemetrySeries: get().telemetrySeries.map((s) => ({ ...s, dataPoints: [] })),
        });
      },

      setSelectedFrameId: (id) => set({ selectedFrameId: id, followLatestInspector: false }),

      setFilterQuery: (query) => {
        set({
          filterQuery: query,
          filterCriteria: parseFilterQuery(query),
        });
      },

      setIsRecording: (recording) => set({ isRecording: recording }),
      toggleRecording: () => set((state) => ({ isRecording: !state.isRecording })),
      setMockActive: (active) => set({ isMockActive: active }),
      setMockSpeed: (speed) => set({ mockSpeed: speed }),

      addCustomColumn: (path, name) => {
        const trimmedPath = path.trim();
        if (!trimmedPath) return;

        const { cleanPath, displayName } = getDisambiguatedPathAndName(trimmedPath, name);
        const finalName =
          name && name.trim() && name.trim() !== trimmedPath && name.trim() !== cleanPath
            ? name.trim()
            : displayName;

        const existing = get().customColumns.find(
          (c) => c.path === cleanPath || c.path === trimmedPath
        );
        if (existing) return;

        const newColId = `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const newCol = {
          id: newColId,
          name: finalName,
          path: cleanPath,
          width: 190,
        };

        // Backfill carry-forward values for existing frames
        const currentFrames = get().frames;
        if (currentFrames.length > 0) {
          const connLastMap = new Map<string, { value: any; fromId: string }>();
          for (let i = 0; i < currentFrames.length; i++) {
            const f = currentFrames[i];
            const connId = f.connectionId || 'default-ws';
            let connLast = connLastMap.get(connId);

            const directVal = extractFrameField(f, cleanPath);
            if (directVal !== undefined && directVal !== null) {
              connLast = { value: directVal, fromId: f.id };
              connLastMap.set(connId, connLast);
            } else if (connLast) {
              if (!f.carried) {
                f.carried = {};
              }
              f.carried[newColId] = { ...connLast };
            }
          }

          // Sync lastKnown back into globalFrameProcessor context for future incoming frames
          for (const [connId, lastVal] of connLastMap.entries()) {
            globalFrameProcessor.setLastKnown(connId, newColId, lastVal);
          }
        }

        set((state) => ({
          customColumns: [...state.customColumns, newCol],
        }));
      },

      updateCustomColumnWidth: (id, width) => {
        set((state) => ({
          customColumns: state.customColumns.map((c) =>
            c.id === id ? { ...c, width: Math.max(80, Math.min(600, width)) } : c
          ),
        }));
      },

      removeCustomColumn: (id) => {
        set((state) => ({
          customColumns: state.customColumns.filter((c) => c.id !== id),
        }));
      },

      addTelemetrySeries: (fieldPath, label) => {
        const trimmed = fieldPath.trim();
        if (!trimmed) return;

        const { cleanPath, displayName } = getDisambiguatedPathAndName(trimmed, label);
        const targetPath = cleanPath;
        const baseName =
          label && label.trim() && label.trim() !== trimmed && label.trim() !== cleanPath
            ? label.trim()
            : displayName;

        const frames = get().frames;
        let sampleVal: any = undefined;
        for (let i = frames.length - 1; i >= 0; i--) {
          const val =
            extractFrameField(frames[i], targetPath) ?? extractFrameField(frames[i], trimmed);
          if (val !== undefined && val !== null) {
            sampleVal = val;
            break;
          }
        }

        const state = get();
        const existing = state.telemetrySeries.filter(
          (s) => s.fieldPath === targetPath || s.fieldPath === trimmed
        );
        if (existing.length > 0) return;

        const newSeriesList: TelemetrySeries[] = [];

        if (Array.isArray(sampleVal) && sampleVal.length >= 2) {
          const isCoord = targetPath.includes('pos') || trimmed.includes('pos');
          const axisLabels = isCoord
            ? ['X', 'Y', 'Z', 'E', 'A', 'B']
            : ['[0]', '[1]', '[2]', '[3]', '[4]', '[5]'];
          const axisColors = ['#06b6d4', '#f59e0b', '#a855f7', '#10b981'];

          sampleVal.forEach((_, idx) => {
            if (idx < 4) {
              const axisName = isCoord ? `(${axisLabels[idx] || idx})` : `${axisLabels[idx] || `[${idx}]`}`;
              newSeriesList.push({
                id: `ts-${Date.now()}-${idx}`,
                label: `${baseName} ${axisName}`,
                fieldPath: trimmed,
                color: axisColors[idx % axisColors.length],
                dataPoints: [],
                subIndex: idx,
              });
            }
          });
        } else {
          const color =
            DEFAULT_HIGHLIGHT_COLORS[state.telemetrySeries.length % DEFAULT_HIGHLIGHT_COLORS.length];
          newSeriesList.push({
            id: `ts-${Date.now()}-0`,
            label: baseName,
            fieldPath: trimmed,
            color,
            dataPoints: [],
          });
        }

        const historyFrames = frames.slice(Math.max(0, frames.length - MAX_TELEMETRY_POINTS));
        for (const s of newSeriesList) {
          let lastVal: number | null = null;
          let lastPointTime = 0;
          for (const f of historyFrames) {
            const val = extractFrameField(f, s.fieldPath);
            let num: number | null = null;
            if (typeof val === 'number') {
              num = val;
            } else if (typeof val === 'string' && val.trim() !== '') {
              const parsed = parseFloat(val);
              if (!isNaN(parsed)) num = parsed;
            } else if (
              Array.isArray(val) &&
              s.subIndex !== undefined
            ) {
              const subVal = val[s.subIndex];
              if (typeof subVal === 'number') {
                num = subVal;
              } else if (typeof subVal === 'string' && subVal.trim() !== '') {
                const parsed = parseFloat(subVal);
                if (!isNaN(parsed)) num = parsed;
              }
            }
            if (num !== null && !isNaN(num)) {
              lastVal = num;
              lastPointTime = f.timestamp;
              s.dataPoints.push({
                time: f.timestamp,
                value: num,
                formattedTime: f.timeFormatted,
              });
            } else if (lastVal !== null && f.timestamp - lastPointTime >= 1000) {
              lastPointTime = f.timestamp;
              s.dataPoints.push({
                time: f.timestamp,
                value: lastVal,
                formattedTime: f.timeFormatted,
              });
            }
          }
        }

        set((s) => ({
          telemetrySeries: [...s.telemetrySeries, ...newSeriesList],
        }));
      },

      removeTelemetrySeries: (id) => {
        set((state) => ({
          telemetrySeries: state.telemetrySeries.filter((s) => s.id !== id),
        }));
      },

      clearTelemetryPoints: () => {
        set((state) => ({
          telemetrySeries: state.telemetrySeries.map((s) => ({ ...s, dataPoints: [] })),
        }));
      },

      addHighlightRule: (text, color) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const state = get();
        if (state.highlightRules.length >= 8) return;

        const ruleColor =
          color ||
          DEFAULT_HIGHLIGHT_COLORS[state.highlightRules.length % DEFAULT_HIGHLIGHT_COLORS.length];
        set({
          highlightRules: [
            ...state.highlightRules,
            {
              id: `hl-${Date.now()}`,
              text: trimmed,
              color: ruleColor,
              active: true,
              tintRow: false,
            },
          ],
        });
      },

      toggleHighlightRule: (id) => {
        set((state) => ({
          highlightRules: state.highlightRules.map((r) =>
            r.id === id ? { ...r, active: !r.active } : r
          ),
        }));
      },

      removeHighlightRule: (id) => {
        set((state) => ({
          highlightRules: state.highlightRules.filter((r) => r.id !== id),
        }));
      },

      getMethodStats: () => {
        return globalFrameProcessor.getMethodStats();
      },

      getSnapshotAtSeq: (connectionId, seq) => {
        return globalFrameProcessor.getSnapshotAtSeq(connectionId, seq, get().frames);
      },

      importTraceData: (jsonStr: string) => {
        try {
          const { frames, connections, customColumns, highlightRules } = parseTraceJson(jsonStr);
          framesLookupMap.clear();
          globalFrameProcessor.reset();

          const cols = customColumns || get().customColumns;
          const processed = globalFrameProcessor.ingestBatch(frames, cols, framesLookupMap);

          const nextConnections: Record<string, WSConnection> = {};
          if (connections && connections.length > 0) {
            for (const c of connections) {
              nextConnections[c.id] = c;
            }
          }

          set({
            frames: processed,
            selectedFrameId: processed[0]?.id || null,
            connections: nextConnections,
            isRecording: false, // Freeze live recording after import
            customColumns: cols,
            highlightRules: highlightRules || get().highlightRules,
            unseenNewFramesCount: 0,
            isAutoScrollPaused: false,
          });
        } catch (e: any) {
          console.error('Failed to import trace:', e);
          alert('Failed to import trace: ' + (e?.message || 'Invalid format'));
        }
      },
    }),
    {
      name: 'ws-analyzer-preferences',
      partialize: (state) => ({
        customColumns: state.customColumns,
        telemetrySeriesConfigs: state.telemetrySeries.map((s) => ({
          id: s.id,
          label: s.label,
          fieldPath: s.fieldPath,
          color: s.color,
          subIndex: s.subIndex,
        })),
        highlightRules: state.highlightRules,
        enableRowTinting: state.enableRowTinting,
        enableCarryForward: state.enableCarryForward,
        filterPresets: state.filterPresets,
        filterHistory: state.filterHistory,
        mockSpeed: state.mockSpeed,
        maxFrames: state.maxFrames,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && (state as any).telemetrySeriesConfigs) {
          state.telemetrySeries = (state as any).telemetrySeriesConfigs.map((cfg: any) => ({
            ...cfg,
            dataPoints: [],
          }));
        }
      },
    }
  )
);
