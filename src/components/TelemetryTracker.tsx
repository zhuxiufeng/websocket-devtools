import React, { useMemo, useState, useRef } from 'react';
import { useWSStore } from '../store/ws-store';
import {
  Activity,
  X,
  Trash2,
  FileSpreadsheet,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Sliders,
  Plus,
  RotateCcw,
} from 'lucide-react';

const extractExplicitUnit = (label: string): string => {
  // Only extract explicit units if the user explicitly provided them, e.g. "latency (ms)", "load [%]"
  const match = label.match(/[\(\[]\s*([^\(\)\[\]]{1,10})\s*[\)\]]/);
  return match ? ` ${match[1].trim()}` : '';
};

export const TelemetryTracker: React.FC = () => {
  const telemetrySeries = useWSStore((s) => s.telemetrySeries);
  const removeTelemetrySeries = useWSStore((s) => s.removeTelemetrySeries);
  const clearTelemetryPoints = useWSStore((s) => s.clearTelemetryPoints);
  const customColumns = useWSStore((s) => s.customColumns);
  const addTelemetrySeries = useWSStore((s) => s.addTelemetrySeries);

  const [windowSize, setWindowSize] = useState<number>(100);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [scaleMode, setScaleMode] = useState<'autofit' | 'shared'>('autofit');
  const [zoomRange, setZoomRange] = useState<{ minTime: number; maxTime: number } | null>(null);
  const [dragSelect, setDragSelect] = useState<{ startX: number; currentX: number } | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{
    index: number;
    x: number;
    y: number;
    time: string;
    values: { label: string; value: number; color: string }[];
  } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  // Helper to get compact label without ugly mid-word truncation
  const getShortLabel = (label: string) => {
    if (label.length <= 22) return label;
    // Check if bracketed like [0] or (X)
    const subMatch = label.match(/\[\d+\]$/) || label.match(/\([^)]+\)$/);
    if (subMatch) {
      const prefix = label.slice(0, 14);
      return `${prefix}..${subMatch[0]}`;
    }
    const parts = label.split('.');
    if (parts.length > 1) {
      return `${parts[0].slice(0, 10)}..${parts[parts.length - 1]}`;
    }
    return label.slice(0, 20) + '..';
  };

  // Compute sliced data and real-time SVG coordinates
  const chartData = useMemo(() => {
    if (telemetrySeries.length === 0) return null;

    let globalMin = Infinity;
    let globalMax = -Infinity;
    let minTime = Infinity;
    let maxTime = -Infinity;

    // Slice the series to the current zoom/windowSize or box zoomRange
    const slicedSeries = telemetrySeries.map((s) => {
      let dataPoints = s.dataPoints;
      if (zoomRange) {
        dataPoints = dataPoints.filter((p) => p.time >= zoomRange.minTime && p.time <= zoomRange.maxTime);
      } else {
        dataPoints = dataPoints.slice(Math.max(0, dataPoints.length - windowSize));
      }
      return {
        ...s,
        dataPoints,
      };
    });

    if (zoomRange) {
      minTime = zoomRange.minTime;
      maxTime = zoomRange.maxTime;
      slicedSeries.forEach((s) => {
        s.dataPoints.forEach((p) => {
          if (p.value < globalMin) globalMin = p.value;
          if (p.value > globalMax) globalMax = p.value;
        });
      });
    } else {
      slicedSeries.forEach((s) => {
        s.dataPoints.forEach((p) => {
          if (p.value < globalMin) globalMin = p.value;
          if (p.value > globalMax) globalMax = p.value;
          if (p.time < minTime) minTime = p.time;
          if (p.time > maxTime) maxTime = p.time;
        });
      });
    }

    if (globalMin === Infinity) {
      globalMin = 0;
      globalMax = 100;
    } else if (globalMin === globalMax) {
      globalMin -= 10;
      globalMax += 10;
    } else {
      const pad = (globalMax - globalMin) * 0.1;
      globalMin -= pad;
      globalMax += pad;
    }

    const width = 800;
    const height = isMaximized ? 420 : 150;
    const padding = {
      top: 18,
      bottom: 24,
      left: 48,
      right: telemetrySeries.length > 1 && scaleMode === 'autofit' ? 48 : 20,
    };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const timeSpan = maxTime > minTime ? maxTime - minTime : 0;
    const maxPoints = Math.max(...slicedSeries.map((s) => s.dataPoints.length), 1);

    // Compute paths per series
    const seriesPaths = slicedSeries.map((s) => {
      if (s.dataPoints.length < 2) {
        return {
          series: s,
          path: '',
          currentVal: s.dataPoints[s.dataPoints.length - 1]?.value ?? null,
          sMin: 0,
          sMax: 100,
        };
      }

      let sMin = Infinity;
      let sMax = -Infinity;
      if (scaleMode === 'autofit') {
        s.dataPoints.forEach((p) => {
          if (p.value < sMin) sMin = p.value;
          if (p.value > sMax) sMax = p.value;
        });
        if (sMin === sMax) {
          sMin -= 0.5;
          sMax += 0.5;
        } else {
          const pad = (sMax - sMin) * 0.15;
          sMin -= pad;
          sMax += pad;
        }
      } else {
        sMin = globalMin;
        sMax = globalMax;
      }

      const sRange = sMax - sMin || 1;

      // Pixel-level decimation: downsample points falling onto the same screen pixel
      const points: string[] = [];
      let lastPixelX = -999;
      let minPixelY = Infinity;
      let maxPixelY = -Infinity;

      for (let idx = 0; idx < s.dataPoints.length; idx++) {
        const p = s.dataPoints[idx];
        const progress = timeSpan > 0 ? (p.time - minTime) / timeSpan : idx / Math.max(1, maxPoints - 1);
        const x = padding.left + progress * plotW;
        const normalizedY = (p.value - sMin) / sRange;
        const y = padding.top + (1 - normalizedY) * plotH;
        const currentPixelX = Math.round(x);

        if (idx === 0 || idx === s.dataPoints.length - 1) {
          points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
          lastPixelX = currentPixelX;
          minPixelY = y;
          maxPixelY = y;
          continue;
        }

        if (currentPixelX === lastPixelX) {
          if (y < minPixelY) minPixelY = y;
          if (y > maxPixelY) maxPixelY = y;
        } else {
          if (minPixelY !== maxPixelY && minPixelY !== Infinity) {
            points.push(`${lastPixelX.toFixed(1)},${minPixelY.toFixed(1)}`);
            points.push(`${lastPixelX.toFixed(1)},${maxPixelY.toFixed(1)}`);
          }
          points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
          lastPixelX = currentPixelX;
          minPixelY = y;
          maxPixelY = y;
        }
      }

      return {
        series: s,
        path: points.length > 0 ? `M ${points.join(' L ')}` : '',
        currentVal: s.dataPoints[s.dataPoints.length - 1]?.value ?? null,
        sMin,
        sMax,
      };
    });

    // Time ticks for bottom axis
    const timeTicks: { label: string; x: number }[] = [];
    if (timeSpan > 0) {
      const tickCount = 4;
      for (let i = 0; i <= tickCount; i++) {
        const t = minTime + (timeSpan * i) / tickCount;
        const d = new Date(t);
        const pad = (n: number) => ('00' + n).slice(-2);
        const label = `${pad(d.getMinutes())}:${pad(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
        const x = padding.left + (i / tickCount) * plotW;
        timeTicks.push({ label, x });
      }
    }

    // Y-Axis Ticks & Units
    const formatVal = (v: number) => {
      if (Math.abs(v) >= 100 || Number.isInteger(v)) return v.toFixed(0);
      return v.toFixed(1);
    };

    const s0Min = seriesPaths[0]?.sMin ?? globalMin;
    const s0Max = seriesPaths[0]?.sMax ?? globalMax;
    const s0Mid = (s0Min + s0Max) / 2;
    const s0Unit = extractExplicitUnit(slicedSeries[0]?.label || '');

    const yAxisTicks = {
      left: {
        unit: s0Unit,
        color: scaleMode === 'autofit' ? (slicedSeries[0]?.color || '#888888') : '#888888',
        ticks: [
          { val: s0Max, y: padding.top, label: `${formatVal(s0Max)}${s0Unit}` },
          { val: s0Mid, y: padding.top + plotH / 2, label: `${formatVal(s0Mid)}${s0Unit}` },
          { val: s0Min, y: padding.top + plotH, label: `${formatVal(s0Min)}${s0Unit}` },
        ],
      },
      right: {
        unit: extractExplicitUnit(slicedSeries[1]?.label || ''),
        color: slicedSeries[1]?.color || '#888888',
        ticks: [] as { val: number; y: number; label: string }[],
      },
    };

    if (scaleMode === 'autofit' && seriesPaths.length > 1) {
      const s1Min = seriesPaths[1].sMin;
      const s1Max = seriesPaths[1].sMax;
      const s1Mid = (s1Min + s1Max) / 2;
      const s1Unit = extractExplicitUnit(slicedSeries[1]?.label || '');
      yAxisTicks.right.ticks = [
        { val: s1Max, y: padding.top, label: `${formatVal(s1Max)}${s1Unit}` },
        { val: s1Mid, y: padding.top + plotH / 2, label: `${formatVal(s1Mid)}${s1Unit}` },
        { val: s1Min, y: padding.top + plotH, label: `${formatVal(s1Min)}${s1Unit}` },
      ];
    }

    return {
      globalMin,
      globalMax,
      minTime,
      maxTime,
      timeSpan,
      width,
      height,
      padding,
      plotW,
      plotH,
      maxPoints,
      slicedSeries,
      seriesPaths,
      timeTicks,
      yAxisTicks,
    };
  }, [telemetrySeries, windowSize, isMaximized, scaleMode, zoomRange]);

  // Handle Zoom via mouse wheel
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      setWindowSize((prev) => Math.max(25, prev - 25));
    } else {
      setWindowSize((prev) => Math.min(500, prev + 25));
    }
  };

  // Box Zoom Mouse Down
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !chartData || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const relX = (mouseX / rect.width) * chartData.width;
    const clampedX = Math.max(chartData.padding.left, Math.min(chartData.width - chartData.padding.right, relX));
    setDragSelect({ startX: clampedX, currentX: clampedX });
  };

  // Handle Crosshair Mouse Move or Box Zoom Drag
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartData || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const relX = (mouseX / rect.width) * chartData.width;
    const clampedX = Math.max(chartData.padding.left, Math.min(chartData.width - chartData.padding.right, relX));

    if (dragSelect) {
      setDragSelect((prev) => (prev ? { ...prev, currentX: clampedX } : null));
      setHoverPoint(null);
      return;
    }

    if (chartData.maxPoints < 2) return;

    const progress = (clampedX - chartData.padding.left) / chartData.plotW;

    // Find nearest point across series
    let bestIdx = 0;
    let bestDist = Infinity;
    const targetTime = chartData.minTime + progress * chartData.timeSpan;

    const firstSeries = chartData.slicedSeries[0];
    if (firstSeries && firstSeries.dataPoints.length > 0) {
      firstSeries.dataPoints.forEach((p, idx) => {
        const dist = Math.abs(p.time - targetTime);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      });
    }

    const values = chartData.slicedSeries.map((s) => ({
      label: s.label,
      value: s.dataPoints[bestIdx]?.value ?? 0,
      color: s.color,
    }));

    const time = firstSeries?.dataPoints[bestIdx]?.formattedTime || '';

    setHoverPoint({
      index: bestIdx,
      x: clampedX,
      y: e.clientY - rect.top,
      time,
      values,
    });
  };

  // Box Zoom Mouse Up
  const handleMouseUp = () => {
    if (dragSelect && chartData && chartData.timeSpan > 0) {
      const x1 = Math.min(dragSelect.startX, dragSelect.currentX);
      const x2 = Math.max(dragSelect.startX, dragSelect.currentX);
      const width = x2 - x1;

      // Only zoom if dragged more than 15px
      if (width > 15) {
        const progress1 = Math.max(0, Math.min(1, (x1 - chartData.padding.left) / chartData.plotW));
        const progress2 = Math.max(0, Math.min(1, (x2 - chartData.padding.left) / chartData.plotW));
        const t1 = Math.round(chartData.minTime + progress1 * chartData.timeSpan);
        const t2 = Math.round(chartData.minTime + progress2 * chartData.timeSpan);

        if (t2 - t1 > 50) {
          setZoomRange({ minTime: t1, maxTime: t2 });
        }
      }
    }
    setDragSelect(null);
  };

  // Export CSV
  const handleExportCSV = () => {
    if (telemetrySeries.length === 0) return;

    const maxLen = Math.max(...telemetrySeries.map((s) => s.dataPoints.length));
    const headers = ['Index', 'Time', ...telemetrySeries.map((s) => `"${s.label}"`)];
    const rows: string[] = [headers.join(',')];

    for (let i = 0; i < maxLen; i++) {
      const timeStr = telemetrySeries[0]?.dataPoints[i]?.formattedTime || '';
      const row = [
        i + 1,
        timeStr,
        ...telemetrySeries.map((s) =>
          s.dataPoints[i]?.value !== undefined ? s.dataPoints[i].value : ''
        ),
      ];
      rows.push(row.join(','));
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ws-telemetry-trace-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export SVG Chart
  const handleExportSVG = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgRef.current);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ws-telemetry-chart-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (telemetrySeries.length === 0) {
    return (
      <div className="h-44 bg-[#1e1e1e] border-t border-[#3c3c3c] flex flex-col items-center justify-center text-xs text-[#858585] p-3 select-none shrink-0">
        <Activity className="w-6 h-6 mb-2 text-[#555555]" />
        <span className="font-medium text-[#aaaaaa]">No Active Telemetry Tracks</span>
        <span className="text-[11px] mt-1 text-[#777777] text-center max-w-sm">
          Track any coordinate, temperature, or numeric field in real time. Right-click or click track on fields in JSON Inspector.
        </span>

        {customColumns.length > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5 flex-wrap justify-center">
            <span className="text-[10px] text-[#666666]">Quick track from custom columns:</span>
            {customColumns.slice(0, 4).map((col) => (
              <button
                key={col.id}
                onClick={() => addTelemetrySeries(col.path, col.name)}
                className="px-2 py-0.5 bg-[#252526] hover:bg-[#333333] text-[#38bdf8] border border-[#38bdf8]/40 rounded text-[10px] transition-colors flex items-center gap-1"
              >
                <Plus className="w-2.5 h-2.5" />
                {col.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const chartContent = (
    <div
      className={`${
        isMaximized
          ? 'fixed inset-4 z-50 bg-[#1e1e1e] border border-[#555555] rounded-lg shadow-2xl flex flex-col overflow-hidden'
          : 'h-60 bg-[#1e1e1e] border-t border-[#3c3c3c] flex flex-col select-none overflow-hidden shrink-0'
      }`}
    >
      {/* Header with Tools */}
      <div className="h-8 px-3 bg-[#252526] border-b border-[#3c3c3c] flex items-center justify-between text-xs shrink-0 gap-2">
        {/* Left: Active Metrics Tags */}
        <div className="flex-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 min-w-0">
          <span className="font-semibold text-[#dddddd] flex items-center gap-1 shrink-0 mr-1 text-[11px]">
            <Activity className="w-3.5 h-3.5 text-[#38bdf8]" />
            Trace:
          </span>

          <div className="flex items-center gap-1 flex-nowrap">
            {telemetrySeries.map((s) => {
              const latestVal = s.dataPoints[s.dataPoints.length - 1]?.value;
              const short = getShortLabel(s.label);
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-[#1e1e1e] border border-[#3c3c3c] shrink-0 hover:border-[#555555] transition-colors"
                  title={s.label}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-[#38bdf8] font-mono font-medium text-[10px]">{short}:</span>
                  <span className="text-white font-mono font-bold text-[11px]">
                    {latestVal !== undefined ? (Number.isInteger(latestVal) ? latestVal : latestVal.toFixed(2)) : '-'}
                  </span>
                  <button
                    onClick={() => removeTelemetrySeries(s.id)}
                    className="text-[#777777] hover:text-red-400 ml-0.5 p-0.5"
                    title={`Remove ${s.label}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Scale Mode, Zoom & Export Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Box Zoom Reset Button */}
          {zoomRange && (
            <button
              onClick={() => setZoomRange(null)}
              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 hover:bg-amber-500/30 transition-colors animate-pulse"
              title="Reset Box Zoom to full window"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>Reset Zoom</span>
            </button>
          )}

          {/* Scale Mode Toggle */}
          <button
            onClick={() => setScaleMode(scaleMode === 'autofit' ? 'shared' : 'autofit')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border flex items-center gap-1 transition-colors ${
              scaleMode === 'autofit'
                ? 'bg-[#094771] text-[#38bdf8] border-[#38bdf8]'
                : 'bg-[#1e1e1e] text-[#888888] border-[#3c3c3c] hover:text-[#cccccc]'
            }`}
            title={
              scaleMode === 'autofit'
                ? 'Auto-Fit: Curves with different units/scales are normalized independently. (Click for 1:1 Shared Scale)'
                : 'Shared Scale: All curves share global min/max physical scale. (Click for Auto-Fit)'
            }
          >
            <Sliders className="w-2.5 h-2.5" />
            <span>{scaleMode === 'autofit' ? 'Auto-Fit (Multi-Scale)' : 'Shared 1:1'}</span>
          </button>

          {/* Zoom controls */}
          <div className="flex items-center bg-[#1e1e1e] border border-[#3c3c3c] rounded px-1 py-0.5 text-[10px] font-mono gap-1 text-[#aaaaaa]">
            <button
              onClick={() => setWindowSize((w) => Math.max(25, w - 25))}
              className="hover:text-white p-0.5"
              title="Zoom In (Fewer points)"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <span className="px-1 text-[#38bdf8] font-bold">{windowSize}p</span>
            <button
              onClick={() => setWindowSize((w) => Math.min(500, w + 25))}
              className="hover:text-white p-0.5"
              title="Zoom Out (More points)"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
          </div>

          <div className="h-3.5 w-[1px] bg-[#3c3c3c]" />

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            className="px-1.5 py-0.5 bg-[#1e1e1e] hover:bg-[#2e2e2e] text-[#aaaaaa] hover:text-[#38bdf8] border border-[#3c3c3c] rounded text-[10px] flex items-center gap-1 transition-colors"
            title="Export Telemetry Data as CSV"
          >
            <FileSpreadsheet className="w-3 h-3 text-emerald-400" />
            <span>CSV</span>
          </button>

          {/* Export SVG */}
          <button
            onClick={handleExportSVG}
            className="px-1.5 py-0.5 bg-[#1e1e1e] hover:bg-[#2e2e2e] text-[#aaaaaa] hover:text-[#38bdf8] border border-[#3c3c3c] rounded text-[10px] flex items-center gap-1 transition-colors"
            title="Export Chart as SVG image"
          >
            <ImageIcon className="w-3 h-3 text-amber-400" />
            <span>SVG</span>
          </button>

          {/* Maximize / Minimize */}
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1 text-[#888888] hover:text-white hover:bg-[#333333] rounded transition-colors"
            title={isMaximized ? 'Minimize chart' : 'Maximize chart (Full view)'}
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Clear */}
          <button
            onClick={clearTelemetryPoints}
            className="p-1 text-[#888888] hover:text-red-400 hover:bg-[#333333] rounded transition-colors"
            title="Clear buffer"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div
        onWheel={handleWheel}
        className="flex-1 relative w-full h-full p-2 bg-[#181818] flex flex-col justify-between overflow-hidden cursor-crosshair"
      >
        {/* Scale Mode & Range Indicator */}
        {chartData && (
          <div className="absolute top-1.5 left-2 z-10 flex items-center gap-3 text-[10px] text-[#777777] font-mono pointer-events-none">
            {scaleMode === 'autofit' ? (
              <span className="text-[#38bdf8]/80 font-bold">
                ✓ Multi-Axis Auto-Fit: Normalized independently
              </span>
            ) : (
              <span>Range: {chartData.globalMin.toFixed(1)} ~ {chartData.globalMax.toFixed(1)}</span>
            )}
            {zoomRange && (
              <span className="text-amber-400 font-bold">
                [Box Zoom Active]
              </span>
            )}
            <span className="text-[#555555] hidden md:inline">| Drag horizontally to box-zoom | Double-click to reset</span>
          </div>
        )}

        {/* Hover Crosshair Tooltip */}
        {hoverPoint && (
          <div
            style={{ left: Math.min(hoverPoint.x + 10, (chartData?.width || 600) - 160), top: 20 }}
            className="absolute z-20 bg-[#252526]/95 border border-[#444444] rounded p-2 text-[10px] shadow-xl pointer-events-none font-mono"
          >
            <div className="text-[#888888] mb-1 font-semibold">{hoverPoint.time || `Pt #${hoverPoint.index}`}</div>
            {hoverPoint.values.map((v, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: v.color }} />
                <span className="text-[#aaaaaa] truncate max-w-[120px]">{v.label}:</span>
                <span className="text-white font-bold">{v.value.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {/* SVG Polyline paths */}
        <div className="flex-1 w-full h-full relative">
          {chartData && (
            <svg
              ref={svgRef}
              id="telemetry-svg-chart"
              className="w-full h-full"
              viewBox={`0 0 ${chartData.width} ${chartData.height}`}
              preserveAspectRatio="none"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onDoubleClick={() => setZoomRange(null)}
              onMouseLeave={() => {
                setHoverPoint(null);
                setDragSelect(null);
              }}
            >
              {/* Horizontal Grid Lines */}
              <line
                x1={chartData.padding.left}
                y1={chartData.padding.top}
                x2={chartData.width - chartData.padding.right}
                y2={chartData.padding.top}
                stroke="#2a2a2a"
                strokeDasharray="4 4"
              />
              <line
                x1={chartData.padding.left}
                y1={chartData.height / 2}
                x2={chartData.width - chartData.padding.right}
                y2={chartData.height / 2}
                stroke="#252525"
                strokeDasharray="4 4"
              />
              <line
                x1={chartData.padding.left}
                y1={chartData.height - chartData.padding.bottom}
                x2={chartData.width - chartData.padding.right}
                y2={chartData.height - chartData.padding.bottom}
                stroke="#2a2a2a"
              />

              {/* Left Y-Axis Line & Numerical Ticks with Unit */}
              <line
                x1={chartData.padding.left}
                y1={chartData.padding.top}
                x2={chartData.padding.left}
                y2={chartData.height - chartData.padding.bottom}
                stroke="#383838"
              />
              {chartData.yAxisTicks.left.ticks.map((tick, i) => (
                <g key={`y-left-${i}`}>
                  <line
                    x1={chartData.padding.left - 4}
                    y1={tick.y}
                    x2={chartData.padding.left}
                    y2={tick.y}
                    stroke={chartData.yAxisTicks.left.color}
                    strokeWidth="1"
                  />
                  <text
                    x={chartData.padding.left - 6}
                    y={tick.y + 3}
                    fill={chartData.yAxisTicks.left.color}
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="end"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {/* Right Y-Axis Line & Numerical Ticks with Unit (in multi-series Auto-Fit mode) */}
              {chartData.yAxisTicks.right.ticks.length > 0 && (
                <>
                  <line
                    x1={chartData.width - chartData.padding.right}
                    y1={chartData.padding.top}
                    x2={chartData.width - chartData.padding.right}
                    y2={chartData.height - chartData.padding.bottom}
                    stroke="#383838"
                  />
                  {chartData.yAxisTicks.right.ticks.map((tick, i) => (
                    <g key={`y-right-${i}`}>
                      <line
                        x1={chartData.width - chartData.padding.right}
                        y1={tick.y}
                        x2={chartData.width - chartData.padding.right + 4}
                        y2={tick.y}
                        stroke={chartData.yAxisTicks.right.color}
                        strokeWidth="1"
                      />
                      <text
                        x={chartData.width - chartData.padding.right + 6}
                        y={tick.y + 3}
                        fill={chartData.yAxisTicks.right.color}
                        fontSize="9"
                        fontFamily="monospace"
                        textAnchor="start"
                      >
                        {tick.label}
                      </text>
                    </g>
                  ))}
                </>
              )}

              {/* Drag Box Selection Area */}
              {dragSelect && (
                <rect
                  x={Math.min(dragSelect.startX, dragSelect.currentX)}
                  y={chartData.padding.top}
                  width={Math.abs(dragSelect.currentX - dragSelect.startX)}
                  height={chartData.plotH}
                  fill="#38bdf8"
                  fillOpacity="0.25"
                  stroke="#38bdf8"
                  strokeDasharray="4 2"
                  strokeWidth="1"
                  pointerEvents="none"
                />
              )}

              {/* Time tick markers */}
              {chartData.timeTicks.map((tick, i) => (
                <g key={i}>
                  <line
                    x1={tick.x}
                    y1={chartData.height - chartData.padding.bottom}
                    x2={tick.x}
                    y2={chartData.height - chartData.padding.bottom + 4}
                    stroke="#444444"
                  />
                  <text
                    x={tick.x}
                    y={chartData.height - 4}
                    fill="#666666"
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor={i === 0 ? 'start' : i === chartData.timeTicks.length - 1 ? 'end' : 'middle'}
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {/* Vertical Crosshair Line */}
              {hoverPoint && (
                <line
                  x1={hoverPoint.x}
                  y1={chartData.padding.top}
                  x2={hoverPoint.x}
                  y2={chartData.height - chartData.padding.bottom}
                  stroke="#555555"
                  strokeDasharray="2 2"
                />
              )}

              {/* Series Curves */}
              {chartData.seriesPaths.map(({ series, path }) =>
                path ? (
                  <path
                    key={series.id}
                    d={path}
                    fill="none"
                    stroke={series.color}
                    strokeWidth={isMaximized ? '2.5' : '2'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null
              )}
            </svg>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {chartContent}
      {isMaximized && (
        <div
          onClick={() => setIsMaximized(false)}
          className="fixed inset-0 bg-black/70 z-40 backdrop-blur-sm"
        />
      )}
    </>
  );
};
