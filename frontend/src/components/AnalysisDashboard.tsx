'use client';

import React, { useState, useEffect } from 'react';
import AnalysisCharts from './AnalysisCharts';
import HierarchyFormModal from './HierarchyFormModal';
import DeviceConfigModal from './DeviceConfigModal';
import MessageHistoryModal from './MessageHistoryModal';

// Define the types based on our backend API
type HierarchyNode = {
    id: string;
    name?: string;
    location_designation?: string;
    device_eui?: string;
    type: 'plant' | 'area' | 'sector' | 'machine' | 'component' | 'sensor';
    children?: HierarchyNode[];
};

export default function AnalysisDashboard() {
    const [hierarchy, setHierarchy] = useState<HierarchyNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const [selectedSensor, setSelectedSensor] = useState<HierarchyNode | null>(null);

    // Context Menu & Modal State
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, node: HierarchyNode } | null>(null);
    const [modalConfig, setModalConfig] = useState<{ mode: 'add' | 'edit', node: HierarchyNode } | null>(null);
    const [configModalNode, setConfigModalNode] = useState<HierarchyNode | null>(null);
    const [messageHistoryNode, setMessageHistoryNode] = useState<HierarchyNode | null>(null);

    // Hide context menu on outside click
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    const handleContextMenu = (e: React.MouseEvent, node: HierarchyNode) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, node });
    };

    const handleAddChild = () => {
        if (!contextMenu) return;
        setModalConfig({ mode: 'add', node: contextMenu.node });
        setContextMenu(null);
    };

    const handleEdit = () => {
        if (!contextMenu) return;
        setModalConfig({ mode: 'edit', node: contextMenu.node });
        setContextMenu(null);
    };

    const handleConfig = () => {
        if (!contextMenu) return;
        setConfigModalNode(contextMenu.node);
        setContextMenu(null);
    };

    const handleMessageHistory = () => {
        if (!contextMenu) return;
        setMessageHistoryNode(contextMenu.node);
        setContextMenu(null);
    };

    const fetchHierarchy = async () => {
        try {
            const apiUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000');
            const res = await fetch(`${apiUrl}/api/hierarchy`);
            if (!res.ok) throw new Error('Failed to fetch hierarchy');
            const data = await res.json();
            setHierarchy(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHierarchy();
    }, []);

    const toggleNode = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedNodes(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    };

    const handleNodeClick = (node: HierarchyNode) => {
        if (node.type === 'sensor') {
            setSelectedSensor(node);
        }
    };

    const renderTree = (nodes: HierarchyNode[], level = 0) => {
        return nodes.map(node => {
            const isExpanded = expandedNodes.has(node.id);
            const isSensor = node.type === 'sensor';
            const hasChildren = node.children && node.children.length > 0;
            const isSelected = selectedSensor?.id === node.id;
            
            const displayName = isSensor ? `${node.location_designation} (${node.device_eui})` : node.name;

            return (
                <div key={node.id} className="select-none">
                    <div 
                        className={`flex items-center py-1.5 px-2 cursor-pointer rounded transition-colors ${isSelected ? 'bg-blue-600/30 text-blue-300' : 'hover:bg-[#2a2a2b]'}`}
                        style={{ paddingLeft: `${ level * 1.5 + 0.5 }rem` }}
                        onClick={(e) => {
                            if (hasChildren) toggleNode(node.id, e);
                            handleNodeClick(node);
                        }}
                        onContextMenu={(e) => handleContextMenu(e, node)}
                    >
                        <span className="w-5 flex items-center justify-center shrink-0">
                            {hasChildren && (
                                <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                </svg>
                            )}
                            {!hasChildren && isSensor && (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                                </svg>
                            )}
                        </span>
                        <span className={`text-[13px] truncate ${isSensor ? 'text-gray-400 font-mono text-xs' : 'text-gray-300'} ${isSelected ? 'font-semibold text-blue-300' : ''}`}>
                            {displayName}
                        </span>
                    </div>
                    {isExpanded && hasChildren && (
                        <div>
                            {renderTree(node.children!, level + 1)}
                        </div>
                    )}
                </div>
            );
        });
    };

    return (
        <div className="flex h-full w-full bg-[#1e1e1e] text-gray-300">
            {/* Sidebar tree view */}
            <div className="w-1/4 min-w-[300px] border-r border-[#333] flex flex-col shrink-0">
                <div className="p-3 border-b border-[#333] bg-[#252526] shrink-0">
                    <h2 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">Asset Hierarchy</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                    {loading && <div className="text-xs text-gray-500 italic p-2">Loading hierarchy...</div>}
                    {error && <div className="text-xs text-red-400 p-2">{error}</div>}
                    {!loading && !error && hierarchy.length === 0 && <div className="text-xs text-gray-500 p-2">No assets found.</div>}
                    {!loading && !error && renderTree(hierarchy)}
                </div>
            </div>
            
            {/* Main content area */}
            <div className="flex-1 flex flex-col bg-[#252526] overflow-y-auto">
                {selectedSensor ? (
                    <div className="p-6">
                        <div className="flex items-end gap-4 mb-6">
                            <h2 className="text-2xl font-bold text-white">{selectedSensor.location_designation}</h2>
                            <div className="text-sm text-gray-500 font-mono pb-1">
                                {selectedSensor.device_eui}
                            </div>
                        </div>
                        
                        {/* Charts Area */}
                        <div className="flex-1 mt-6 h-[800px]">
                            <AnalysisCharts deviceEui={selectedSensor.device_eui!} />
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        Select a sensor from the hierarchy to view analysis data
                    </div>
                )}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div 
                    className="fixed bg-[#2d2d2d] border border-[#444] rounded shadow-xl py-1 z-50 min-w-[120px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    {contextMenu.node.type !== 'sensor' && (
                        <button 
                            className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-blue-600 transition-colors"
                            onClick={handleAddChild}
                        >
                            Add Child
                        </button>
                    )}
                    <button 
                        className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-blue-600 transition-colors"
                        onClick={handleEdit}
                    >
                        Edit
                    </button>
                    {contextMenu.node.type === 'sensor' && (
                        <>
                            <button 
                                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-purple-600 transition-colors"
                                onClick={handleConfig}
                            >
                                Config
                            </button>
                            <button 
                                className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-emerald-600 transition-colors border-t border-[#444]"
                                onClick={handleMessageHistory}
                            >
                                Message History
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Form Modal */}
            <HierarchyFormModal 
                isOpen={!!modalConfig}
                mode={modalConfig?.mode || 'edit'}
                targetNode={modalConfig?.node || null}
                hierarchyData={hierarchy}
                onClose={() => setModalConfig(null)}
                onSave={() => {
                    fetchHierarchy();
                }}
            />

            {/* Device Config Modal */}
            <DeviceConfigModal
                isOpen={!!configModalNode}
                node={configModalNode}
                onClose={() => setConfigModalNode(null)}
            />

            {/* Message History Modal */}
            <MessageHistoryModal
                isOpen={!!messageHistoryNode}
                node={messageHistoryNode}
                onClose={() => setMessageHistoryNode(null)}
            />
        </div>
    );
}
