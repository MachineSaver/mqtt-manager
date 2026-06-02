"use client";

import { useState, useEffect } from 'react';
import { SocketProvider, useSocket } from './SocketContext';
import MQTTMonitor from '@/components/MQTTMonitor';
import WaveformsView from '@/components/WaveformsView';
import FUOTAManager from '@/components/FUOTAManager';
import DevTools from '@/components/DevTools';
import Historian from '@/components/Historian';
import AnalysisDashboard from '@/components/AnalysisDashboard';

function AppContent() {
  const { connected, messages, socket } = useSocket();
  const [activeView, setActiveView] = useState<'mqtt' | 'waveforms' | 'fuota' | 'devtools' | 'historian' | 'analysis' | 'docs'>('mqtt');
  const apiUrl = (typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'));
  
  const [configNotification, setConfigNotification] = useState<{devEui: string, time: string} | null>(null);

  useEffect(() => {
    if (messages.length > 0) {
      const latestMsg = messages[0];
      try {
        const payload = JSON.parse(latestMsg.payload);
        // Depending on backend structure, data might be nested inside "object" (ChirpStack v4) or direct
        const dataObj = payload.object || payload;
        
        if (dataObj && dataObj.packet_type === 4) {
          const devEui = payload.deviceInfo?.devEui || payload.devEui || 'Unknown Device';
          setConfigNotification({ devEui, time: new Date().toLocaleTimeString() });
          
          // Auto clear after 10 seconds
          setTimeout(() => setConfigNotification(null), 10000);
        }
      } catch(e) { /* ignore parse errors */ }
    }
  }, [messages]);

  return (
    <div className="flex h-screen bg-[#1e1e1e] text-gray-300 font-sans">
      {/* Sidebar */}
      <div className="w-16 bg-[#252526] flex flex-col items-center py-4 border-r border-[#333]">
        {/* MQTT Live Data */}
        <button
          onClick={() => setActiveView('mqtt')}
          className={`p-3 mb-2 rounded-lg ${activeView === 'mqtt' ? 'bg-[#37373d] text-green-500' : 'hover:bg-[#2d2d2d]'}`}
          title="MQTT Live Data"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </button>

        {/* Waveforms */}
        <button
          onClick={() => setActiveView('waveforms')}
          className={`p-3 mb-2 rounded-lg ${activeView === 'waveforms' ? 'bg-[#37373d] text-purple-500' : 'hover:bg-[#2d2d2d]'}`}
          title="Waveforms"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </button>

        {/* FUOTA */}
        <button
          onClick={() => setActiveView('fuota')}
          className={`p-3 mb-2 rounded-lg ${activeView === 'fuota' ? 'bg-[#37373d] text-amber-500' : 'hover:bg-[#2d2d2d]'}`}
          title="FUOTA Manager"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </button>

        {/* Dev Tools */}
        <button
          onClick={() => setActiveView('devtools')}
          className={`p-3 mb-2 rounded-lg ${activeView === 'devtools' ? 'bg-[#37373d] text-cyan-500' : 'hover:bg-[#2d2d2d]'}`}
          title="Dev Tools"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </button>

        {/* Historian */}
        <button
          onClick={() => setActiveView('historian')}
          className={`p-3 mb-2 rounded-lg ${activeView === 'historian' ? 'bg-[#37373d] text-yellow-500' : 'hover:bg-[#2d2d2d]'}`}
          title="Historian"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        {/* Analysis */}
        <button
          onClick={() => setActiveView('analysis')}
          className={`p-3 mb-2 rounded-lg ${activeView === 'analysis' ? 'bg-[#37373d] text-emerald-400' : 'hover:bg-[#2d2d2d] text-gray-400'}`}
          title="Analysis"
        >
          <div className="h-6 w-6 flex items-center justify-center text-xl font-bold font-serif">A</div>
        </button>

        {/* API Docs */}
        <button
          onClick={() => setActiveView('docs')}
          className={`p-3 mb-2 rounded-lg ${activeView === 'docs' ? 'bg-[#37373d] text-indigo-400' : 'hover:bg-[#2d2d2d]'}`}
          title="API Documentation"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.747 0-3.332.477-4.5 1.253" />
          </svg>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-12 bg-[#252526] border-b border-[#333] flex items-center px-4 justify-between shrink-0">
          <h1 className="font-semibold text-sm text-gray-200">
            {activeView === 'mqtt' ? 'MQTT Live Data'
              : activeView === 'waveforms' ? 'Waveform Manager'
              : activeView === 'fuota' ? 'FUOTA Manager'
              : activeView === 'devtools' ? 'Dev Tools'
              : activeView === 'historian' ? 'Historian'
              : activeView === 'analysis' ? 'Analysis Dashboard'
              : 'API Documentation'}
          </h1>
          <div className="flex items-center space-x-2">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            <span className="text-xs text-gray-500">{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>

        {/* View Content */}
        <div className="flex-1 overflow-hidden relative">
          {activeView === 'mqtt' && (
            <div className="absolute inset-0 overflow-auto">
              <MQTTMonitor messages={messages} socket={socket} />
            </div>
          )}

          {activeView === 'waveforms' && <WaveformsView />}

          {activeView === 'fuota' && <FUOTAManager socket={socket} />}

          {activeView === 'devtools' && <DevTools />}

          {activeView === 'historian' && <Historian />}

          {activeView === 'analysis' && <AnalysisDashboard />}

          {activeView === 'docs' && (
            <iframe
              src={`${apiUrl}/api/docs/`}
              className="absolute inset-0 w-full h-full border-0"
              title="API Documentation"
            />
          )}
        </div>

        {/* Build Info Footer */}
        <div className="h-7 flex items-center justify-center border-t border-[#333] bg-[#252526] shrink-0">
          <span className="text-[11px] text-gray-400 font-mono tracking-wide">
            build {process.env.NEXT_PUBLIC_BUILD_HASH} &bull; {process.env.NEXT_PUBLIC_BUILD_DATE} UTC
          </span>
        </div>
      </div>

      {/* Global Config Notification Overlay */}
      {configNotification && (
        <div className="fixed bottom-10 right-10 z-[200] max-w-sm w-full bg-emerald-900/90 border border-emerald-500 rounded-lg shadow-[0_0_20px_rgba(16,185,129,0.3)] p-4 text-emerald-100 flex items-start space-x-3 isolate overflow-hidden transform transition-all duration-500 ease-in-out">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-400/10 to-transparent -translate-x-full animate-pulse"></div>
          
          <div className="flex-shrink-0 pt-0.5">
            <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold tracking-wider text-emerald-300 uppercase mb-1">Configuration Synced</h3>
            <p className="text-xs leading-relaxed text-emerald-100/90">
              Sensor <span className="font-mono bg-emerald-950/50 px-1 rounded text-emerald-400">{configNotification.devEui}</span> just acknowledged config uplink at {configNotification.time}.
            </p>
          </div>
          <button onClick={() => setConfigNotification(null)} className="flex-shrink-0 text-emerald-500 hover:text-emerald-300 transition-colors">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <SocketProvider>
      <AppContent />
    </SocketProvider>
  );
}
