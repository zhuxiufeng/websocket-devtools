import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { useWSStore } from '../src/store/ws-store';
import { MockStreamGenerator } from '../src/core/mock-stream';
import { extractFrameField } from '../src/core/field-extractor';
import { matchesFilter, parseFilterQuery } from '../src/core/filter-engine';
import { highlightText } from '../src/utils/highlighter';


describe('DevTools Full Integration & Verification Test Suite', () => {
  beforeEach(() => {
    // Reset store
    useWSStore.getState().clearFrames();
    useWSStore.getState().setFilterQuery('');
  });

  it('1. Generates 3D mock frames with authentic Moonraker JSON-RPC telemetry', () => {
    let generatedFrames: any[] = [];
    const mock = new MockStreamGenerator((batch) => {
      generatedFrames = batch;
    });

    // Call private tick method
    (mock as any).tick();
    expect(generatedFrames.length).toBeGreaterThan(0);

    const frame = generatedFrames[0];
    expect(frame.direction).toBe('in');
    expect(frame.isJson).toBe(true);
    expect(frame.payload).toContain('notify_status_update');
    expect(frame.payload).toContain('live_position');
  });

  it('2. Highlighting tints rows by default when matched, and highlights text accurately', () => {
    const store = useWSStore.getState();
    
    // Check default row tinting setting is true by default
    expect(store.enableRowTinting).toBe(true);

    // Add a highlight rule for "params"
    store.addHighlightRule('params', '#f59e0b');
    const updatedRules = useWSStore.getState().highlightRules;
    const paramsRule = updatedRules.find((r) => r.text === 'params');

    expect(paramsRule).toBeDefined();
    expect(paramsRule?.active).toBe(true);
    expect(paramsRule?.tintRow).toBe(false); // Should default to false to protect clean rows!

    // Verify text highlighter output returns React element with mark tag
    const testText = '{"jsonrpc":"2.0","method":"notify_status_update","params":[]}';
    const highlightedNode = highlightText(testText, updatedRules) as React.ReactElement;
    
    expect(React.isValidElement(highlightedNode)).toBe(true);
    const children = (highlightedNode.props as any).children;
    expect(Array.isArray(children)).toBe(true);
    
    // Look for the mark tag matching 'params'
    const markNode = children.find(
      (c: any) => c && c.type === 'mark' && c.props.children === 'params'
    );
    expect(markNode).toBeDefined();
    expect(markNode.props.style.color).toBe('#f59e0b');
  });

  it('3. Ingests frames and dynamically extracts custom columns (live_position, printing_time)', () => {
    const store = useWSStore.getState();

    // Setup custom columns
    store.addCustomColumn('live_position', 'live_position');
    store.addCustomColumn('print_stats.total_duration', 'printing_time');

    let framesToFeed: any[] = [];
    const mock = new MockStreamGenerator((batch) => {
      framesToFeed = batch;
    });
    (mock as any).tick();

    store.addFramesBatch(framesToFeed);
    const currentFrames = useWSStore.getState().frames;
    expect(currentFrames.length).toBeGreaterThan(0);

    const firstFrame = currentFrames[0];
    const livePos = extractFrameField(firstFrame, 'live_position');
    expect(Array.isArray(livePos)).toBe(true);
    expect(livePos.length).toBe(4); // [X, Y, Z, E]

    const printTime = extractFrameField(firstFrame, 'print_stats.total_duration');
    expect(typeof printTime).toBe('number');
  });

  it('4. Real-time telemetry series tracks coordinates and handles auto-fit scaling', () => {
    const store = useWSStore.getState();

    const mock = new MockStreamGenerator((batch) => {
      useWSStore.getState().addFramesBatch(batch);
    });

    // Feed initial frame so store knows the schema
    (mock as any).tick();

    // Register telemetry series for live_position (it should auto-expand into X, Y, Z, E)
    store.addTelemetrySeries('live_position', 'Live Position');

    // Feed 5 more ticks of mock stream
    for (let i = 0; i < 5; i++) {
      (mock as any).tick();
    }

    const series = useWSStore.getState().telemetrySeries;
    const seriesX = series.find((s) => s.label.includes('X'));
    const seriesZ = series.find((s) => s.label.includes('Z'));

    expect(seriesX).toBeDefined();
    expect(seriesX!.dataPoints.length).toBeGreaterThanOrEqual(5);

    expect(seriesZ).toBeDefined();
    expect(seriesZ!.dataPoints.length).toBeGreaterThanOrEqual(5);
    // Z coordinate in Moonraker mock is ~3.62mm
    expect(seriesZ!.dataPoints[0].value).toBeCloseTo(3.62, 1);
  });

  it('5. Compound filter engine handles direction, exclusions, and field matching', () => {
    let mockFrames: any[] = [];
    const mock = new MockStreamGenerator((batch) => {
      mockFrames = batch;
    });
    (mock as any).tick();

    const sampleFrame = mockFrames[0];

    // Filter 1: dir:in
    const filterIn = parseFilterQuery('dir:in');
    expect(matchesFilter(sampleFrame, filterIn)).toBe(true);

    // Filter 2: dir:out
    const filterOut = parseFilterQuery('dir:out');
    expect(matchesFilter(sampleFrame, filterOut)).toBe(false);

    // Filter 3: Exclude keyword
    const filterExclude = parseFilterQuery('-notify_status_update');
    expect(matchesFilter(sampleFrame, filterExclude)).toBe(false);

    // Filter 4: has:live_position
    const filterHas = parseFilterQuery('has:live_position');
    expect(matchesFilter(sampleFrame, filterHas)).toBe(true);
  });

  it('6. Jump to first and latest frames updates selection, auto-scroll paused flag, and scroll request target', () => {
    const store = useWSStore.getState();
    const mock = new MockStreamGenerator((batch) => {
      useWSStore.getState().addFramesBatch(batch);
    });

    // Ingest several ticks of frames
    for (let i = 0; i < 20; i++) {
      (mock as any).tick();
    }

    const frames = useWSStore.getState().frames;
    expect(frames.length).toBeGreaterThan(10);

    const firstFrame = frames[0];
    const latestFrame = frames[frames.length - 1];

    // Select middle frame and enable live tail
    useWSStore.getState().setSelectedFrameId(frames[5].id);
    useWSStore.getState().setFollowLatestInspector(true);
    useWSStore.getState().setIsAutoScrollPaused(false);

    // Call jumpToFirstFrame
    useWSStore.getState().jumpToFirstFrame();
    expect(useWSStore.getState().selectedFrameId).toBe(firstFrame.id);
    expect(useWSStore.getState().followLatestInspector).toBe(false);
    expect(useWSStore.getState().isAutoScrollPaused).toBe(true);
    expect(useWSStore.getState().lastScrollRequest?.target).toBe('first');

    // Call jumpToLatestFrame
    useWSStore.getState().jumpToLatestFrame();
    expect(useWSStore.getState().selectedFrameId).toBe(latestFrame.id);
    expect(useWSStore.getState().followLatestInspector).toBe(false);
    expect(useWSStore.getState().isAutoScrollPaused).toBe(false);
    expect(useWSStore.getState().lastScrollRequest?.target).toBe('latest');
  });

  it('7. syncConnections synchronizes active connections and deduplicates historical frame replay', () => {
    const store = useWSStore.getState();

    // 1. Sync connection before any frame arrives
    store.syncConnections([
      {
        id: 'ws://192.168.1.50/websocket',
        url: 'ws://192.168.1.50/websocket',
        status: 'open',
        frameCount: 0,
        inCount: 0,
        outCount: 0,
        startTime: Date.now(),
      },
    ]);

    const conns = useWSStore.getState().connections;
    expect(conns['ws://192.168.1.50/websocket']).toBeDefined();
    expect(conns['ws://192.168.1.50/websocket'].status).toBe('open');

    // 2. Ingest frames with predefined id
    store.addFramesBatch([
      {
        id: 'frame-test-101',
        connectionId: 'ws://192.168.1.50/websocket',
        payload: '{"method":"printer.info"}',
        direction: 'out',
        timestamp: 1000,
      },
      {
        id: 'frame-test-102',
        connectionId: 'ws://192.168.1.50/websocket',
        payload: '{"result":{"state":"ready"}}',
        direction: 'in',
        timestamp: 1020,
      },
    ]);

    expect(useWSStore.getState().frames.length).toBe(2);

    // 3. Replay sync with same IDs (historical sync on late attach)
    store.addFramesBatch([
      {
        id: 'frame-test-101',
        connectionId: 'ws://192.168.1.50/websocket',
        payload: '{"method":"printer.info"}',
        direction: 'out',
        timestamp: 1000,
      },
      {
        id: 'frame-test-102',
        connectionId: 'ws://192.168.1.50/websocket',
        payload: '{"result":{"state":"ready"}}',
        direction: 'in',
        timestamp: 1020,
      },
      {
        id: 'frame-test-103',
        connectionId: 'ws://192.168.1.50/websocket',
        payload: '{"method":"printer.objects.query"}',
        direction: 'out',
        timestamp: 1050,
      },
    ]);

    // Should only add the new frame (total 3, not 5!)
    expect(useWSStore.getState().frames.length).toBe(3);
    expect(useWSStore.getState().frames.map((f) => f.id)).toEqual([
      'frame-test-101',
      'frame-test-102',
      'frame-test-103',
    ]);
  });

  it('8. Auto-scroll pause, resume, and unseen count tracking on streaming incoming frames', () => {
    const store = useWSStore.getState();
    store.clearFrames();
    store.setIsAutoScrollPaused(false);

    // Initial frames stream in while auto-scroll is active
    store.addFramesBatch([
      { id: 'f-stream-1', payload: '{"seq":1}', timestamp: 1000 },
      { id: 'f-stream-2', payload: '{"seq":2}', timestamp: 1010 },
    ]);
    expect(useWSStore.getState().isAutoScrollPaused).toBe(false);
    expect(useWSStore.getState().unseenNewFramesCount).toBe(0);

    // User scrolls up or jumps to first frame -> auto-scroll pauses
    store.setIsAutoScrollPaused(true);
    expect(useWSStore.getState().isAutoScrollPaused).toBe(true);

    // Frames continue streaming in while paused
    store.addFramesBatch([
      { id: 'f-stream-3', payload: '{"seq":3}', timestamp: 1020 },
      { id: 'f-stream-4', payload: '{"seq":4}', timestamp: 1030 },
      { id: 'f-stream-5', payload: '{"seq":5}', timestamp: 1040 },
    ]);
    expect(useWSStore.getState().unseenNewFramesCount).toBe(3);

    // User jumps to latest frame -> auto-scroll resumes and unseen count resets
    store.jumpToLatestFrame();
    expect(useWSStore.getState().isAutoScrollPaused).toBe(false);
    expect(useWSStore.getState().unseenNewFramesCount).toBe(0);
    expect(useWSStore.getState().lastScrollRequest?.target).toBe('latest');
    expect(useWSStore.getState().selectedFrameId).toBe('f-stream-5');

    // New frames now do not increase unseen count
    store.addFramesBatch([
      { id: 'f-stream-6', payload: '{"seq":6}', timestamp: 1050 },
    ]);
    expect(useWSStore.getState().unseenNewFramesCount).toBe(0);
  });
});
