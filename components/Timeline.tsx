import React, { useRef, useState, useEffect } from 'react';
import { ProjectState, Property, Keyframe } from '../types';
import { Play, Pause, SkipBack, SkipForward, Music, Terminal, Diamond } from 'lucide-react';
import { ConsolePanel } from './ConsolePanel';

interface TimelineProps {
  project: ProjectState;
  onTimeChange: (t: number) => void;
  onTogglePlay: () => void;
  onJumpToSource: (nodeId: string, propKey: string) => void;
  onRunScript?: (code: string) => void;
  onAddKeyframeToNode: (nodeId: string) => void;
}

export const Timeline: React.FC<TimelineProps> = ({ project, onTimeChange, onTogglePlay, onJumpToSource, onRunScript, onAddKeyframeToNode }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showConsole, setShowConsole] = useState(false);

  const handleScrub = (e: React.MouseEvent) => {
    // Only scrub if we are clicking the track area, not headers
    const target = e.target as HTMLElement;
    if (target.closest('.track-header')) return;

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const trackStartX = 256; // Width of header (w-64)
    
    // Adjust mouse X relative to the timeline start
    const x = e.clientX - rect.left - trackStartX;
    const trackWidth = rect.width - trackStartX;
    
    if (trackWidth <= 0) return;

    const percent = Math.max(0, Math.min(1, x / trackWidth));
    onTimeChange(percent * project.meta.duration);
  };

  const duration = project.meta.duration;
  const tickStep = duration > 60 ? 10 : (duration > 20 ? 5 : 1);
  const ticks = [];
  for (let i = 0; i <= Math.ceil(duration); i += tickStep) {
      if (i <= duration) ticks.push(i);
  }

  const renderRows = () => {
      const rows: React.ReactNode[] = [];

      // Audio Row
      if (project.audio.hasAudio) {
          rows.push(
            <div key="audio" className="flex h-8 border-b border-zinc-700/50 bg-emerald-900/5 shrink-0">
                <div className="w-64 shrink-0 border-r border-zinc-700 flex items-center px-4 gap-2 text-emerald-400 bg-zinc-800 z-10 track-header">
                    <Music size={12} />
                    <span className="text-xs truncate">{project.audio.fileName || 'Audio Track'}</span>
                </div>
                <div className="flex-1 relative">
                    {/* Audio Waveform visualization */}
                    {project.audio.waveform.length > 0 && (
                        <div className="absolute inset-0 flex items-center gap-[1px] opacity-30">
                            {project.audio.waveform.map((val, i) => (
                                <div key={i} className="bg-emerald-500 flex-1" style={{ height: `${val * 100}%` }} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
          );
      }

      // Node Rows
      project.rootNodeIds.forEach(id => {
          const node = project.nodes[id];
          if (!node) return;
          
          // Identify Animated Properties
          const animatedPropsKeys = Object.keys(node.properties).filter(key => {
              const prop = node.properties[key];
              return prop.keyframes && prop.keyframes.length > 0;
          });
                
          // Main Node Row
          rows.push(
              <div key={id} className={`flex h-8 border-b border-zinc-700/50 shrink-0 ${project.selection === id ? 'bg-indigo-900/20' : ''}`}>
                  <div className="w-64 shrink-0 border-r border-zinc-700 flex items-center px-4 gap-2 text-zinc-300 bg-zinc-800 z-10 track-header group">
                       <span 
                         className={`text-xs font-mono truncate cursor-pointer flex-1 ${project.selection === id ? 'text-indigo-300 font-bold' : ''}`}
                         onClick={() => onJumpToSource(id, 'x')} // Just select node
                       >
                           {id}
                       </span>
                       {/* Add Keyframe Button (Visible on Hover or if selected) */}
                       <button 
                            className="p-1 text-zinc-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Add Keyframe for Transforms (X, Y, Rot, Scale)"
                            onClick={(e) => { e.stopPropagation(); onAddKeyframeToNode(id); }}
                        >
                            <Diamond size={10} fill="currentColor" />
                       </button>
                  </div>
                  
                  <div className="flex-1 relative">
                      {/* Summary Keyframes */}
                      {animatedPropsKeys.map((key) => {
                          const prop = node.properties[key];
                          return prop.keyframes?.map(kf => (
                              <button
                                key={`${key}-${kf.id}`}
                                className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-indigo-400 rotate-45 border border-zinc-900 z-10 hover:scale-150 transition-transform cursor-pointer"
                                style={{ left: `calc(${(kf.time / duration) * 100}% - 3px)` }}
                                onClick={(e) => { e.stopPropagation(); onTimeChange(kf.time); onJumpToSource(id, key); }}
                                title={`${key}: ${JSON.stringify(kf.value)}`}
                              />
                          ));
                      })}
                  </div>
              </div>
          );
      });

      return rows;
  };

  return (
    <div className="h-72 bg-zinc-900 border-t border-zinc-700 flex flex-col select-none">
      {/* Transport Controls & Console Toggle */}
      <div className="h-10 border-b border-zinc-700 flex items-center px-4 justify-between bg-zinc-800 shrink-0 z-30 relative">
        <div className="flex items-center space-x-4">
            <button className="text-zinc-400 hover:text-white" onClick={() => onTimeChange(0)}>
            <SkipBack size={16} />
            </button>
            <button className="text-zinc-200 hover:text-white" onClick={onTogglePlay}>
            {project.meta.isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="text-zinc-400 hover:text-white" onClick={() => onTimeChange(project.meta.duration)}>
            <SkipForward size={16} />
            </button>
            <div className="text-xs font-mono text-zinc-400">
            {project.meta.currentTime.toFixed(2)}s / {project.meta.duration}s ({project.meta.fps} FPS)
            </div>
        </div>

        <button 
            className={`p-1.5 rounded flex items-center gap-2 text-xs transition-colors ${showConsole ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:bg-zinc-700'}`}
            onClick={() => setShowConsole(!showConsole)}
        >
            <Terminal size={14} />
            <span className="font-medium">Console</span>
        </button>
      </div>

      {/* Main Content Area */}
      {showConsole ? (
          <div className="flex-1 overflow-hidden relative">
              <ConsolePanel onJumpToSource={onJumpToSource} onRunScript={onRunScript} />
          </div>
      ) : (
        <div 
            className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 relative bg-zinc-900" 
            ref={containerRef} 
            onMouseDown={(e) => {
                // Ensure we aren't clicking a button
                if ((e.target as HTMLElement).tagName !== 'BUTTON') {
                    handleScrub(e);
                }
            }}
            onMouseMove={(e) => e.buttons === 1 && handleScrub(e)}
        >
            {/* Sticky Ruler */}
            <div className="sticky top-0 z-40 flex h-6 border-b border-zinc-700 bg-zinc-800">
                <div className="w-64 shrink-0 border-r border-zinc-700 flex items-center px-4 text-[10px] font-bold text-zinc-500 uppercase tracking-wider bg-zinc-800 z-50">
                    Timeline
                </div>
                <div className="flex-1 relative overflow-hidden">
                    <div className="absolute inset-0">
                         {ticks.map(t => (
                            <div 
                            key={t} 
                            className="absolute top-0 bottom-0 border-l border-zinc-600/50 text-[9px] text-zinc-500 pl-1 pt-0.5 font-mono select-none"
                            style={{ left: `${(t / duration) * 100}%` }}
                            >
                            {t}s
                            </div>
                        ))}
                    </div>
                     {/* Playhead Arrow in Ruler */}
                    <div 
                        className="absolute top-3 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-red-500 -ml-[4px] z-40 pointer-events-none"
                        style={{ left: `${(project.meta.currentTime / project.meta.duration) * 100}%` }}
                    />
                </div>
            </div>

            {/* Playhead Line Container (Spans full scrolling content height) */}
            <div className="absolute top-0 bottom-0 left-64 right-0 pointer-events-none z-30">
                 <div 
                    className="absolute top-0 bottom-0 w-px bg-red-500/50 -translate-x-1/2"
                    style={{ left: `${(project.meta.currentTime / project.meta.duration) * 100}%` }}
                />
            </div>

            {/* Background Grid */}
            <div 
                className="absolute top-0 bottom-0 left-64 right-0 pointer-events-none opacity-20"
                style={{ 
                    backgroundSize: `${(100 / duration) * tickStep}% 100%`, 
                    backgroundImage: 'linear-gradient(to right, #52525b 1px, transparent 1px)' 
                }}
            />
                
            {renderRows()}
            
            {/* Bottom padding for scrolling comfort */}
            <div className="h-32"></div>
        </div>
      )}
    </div>
  );
};