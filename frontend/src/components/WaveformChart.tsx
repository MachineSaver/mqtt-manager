'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    ChartOptions,
    ChartEvent,
    ActiveElement
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
);

interface WaveformChartProps {
    data: {
        axis1: number[];
        axis2: number[];
        axis3: number[];
    };
    sampleRate: number;
    activeAxis?: number;
    chartRef?: React.MutableRefObject<any>;
    accelUnit?: 'mm/s²' | 'g';
}

const WaveformChart: React.FC<WaveformChartProps> = ({ data, sampleRate, activeAxis, chartRef, accelUnit = 'mm/s²' }) => {
    const [cursorIndex, setCursorIndex] = useState<number | null>(null);

    const chartData = useMemo(() => {
        // Generate labels based on sample rate (Time in seconds)
        // Assuming all axes have same length
        const length = Math.max(data.axis1.length, data.axis2.length, data.axis3.length);
        const labels = Array.from({ length }, (_, i) => (i / sampleRate).toFixed(4));

        const datasets = [];

        const scaleFactor = accelUnit === 'g' ? 1 / 4096 : 9806.65 / 4096;

        // Only add datasets for axes that have data and match the active axis (or if no active axis is specified)
        if (data.axis1.length > 0 && (!activeAxis || activeAxis === 1)) {
            datasets.push({
                label: 'Axis 1',
                data: data.axis1.map(v => v * scaleFactor),
                borderColor: '#00357a',
                backgroundColor: '#00357a',
                borderWidth: 1,
                pointRadius: 0,
                tension: 0.1,
            });
        }

        if (data.axis2.length > 0 && (!activeAxis || activeAxis === 2)) {
            datasets.push({
                label: 'Axis 2',
                data: data.axis2.map(v => v * scaleFactor),
                borderColor: '#1f80ff',
                backgroundColor: '#1f80ff',
                borderWidth: 1,
                pointRadius: 0,
                tension: 0.1,
            });
        }

        if (data.axis3.length > 0 && (!activeAxis || activeAxis === 3)) {
            datasets.push({
                label: 'Axis 3',
                data: data.axis3.map(v => v * scaleFactor),
                borderColor: '#c2dcff',
                backgroundColor: '#c2dcff',
                borderWidth: 1,
                pointRadius: 0,
                tension: 0.1,
            });
        }

        return { labels, datasets };
    }, [data, sampleRate, activeAxis, accelUnit]);

    // Find absolute max to set initial cursor
    useEffect(() => {
        let maxVal = -1;
        let maxIdx = 0;
        let activeData: number[] = [];
        
        if (activeAxis === 1 && data.axis1.length) activeData = data.axis1;
        else if (activeAxis === 2 && data.axis2.length) activeData = data.axis2;
        else if (activeAxis === 3 && data.axis3.length) activeData = data.axis3;
        else {
            if (data.axis3.length) activeData = data.axis3;
            else if (data.axis2.length) activeData = data.axis2;
            else if (data.axis1.length) activeData = data.axis1;
        }
        
        if (!activeData.length) {
            setCursorIndex(null);
            return;
        }

        for (let i = 0; i < activeData.length; i++) {
            const abs = Math.abs(activeData[i]);
            if (abs > maxVal) {
                maxVal = abs;
                maxIdx = i;
            }
        }
        setCursorIndex(maxIdx);
    }, [data, activeAxis]);

    const containerRef = React.useRef<HTMLDivElement>(null);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (cursorIndex === null) return;
        
        const maxLen = Math.max(data.axis1.length, data.axis2.length, data.axis3.length);
        
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setCursorIndex(prev => prev !== null ? Math.max(0, prev - 1) : 0);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            setCursorIndex(prev => prev !== null ? Math.min(maxLen - 1, prev + 1) : 0);
        }
    }, [cursorIndex, data]);

    const cursorIndexRef = React.useRef(cursorIndex);
    useEffect(() => {
        cursorIndexRef.current = cursorIndex;
        // Trigger a redraw without updating the data/options structure to preserve zoom
        if (chartRef?.current) {
            chartRef.current.draw();
        }
    }, [cursorIndex, chartRef]);

    const verticalCursorPlugin = useMemo(() => ({
        id: 'verticalCursor',
        afterDatasetsDraw(chart: any) {
            const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
            const index = cursorIndexRef.current;
            if (index === undefined || index === null) return;
            
            const pixel = x.getPixelForValue ? x.getPixelForValue(index) : null;
            if (pixel === null) return;

            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'white';
            ctx.moveTo(pixel, top);
            ctx.lineTo(pixel, bottom);
            ctx.stroke();

            // Draw dots at data points
            chart.data.datasets.forEach((dataset: any, i: number) => {
                const meta = chart.getDatasetMeta(i);
                if (!meta.hidden && meta.data[index]) {
                    const point = meta.data[index];
                    ctx.beginPath();
                    ctx.arc(pixel, point.y, 4, 0, 2 * Math.PI);
                    ctx.fillStyle = dataset.borderColor || 'white';
                    ctx.fill();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = '#1e293b'; // slate-800 to match bg
                    ctx.stroke();
                }
            });

            ctx.restore();
        }
    }), []);

    const options: ChartOptions<'line'> = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
            mode: 'index',
            intersect: false,
        },
        onClick: (event: ChartEvent, elements: ActiveElement[], chart: any) => {
            if (!event.native) return;
            const points = chart.getElementsAtEventForMode(event.native, 'index', { intersect: false }, true);
            if (points.length > 0) {
                setCursorIndex(points[0].index);
                containerRef.current?.focus();
            }
        },
        plugins: {
            legend: {
                position: 'top' as const,
                labels: { color: '#cbd5e1' }
            },
            title: {
                display: false,
            },
            tooltip: {
                enabled: true,
            },
            zoom: {
                pan: { enabled: true, mode: 'x' as const },
                zoom: {
                    wheel: { enabled: true },
                    pinch: { enabled: true },
                    drag: { enabled: true, backgroundColor: 'rgba(54, 162, 235, 0.3)' },
                    mode: 'x' as const
                }
            }
        },
        scales: {
            x: {
                ticks: { color: '#94a3b8', maxTicksLimit: 10 },
                grid: { color: '#334155' }
            },
            y: {
                ticks: { color: '#94a3b8' },
                grid: { color: '#334155' },
                title: { display: true, text: `Acceleration (${accelUnit})`, color: '#94a3b8' }
            }
        }
    }), [accelUnit]);

    // Get value for overlay
    let cursorVal = 0;
    if (cursorIndex !== null) {
        const scaleFactor = accelUnit === 'g' ? 1 / 4096 : 9806.65 / 4096;
        if (activeAxis === 1 && data.axis1.length > cursorIndex) cursorVal = data.axis1[cursorIndex];
        else if (activeAxis === 2 && data.axis2.length > cursorIndex) cursorVal = data.axis2[cursorIndex];
        else if (activeAxis === 3 && data.axis3.length > cursorIndex) cursorVal = data.axis3[cursorIndex];
        cursorVal = cursorVal * scaleFactor;
    }

    return (
        <div 
            ref={containerRef}
            className="w-full h-[400px] bg-slate-950 p-4 rounded-xl border border-slate-800 relative outline-none focus:border-blue-500 transition-colors"
            tabIndex={0}
            onKeyDown={handleKeyDown}
        >
            {/* Cursor Readout Overlay */}
            {cursorIndex !== null && chartData.labels[cursorIndex] && (
                <div className="absolute top-4 right-4 bg-[#2d2d2d] bg-opacity-90 border border-slate-700 rounded px-3 py-1.5 z-10 pointer-events-none flex flex-col items-end shadow-lg">
                    <div className="text-gray-400 text-[10px] uppercase font-bold tracking-wider mb-0.5">Custom Cursor</div>
                    <div className="text-white text-xs font-mono">
                        {chartData.labels[cursorIndex]} s
                    </div>
                    <div className="text-blue-400 text-xs font-mono font-medium">
                        {cursorVal.toFixed(3)} {accelUnit}
                    </div>
                </div>
            )}
            <Line ref={chartRef} options={options} data={chartData} plugins={[verticalCursorPlugin]} />
        </div>
    );
};

export default WaveformChart;
