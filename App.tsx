import React, { useRef, useState, useEffect } from 'react';
import { Timeline } from './components/Timeline';
import { PropertyPanel } from './components/PropertyPanel';
import { Viewport } from './components/Viewport';
import { NodeGraph } from './components/NodeGraph';
import { Toolbar } from './components/Toolbar';
import { useProject } from './hooks/useProject';
import { audioController } from './services/audio';
import { exportToPNG, exportToSVG } from './services/export';
import { Square, Circle, Download, Layout, Layers, Volume2, Network, Cpu, Image, FileImage, FileJson, GripVertical, History as HistoryIcon, Bug } from 'lucide-react';
import { HistoryPanel } from './components/HistoryPanel';
import { DebugPanel } from './components/DebugPanel';

export default function App() {
  const { 
    project, 
    projectRef, 
    history,
    commit,
    undo,
    redo,
    jumpToHistory,
    updateProperty, 
    updateMeta,
    addNode, 
    removeNode,
    renameNode,
    selectNode,
    moveNode,
    togglePlay, 
    setTime,
    setTool,
    runScript
  } = useProject();

  const [propViewMode, setPropViewMode] = useState<'ui' | 'json'>('ui');
  const [rightPanelMode, setRightPanelMode] = useState<'props' | 'history'>('props');
  const [focusTarget, setFocusTarget] = useState<{nodeId: string, propKey: string, timestamp: number} | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  
  // Drag & Drop State
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<'top' | 'bottom' | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard Shortcuts
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          const target = e.target as HTMLElement;
          const isInput = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
          
          // Check if this input explicitly allows global undo (e.g. property fields)
          const isUndoableInput = target.getAttribute('data-undoable') === 'true';
          const isColorInput = (target as HTMLInputElement).type === 'color';
          
          // Allow if it's NOT an input, OR if it's explicitly marked undoable, OR if it's a color input
          const shouldAllowUndo = !isInput || isUndoableInput || isColorInput;

          // Undo / Redo (Global)
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
              if (shouldAllowUndo) {
                  e.preventDefault(); // Prevent browser native undo if we handle it
                  
                  // NOTE: We do NOT force blur here anymore.
                  // PropertyInput handles its own "Dirty" vs "Clean" state.
                  // If "Dirty", PropertyInput cancels edit and stops propagation.
                  // If "Clean", PropertyInput bubbles, and we arrive here.
                  // Since we are Clean, we can safely Undo history without forcing a commit.
                  
                  if (e.shiftKey) {
                      redo();
                  } else {
                      undo();
                  }
              }
              return;
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
              if (shouldAllowUndo) {
                  e.preventDefault();
                  if (isInput) target.blur();
                  redo();
              }
              return;
          }

          // Delete
          if (e.key === 'Delete' || e.key === 'Backspace') {
             if (!isInput && projectRef.current.selection) {
                 e.preventDefault();
                 removeNode(projectRef.current.selection);
                 return;
             }
          }

          if (isInput) return;
          if (e.key.toLowerCase() === 'v') setTool('select');
          if (e.key.toLowerCase() === 'p') setTool('pen');
          if (e.code === 'Space') {
             e.preventDefault();
             togglePlay();
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, setTool, undo, redo, removeNode]);

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
      setRightPanelMode('props'); 
  };

  const handleJumpToSource = (nodeId: string, propKey: string) => {
      selectNode(nodeId);
      setPropViewMode('ui'); 
      setRightPanelMode('props');
      setFocusTarget({ nodeId, propKey, timestamp: Date.now() });
  };

  // --- DRAG AND DROP HANDLERS ---

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('sourceIndex', index.toString());
    e.dataTransfer.effectAllowed = 'move';
    // Transparent ghost image if desired, but default is usually fine
  };

  const handleDragOver = (e: React.DragEvent, targetId: string, targetIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    // Calculate if we are in the top or bottom half of the item
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? 'top' : 'bottom';
    
    setDragOverId(targetId);
    setDragPosition(pos);
  };

  const handleDragLeave = () => {
      setDragOverId(null);
      setDragPosition(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    setDragOverId(null);
    setDragPosition(null);

    const sourceIndexStr = e.dataTransfer.getData('sourceIndex');
    if (!sourceIndexStr) return;
    
    const sourceIndex = parseInt(sourceIndexStr, 10);
    if (isNaN(sourceIndex)) return;
    
    if (sourceIndex === targetIndex) return;

    // Logic for insertion
    // The list is displayed in REVERSE order (Highest Index = Visual Top)
    // "Top" of visual item means "Higher Z-index" -> Higher Array Index
    // "Bottom" of visual item means "Lower Z-index" -> Lower Array Index
    
    // Visual Top (Above Item) -> Insert After (Index + 1)
    // Visual Bottom (Below Item) -> Insert At (Index)
    
    let insertionIndex = targetIndex;
    if (dragPosition === 'top') {
        insertionIndex = targetIndex + 1;
    }

    // Adjustment: If we remove an item from a lower index, all subsequent indices shift down.
    // If the insertion point is higher than the source, we need to account for that shift 
    // to land in the visually intended spot.
    
    if (sourceIndex < insertionIndex) {
        insertionIndex -= 1;
    }

    moveNode(sourceIndex, insertionIndex);
  };

  const isGraphMode = project.meta.viewMode === 'graph';

  return (
    <div className="flex flex-col h-screen w-full bg-black text-zinc-300 font-sans overflow-hidden">
      <input type="file" ref={fileInputRef} className="hidden" accept="audio/*" onChange={handleAudioUpload} />
      
      {showDebug && <DebugPanel project={project} history={history} onClose={() => setShowDebug(false)} />}

      {/* Header */}
      <div className="h-12 bg-zinc-900 border-b border-zinc-700 flex items-center px-4 justify-between shrink-0 z-50 relative shadow-md">
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-indigo-400 font-bold tracking-tight select-none">
                <Layout className="w-5 h-5" />
                <span>AnimNode</span>
            </div>
            
             <div className="flex items-center gap-4 text-[10px] text-zinc-600 font-mono ml-4 hidden md:flex">
                <span>[Space] Play/Pause</span>
                <span>[V] Select Tool</span>
                <span>[P] Pen Tool</span>
                <span>[Delete] Remove</span>
                <span>[Ctrl+Z] Undo</span>
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
             
             {/* Tools / Export */}
             <div className="flex bg-zinc-800 rounded p-0.5 items-center">
                 <button 
                    onClick={() => setShowDebug(!showDebug)}
                    className={`text-zinc-400 hover:text-white hover:bg-zinc-700 px-2 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors ${showDebug ? 'text-indigo-400 bg-indigo-900/30' : ''}`}
                    title="Toggle Debug Panel"
                 >
                    <Bug size={14} />
                 </button>
                 <div className="w-px h-3 bg-zinc-700 mx-1"></div>
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
            
            <div className={`p-3 border-b border-zinc-800 text-xs font-bold text-zinc-500 uppercase flex items-center gap-4 select-none bg-zinc-900 shrink-0 z-50 relative ${isGraphMode ? 'shadow-lg' : ''}`}>
                <div className="flex gap-2 items-center min-w-fit">
                    {isGraphMode ? <Network size={14} /> : <Layers size={14} />} 
                    {isGraphMode ? 'Node Graph' : 'Scene Graph'}
                </div>
                <div className="flex bg-zinc-800 rounded p-0.5">
                    <button onClick={() => setViewMode('list')} className={`p-1 rounded ${!isGraphMode ? 'bg-zinc-600 text-white' : 'text-zinc-500'}`} title="List View"><Layers size={12}/></button>
                    <button onClick={() => setViewMode('graph')} className={`p-1 rounded ${isGraphMode ? 'bg-zinc-600 text-white' : 'text-zinc-500'}`} title="Graph View"><Network size={12}/></button>
                </div>
            </div>
            
            {/* Layer List with Drag & Drop */}
            {isGraphMode ? (
                <NodeGraph project={project} onSelect={handleNodeSelect} />
            ) : (
                <div className="flex-1 overflow-y-auto p-2 space-y-1 relative" onDragLeave={handleDragLeave}>
                    {/* Reverse map to show Top layer at Top of list */}
                    {project.rootNodeIds.map((id, index) => ({ id, index })).reverse().map(({ id, index }) => {
                         const isDragTarget = dragOverId === id;
                         return (
                            <div 
                                key={id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragOver={(e) => handleDragOver(e, id, index)}
                                onDrop={(e) => handleDrop(e, index)}
                                onClick={() => handleNodeSelect(id, 'ui')}
                                className={`px-3 py-2 rounded text-sm cursor-pointer flex items-center gap-2 transition-all group relative border border-transparent 
                                    ${project.selection === id ? 'bg-indigo-900/50 text-indigo-100 border-indigo-700/50' : 'hover:bg-zinc-800 text-zinc-400'}
                                `}
                            >
                                {/* Drag Indicator Line */}
                                {isDragTarget && dragPosition === 'top' && (
                                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full z-10 pointer-events-none transform -translate-y-[2px] shadow-[0_0_4px_rgba(99,102,241,1)]" />
                                )}
                                {isDragTarget && dragPosition === 'bottom' && (
                                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full z-10 pointer-events-none transform translate-y-[2px] shadow-[0_0_4px_rgba(99,102,241,1)]" />
                                )}

                                <GripVertical size={12} className="text-zinc-600 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing shrink-0" />
                                <span className="text-[10px] text-zinc-600 font-mono shrink-0 select-none mr-1 opacity-50">#{index}</span>
                                
                                {project.nodes[id].type === 'rect' ? <Square size={12}/> : 
                                 project.nodes[id].type === 'circle' ? <Circle size={12}/> :
                                 <Layout size={12} className="text-emerald-500"/>}
                                
                                <span className="truncate flex-1 font-mono text-xs">{id}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>

        {!isGraphMode && (
             <Toolbar 
                activeTool={project.meta.activeTool}
                onSetTool={setTool}
                onAddNode={addNode} 
                onAddAudio={() => fileInputRef.current?.click()} 
             />
        )}

        {!isGraphMode && (
             <Viewport 
                projectRef={projectRef} 
                onSelect={(id) => id ? handleNodeSelect(id) : selectNode(null)}
                onUpdate={updateProperty}
                onCommit={commit} 
                selection={project.selection}
                onAddNode={addNode}
             />
        )}

        {/* Right Panel */}
        <div className={`z-50 h-full border-l border-zinc-700 bg-zinc-900 transition-all flex flex-col ${isGraphMode ? 'absolute right-0 w-96 shadow-2xl border-l-2 border-zinc-800' : 'w-80 relative'}`}>
             
             {/* Tab Switcher */}
             <div className="flex border-b border-zinc-800 bg-zinc-950 shrink-0">
                 <button 
                    onClick={() => setRightPanelMode('props')}
                    className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${rightPanelMode === 'props' ? 'bg-zinc-900 text-zinc-200 border-b-2 border-indigo-500' : 'text-zinc-600 hover:text-zinc-400'}`}
                 >
                     Properties
                 </button>
                 <button 
                    onClick={() => setRightPanelMode('history')}
                    className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide transition-colors flex items-center justify-center gap-2 ${rightPanelMode === 'history' ? 'bg-zinc-900 text-zinc-200 border-b-2 border-indigo-500' : 'text-zinc-600 hover:text-zinc-400'}`}
                 >
                     <HistoryIcon size={12} /> History
                 </button>
             </div>

             <div className="flex-1 overflow-hidden relative">
                {rightPanelMode === 'props' ? (
                     <PropertyPanel 
                        nodes={project.nodes} 
                        selection={project.selection} 
                        onUpdateProperty={updateProperty}
                        onCommit={commit} 
                        onRenameNode={renameNode}
                        onDeleteNode={removeNode}
                        viewMode={propViewMode}
                        onViewModeChange={setPropViewMode}
                        focusTarget={focusTarget}
                    />
                ) : (
                    <HistoryPanel 
                        history={history}
                        onUndo={undo}
                        onRedo={redo}
                        onJump={jumpToHistory}
                    />
                )}
             </div>
        </div>
      </div>

      <Timeline 
        project={project} 
        onTimeChange={setTime} 
        onTogglePlay={togglePlay}
        onJumpToSource={handleJumpToSource}
        onRunScript={runScript}
      />
    </div>
  );
}