'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale
} from 'chart.js';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale
);
import { Line } from 'react-chartjs-2';
import 'chartjs-adapter-date-fns';
import { deinterleaveWaveform } from '@/lib/deinterleave';
import WaveformChart from './WaveformChart';
import { useSocket } from '@/app/SocketContext';

// We must register the zoom plugin dynamically to avoid Next.js SSR window errors
if (typeof window !== 'undefined') {
    import('chartjs-plugin-zoom').then((plugin) => {
        const zoomPlugin = plugin.default || plugin;
        if (zoomPlugin) ChartJS.register(zoomPlugin);
    }).catch(e => console.error("Could not load zoom plugin:", e));
}

const GraphControlsTooltip = () => (
    <div className="relative group flex items-center justify-center ml-2 z-50">
        <div className="w-5 h-5 rounded-full bg-[#3d3d3d] border border-[#555] flex items-center justify-center text-gray-300 text-xs cursor-help opacity-70 hover:opacity-100 transition-opacity font-bold">?</div>
        <div className="absolute left-0 top-full mt-2 w-56 bg-[#2d2d2d] border border-[#555] rounded shadow-xl p-3 text-xs text-gray-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all pointer-events-none text-left">
            <p className="font-semibold text-gray-100 mb-2 border-b border-[#444] pb-1">Graph Controls</p>
            <ul className="space-y-1.5 list-none m-0 p-0">
                <li><b className="text-blue-400">Pan:</b> Left-Click + Drag</li>
                <li><b className="text-blue-400">Zoom Area:</b> Shift + Drag</li>
                <li><b className="text-blue-400">Zoom In/Out:</b> Mouse Wheel</li>
            </ul>
        </div>
    </div>
);

export default function AnalysisCharts({ deviceEui }: { deviceEui: string }) {
    const [trends, setTrends] = useState<any[]>([]);
    const [loadingTrends, setLoadingTrends] = useState(false);
    
    // Waveform data
    const [waveforms, setWaveforms] = useState<any[]>([]);
    const [selectedWaveformId, setSelectedWaveformId] = useState<string | null>(null);
    const [spectrums, setSpectrums] = useState<any[]>([]);
    const [loadingSpectrums, setLoadingSpectrums] = useState(false);
    const [viewMode, setViewMode] = useState<'velocity' | 'acceleration' | 'envelope' | 'raw'>('velocity');
    const [trendMode, setTrendMode] = useState<'acceleration' | 'velocity'>('velocity');
    const [accelUnit, setAccelUnit] = useState<'mm/s²' | 'g'>('mm/s²');
    const [deviceConfig, setDeviceConfig] = useState<any>(null);
    const [activeAxis, setActiveAxis] = useState<number>(1);
    const activeAxisRef = useRef(1);
    useEffect(() => { activeAxisRef.current = activeAxis; }, [activeAxis]);
    
    // Globally track Shift key to reliably bypass Chart.js inner-event obfuscation
    const isShiftPressedRef = React.useRef(false);
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') isShiftPressedRef.current = true; };
        const handleKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') isShiftPressedRef.current = false; };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    const [spectrumCursorIndex, setSpectrumCursorIndex] = useState<number | null>(null);
    
    // Raw TWF data
    const [rawWaveform, setRawWaveform] = useState<any>(null);
    const [rawChartData, setRawChartData] = useState<{ axis1: number[], axis2: number[], axis3: number[] } | null>(null);
    const [loadingRaw, setLoadingRaw] = useState(false);
    
    // Lookback selector
    const [lookback, setLookback] = useState<'1d' | '3d' | '1w' | '1m' | '3m'>('1w');

    // Live Auto-Refresh
    const { messages } = useSocket();
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Chart Refs for Zoom/Scale Control
    const twfChartRef = useRef<any>(null);
    const spectrumChartRef = useRef<any>(null);
    const spectrumContainerRef = useRef<HTMLDivElement>(null);
    const trendChartRef = useRef<any>(null);

    const handleResetZoom = () => {
        if (viewMode === 'raw') {
            if (twfChartRef.current) twfChartRef.current.resetZoom();
        } else {
            if (spectrumChartRef.current) {
                spectrumChartRef.current.resetZoom();
            }
        }
    };

    const fromDate = React.useMemo(() => {
        const d = new Date();
        if (lookback === '1d') d.setDate(d.getDate() - 1);
        else if (lookback === '3d') d.setDate(d.getDate() - 3);
        else if (lookback === '1w') d.setDate(d.getDate() - 7);
        else if (lookback === '1m') d.setMonth(d.getMonth() - 1);
        else if (lookback === '3m') d.setMonth(d.getMonth() - 3);
        return d;
    }, [lookback]);

    // Sideband socket interceptor for live refresh
    useEffect(() => {
        if (!autoRefresh || messages.length === 0) return;
        const latestMessage = messages[0];
        if (latestMessage.topic.includes(deviceEui)) {
            // Buffer time to allow backend to finish Postgres insertions/FFT processing
            const timer = setTimeout(() => {
                setRefreshTrigger(prev => prev + 1);
            }, 2500);
            return () => clearTimeout(timer);
        }
    }, [messages, autoRefresh, deviceEui]);

    useEffect(() => {
        if (!deviceEui) return;
        
        const fetchInitialData = async () => {
            const apiUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');
            
            // Only show full loading screen if we have no data, preventing graph unmount & zoom loss
            if (trends.length === 0) {
                setLoadingTrends(true);
            }

            try {
                const devRes = await fetch(`${apiUrl}/api/devices/${deviceEui}`);
                if (devRes.ok) {
                    const devData = await devRes.json();
                    setDeviceConfig(devData.metadata);
                }
            } catch (e) { console.error('Error fetching device config', e); }

            let fetchedTData: any[] = [];
            try {
                const queryParams = new URLSearchParams({ 
                    from: fromDate.toISOString(), 
                    limit: '5000' 
                });
                const trendRes = await fetch(`${apiUrl}/api/analytics/trends/${deviceEui}?${queryParams.toString()}`);
                if (trendRes.ok) {
                    fetchedTData = await trendRes.json();
                    setTrends(fetchedTData);
                }
            } catch (e) { console.error('Error fetching trends', e); }
            setLoadingTrends(false);

            // Fetch available waveforms
            try {
                const wfRes = await fetch(`${apiUrl}/api/analytics/waveforms/${deviceEui}`);
                if (wfRes.ok) {
                    const wData = await wfRes.json();
                    
                    if (fetchedTData.length > 0) {
                        wData.forEach((w: any) => {
                            const wTime = new Date(w.start_time).getTime();
                            let closestTime = wTime;
                            let minDiff = 120000;
                            fetchedTData.forEach((t: any) => {
                                const tTime = new Date(t.timestamp).getTime();
                                const diff = Math.abs(tTime - wTime);
                                if (diff < minDiff) { 
                                    minDiff = diff; 
                                    closestTime = tTime;
                                }
                            });
                            w.start_time = new Date(closestTime).toISOString();
                        });
                    }

                    setWaveforms(wData);
                    if (wData.length > 0) {
                        setSelectedWaveformId(prev => {
                            if (prev && wData.some((w: any) => String(w.id) === String(prev))) {
                                return String(prev);
                            }
                            return wData[0].id ? String(wData[0].id) : null;
                        });
                    } else {
                        setSelectedWaveformId(null);
                        setSpectrums([]);
                    }
                }
            } catch (e) { console.error('Error fetching waveforms list', e); }
        };

        fetchInitialData();
    }, [deviceEui, fromDate, refreshTrigger]);

    useEffect(() => {
        if (!selectedWaveformId) return;

        const loadData = async () => {
            setLoadingSpectrums(true);
            setLoadingRaw(true);
            try {
                const apiUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');
                
                // Fetch spectrums
                const sRes = await fetch(`${apiUrl}/api/analytics/spectrums/${selectedWaveformId}`);
                if (sRes.ok) setSpectrums(await sRes.json());
                
                // Fetch raw waveform details
                const wRes = await fetch(`${apiUrl}/api/waveforms/${selectedWaveformId}`);
                if (wRes.ok) {
                    const wData = await wRes.json();
                    setRawWaveform(wData);
                    if (wData.final_data?.raw_hex && wData.metadata?.axisMask) {
                        setRawChartData(deinterleaveWaveform(wData.final_data.raw_hex, wData.metadata.axisMask));
                    } else {
                        setRawChartData(null);
                    }
                }
            } catch (e) { console.error('Error fetching data', e); }
            setLoadingSpectrums(false);
            setLoadingRaw(false);
        };

        loadData();
    }, [selectedWaveformId]);

    // Trend chart config
    const { trendChartData, unit } = React.useMemo(() => {
        const trendDataRev = [...trends].reverse(); // Chart needs chronological order (left to right)
        
        const getPoint = (t: any, axisKey: string) => {
            if (t.is_machine_off) return 0;
            if (trendMode === 'velocity') {
                // Check both new nested structure and old flat structure
                const val = t.velocity_mips_rms?.[axisKey] ?? t.vibration?.velocity_mips_rms?.[axisKey];
                // Despite the 'mips' key, Airvibe actually transmits integer hundredths of a mm/s (0.01 mm/s)
                return val != null ? +(val * 0.01).toFixed(2) : null;
            } else {
                const val = t.accel_mg_rms?.[axisKey] ?? t.vibration?.accel_mg_rms?.[axisKey];
                // Convert milli-g locally based on accelUnit mapping
                if (accelUnit === 'mm/s²') {
                    return val != null ? +(val * 0.001 * 9806.65).toFixed(2) : null;
                } else {
                    return val != null ? +(val * 0.001).toFixed(4) : null;
                }
            }
        };

        const ax1Trend = trendDataRev.map(t => ({ x: new Date(t.timestamp), y: getPoint(t, 'axis_1') }));
        const ax2Trend = trendDataRev.map(t => ({ x: new Date(t.timestamp), y: getPoint(t, 'axis_2') }));
        const ax3Trend = trendDataRev.map(t => ({ x: new Date(t.timestamp), y: getPoint(t, 'axis_3') }));

        const currentUnit = trendMode === 'velocity' ? 'mm/s' : accelUnit;
        const twfCaptures = waveforms
            .filter(w => new Date(w.start_time).getTime() >= fromDate.getTime())
            .map(w => ({ x: new Date(w.start_time), y: 0, wfId: w.id }));

        return {
            trendChartData: {
                datasets: [
                    { label: `Axis 1 (${currentUnit})`, data: ax1Trend, borderColor: 'rgb(53, 162, 235)', backgroundColor: 'rgba(53, 162, 235, 0.5)', pointRadius: 2, spanGaps: true },
                    { label: `Axis 2 (${currentUnit})`, data: ax2Trend, borderColor: 'rgb(255, 99, 132)', backgroundColor: 'rgba(255, 99, 132, 0.5)', pointRadius: 2, spanGaps: true },
                    { label: `Axis 3 (${currentUnit})`, data: ax3Trend, borderColor: 'rgb(75, 192, 192)', backgroundColor: 'rgba(75, 192, 192, 0.5)', pointRadius: 2, spanGaps: true },
                    { 
                        label: `TWF Captures`, 
                        data: twfCaptures, 
                        backgroundColor: '#fbbf24', // amber warning color
                        borderColor: '#ffffff',
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        pointStyle: 'triangle',
                        showLine: false,
                        type: 'line' as const
                    }
                ]
            },
            unit: currentUnit
        };
    }, [trends, trendMode, waveforms, fromDate]);

    const handleTrendClick = React.useCallback((event: any, elements: any[]) => {
        if (elements.length > 0) {
            const datasetIndex = elements[0].datasetIndex;
            const index = elements[0].index;
            
            if (trendChartData.datasets[datasetIndex].label === 'TWF Captures') {
                const wfId = (trendChartData.datasets[datasetIndex].data[index] as any).wfId;
                setSelectedWaveformId(wfId);
                return;
            }
            
            const clickedDate = trendChartData.datasets[datasetIndex].data[index].x;
            const clickedTimeMs = clickedDate.getTime();
            
            let closestWf: any = null;
            let minDiff = Infinity;
            
            waveforms.forEach((w) => {
                const wt = new Date(w.start_time).getTime();
                const diff = Math.abs(wt - clickedTimeMs);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestWf = w;
                }
            });
            
            // Allow up to 5 minutes difference
            if (closestWf && minDiff <= 300000) {
                setSelectedWaveformId(closestWf.id);
            }
        }
    }, [trendChartData, waveforms]);

    const trendOptions = React.useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        onClick: handleTrendClick,
        scales: {
            x: { type: 'time' as const, time: { tooltipFormat: 'PPpp' }, ticks: { color: '#888' }, grid: { color: '#333' } },
            y: { title: { display: true, text: `RMS ${trendMode === 'velocity' ? 'Velocity' : 'Acceleration'} (${unit})`, color: '#aaa' }, ticks: { color: '#888' }, grid: { color: '#333' }, min: 0 }
        },
        plugins: {
            legend: { labels: { color: '#ccc' } },
            title: { display: true, text: 'Overall Vibration Trend', color: '#eee' },
            tooltip: {
                callbacks: {
                    label: function(context: any) {
                        const datasetLabel = context.dataset.label || '';
                        if (datasetLabel === 'TWF Captures') {
                            const wfId = context.raw.wfId;
                            const wf = waveforms.find((w: any) => w.id === wfId);
                            if (wf && wf.metadata && wf.metadata.peaks) {
                                const axisPeaks = wf.metadata.peaks[`axis_${activeAxisRef.current}`];
                                if (axisPeaks) {
                                    return [
                                        `TWF Capture`,
                                        `Peak Velocity: ${axisPeaks.velocity.mag} mm/s @ ${axisPeaks.velocity.hz} Hz`,
                                        `Peak Accel: ${axisPeaks.accel.mag} m/s² @ ${axisPeaks.accel.hz} Hz`
                                    ];
                                }
                            }
                            return ['TWF Capture (Peak Data Unavailable)'];
                        }
                        
                        let label = datasetLabel;
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed.y !== null) {
                            label += context.parsed.y.toFixed(2) + ` ${unit}`;
                        }
                        return label;
                    }
                }
            },
            zoom: {
                pan: { 
                    enabled: true, 
                    mode: 'xy' as const,
                    onPanStart: () => !isShiftPressedRef.current
                },
                zoom: { 
                    wheel: { enabled: true }, 
                    pinch: { enabled: true },
                    drag: { enabled: true, backgroundColor: 'rgba(54, 162, 235, 0.3)', modifierKey: 'shift' as const }, 
                    mode: 'xy' as const 
                }
            }
        }
    }), [handleTrendClick, trendMode, unit, waveforms]);

    const currentSpectrum = spectrums.find(s => s.type === viewMode && s.axis === `axis_${activeAxis}`);
    
    const { spectrumChartData, yTitle, xTitle } = React.useMemo(() => {
        let scData: { datasets: any[] } = { datasets: [] };
        let yT = 'Magnitude';
        let xT = 'Frequency (Hz)';

        if (currentSpectrum) {
            if (viewMode === 'velocity') yT = 'Velocity (mm/s)';
            if (viewMode === 'acceleration') yT = `Acceleration (${accelUnit})`;
            if (viewMode === 'envelope') yT = `Envelope (${accelUnit})`;
            
            let labelType = 'Acceleration';
            if (viewMode === 'velocity') labelType = 'Velocity';
            if (viewMode === 'envelope') labelType = 'Envelope';

            scData = {
                datasets: [
                    {
                        label: `${labelType} Spectrum (Axis ${activeAxis})`,
                        data: currentSpectrum.data.map((y: number, i: number) => {
                            let scaledY = y;
                            if (viewMode === 'acceleration' || viewMode === 'envelope') {
                                // currentSpectrum natively stores mm/s²
                                if (accelUnit === 'g') {
                                    scaledY = y / 9806.65;
                                } else {
                                    scaledY = y;
                                }
                            }
                            return { x: i * currentSpectrum.resolutionHz, y: scaledY };
                        }),
                        borderColor: 'rgb(147, 51, 234)', // Purple
                        borderWidth: 1,
                        pointRadius: 0, // Disable points for dense FFT
                    }
                ]
            };
        }
        return { spectrumChartData: scData, yTitle: yT, xTitle: xT };
    }, [currentSpectrum, viewMode, activeAxis, accelUnit]);

    useEffect(() => {
        if (!currentSpectrum) {
            setSpectrumCursorIndex(null);
            return;
        }
        
        let maxVal = -Infinity;
        let maxIdx = 0;
        const dataArray = currentSpectrum.data;
        for (let i = 0; i < dataArray.length; i++) {
            if (dataArray[i] > maxVal) {
                maxVal = dataArray[i];
                maxIdx = i;
            }
        }
        setSpectrumCursorIndex(maxIdx);
    }, [currentSpectrum]);

    const handleKeyDownSpectrum = (e: React.KeyboardEvent) => {
        if (!currentSpectrum || spectrumCursorIndex === null) return;
        
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setSpectrumCursorIndex(prev => prev !== null ? Math.max(0, prev - 1) : 0);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            setSpectrumCursorIndex(prev => prev !== null ? Math.min(currentSpectrum.data.length - 1, prev + 1) : 0);
        }
    };

    const spectrumCursorIndexRef = React.useRef(spectrumCursorIndex);
    useEffect(() => {
        spectrumCursorIndexRef.current = spectrumCursorIndex;
        // Trigger a redraw without updating the data/options structure to preserve zoom
        if (spectrumChartRef.current) {
            spectrumChartRef.current.draw();
        }
    }, [spectrumCursorIndex]);

    const verticalCursorPlugin = React.useMemo(() => ({
        id: 'verticalCursor',
        afterDatasetsDraw(chart: any) {
            const index = spectrumCursorIndexRef.current;
            if (index === undefined || index === null) return;
            
            const meta = chart.getDatasetMeta(0);
            if (!meta || !meta.data || !meta.data[index] || meta.hidden) return;

            const point = meta.data[index];
            const pixelX = point.x;
            const pixelY = point.y;
            const { ctx, chartArea: { top, bottom } } = chart;

            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'white';
            ctx.moveTo(pixelX, top);
            ctx.lineTo(pixelX, bottom);
            ctx.stroke();

            // Draw dot for spectrum peak
            ctx.beginPath();
            ctx.arc(pixelX, pixelY, 4, 0, 2 * Math.PI);
            ctx.fillStyle = chart.data.datasets[0].borderColor || 'white';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#1e293b';
            ctx.stroke();

            ctx.restore();
        }
    }), []);
    
    const spectrumPluginsArray = React.useMemo(() => [verticalCursorPlugin], [verticalCursorPlugin]);

    const spectrumOptions = React.useMemo(() => {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: false as const,
            scales: {
                x: { 
                    type: 'linear' as const,
                    title: { display: true, text: xTitle, color: '#aaa' }, 
                    ticks: { color: '#888', maxTicksLimit: 20 }, 
                    grid: { color: '#333' }
                },
                y: { title: { display: true, text: yTitle, color: '#aaa' }, ticks: { color: '#888' }, grid: { color: '#333' }, min: 0 }
            },
            plugins: {
                legend: { labels: { color: '#ccc' } },
                tooltip: { intersect: false, mode: 'index' as const },
                zoom: {
                    pan: { 
                        enabled: true, 
                        mode: 'xy' as const,
                        onPanStart: () => !isShiftPressedRef.current
                    },
                    zoom: { 
                        wheel: { enabled: true }, 
                        pinch: { enabled: true }, 
                        drag: { enabled: true, backgroundColor: 'rgba(54, 162, 235, 0.3)', modifierKey: 'shift' as const },
                        mode: 'xy' as const 
                    }
                }
            },
            onClick: (event: any, elements: any, chart: any) => {
                if (!event.native) return;
                const points = chart.getElementsAtEventForMode(event.native, 'index', { intersect: false }, true);
                if (points.length > 0) {
                    setSpectrumCursorIndex(points[0].index);
                    spectrumContainerRef.current?.focus();
                }
            }
        };
    }, [xTitle, yTitle, spectrumChartData, currentSpectrum]);

    const executeSpectrumAutoScale = () => {
        if (!currentSpectrum || !spectrumChartRef.current) return;
        const dataArray = currentSpectrum.data;
        
        let maxMag = 0;
        let maxIdx = 0;
        for (let i = 0; i < dataArray.length; i++) {
            if (dataArray[i] > maxMag) {
                maxMag = dataArray[i];
                maxIdx = i;
            }
        }
        
        // Define dynamic threshold (0.5% of max peak, or minimum 0.02)
        const threshold = Math.max(0.02, maxMag * 0.005);

        let lastNonZeroIdx = 0;
        for (let i = dataArray.length - 1; i >= 0; i--) {
            if (dataArray[i] > threshold) {
                lastNonZeroIdx = i;
                break;
            }
        }
        
        // Ensure we at least leave enough room to clearly display the main peak
        lastNonZeroIdx = Math.max(lastNonZeroIdx, Math.floor(maxIdx * 2.5));
        
        lastNonZeroIdx = Math.min(dataArray.length - 1, Math.floor(lastNonZeroIdx * 1.1));
        const endFreq = lastNonZeroIdx * currentSpectrum.resolutionHz;
        
        spectrumChartRef.current.resetZoom();
        spectrumChartRef.current.zoomScale('x', { min: 0, max: endFreq }, 'default');
    };

    const handleAutoScale = () => {
        if (viewMode === 'raw') {
            handleResetZoom();
        } else {
            executeSpectrumAutoScale();
        }
    };

    const lastScaleIdRef = useRef<string>('');

    // Auto-scale explicitly *only* when the specific spectrum initially changes
    useEffect(() => {
        if (viewMode !== 'raw' && currentSpectrum && spectrumChartRef.current) {
            const chartIdentity = `${rawWaveform?.id}-${viewMode}-${activeAxis}`;
            if (lastScaleIdRef.current !== chartIdentity) {
                lastScaleIdRef.current = chartIdentity;
                const timer = setTimeout(() => {
                    executeSpectrumAutoScale();
                }, 100);
                return () => clearTimeout(timer);
            }
        }
    }, [currentSpectrum, viewMode, activeAxis, rawWaveform]);

    return (
        <div className="flex flex-col gap-6 h-full pb-6">
            {/* Top Chart: Overall Trends */}
            <div className="bg-[#1e1e1e] border border-[#333] rounded-lg p-4 h-[450px] flex flex-col relative shrink-0">
                <div className="absolute top-4 left-4 z-10 flex gap-2">
                    <button
                        onClick={() => trendChartRef.current?.resetZoom()}
                        className="bg-[#2d2d2d] hover:bg-[#3d3d3d] text-gray-300 px-3 py-1.5 rounded text-xs border border-[#444] transition-colors shadow flex items-center gap-1 opacity-80 hover:opacity-100"
                        title="Reset Graph Zoom"
                    >
                        <span>Reset Zoom</span>
                    </button>
                    <GraphControlsTooltip />
                </div>
                <div className="absolute top-4 right-4 z-10 flex gap-2 items-center bg-[#2d2d2d] border border-[#444] rounded px-3 py-1 mt-6 mr-6 opacity-80 hover:opacity-100 transition-opacity">
                    <span className="text-gray-400 text-xs">View:</span>
                    <select 
                        className={`bg-transparent text-gray-200 outline-none text-xs cursor-pointer ${trendMode === 'velocity' ? 'mr-4' : 'mr-2'}`}
                        value={trendMode}
                        onChange={(e: any) => {
                            setTrendMode(e.target.value);
                        }}
                    >
                        <option value="acceleration">Accel</option>
                        <option value="velocity">Velocity (mm/s)</option>
                    </select>
                    {trendMode === 'acceleration' && (
                        <select 
                            value={accelUnit}
                            onChange={(e) => setAccelUnit(e.target.value as 'mm/s²' | 'g')}
                            className="bg-[#444] text-xs text-gray-300 hover:text-white rounded border border-[#555] px-1 py-0.5 outline-none cursor-pointer"
                        >
                            <option value="mm/s²">mm/s²</option>
                            <option value="g">g</option>
                        </select>
                    )}
                    <span className="text-gray-400 text-xs">Lookback:</span>
                    <select 
                        className="bg-transparent text-gray-200 outline-none text-xs cursor-pointer"
                        value={lookback}
                        onChange={(e: any) => setLookback(e.target.value)}
                    >
                        <option value="1d">1 Day</option>
                        <option value="3d">3 Days</option>
                        <option value="1w">1 Week</option>
                        <option value="1m">1 Month</option>
                        <option value="3m">3 Months</option>
                    </select>

                    <span className="text-gray-600 mx-1">|</span>
                    <label className="flex items-center gap-2 cursor-pointer opacity-80 hover:opacity-100 transition-opacity">
                        <input 
                            type="checkbox" 
                            className="accent-blue-500 cursor-pointer"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                        />
                        <span className="text-xs text-gray-300">Live Auto-Refresh</span>
                    </label>
                </div>
                {loadingTrends ? (
                    <div className="flex-1 flex items-center justify-center text-gray-500">Loading trends...</div>
                ) : trends.length > 0 ? (
                    <Line ref={trendChartRef} data={trendChartData} options={trendOptions} />
                ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-500">No trend data available for this sensor.</div>
                )}
            </div>

            {/* Bottom Section: Waveforms & Spectrum */}
            <div className="bg-[#1e1e1e] border border-[#333] rounded-lg p-4 flex-1 flex flex-col min-h-[400px]">
                {/* Controls */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4 border-b border-[#333] pb-4">
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-gray-400">Capture:</span>
                        <select 
                            className="bg-[#2d2d2d] border border-[#444] rounded px-3 py-1.5 text-gray-200 outline-none"
                            value={selectedWaveformId || ''}
                            onChange={(e) => setSelectedWaveformId(e.target.value || null)}
                        >
                            {waveforms.length === 0 && <option value="">No captures available</option>}
                            {waveforms.map((w: any) => (
                                <option key={w.id} value={w.id}>
                                    {new Date(w.start_time).toLocaleString()}
                                </option>
                            ))}
                        </select>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <div className="bg-[#2d2d2d] p-1 rounded-md flex">
                            <button 
                                onClick={() => setViewMode('velocity')}
                                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'velocity' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                Velocity Spec
                            </button>
                            <button 
                                onClick={() => setViewMode('acceleration')}
                                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'acceleration' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                Accel Spec
                            </button>
                            <button 
                                onClick={() => setViewMode('envelope')}
                                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'envelope' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                Envelope Spec
                            </button>
                            <button 
                                onClick={() => setViewMode('raw')}
                                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'raw' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                Raw TWF
                            </button>
                        </div>
                        
                        <div className="w-px h-6 bg-[#444] mx-2"></div>
                        
                        <div className="bg-[#2d2d2d] p-1 rounded-md flex">
                            {[1, 2, 3].map(axis => (
                                <button 
                                    key={axis}
                                    onClick={() => setActiveAxis(axis)}
                                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${activeAxis === axis ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                                >
                                    Axis {axis}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Chart Area */}
                <div className="flex-1 relative min-h-0 min-w-0">
                    <div className="absolute top-2 left-2 z-10 flex gap-2 items-center bg-[#2d2d2d] bg-opacity-80 border border-[#444] rounded px-2 py-1 shadow-md hover:bg-opacity-100 transition-opacity">
                        <button 
                            onClick={handleResetZoom}
                            className="text-xs text-gray-300 hover:text-white bg-[#444] hover:bg-[#555] px-2 py-0.5 rounded transition-colors"
                        >
                            Reset Zoom
                        </button>
                        {viewMode !== 'raw' && (
                            <button 
                                onClick={handleAutoScale}
                                className="text-xs text-gray-300 hover:text-white bg-[#444] hover:bg-[#555] px-2 py-0.5 rounded transition-colors"
                            >
                                Auto-Scale
                            </button>
                        )}
                        {(viewMode === 'acceleration' || viewMode === 'raw') && (
                            <select 
                                value={accelUnit}
                                onChange={(e) => setAccelUnit(e.target.value as 'mm/s²' | 'g')}
                                className="bg-[#444] text-xs text-gray-300 hover:text-white rounded border border-[#555] px-1 py-0.5 outline-none cursor-pointer"
                            >
                                <option value="mm/s²">mm/s²</option>
                                <option value="g">g</option>
                            </select>
                        )}
                        {viewMode === 'raw' && rawChartData && (
                            <div className="text-xs font-mono text-emerald-400 bg-[#2d2d2d] bg-opacity-80 border border-[#444] rounded px-2 py-1 shadow-md ml-auto">
                                {(activeAxis === 1 ? rawChartData.axis1?.length || 0 : activeAxis === 2 ? rawChartData.axis2?.length || 0 : rawChartData.axis3?.length || 0).toLocaleString()} Points
                            </div>
                        )}
                        {(viewMode === 'velocity' || viewMode === 'acceleration') && deviceConfig?.vibration_config && (
                            <div className="text-xs font-mono text-blue-400 bg-[#2d2d2d] bg-opacity-80 border border-[#444] rounded px-2 py-1 shadow-md ml-auto flex gap-3">
                                <div><span className="text-gray-500">HP:</span> {deviceConfig.vibration_config.high_pass_filter_hz} Hz</div>
                                <div><span className="text-gray-500">LP:</span> {deviceConfig.vibration_config.low_pass_filter_hz} Hz</div>
                            </div>
                        )}
                        <GraphControlsTooltip />
                    </div>
                    {loadingSpectrums || loadingRaw ? (
                    <div className="flex-1 flex items-center justify-center text-gray-500 h-full">Loading details...</div>
                ) : (
                    viewMode === 'raw' ? (
                        rawChartData ? (
                            <WaveformChart chartRef={twfChartRef} data={rawChartData} sampleRate={rawWaveform?.metadata?.samplingRate || rawWaveform?.metadata?.sampleRate || 5340} activeAxis={activeAxis} accelUnit={accelUnit} />
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
                                <div>No reading for this axis using current configuration.</div>
                                {rawWaveform?.metadata && (
                                    <div className="bg-[#2a2a2a] p-4 rounded text-xs text-gray-400 text-left w-full max-w-xl font-mono shadow-md border border-[#444]">
                                        <div className="text-white mb-3 font-sans font-semibold border-b border-[#555] pb-2">Current Capture Configuration</div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div><span className="text-gray-500">Axis Mask:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.axisMask}</span></div>
                                            <div><span className="text-gray-500">Axis Selection:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.axisSelection || 'N/A'}</span></div>
                                            <div><span className="text-gray-500">Hardware Filter:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.hwFilter || 'N/A'}</span></div>
                                            <div><span className="text-gray-500">Sample Rate:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.sampleRate || rawWaveform.metadata.samplingRate} Hz</span></div>
                                            <div><span className="text-gray-500">Samples/Axis:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.samplesPerAxis}</span></div>
                                            <div><span className="text-gray-500">Error Code:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.errorCode}</span></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    ) : (
                        currentSpectrum && spectrumOptions ? (
                            <div 
                                ref={spectrumContainerRef}
                                className="h-[400px] w-full relative outline-none focus:border-blue-500 rounded-xl" 
                                tabIndex={0} 
                                onKeyDown={handleKeyDownSpectrum}
                            >
                                {/* Cursor Readout Overlay */}
                                {spectrumCursorIndex !== null && currentSpectrum.data[spectrumCursorIndex] != null && (
                                    <div className="absolute top-2 right-2 bg-[#2d2d2d] bg-opacity-90 border border-[#444] rounded px-3 py-1.5 z-10 pointer-events-none flex flex-col items-end shadow-lg">
                                        <div className="text-gray-400 text-[10px] uppercase font-bold tracking-wider mb-0.5">Custom Cursor</div>
                                        <div className="text-white text-xs font-mono">
                                            {(spectrumCursorIndex * currentSpectrum.resolutionHz).toFixed(1)} Hz
                                        </div>
                                        <div className="text-blue-400 text-xs font-mono font-medium">
                                            {(() => {
                                                let val = currentSpectrum.data[spectrumCursorIndex];
                                                if ((viewMode === 'acceleration' || viewMode === 'envelope') && accelUnit === 'g') {
                                                    val = val / 9806.65;
                                                    return val.toFixed(5);
                                                }
                                                return val.toFixed(3);
                                            })()} {(accelUnit && (viewMode === 'acceleration' || viewMode === 'envelope')) ? accelUnit : yTitle.replace('Velocity ', '').replace(/[()]/g, '')}
                                        </div>
                                    </div>
                                )}
                                <Line 
                                    ref={spectrumChartRef}
                                    data={spectrumChartData} 
                                    options={spectrumOptions} 
                                    plugins={spectrumPluginsArray} 
                                />
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
                                <div>No reading for this axis using current configuration.</div>
                                {rawWaveform?.metadata && (
                                    <div className="bg-[#2a2a2a] p-4 rounded text-xs text-gray-400 text-left w-full max-w-xl font-mono shadow-md border border-[#444]">
                                        <div className="text-white mb-3 font-sans font-semibold border-b border-[#555] pb-2">Current Capture Configuration</div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div><span className="text-gray-500">Axis Mask:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.axisMask}</span></div>
                                            <div><span className="text-gray-500">Axis Selection:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.axisSelection || 'N/A'}</span></div>
                                            <div><span className="text-gray-500">Hardware Filter:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.hwFilter || 'N/A'}</span></div>
                                            <div><span className="text-gray-500">Sample Rate:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.sampleRate || rawWaveform.metadata.samplingRate} Hz</span></div>
                                            <div><span className="text-gray-500">Samples/Axis:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.samplesPerAxis}</span></div>
                                            <div><span className="text-gray-500">Error Code:</span> <span className="text-blue-300 font-semibold">{rawWaveform.metadata.errorCode}</span></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    )
                )}
                </div>
            </div>
        </div>
    );
}
