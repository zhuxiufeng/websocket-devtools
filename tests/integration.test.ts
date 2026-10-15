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

  it('2. Highlighting does not tint rows or add left bars, and highlights text accurately', () => {
    const store = useWSStore.getState();
    
    // Check default row tinting setting is strictly false
    expect(store.enableRowTinting).toBe(false);

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
});
