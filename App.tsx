
import React, { useRef, useState } from 'react';
import { Timeline } from './components/Timeline';
import { PropertyPanel } from './components/PropertyPanel';
import { Viewport } from './components/Viewport';
import { NodeGraph } from './components/NodeGraph';
import { useProject } from './hooks/useProject';
import { audioController } from './services/audio';
import { Square, Circle, Download, Layout, Layers, Volume2, Network } from 'lucide-react';

export default function App() {
  const { 
    project, 
    projectRef, 
    updateProperty, 
    updateMeta,
    addNode, 
    renameNode,
    selectNode, 
    togglePlay, 
    setTime 
  } = useProject();

  const [propViewMode, setPropViewMode] = useState<'ui' | 'json'>('ui');
  const [focusTarget, setFocusTarget] = useState<{nodeId: string, propKey: string, timestamp: number} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportJSON = () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(project, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href",     dataStr);
      downloadAnchorNode.setAttribute("download", "project.animnode");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const { buffer, waveform } = await audioController.loadFile(file);
        projectRef.current.audio = {
            hasAudio: true,
            fileName: file.name,
            buffer: buffer,
            waveform: waveform
        };
        // Force update via meta to ensure UI reflects audio presence
        updateMeta({});
    }
  };

  const setViewMode = (mode: 'list' | 'graph') => {
      updateMeta({ viewMode: mode });
  };

  const setRenderer = (mode: 'canvas' | 'svg') => {
      updateMeta({ renderer: mode });
  };

  const handleNodeSelect = (id: string, view: 'ui' | 'json' = 'ui') => {
      selectNode(id);
      setPropViewMode(view);
  };

  const handleJumpToSource = (nodeId: string, propKey: string) => {
      selectNode(nodeId);
      setPropViewMode('ui'); 
      setFocusTarget({ nodeId, propKey, timestamp: Date.now() });
  };

  const isGraphMode = project.meta.viewMode === 'graph';

  return (
    <div className="flex flex-col h-screen w-full bg-black text-zinc-300 font-sans overflow-hidden">
      <input type="file" ref={fileInputRef} className="hidden" accept="audio/*" onChange={handleAudioUpload} />

      {/* Header */}
      <div className="h-12 bg-zinc-900 border-b border-zinc-700 flex items-center px-4 justify-between shrink-0 z-50 relative shadow-md">
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-indigo-400 font-bold tracking-tight select-none">
                <Layout className="w-5 h-5" />
                <span>AnimNode</span>
            </div>
            <div className="h-6 w-px bg-zinc-700 mx-2"></div>
            <button onClick={() => addNode('rect')} className="p-1.5 hover:bg-zinc-800 rounded flex gap-2 items-center text-xs text-zinc-300 transition-colors">
                <Square size={14} /> <span className="hidden sm:inline">Add Rect</span>
            </button>
             <button onClick={() => addNode('circle')} className="p-1.5 hover:bg-zinc-800 rounded flex gap-2 items-center text-xs text-zinc-300 transition-colors">
                <Circle size={14} /> <span className="hidden sm:inline">Add Circle</span>
            </button>
             <button onClick={() => fileInputRef.current?.click()} className="p-1.5 hover:bg-zinc-800 rounded flex gap-2 items-center text-xs text-zinc-300 transition-colors">
                <Volume2 size={14} /> <span className="hidden sm:inline">Add Audio</span>
            </button>
        </div>
        
        <div className="flex items-center gap-2">
             <div className="flex bg-zinc-800 rounded p-0.5 mr-2">
                <button onClick={() => setRenderer('canvas')} className={`px-2 py-0.5 text-[10px] rounded ${project.meta.renderer === 'canvas' ? 'bg-zinc-600 text-white' : 'text-zinc-500'}`}>Canvas</button>
                <button onClick={() => setRenderer('svg')} className={`px-2 py-0.5 text-[10px] rounded ${project.meta.renderer === 'svg' ? 'bg-zinc-600 text-white' : 'text-zinc-500'}`}>SVG</button>
             </div>
             <button 
                onClick={handleExportJSON}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded text-xs font-medium flex items-center gap-2 transition-colors"
             >
                <Download size={14} /> JSON
             </button>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Left Panel (Layer List) OR Full Screen Graph */}
        <div className={`bg-zinc-900 border-r border-zinc-700 flex flex-col z-20 transition-all duration-300 ${isGraphMode ? 'absolute inset-0 z-40' : 'w-64 relative'}`}>
            
            {/* Panel Header - Always visible and Z-indexed above the graph */}
            <div className={`p-3 border-b border-zinc-800 text-xs font-bold text-zinc-500 uppercase flex items-center gap-4 select-none bg-zinc-900 shrink-0 z-50 relative ${isGraphMode ? 'shadow-lg' : ''}`}>
                <div className="flex gap-2 items-center min-w-fit">
                    {isGraphMode ? <Network size={14} /> : <Layers size={14} />} 
                    {isGraphMode ? 'Node Graph' : 'Scene Graph'}
                </div>
                {/* View Toggles - Moved to left side so they aren't blocked by Right Panel */}
                <div className="flex bg-zinc-800 rounded p-0.5">
                    <button onClick={() => setViewMode('list')} className={`p-1 rounded ${!isGraphMode ? 'bg-zinc-600 text-white' : 'text-zinc-500'}`} title="List View"><Layers size={12}/></button>
                    <button onClick={() => setViewMode('graph')} className={`p-1 rounded ${isGraphMode ? 'bg-zinc-600 text-white' : 'text-zinc-500'}`} title="Graph View"><Network size={12}/></button>
                </div>
            </div>
            
            {/* Content */}
            {isGraphMode ? (
                <NodeGraph project={project} onSelect={handleNodeSelect} />
            ) : (
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {project.rootNodeIds.map(id => (
                        <div 
                            key={id}
                            onClick={() => handleNodeSelect(id, 'ui')}
                            className={`px-3 py-2 rounded text-sm cursor-pointer flex items-center gap-2 transition-all ${project.selection === id ? 'bg-indigo-900/50 text-indigo-100 border border-indigo-700/50' : 'hover:bg-zinc-800 text-zinc-400 border border-transparent'}`}
                        >
                            {project.nodes[id].type === 'rect' ? <Square size={12}/> : <Circle size={12}/>}
                            {project.nodes[id].name}
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* Center Viewport - Hidden in Graph Mode */}
        {!isGraphMode && (
             <Viewport projectRef={projectRef} />
        )}

        {/* Right Properties Panel */}
        {/* In Graph mode, it floats on top right */}
        <div className={`z-50 h-full border-l border-zinc-700 bg-zinc-900 transition-all ${isGraphMode ? 'absolute right-0 w-96 shadow-2xl border-l-2 border-zinc-800' : 'w-80 relative'}`}>
             <PropertyPanel 
                nodes={project.nodes} 
                selection={project.selection} 
                onUpdateProperty={updateProperty}
                onRenameNode={renameNode}
                viewMode={propViewMode}
                onViewModeChange={setPropViewMode}
                focusTarget={focusTarget}
                />
        </div>
      </div>

      {/* Bottom Timeline */}
      <Timeline 
        project={project} 
        onTimeChange={setTime} 
        onTogglePlay={togglePlay}
        onJumpToSource={handleJumpToSource} 
      />
    </div>
  );
}
