
import React, { useRef, useState } from 'react';
import { ProjectState, Property } from '../types';
import { Play, Pause, SkipBack, SkipForward, Music, Terminal } from 'lucide-react';
import { ConsolePanel } from './ConsolePanel';

interface TimelineProps {
  project: ProjectState;
  onTimeChange: (t: number) => void;
  onTogglePlay: () => void;
  onJumpToSource: (nodeId: string, propKey: string) => void;
}

export const Timeline: React.FC<TimelineProps> = ({ project, onTimeChange, onTogglePlay, onJumpToSource }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showConsole, setShowConsole] = useState(false);
  
  const handleScrub = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    onTimeChange(percent * project.meta.duration);
  };

  return (
    <div className="h-56 bg-zinc-900 border-t border-zinc-700 flex flex-col select-none">
      {/* Transport Controls & Console Toggle */}
      <div className="h-10 border-b border-zinc-700 flex items-center px-4 justify-between bg-zinc-800">
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
              <ConsolePanel onJumpToSource={onJumpToSource} />
          </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
            {/* Track Headers */}
            <div className="w-64 bg-zinc-800 border-r border-zinc-700 flex flex-col">
            {project.audio.hasAudio && (
                <div className="h-12 px-4 flex items-center text-xs border-b border-zinc-700/50 text-emerald-400 bg-emerald-900/10 gap-2">
                <Music size={12} />
                <div className="truncate">{project.audio.fileName || 'Audio Track'}</div>
                </div>
            )}
            {project.rootNodeIds.map(id => (
                <div key={id} className={`h-8 px-4 flex items-center text-xs border-b border-zinc-700/50 ${project.selection === id ? 'bg-blue-900/30 text-blue-200' : 'text-zinc-400'}`}>
                    {project.nodes[id].name}
                </div>
            ))}
            </div>

            {/* Track Timeline */}
            <div className="flex-1 relative bg-zinc-900 overflow-hidden" ref={containerRef} onClick={handleScrub} onMouseMove={(e) => e.buttons === 1 && handleScrub(e)}>
            
            {/* Grid/Ruler */}
            <div className="absolute inset-0 pointer-events-none opacity-20" 
                style={{ backgroundSize: `${100 / project.meta.duration}% 100%`, backgroundImage: 'linear-gradient(to right, #52525b 1px, transparent 1px)' }}>
            </div>

            {/* Audio Waveform */}
            {project.audio.hasAudio && (
                <div className="h-12 relative border-b border-zinc-700/50 flex items-center opacity-50">
                    {project.audio.waveform.length > 0 && (
                    <div className="absolute inset-0 flex items-center gap-[1px]">
                        {project.audio.waveform.map((val, i) => (
                            <div 
                            key={i} 
                            className="bg-emerald-500 flex-1"
                            style={{ height: `${val * 100}%` }}
                            />
                        ))}
                    </div>
                    )}
                </div>
            )}

            {/* Node Tracks */}
            <div className="flex flex-col pt-0">
                {project.rootNodeIds.map(id => {
                    const node = project.nodes[id];
                    if (!node) return null;
                    const hasKeys = Object.values(node.properties).some((p: Property) => p.mode === 'keyframe' && p.keyframes.length > 0);
                    
                    return (
                    <div key={id} className="h-8 relative border-b border-zinc-700/50">
                        {hasKeys && (
                            <div className="absolute inset-y-0 left-0 flex items-center">
                            <div className="w-2 h-2 rounded-full bg-yellow-500/50 ml-10" />
                            </div>
                        )}
                    </div>
                    );
                })}
            </div>

            {/* Playhead */}
            <div 
                className="absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none"
                style={{ left: `${(project.meta.currentTime / project.meta.duration) * 100}%` }}
            >
                <div className="w-3 h-3 -ml-1.5 bg-red-500 rounded-full shadow-sm" />
            </div>
            </div>
        </div>
      )}
    </div>
  );
};
