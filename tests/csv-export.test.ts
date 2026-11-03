import { describe, it, expect } from 'vitest';
import {
  escapeCsvCell,
  exportColumnsCsv,
  exportSingleColumnCsv,
  exportSelectedColumnsCsv,
} from '../src/core/trace-io';
import type { WSFrame, CustomColumn } from '../src/types/websocket';

describe('CSV Column Data Export Suite', () => {
  it('1. Correctly escapes CSV cells per RFC 4180', () => {
    expect(escapeCsvCell('simple')).toBe('simple');
    expect(escapeCsvCell(123.45)).toBe('123.45');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');

    // Commas require quoting
    expect(escapeCsvCell('hello, world')).toBe('"hello, world"');

    // Quotes must be doubled
    expect(escapeCsvCell('say "hello"')).toBe('"say ""hello"""');

    // Newlines require quoting
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');

    // Complex objects are JSON stringified and escaped
    expect(escapeCsvCell({ a: 1, b: 'two' })).toBe('"{""a"":1,""b"":""two""}"');
  });

  it('2. Exports table columns to standard CSV with headers and custom columns', () => {
    const customCols: CustomColumn[] = [
      { id: 'col-temp', path: 'params[0].extruder.temperature', name: 'Hotend Temp' },
      { id: 'col-pos', path: 'params[0].toolhead.position[0]', name: 'X Pos' },
    ];

    const frames: WSFrame[] = [
      {
        id: 'f-1',
        seq: 1,
        connectionId: 'ws://printer',
        direction: 'in',
        timestamp: 1680000000000,
        timeFormatted: '12:00:00.000',
        length: 80,
        method: 'notify_status_update',
        rpcKind: 'notification',
        deltaMs: 50,
        payload: '{"params":[{"extruder":{"temperature":210.5},"toolhead":{"position":[125.0,150.0]}}]}',
        jsonPayload: {
          params: [{ extruder: { temperature: 210.5 }, toolhead: { position: [125.0, 150.0] } }],
        },
        isJson: true,
      },
      {
        id: 'f-2',
        seq: 2,
        connectionId: 'ws://printer',
        direction: 'out',
        timestamp: 1680000000050,
        timeFormatted: '12:00:00.050',
        length: 45,
        method: 'printer.objects.query',
        rpcKind: 'request',
        rpcId: 42,
        rpcLatencyMs: 12,
        deltaMs: 50,
        payload: '{"id":42,"method":"printer.objects.query"}',
        jsonPayload: { id: 42, method: 'printer.objects.query' },
        isJson: true,
      },
    ];

    const csv = exportColumnsCsv(frames, customCols, { enableCarryForward: true });
    const lines = csv.split('\r\n');

    // Header line
    expect(lines[0]).toBe(
      'Seq,Direction,Time,Timestamp,Delta_ms,Length_bytes,Method,RPC_Kind,RPC_Latency_ms,Hotend Temp,X Pos'
    );

    // Row 1: has both custom columns
    expect(lines[1]).toBe(
      '1,in,12:00:00.000,1680000000000,50,80,notify_status_update,notification,,210.5,125'
    );

    // Row 2: request has rpcLatencyMs 12
    expect(lines[2]).toBe(
      '2,out,12:00:00.050,1680000000050,50,45,printer.objects.query,request,12,,'
    );
  });

  it('3. Populates carried values in CSV when enableCarryForward is active', () => {
    const customCols: CustomColumn[] = [
      { id: 'col-temp', path: 'params[0].extruder.temperature', name: 'Temp' },
    ];

    const frames: WSFrame[] = [
      {
        id: 'f-1',
        seq: 1,
        connectionId: 'ws://printer',
        direction: 'in',
        timestamp: 1000,
        timeFormatted: '12:00:00.000',
        length: 50,
        method: 'status',
        payload: '{"params":[{"extruder":{"temperature":215.0}}]}',
        jsonPayload: { params: [{ extruder: { temperature: 215.0 } }] },
        isJson: true,
      },
      {
        id: 'f-2',
        seq: 2,
        connectionId: 'ws://printer',
        direction: 'in',
        timestamp: 1050,
        timeFormatted: '12:00:00.050',
        length: 40,
        method: 'status',
        payload: '{"params":[{"toolhead":{"speed":100}}]}',
        jsonPayload: { params: [{ toolhead: { speed: 100 } }] },
        isJson: true,
        carried: {
          'col-temp': { value: 215.0, fromId: 'f-1' },
        },
      },
    ];

    // With carry-forward: row 2 gets 215
    const csvWithCarry = exportColumnsCsv(frames, customCols, { enableCarryForward: true });
    const linesWith = csvWithCarry.split('\r\n');
    expect(linesWith[2]).toContain(',215');

    // Without carry-forward: row 2 has empty cell
    const csvNoCarry = exportColumnsCsv(frames, customCols, { enableCarryForward: false });
    const linesNo = csvNoCarry.split('\r\n');
    expect(linesNo[2].endsWith(',')).toBe(true);
  });

  it('4. Exports a single column to CSV with Seq, formatted Time, and raw Timestamp', () => {
    const col = { id: 'col-temp', path: 'params[0].temp', name: 'Nozzle Temp' };
    const frames: WSFrame[] = [
      {
        id: 'f-1',
        seq: 1,
        connectionId: 'c1',
        direction: 'in',
        timestamp: 1680000000100,
        timeFormatted: '12:00:00.100',
        length: 20,
        payload: '{"params":[{"temp":200}]}',
        jsonPayload: { params: [{ temp: 200 }] },
        isJson: true,
      },
      {
        id: 'f-2',
        seq: 2,
        connectionId: 'c1',
        direction: 'in',
        timestamp: 1680000000200,
        timeFormatted: '12:00:00.200',
        length: 20,
        payload: '{"params":[{"temp":205}]}',
        jsonPayload: { params: [{ temp: 205 }] },
        isJson: true,
      },
    ];

    const csv = exportSingleColumnCsv(frames, col);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Seq,Time,Timestamp_ms,Nozzle Temp');
    expect(lines[1]).toBe('1,12:00:00.100,1680000000100,200');
    expect(lines[2]).toBe('2,12:00:00.200,1680000000200,205');
  });

  it('5. Correctly handles Unicode and Chinese characters without corrupting formatting', () => {
    const customCols: CustomColumn[] = [
      { id: 'col-obj', path: 'params[0].object_name', name: '模型名称 (Model)' },
    ];
    const frames: WSFrame[] = [
      {
        id: 'f-1',
        seq: 1,
        connectionId: 'c1',
        direction: 'in',
        timestamp: 100,
        timeFormatted: '12:00:00.100',
        length: 40,
        payload: '{"params":[{"object_name":"立方体_测试_#1"}]}',
        jsonPayload: { params: [{ object_name: '立方体_测试_#1' }] },
        isJson: true,
      },
    ];

    const csv = exportColumnsCsv(frames, customCols);
    expect(csv).toContain('模型名称 (Model)');
    expect(csv).toContain('立方体_测试_#1');
  });

  it('6. Flexibly exports multiple selected columns with formatted Time and raw Epoch Timestamp', () => {
    const customCols: CustomColumn[] = [
      { id: 'col-hotend', path: 'params[0].extruder.temperature', name: 'Extruder Temp' },
      { id: 'col-bed', path: 'params[0].heater_bed.temperature', name: 'Bed Temp' },
      { id: 'col-pos', path: 'params[0].toolhead.position[0]', name: 'X Pos' },
    ];

    const frames: WSFrame[] = [
      {
        id: 'f-1',
        seq: 1,
        connectionId: 'c1',
        direction: 'in',
        timestamp: 1680000000000,
        timeFormatted: '12:00:00.000',
        length: 100,
        payload: '{"params":[{"extruder":{"temperature":210.0},"heater_bed":{"temperature":60.0},"toolhead":{"position":[125.0]}}]}',
        jsonPayload: {
          params: [{ extruder: { temperature: 210.0 }, heater_bed: { temperature: 60.0 }, toolhead: { position: [125.0] } }],
        },
        isJson: true,
      },
      {
        id: 'f-2',
        seq: 2,
        connectionId: 'c1',
        direction: 'in',
        timestamp: 1680000000050,
        timeFormatted: '12:00:00.050',
        length: 100,
        payload: '{"params":[{"extruder":{"temperature":210.2},"heater_bed":{"temperature":60.1},"toolhead":{"position":[125.5]}}]}',
        jsonPayload: {
          params: [{ extruder: { temperature: 210.2 }, heater_bed: { temperature: 60.1 }, toolhead: { position: [125.5] } }],
        },
        isJson: true,
      },
    ];

    // Export only: Time, Timestamp, and 2 custom columns (Extruder Temp & Bed Temp), excluding X Pos and Seq
    const csv = exportSelectedColumnsCsv(frames, customCols, {
      includeSeq: false,
      includeTime: true,
      includeTimestamp: true,
      selectedColumnIds: ['col-hotend', 'col-bed'],
    });

    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Time,Timestamp_ms,Extruder Temp,Bed Temp');
    expect(lines[1]).toBe('12:00:00.000,1680000000000,210,60');
    expect(lines[2]).toBe('12:00:00.050,1680000000050,210.2,60.1');

    // Make sure X Pos was excluded
    expect(lines[0]).not.toContain('X Pos');
    expect(lines[0]).not.toContain('Seq');
  });
});
