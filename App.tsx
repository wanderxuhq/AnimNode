import React, { useRef, useState, useEffect } from 'react';
import { Timeline } from './components/Timeline';
import { PropertyPanel } from './components/PropertyPanel';
import { Viewport } from './components/Viewport';
import { NodeGraph } from './components/NodeGraph';
import { Toolbar } from './components/Toolbar';
import { useProject } from './hooks/useProject';
import { audioController } from './services/audio';
import { exportToPNG, exportToSVG } from './services/export';
import { Square, Circle, Download, Layout, Layers, Volume2, Network, Cpu, Image, FileImage, FileJson, GripVertical } from 'lucide-react';

export default function App() {
  const { 
    project, 
    projectRef, 
    updateProperty, 
    updateMeta,
    addNode, 
    renameNode,
    selectNode,
    moveNode,
    togglePlay, 
    setTime,
    setTool
  } = useProject();

  const [propViewMode, setPropViewMode] = useState<'ui' | 'json'>('ui');
  const [focusTarget, setFocusTarget] = useState<{nodeId: string, propKey: string, timestamp: number} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard Shortcuts
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
          if (e.key.toLowerCase() === 'v') setTool('select');
          if (e.key.toLowerCase() === 'p') setTool('pen');
          if (e.code === 'Space') {
             e.preventDefault();
             togglePlay();
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, setTool]);

  const handleExportJSON = () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(project, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href",     dataStr);
      downloadAnchorNode.setAttribute("download", "project.animnode");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
  };
  
  const handleExportPNG = () => {
      exportToPNG(projectRef.current);
  };

  const handleExportSVG = () => {
      exportToSVG(projectRef.current);
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

  const setRenderer = (mode: 'svg' | 'webgpu') => {
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

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('sourceIndex', index.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const sourceIndexStr = e.dataTransfer.getData('sourceIndex');
    if (!sourceIndexStr) return;
    
    const sourceIndex = parseInt(sourceIndexStr, 10);
    if (isNaN(sourceIndex)) return;
    
    moveNode(sourceIndex, dropIndex);
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
            
             {/* Simple Hints */}
             <div className="flex items-center gap-4 text-[10px] text-zinc-600 font-mono ml-4 hidden md:flex">
                <span>[Space] Play/Pause</span>
                <span>[V] Select Tool</span>
                <span>[P] Pen Tool</span>
            </div>
        </div>
        
        <div className="flex items-center gap-3">
             <div className="flex bg-zinc-800 rounded p-0.5">
                <button onClick={() => setRenderer('svg')} className={`px-2 py-0.5 text-[10px] rounded ${project.meta.renderer === 'svg' ? 'bg-zinc-600 text-white' : 'text-zinc-500'}`}>SVG</button>
                <button onClick={() => setRenderer('webgpu')} className={`px-2 py-0.5 text-[10px] rounded flex items-center gap-1 ${project.meta.renderer === 'webgpu' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
                    <Cpu size={10} /> WebGPU
                </button>
             </div>
             
             <div className="h-4 w-px bg-zinc-700" />

             <div className="flex bg-zinc-800 rounded p-0.5 items-center">
                 <button 
                    onClick={handleExportJSON}
                    className="text-zinc-400 hover:text-white hover:bg-zinc-700 px-2 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                    title="Save Project (JSON)"
                 >
                    <FileJson size={14} />
                 </button>
                 <div className="w-px h-3 bg-zinc-700 mx-1"></div>
                 <button 
                    onClick={handleExportSVG}
                    className="text-zinc-400 hover:text-white hover:bg-zinc-700 px-2 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                    title="Export Frame as SVG"
                 >
                    <FileImage size={14} />
                 </button>
                 <button 
                    onClick={handleExportPNG}
                    className="text-zinc-400 hover:text-white hover:bg-zinc-700 px-2 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                    title="Export Frame as PNG"
                 >
                    <Image size={14} />
                 </button>
             </div>
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
                    {project.rootNodeIds.map((id, index) => ({ id, index })).reverse().map(({ id, index }) => (
                        <div 
                            key={id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, index)}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, index)}
                            onClick={() => handleNodeSelect(id, 'ui')}
                            className={`px-3 py-2 rounded text-sm cursor-pointer flex items-center gap-2 transition-all group ${project.selection === id ? 'bg-indigo-900/50 text-indigo-100 border border-indigo-700/50' : 'hover:bg-zinc-800 text-zinc-400 border border-transparent'}`}
                        >
                            <GripVertical size={12} className="text-zinc-600 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing shrink-0" />
                            
                            {project.nodes[id].type === 'rect' ? <Square size={12}/> : 
                             project.nodes[id].type === 'circle' ? <Circle size={12}/> :
                             <Layout size={12} className="text-emerald-500"/>}
                            <span className="truncate flex-1">{project.nodes[id].name}</span>
                            <span className="text-[10px] text-zinc-600 font-mono shrink-0 opacity-50">{id}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>

        {/* Toolbar - Only visible in Viewport mode */}
        {!isGraphMode && (
             <Toolbar 
                activeTool={project.meta.activeTool}
                onSetTool={setTool}
                onAddNode={addNode} 
                onAddAudio={() => fileInputRef.current?.click()} 
             />
        )}

        {/* Center Viewport - Hidden in Graph Mode */}
        {!isGraphMode && (
             <Viewport 
                projectRef={projectRef} 
                onSelect={(id) => id ? handleNodeSelect(id) : selectNode(null)}
                onUpdate={updateProperty}
                selection={project.selection}
                onAddNode={addNode}
             />
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