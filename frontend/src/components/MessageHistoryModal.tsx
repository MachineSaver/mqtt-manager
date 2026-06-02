import React, { useState, useEffect } from 'react';

type HierarchyNode = {
    id: string;
    name?: string;
    location_designation?: string;
    device_eui?: string;
    type: 'plant' | 'area' | 'sector' | 'machine' | 'component' | 'sensor';
};

interface MessageHistoryModalProps {
    isOpen: boolean;
    node: HierarchyNode | null;
    onClose: () => void;
}

interface MessageRow {
    id: number;
    received_at: string;
    direction: 'uplink' | 'downlink';
    topic: string;
    fport: number;
    packet_type: number | null;
    payload_hex: string;
    payload: any;
}

const getPacketTypeDescription = (fPort: number, packetType: number | null, direction: string) => {
    if (direction === 'downlink') {
        if (fPort === 20) return "Waveform Transfer Command";
        if (fPort === 21) return "FUOTA Data Block";
        if (fPort === 22) return "Request Configuration Sync";
        if (fPort === 30) return "Configuration Write (Settings)";
        if (fPort === 31) return "Configuration Write (Alarms)";
        return `Downlink Port ${fPort}`;
    } else {
        if (typeof packetType === 'number') {
            switch (packetType) {
                case 1: return "Overall Vibration Metric";
                case 2: return "Overall Vibration & Temperature";
                case 3: return "Waveform Header";
                case 4: return "Device Configuration Echo";
                case 5: return "Waveform Data Chunk";
                case 6: return "Waveform Error Event";
                case 7: return "Periodic Wakeup Notification";
                case 17: return "Waveform Checksum (End of Transfer)";
                default: return `Type ${packetType}`;
            }
        }
        return `Uplink Port ${fPort}`;
    }
};

export default function MessageHistoryModal({ isOpen, node, onClose }: MessageHistoryModalProps) {
    const [messages, setMessages] = useState<MessageRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedRow, setExpandedRow] = useState<number | null>(null);

    const fetchMessages = async () => {
        if (!node?.device_eui) return;
        setLoading(true);
        setError(null);
        try {
            const apiUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');
            const res = await fetch(`${apiUrl}/api/devices/${node.device_eui}/messages?limit=250`);
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            const data = await res.json();
            setMessages(Array.isArray(data) ? data : (data.items || []));
        } catch (err: any) {
            console.error("Failed to fetch messages:", err);
            setError("Failed to fetch messages from the server.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchMessages();
            setExpandedRow(null);
        }
    }, [isOpen, node]);

    if (!isOpen || !node) return null;

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1e1e1e] rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col border border-[#3e3e42]">
                
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[#3e3e42] bg-[#252526] shrink-0 rounded-t-lg">
                    <div>
                        <h2 className="text-lg font-bold text-gray-200">
                            Message History: <span className="text-blue-400 font-mono text-base">{node.device_eui}</span>
                        </h2>
                        <div className="text-xs text-gray-500 mt-1">{node.location_designation}</div>
                    </div>
                    <div className="flex gap-2">
                        <button 
                            onClick={fetchMessages}
                            className="bg-[#3e3e42] hover:bg-[#4e4e52] text-gray-300 px-3 py-1.5 rounded transition-colors text-sm flex items-center gap-1"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Refresh
                        </button>
                        <button 
                            onClick={onClose} 
                            className="text-gray-400 hover:text-white bg-transparent hover:bg-red-500/80 px-3 py-1.5 rounded transition-colors text-sm"
                        >
                            Close
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-auto p-4 bg-[#1e1e1e]">
                    {error && (
                        <div className="bg-red-900/40 text-red-400 p-3 mb-4 border border-red-800 rounded text-sm">
                            {error}
                        </div>
                    )}
                    
                    {!loading && messages.length === 0 && !error && (
                        <div className="text-center p-8 text-gray-500 italic">
                            No messages found for this sensor.
                        </div>
                    )}

                    {messages.length > 0 && (
                        <div className="border border-[#3e3e42] rounded overflow-hidden">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-[#2d2d2d] text-gray-300">
                                    <tr>
                                        <th className="py-2.5 px-4 font-semibold border-b border-[#3e3e42] w-[180px]">Timestamp</th>
                                        <th className="py-2.5 px-4 font-semibold border-b border-[#3e3e42] w-[100px]">Dir</th>
                                        <th className="py-2.5 px-4 font-semibold border-b border-[#3e3e42] w-[80px]">Port</th>
                                        <th className="py-2.5 px-4 font-semibold border-b border-[#3e3e42]">Type / Description</th>
                                        <th className="py-2.5 px-4 font-semibold border-b border-[#3e3e42] w-[80px] text-center">Payload</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {messages.map((msg, idx) => {
                                        const isExpanded = expandedRow === msg.id;
                                        const desc = getPacketTypeDescription(msg.fport, msg.packet_type, msg.direction);
                                        const dirColor = msg.direction === 'downlink' ? 'text-blue-400' : 'text-emerald-400';
                                        const isEven = idx % 2 === 0;
                                        
                                        return (
                                            <React.Fragment key={msg.id}>
                                                <tr 
                                                    className={`${isEven ? 'bg-[#252526]' : 'bg-[#1e1e1e]'} hover:bg-[#2a2d33] transition-colors border-b border-[#3e3e42] cursor-pointer`}
                                                    onClick={() => setExpandedRow(isExpanded ? null : msg.id)}
                                                >
                                                    <td className="py-2.5 px-4 text-gray-300 font-mono text-xs whitespace-nowrap">
                                                        {new Date(msg.received_at).toLocaleString('en-US', { hour12: false, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                    </td>
                                                    <td className={`py-2.5 px-4 font-medium capitalize ${dirColor}`}>
                                                        {msg.direction === 'downlink' ? '⬇ Dn' : '⬆ Up'}
                                                    </td>
                                                    <td className="py-2.5 px-4 text-gray-400 font-mono">
                                                        {msg.fport}
                                                    </td>
                                                    <td className="py-2.5 px-4 text-gray-200">
                                                        {desc}
                                                    </td>
                                                    <td className="py-2.5 px-4 text-center">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 mx-auto text-gray-500 transition-transform ${isExpanded ? 'rotate-180 text-blue-400' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="bg-[#181818]">
                                                        <td colSpan={5} className="py-3 px-4 border-b border-[#3e3e42]">
                                                            <div className="mb-2">
                                                                <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Hex Payload</span>
                                                                <div className="mt-1 font-mono text-xs text-blue-300 break-all bg-black/30 p-2 rounded border border-[#3e3e42]">
                                                                    {msg.payload_hex || '—'}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Decoded JSON Object</span>
                                                                <pre className="mt-1 font-mono text-[11px] text-emerald-300 bg-black/30 p-3 rounded border border-[#3e3e42] overflow-x-auto">
                                                                    {msg.payload ? JSON.stringify(msg.payload, null, 2) : 'No decoded payload available'}
                                                                </pre>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
