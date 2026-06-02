import React, { useState, useEffect } from 'react';
import { useSocket } from '@/app/SocketContext';
import { encodeDownlink, bytesToHex, decodeConfigPayloadHex } from '@/lib/codec';

type HierarchyNode = {
    id: string;
    name?: string;
    location_designation?: string;
    device_eui?: string;
    type: 'plant' | 'area' | 'sector' | 'machine' | 'component' | 'sensor';
};

interface DeviceConfigModalProps {
    isOpen: boolean;
    node: HierarchyNode | null;
    onClose: () => void;
}

// Default standard configuration fallback
const DEFAULT_CONFIG = {
    device_settings: {
        push_mode: "overall_and_waveform",
        accel_range_g: 8,
        hw_filter: "lp_2670_hz",
        machine_off_threshold_mg: 25
    },
    waveform_config: {
        push_period_min: 15,
        samples_per_axis: 4096,
        active_axes: { axis_1: true, axis_2: true, axis_3: true }
    },
    vibration_config: {
        overall_push_period_min: 5,
        high_pass_filter_hz: 2,
        low_pass_filter_hz: 5000,
        window_function: "hanning"
    },
    alarms: { test_period_min: 5 }
};

const TooltipIcon = ({ text }: { text: string }) => (
    <div className="group relative inline-flex items-center ml-2">
        <div className="flex items-center justify-center w-4 h-4 rounded-full bg-gray-600 text-gray-300 text-[10px] font-bold cursor-help border border-gray-500 hover:bg-blue-500 hover:text-white transition-colors">
            ?
        </div>
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-gray-800 text-white text-[10px] rounded shadow-lg border border-gray-600 z-50 text-center">
            {text}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
        </div>
    </div>
);

export default function DeviceConfigModal({ isOpen, node, onClose }: DeviceConfigModalProps) {
    const { socket } = useSocket();
    const [config, setConfig] = useState(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [lastAcceptedTime, setLastAcceptedTime] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || !node?.device_eui) return;
        
        setError(null);
        setLoading(true);
        // Reset to initial defaults before fetching
        setConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
        
        const fetchConfig = async () => {
            try {
                const apiUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');
                // Fetch the latest message of packet_type=4
                const res = await fetch(`${apiUrl}/api/devices/${node.device_eui}/messages?packet_type=4&limit=1&t=${Date.now()}`, { cache: 'no-store' });
                if (!res.ok) throw new Error('Failed to fetch messages');
                const data = await res.json();
                let fetchedPayloadHex = "null";
                let decodedSuccess = "false";
                
                if (data && data.length > 0 && data[0].payload) {
                    const parsedPayload = typeof data[0].payload === 'string' ? JSON.parse(data[0].payload) : data[0].payload;
                    const hexStr = data[0].payload_hex || 
                                   (parsedPayload.DevEUI_uplink && parsedPayload.DevEUI_uplink.payload_hex) ||
                                   (parsedPayload.payload_hex);

                    if (hexStr) {
                        fetchedPayloadHex = hexStr;
                        const decodedStr = decodeConfigPayloadHex(hexStr);
                        if (decodedStr && decodedStr.device_settings) {
                            decodedSuccess = "true";
                            setConfig({
                                ...DEFAULT_CONFIG,
                                device_settings: { ...DEFAULT_CONFIG.device_settings, ...decodedStr.device_settings },
                                waveform_config: { ...DEFAULT_CONFIG.waveform_config, ...decodedStr.waveform_config },
                                vibration_config: { ...DEFAULT_CONFIG.vibration_config, ...decodedStr.vibration_config },
                                alarms: { ...DEFAULT_CONFIG.alarms, ...decodedStr.alarms }
                            });
                            if (data[0].received_at) {
                                setLastAcceptedTime(new Date(data[0].received_at).toLocaleString());
                            }
                        } else {
                            decodedSuccess = "decoder returned null or missing device_settings";
                        }
                    } else {
                         fetchedPayloadHex = "hexStr evaluated false";
                    }
                } else {
                    fetchedPayloadHex = "data empty or no payload";
                }
                
                // Unconditionally append debug info as an error so we see it
                setConfig((prev: any) => ({...prev, debug_err: `fetch OK! HEX: ${fetchedPayloadHex} | DECODED: ${decodedSuccess}`}));
            } catch (err: any) {
                console.error("Config fetch error:", err);
                setConfig({...DEFAULT_CONFIG, debug_err: err.message});
            } finally {
                setLoading(false);
            }
        };

        fetchConfig();
    }, [isOpen, node]);

    if (!isOpen || !node) return null;

    const handleSave = () => {
        if (!socket) {
            setError("Socket not connected. Cannot send downlink.");
            return;
        }

        // Validation
        const numActiveAxes = (config.waveform_config.active_axes.axis_1 ? 1 : 0) +
                              (config.waveform_config.active_axes.axis_2 ? 1 : 0) +
                              (config.waveform_config.active_axes.axis_3 ? 1 : 0);
                              
        if (numActiveAxes === 0) {
            setError("At least one axis must be active to record a waveform.");
            return;
        }
        
        const totalSamples = numActiveAxes * config.waveform_config.samples_per_axis;
        if (totalSamples > 12288) {
            setError(`Total samples across all active axes (${totalSamples}) exceeds firmware memory limits (~12K). Please reduce the samples per axis, or disable an axis.`);
            return;
        }
        
        if (config.waveform_config.samples_per_axis > 12288) {
            setError("Samples per axis cannot exceed 12288 due to hardware memory limits.");
            return;
        }
        
        if (config.waveform_config.push_period_min < 1) {
            setError("Waveform push period must be at least 1 minute.");
            return;
        }
        
        if (config.vibration_config.overall_push_period_min < 1) {
            setError("Overall vibration push period must be at least 1 minute.");
            return;
        }

        if (config.vibration_config.high_pass_filter_hz >= config.vibration_config.low_pass_filter_hz) {
            setError("High Pass Filter (Hz) must be strictly less than Low Pass Filter (Hz).");
            return;
        }

        if (config.device_settings.machine_off_threshold_mg < 0) {
            setError("Machine off threshold must be a positive integer.");
            return;
        }

        setSaving(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const finalConfig = { version: 2, ...config };
            const fport30Bytes = encodeDownlink({ fPort: 30, data: finalConfig });
            if (fport30Bytes.errors && fport30Bytes.errors.length > 0) {
                throw new Error("Codec encoding failed: " + fport30Bytes.errors.join(', '));
            }
            
            const payload30Hex = bytesToHex(fport30Bytes.bytes);
            
            // Generate FPort 22 downlink (request_config) so the sensor echoes back the new state
            const fport22Bytes = encodeDownlink({ fPort: 22, data: { command_id: 'request_config' } });
            const payload22Hex = bytesToHex(fport22Bytes.bytes);

            const topic = `mqtt/things/${node.device_eui}/downlink`;
            const now = new Date();
            
            const mqPayload30 = {
                DevEUI_downlink: { Time: now.toISOString(), DevEUI: node.device_eui, FPort: 30, payload_hex: payload30Hex, Confirmed: "1" }
            };
            
            const mqPayload22 = {
                DevEUI_downlink: { Time: new Date(now.getTime() + 1000).toISOString(), DevEUI: node.device_eui, FPort: 22, payload_hex: payload22Hex, Confirmed: "1" }
            };

            socket.emit('publish', { topic, payload: JSON.stringify(mqPayload30, null, 2) });
            // Queue the sync request immediately behind the configuration update
            setTimeout(() => {
                socket.emit('publish', { topic, payload: JSON.stringify(mqPayload22, null, 2) });
            }, 250);
            
            setSaving(false);
            setSuccessMessage(`✅ Downlink Queued! The sensor will apply FPort 30 and then echo back via FPort 22 at its next transmissions.`);
            
            setTimeout(() => {
                onClose();
                setSuccessMessage(null);
            }, 7500);

        } catch (err: any) {
            setError(err.message);
            setSaving(false);
        }
    };

    const handleSync = () => {
        if (!socket) return;
        setSuccessMessage(null);
        setError(null);
        try {
            const fport22Bytes = encodeDownlink({ fPort: 22, data: { command_id: 'request_config' } });
            const payload22Hex = bytesToHex(fport22Bytes.bytes);
            const topic = `mqtt/things/${node.device_eui}/downlink`;
            
            const mqPayload22 = {
                DevEUI_downlink: { Time: new Date().toISOString(), DevEUI: node.device_eui, FPort: 22, payload_hex: payload22Hex, Confirmed: "1" }
            };

            socket.emit('publish', { topic, payload: JSON.stringify(mqPayload22, null, 2) });
            setSuccessMessage(`✅ Sync Request Queued! Sensor will echo config at next wake up.`);
        } catch (err: any) {
            setError(err.message);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]">
            <div className="bg-[#2d2d2d] rounded-lg shadow-xl w-full max-w-2xl border border-[#444] overflow-hidden flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-[#444] flex justify-between items-center bg-[#252526] shrink-0">
                    <div className="flex flex-col">
                        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wide">
                            Configure Sensor: <span className="text-blue-400 normal-case">{node.device_eui}</span>
                        </h2>
                        <span className="text-[10px] text-gray-400 mt-0.5">
                            Last Handshake/Sync: <span className="text-gray-300 font-mono">{lastAcceptedTime ? lastAcceptedTime : "Never (Using Defaults)"}</span> 
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={handleSync} className="text-xs bg-emerald-900/50 hover:bg-emerald-800 text-emerald-400 border border-emerald-800 rounded px-3 py-1.5 transition-colors font-medium flex items-center gap-1.5" title="Force sensor to report its active configuration">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                            </svg>
                            Request Sync
                        </button>
                        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors ml-2">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    {loading ? (
                        <div className="text-center text-gray-400 py-10">Loading device configuration...</div>
                    ) : (
                        <div className="space-y-6">
                            {/* Device Settings Group */}
                            <div className="bg-[#252526] border border-[#3e3e42] p-4 rounded">
                                <h3 className="text-orange-500 text-xs font-semibold uppercase mb-3 border-b border-[#3e3e42] pb-1">Device Settings</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="flex items-center text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                                            Push Mode
                                            <TooltipIcon text="Determines what type of data the sensor publishes automatically. (Overall = Trend, Waveform = High Res Data)" />
                                        </label>
                                        <select 
                                            value={config.device_settings.push_mode}
                                            onChange={e => setConfig({...config, device_settings: {...config.device_settings, push_mode: e.target.value}})}
                                            className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1.5 text-xs text-gray-300 focus:border-blue-500 outline-none"
                                        >
                                            <option value="overall_and_waveform">Overall & Waveform</option>
                                            <option value="overall_only">Overall Only</option>
                                            <option value="waveform_only">Waveform Only</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="flex items-center text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                                            Accel Range (G)
                                            <TooltipIcon text="The hardware gravity scaling limit. A higher setting (16G) avoids clipping on aggressive vibration, but offers lower resolution." />
                                        </label>
                                        <select 
                                            value={config.device_settings.accel_range_g}
                                            onChange={e => setConfig({...config, device_settings: {...config.device_settings, accel_range_g: parseInt(e.target.value)}})}
                                            className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1.5 text-xs text-gray-300 focus:border-blue-500 outline-none"
                                        >
                                            <option value={2}>2G</option>
                                            <option value={4}>4G</option>
                                            <option value={8}>8G</option>
                                            <option value={16}>16G</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="flex items-center text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                                            Hardware Filter
                                            <TooltipIcon text="The analog low-pass cutoff filter implemented natively on the MEMs chip before digital conversion." />
                                        </label>
                                        <select 
                                            value={config.device_settings.hw_filter}
                                            onChange={e => setConfig({...config, device_settings: {...config.device_settings, hw_filter: e.target.value}})}
                                            className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1.5 text-xs text-gray-300 focus:border-blue-500 outline-none"
                                        >
                                            <option value="lp_5340_hz">LP 5340 Hz</option>
                                            <option value="lp_2670_hz">LP 2670 Hz</option>
                                            <option value="lp_1340_hz">LP 1340 Hz</option>
                                            <option value="lp_670_hz">LP 670 Hz</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="flex items-center text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                                            Machine Off Threshold
                                            <TooltipIcon text="The vibration limit in milligravities under which the sensor will deem the machine 'Off' and skip expensive telemetry transmission." />
                                        </label>
                                        <div className="flex items-center">
                                            <input 
                                                type="number"
                                                value={config.device_settings.machine_off_threshold_mg}
                                                onChange={e => setConfig({...config, device_settings: {...config.device_settings, machine_off_threshold_mg: parseInt(e.target.value)}})}
                                                className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1.5 text-xs text-gray-300 focus:border-blue-500 outline-none"
                                            />
                                            <span className="ml-2 text-xs text-gray-500">mG</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Waveform Config */}
                            <div className="bg-[#252526] border border-[#3e3e42] p-4 rounded">
                                <h3 className="text-orange-500 text-xs font-semibold uppercase mb-3 border-b border-[#3e3e42] pb-1">Waveform Config</h3>
                                <div className="grid grid-cols-2 gap-4 mb-3">
                                    <div>
                                        <label className="flex items-center text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                                            Push Period
                                            <TooltipIcon text="How frequently (in minutes) the sensor captures and beams a Time Waveform (TWF)." />
                                        </label>
                                        <div className="flex items-center">
                                            <input 
                                                type="number"
                                                value={config.waveform_config.push_period_min}
                                                onChange={e => setConfig({...config, waveform_config: {...config.waveform_config, push_period_min: parseInt(e.target.value)}})}
                                                className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1.5 text-xs text-gray-300 focus:border-blue-500 outline-none"
                                            />
                                            <span className="ml-2 text-xs text-gray-500">min</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="flex items-center text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                                            Samples Per Axis
                                            <TooltipIcon text="The raw array length captured per active listening axis. Higher scales heavily block LoRa airspace. 4096 is default." />
                                        </label>
                                        <input 
                                            type="number"
                                            value={config.waveform_config.samples_per_axis}
                                            onChange={e => setConfig({...config, waveform_config: {...config.waveform_config, samples_per_axis: parseInt(e.target.value)}})}
                                            className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1.5 text-xs text-gray-300 focus:border-blue-500 outline-none"
                                        />
                                    </div>
                                </div>
                                
                                <label className="flex items-center text-[10px] text-gray-400 mb-2 uppercase tracking-wider">
                                    Active Recording Axes
                                    <TooltipIcon text="Select which direction axes dynamically record Waveform events." />
                                </label>
                                <div className="flex gap-4 p-2 bg-[#1e1e1e] border border-[#3e3e42] rounded">
                                    <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                                        <input type="checkbox" checked={config.waveform_config.active_axes.axis_1} onChange={e => setConfig({
                                            ...config, waveform_config: {...config.waveform_config, active_axes: {...config.waveform_config.active_axes, axis_1: e.target.checked}}})} 
                                            className="accent-blue-600 rounded bg-[#1e1e1e] border-[#3e3e42]" /> <span>Axis 1</span>
                                    </label>
                                    <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                                        <input type="checkbox" checked={config.waveform_config.active_axes.axis_2} onChange={e => setConfig({
                                            ...config, waveform_config: {...config.waveform_config, active_axes: {...config.waveform_config.active_axes, axis_2: e.target.checked}}})} 
                                            className="accent-blue-600 rounded bg-[#1e1e1e] border-[#3e3e42]" /> <span>Axis 2</span>
                                    </label>
                                    <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                                        <input type="checkbox" checked={config.waveform_config.active_axes.axis_3} onChange={e => setConfig({
                                            ...config, waveform_config: {...config.waveform_config, active_axes: {...config.waveform_config.active_axes, axis_3: e.target.checked}}})} 
                                            className="accent-blue-600 rounded bg-[#1e1e1e] border-[#3e3e42]" /> <span>Axis 3</span>
                                    </label>
                                </div>
                            </div>
                            
                            {/* Vibration & Alarms Config */}
                            <div className="bg-[#252526] border border-[#3e3e42] p-4 rounded">
                                <h3 className="text-orange-500 text-xs font-semibold uppercase mb-3 border-b border-[#3e3e42] pb-1">Vibration & Polling</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="flex items-center text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                                            Overall Push Period
                                            <TooltipIcon text="How frequently (in minutes) the sensor quickly measures continuous overall RMS values and reports it." />
                                        </label>
                                        <div className="flex items-center">
                                            <input 
                                                type="number"
                                                value={config.vibration_config.overall_push_period_min}
                                                onChange={e => setConfig({...config, vibration_config: {...config.vibration_config, overall_push_period_min: parseInt(e.target.value)}})}
                                                className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1.5 text-xs text-gray-300 focus:border-blue-500 outline-none"
                                            />
                                            <span className="ml-2 text-xs text-gray-500">min</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="flex items-center text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                                            Alarm Test Period
                                            <TooltipIcon text="How frequently (in minutes) local alarms are internally checked against threshold values." />
                                        </label>
                                        <div className="flex items-center">
                                            <input 
                                                type="number"
                                                value={config.alarms.test_period_min}
                                                onChange={e => setConfig({...config, alarms: {...config.alarms, test_period_min: parseInt(e.target.value)}})}
                                                className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1.5 text-xs text-gray-300 focus:border-blue-500 outline-none"
                                            />
                                            <span className="ml-2 text-xs text-gray-500">min</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="flex items-center text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                                            High Pass Filter (Hz)
                                            <TooltipIcon text="Digital HPF applied locally on the node to remove sub-frequency bleed over." />
                                        </label>
                                        <div className="flex items-center">
                                            <input 
                                                type="number"
                                                value={config.vibration_config.high_pass_filter_hz}
                                                onChange={e => setConfig({...config, vibration_config: {...config.vibration_config, high_pass_filter_hz: parseInt(e.target.value)}})}
                                                className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1.5 text-xs text-gray-300 focus:border-blue-500 outline-none"
                                            />
                                            <span className="ml-2 text-xs text-gray-500">Hz</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="flex items-center text-[10px] text-gray-400 mb-1 uppercase tracking-wider">
                                            Low Pass Filter (Hz)
                                            <TooltipIcon text="Digital LPF restricting high-frequency artifacts in the firmware algorithms." />
                                        </label>
                                        <div className="flex items-center">
                                            <input 
                                                type="number"
                                                value={config.vibration_config.low_pass_filter_hz}
                                                onChange={e => setConfig({...config, vibration_config: {...config.vibration_config, low_pass_filter_hz: parseInt(e.target.value)}})}
                                                className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1.5 text-xs text-gray-300 focus:border-blue-500 outline-none"
                                            />
                                            <span className="ml-2 text-xs text-gray-500">Hz</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {error && (
                        <div className="mt-4 p-3 bg-red-900/30 border border-red-800 text-red-200 text-xs rounded">
                            {error}
                        </div>
                    )}
                    {successMessage && (
                        <div className="mt-4 p-3 bg-green-900/30 border border-green-800 text-green-200 text-xs rounded transition-opacity animate-pulse">
                            {successMessage}
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-[#444] bg-[#252526] flex justify-end gap-3 shrink-0">
                    <button 
                        onClick={onClose} 
                        disabled={saving}
                        className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={saving || loading}
                        className={`px-4 py-2 text-sm text-white rounded bg-blue-600 hover:bg-blue-700 transition-colors flex items-center ${saving || loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {saving ? 'Syncing to Device...' : 'Save Configuration'}
                    </button>
                </div>
            </div>
        </div>
    );
}
