import React from 'react';
import { describeSystemAction, postWithApproval } from './security/approval';
import { 
  Camera,
  CameraOff, 
  LayoutGrid, 
  Brain,
  BookOpen,
  Drama,
  BrainCircuit, 
  History, 
  User, 
  Maximize2, 
  MessageSquare, 
  List, 
  Paperclip,
  Settings,
  Globe as GlobeIcon,
  Cpu,
  Zap,
  Box,
  Mic,
  MicOff,
  Power,
  Phone,
  PhoneCall,
  Check,
  CheckCheck,
  QrCode,
  MessageCircle,
  Send,
  Volume2,
  Shield,
  FolderOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HologramCore } from '@/components/ui/hologram-core';
import { AIRALiveService, type AIRALiveCallbacks } from './services/geminiLiveService';
import { LocalAssistantService, type AssistantEngine } from './services/localAssistantService';

interface DesktopPermissionsStatus {
  platform: string;
  accessibility: boolean;
  screen: string;
  microphone: string;
  camera: string;
  appPath?: string;
  inApplications?: boolean;
}
import {
  MemoryModal,
  SkillsModal,
  CharacterModal,
  SettingsModal,
} from './components/CoreModals';
import {
  BUILT_IN_CHARACTERS,
  DEFAULT_CORE_STATE,
  type CoreStoreState,
} from './types/core';

// --- Components ---

const SidebarLeft = ({ 
  isCameraOn, 
  videoRef, 
  toggleCamera,
  userEmotion,
  airaEmotion,
  cameraInsight,
  onOpenSettings,
}: { 
  isCameraOn: boolean, 
  videoRef: React.RefObject<HTMLVideoElement | null>, 
  toggleCamera: () => void,
  userEmotion: string,
  airaEmotion: string,
  cameraInsight: string,
  onOpenSettings: () => void,
}) => {
  const [headlines, setHeadlines] = React.useState<{ id: number, title: string, url: string, summary: string, published_at: string }[]>([]);
  const [loadingNews, setLoadingNews] = React.useState(true);

  React.useEffect(() => {
    fetchNews();
  }, []);

  const fetchNews = async () => {
    setLoadingNews(true);
    try {
      const response = await fetch('https://api.spaceflightnewsapi.net/v4/articles?limit=5');
      const data = await response.json();
      setHeadlines(data.results);
    } catch (error) {
      console.error('Error fetching news:', error);
    } finally {
      setLoadingNews(false);
    }
  };

  return (
    <div className="w-80 flex flex-col gap-4 p-4 h-full shrink-0">
      {/* Camera Panel */}
      <button 
        id="camera-toggle-btn"
        onClick={(e) => {
          e.preventDefault();
          toggleCamera();
        }}
        className="glass-panel aspect-square flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-br from-dash-card to-black/40 cursor-pointer group w-full border-none outline-none appearance-none p-0"
      >
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] pointer-events-none"></div>
        
        {isCameraOn ? (
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted
            className="absolute inset-0 w-full h-full object-cover scale-x-[-1] pointer-events-none"
          />
        ) : (
          <div className="flex flex-col items-center justify-center pointer-events-none">
            <CameraOff className="w-12 h-12 text-dash-text-muted mb-4 opacity-50 group-hover:opacity-80 transition-opacity" />
            <span className="text-dash-text-muted text-[10px] font-mono tracking-[0.2em] uppercase">camera offline</span>
          </div>
        )}

        <div className="absolute bottom-4 right-4 p-2 glass-panel !rounded-xl border-dash-border/30 z-20 pointer-events-none">
           {isCameraOn ? <Camera className="w-4 h-4 text-dash-accent" /> : <LayoutGrid className="w-4 h-4 text-dash-text-muted" />}
        </div>
        
        <div className="absolute top-4 left-4 flex items-center gap-2 z-20 pointer-events-none">
          <div className={`w-2 h-2 rounded-full ${isCameraOn ? 'bg-dash-accent animate-pulse shadow-[0_0_8px_#00f2ff]' : 'bg-red-500/50'}`} />
          <span className="text-[8px] font-bold text-white/50 uppercase tracking-widest">{isCameraOn ? 'Feed Live' : 'Not Connected'}</span>
        </div>

        <div className="absolute bottom-3 left-3 right-14 flex flex-col items-start gap-1 z-20 pointer-events-none text-left">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/65 border border-white/10 font-mono text-[8px] uppercase tracking-wider">
            <span className="text-cyan-300">MOOD: {userEmotion}</span>
            <span className="text-white/30">·</span>
            <span className="text-emerald-300">TONE: {airaEmotion}</span>
          </div>
          {isCameraOn && cameraInsight && (
            <span className="text-[9px] text-white/75 bg-black/60 px-2 py-0.5 rounded-md truncate max-w-full">
              {cameraInsight}
            </span>
          )}
        </div>
      </button>

      {/* Headlines Panel */}
      <div className="glass-panel flex-1 p-6 flex flex-col gap-4 overflow-hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-white/90">Today Headlines</h2>
          <div className="flex gap-2 text-dash-text-muted">
             <History 
              className="w-4 h-4 cursor-pointer hover:text-dash-accent transition-colors" 
              onClick={fetchNews}
             />
             <Settings
              className="w-4 h-4 cursor-pointer hover:text-dash-accent transition-colors"
              onClick={onOpenSettings}
             />
          </div>
        </div>
        
        <div className="flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
          {loadingNews ? (
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="flex flex-col gap-2 animate-pulse">
                <div className="h-3 w-full bg-dash-border/20 rounded-md" />
                <div className="h-2 w-[60%] bg-dash-border/10 rounded-md" />
              </div>
            ))
          ) : (
            headlines.map((news) => (
              <div 
                key={news.id} 
                className="flex flex-col gap-2 group cursor-pointer"
                onClick={() => window.open(news.url, '_blank')}
              >
                <h3 className="text-xs font-bold text-white/80 group-hover:text-dash-accent transition-colors line-clamp-2 uppercase tracking-wide">
                  {news.title}
                </h3>
                <div className="flex items-center justify-between">
                  <span className="text-[8px] text-dash-text-muted uppercase font-mono tracking-tighter">
                    {new Date(news.published_at).toLocaleDateString()}
                  </span>
                  <div className="w-1 h-1 rounded-full bg-dash-border/50" />
                </div>
              </div>
            ))
          )}
        </div>
        
        <div className="mt-auto pt-4 border-t border-dash-border/30 flex items-center justify-between text-xs text-dash-text-muted">
           <div className="flex items-center gap-2">
             <div className="w-2 h-2 rounded-full bg-dash-accent/50" />
             <span className="text-[9px] font-bold uppercase tracking-widest">Feed_Active</span>
           </div>
           <List className="w-4 h-4 hover:text-dash-accent cursor-pointer transition-colors" />
        </div>
      </div>
    </div>
  );
};

interface CoreNodeConfig {
  id: 'memory' | 'skills' | 'character' | 'setting';
  label: string;
  actionTitle: string;
  actionType: 'neural' | 'architecture' | 'ai' | 'data';
  icon: React.ComponentType<{ className?: string }>;
  borderColor: string;
  surfaceGradient: string;
  iconBoxClass: string;
  iconClass: string;
  dotColor: string;
  lineColor: string;
  pathD: string;
  dotPos: { x: string; y: string };
  elbow1: { x: string; y: string };
  elbow2: { x: string; y: string };
}

const CORE_NODES: CoreNodeConfig[] = [
  {
    id: 'memory',
    label: 'MEMORY',
    actionTitle: 'Synaptic_Memory_Bank',
    actionType: 'neural',
    icon: Brain,
    borderColor: 'rgba(34, 211, 238, 0.35)',
    surfaceGradient: 'linear-gradient(90deg, rgba(8, 42, 54, 0.85) 0%, rgba(10, 18, 26, 0.94) 100%)',
    iconBoxClass: 'border-cyan-400/35 bg-cyan-500/10',
    iconClass: 'text-cyan-400',
    dotColor: '#22d3ee',
    lineColor: '#22d3ee',
    pathD: 'M 0 25 L 74 25 L 146 135 L 200 135',
    dotPos: { x: '0%', y: '8.33%' },
    elbow1: { x: '37%', y: '8.33%' },
    elbow2: { x: '73%', y: '45%' },
  },
  {
    id: 'skills',
    label: 'SKILLS',
    actionTitle: 'Skills_Matrix_Registry',
    actionType: 'architecture',
    icon: BookOpen,
    borderColor: 'rgba(74, 222, 128, 0.35)',
    surfaceGradient: 'linear-gradient(90deg, rgba(10, 44, 24, 0.85) 0%, rgba(10, 18, 16, 0.94) 100%)',
    iconBoxClass: 'border-emerald-400/35 bg-emerald-500/10',
    iconClass: 'text-emerald-400',
    dotColor: '#4ade80',
    lineColor: '#4ade80',
    pathD: 'M 0 108 L 88 108 L 118 145 L 200 145',
    dotPos: { x: '0%', y: '36%' },
    elbow1: { x: '44%', y: '36%' },
    elbow2: { x: '59%', y: '48.33%' },
  },
  {
    id: 'character',
    label: 'CHARACTER',
    actionTitle: 'Character_Persona_Core',
    actionType: 'ai',
    icon: Drama,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    surfaceGradient: 'linear-gradient(90deg, rgba(52, 14, 16, 0.85) 0%, rgba(20, 11, 14, 0.94) 100%)',
    iconBoxClass: 'border-red-400/35 bg-red-500/10',
    iconClass: 'text-red-400',
    dotColor: '#f87171',
    lineColor: '#f87171',
    pathD: 'M 0 192 L 88 192 L 118 155 L 200 155',
    dotPos: { x: '0%', y: '64%' },
    elbow1: { x: '44%', y: '64%' },
    elbow2: { x: '59%', y: '51.67%' },
  },
  {
    id: 'setting',
    label: 'SETTING',
    actionTitle: 'System_Parameters',
    actionType: 'data',
    icon: Settings,
    borderColor: 'rgba(148, 163, 184, 0.32)',
    surfaceGradient: 'linear-gradient(90deg, rgba(24, 34, 48, 0.85) 0%, rgba(12, 17, 24, 0.94) 100%)',
    iconBoxClass: 'border-slate-300/30 bg-slate-400/10',
    iconClass: 'text-slate-300',
    dotColor: '#cbd5e1',
    lineColor: '#cbd5e1',
    pathD: 'M 0 275 L 74 275 L 146 165 L 200 165',
    dotPos: { x: '0%', y: '91.67%' },
    elbow1: { x: '37%', y: '91.67%' },
    elbow2: { x: '73%', y: '55%' },
  },
];

const NeuralCoreDeck = ({
  onOpenModal,
  isActive,
  onToggle,
  audioLevel,
  status,
  airaEmotion,
}: {
  onOpenModal: (nodeId: CoreNodeConfig['id']) => void;
  isActive: boolean;
  onToggle: () => void;
  audioLevel: number;
  status: string;
  airaEmotion?: string;
  userEmotion?: string;
  selectedVoice?: string;
  onSelectVoice?: (voice: string) => void;
}) => {
  const [selectedNode, setSelectedNode] = React.useState<CoreNodeConfig['id'] | null>(null);

  const statusLabel = React.useMemo(() => {
    if (status === 'MISSING_API_KEY') return 'Missing Gemini API key';
    if (status === 'FAILED' || status === 'CONNECTION FAILED' || status === 'ERROR') {
      return 'Connection failed';
    }
    if (status === 'INITIALIZING...' || status === 'CONNECTING...') {
      return 'Ultron is connecting...';
    }
    if (!isActive) {
      return 'Ultron is ready';
    }
    if (airaEmotion === 'THINKING') return 'Ultron is thinking';
    return 'Ultron is listening';
  }, [isActive, status, airaEmotion]);

  return (
    <div className="w-full h-full flex flex-col md:flex-row items-stretch relative select-none">
      {/* Left 4 Chamfered Module Tabs */}
      <div className="w-full md:w-[190px] lg:w-[205px] xl:w-[220px] shrink-0 flex flex-col justify-between gap-2 md:gap-0 md:py-1 z-10">
        {CORE_NODES.map((node) => {
          const Icon = node.icon;
          const isSelected = selectedNode === node.id;
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => {
                setSelectedNode(node.id);
                onOpenModal(node.id);
              }}
              className="relative h-[50px] w-full text-left group cursor-pointer transition-transform duration-200 hover:translate-x-0.5"
              style={{
                clipPath:
                  'polygon(11px 0, 100% 0, 100% calc(100% - 11px), calc(100% - 11px) 100%, 0 100%, 0 11px)',
                background: isSelected ? node.lineColor : node.borderColor,
              }}
            >
              <div
                className="absolute inset-[1px] flex items-center px-2.5"
                style={{
                  clipPath:
                    'polygon(10.5px 0, 100% 0, 100% calc(100% - 10.5px), calc(100% - 10.5px) 100%, 0 100%, 0 10.5px)',
                  background: node.surfaceGradient,
                }}
              >
                <div
                  className={`w-8 h-8 rounded-[6px] border flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${node.iconBoxClass}`}
                >
                  <Icon className={`w-4 h-4 ${node.iconClass}`} />
                </div>
                <span className="ml-3 text-[11px] font-bold tracking-[0.22em] text-slate-100 uppercase truncate">
                  {node.label}
                </span>
                <span
                  className="ml-auto mr-1 w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: node.dotColor,
                    boxShadow: `0 0 8px ${node.dotColor}`,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Middle Orthogonal + 45-deg Circuit Trace Lines */}
      <div className="hidden md:block flex-1 min-w-[90px] relative py-1 pointer-events-none">
        <div className="relative w-full h-full">
          <svg
            className="w-full h-full overflow-visible"
            viewBox="0 0 200 300"
            preserveAspectRatio="none"
          >
            {CORE_NODES.map((node, idx) => (
              <g key={node.id}>
                {/* Soft glow trace */}
                <path
                  d={node.pathD}
                  fill="none"
                  stroke={node.lineColor}
                  strokeWidth="4"
                  strokeOpacity="0.22"
                  vectorEffect="non-scaling-stroke"
                />
                {/* Crisp primary trace */}
                <motion.path
                  d={node.pathD}
                  fill="none"
                  stroke={node.lineColor}
                  strokeWidth="1.5"
                  strokeOpacity="0.85"
                  vectorEffect="non-scaling-stroke"
                  initial={{ pathLength: 0.2, opacity: 0.4 }}
                  animate={{ pathLength: 1, opacity: 0.9 }}
                  transition={{ duration: 0.9, delay: idx * 0.1, ease: 'easeOut' }}
                />
                {/* Animated data pulse */}
                <path
                  d={node.pathD}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  strokeOpacity="0.55"
                  strokeDasharray="6 34"
                  vectorEffect="non-scaling-stroke"
                  className="animate-dash"
                />
              </g>
            ))}
          </svg>

          {/* Circular junction dots so aspect scaling never stretches them */}
          {CORE_NODES.map((node) => (
            <React.Fragment key={`dots-${node.id}`}>
              <span
                className="absolute w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: node.dotPos.x,
                  top: node.dotPos.y,
                  backgroundColor: node.dotColor,
                  boxShadow: `0 0 8px ${node.dotColor}`,
                }}
              />
              <span
                className="absolute w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: node.elbow1.x,
                  top: node.elbow1.y,
                  backgroundColor: node.dotColor,
                  boxShadow: `0 0 8px ${node.dotColor}`,
                }}
              />
              <span
                className="absolute w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2 opacity-80"
                style={{
                  left: node.elbow2.x,
                  top: node.elbow2.y,
                  backgroundColor: node.dotColor,
                  boxShadow: `0 0 6px ${node.dotColor}`,
                }}
              />
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Right Column: Octagonal Hologram Chamber */}
      <div className="w-full md:w-[320px] lg:w-[335px] xl:w-[365px] shrink-0 flex flex-col mt-3 md:mt-0">
        {/* Octagonal Chamber */}
        <div
          className="relative flex-1 min-h-[300px]"
          style={{
            clipPath:
              'polygon(18px 0, calc(100% - 18px) 0, 100% 18px, 100% calc(100% - 18px), calc(100% - 18px) 100%, 18px 100%, 0 calc(100% - 18px), 0 18px)',
            background:
              'linear-gradient(180deg, rgba(34, 211, 238, 0.48) 0%, rgba(20, 95, 125, 0.35) 50%, rgba(34, 211, 238, 0.42) 100%)',
          }}
        >
          <div
            className="absolute inset-[1px] overflow-hidden flex flex-col justify-end"
            style={{
              clipPath:
                'polygon(17.5px 0, calc(100% - 17.5px) 0, 100% 17.5px, 100% calc(100% - 17.5px), calc(100% - 17.5px) 100%, 17.5px 100%, 0 calc(100% - 17.5px), 0 17.5px)',
              background:
                'radial-gradient(circle at 50% 42%, #071928 0%, #040910 65%, #020509 100%)',
            }}
          >
            {/* Subtle square grid inside chamber */}
            <div
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(34, 211, 238, 0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(34, 211, 238, 0.12) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            />

            {/* Left wall port indicator dot */}
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8] z-20" />

            {/* Hologram Bust */}
            <div className="absolute inset-x-0 top-1 bottom-[74px] flex items-center justify-center">
              <HologramCore isActive={isActive} audioLevel={audioLevel} />
            </div>

            {/* Bottom Status + Hexagonal Action Button + Mic */}
            <div className="relative z-20 w-full flex flex-col items-center gap-2.5 pb-4 pt-2 bg-gradient-to-t from-[#03070c] via-[#03070c]/85 to-transparent">
              <div className="flex items-center gap-2 text-[12px] font-medium text-slate-200 tracking-wide">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isActive
                      ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse'
                      : 'bg-cyan-400/90 shadow-[0_0_6px_#22d3ee]'
                  }`}
                />
                <span>{statusLabel}</span>
              </div>

              <div className="flex items-center justify-center gap-3">
                {/* Hexagonal Chamfered Connect / Terminate Button */}
                <button
                  type="button"
                  onClick={onToggle}
                  className="relative w-[176px] h-[36px] cursor-pointer group transition-transform active:scale-[0.98]"
                  style={{
                    clipPath:
                      'polygon(11px 0, calc(100% - 11px) 0, 100% 50%, calc(100% - 11px) 100%, 11px 100%, 0 50%)',
                    background: isActive
                      ? 'rgba(239, 68, 68, 0.72)'
                      : 'rgba(34, 211, 238, 0.65)',
                  }}
                >
                  <div
                    className="absolute inset-[1px] flex items-center justify-center transition-colors"
                    style={{
                      clipPath:
                        'polygon(10.5px 0, calc(100% - 10.5px) 0, 100% 50%, calc(100% - 10.5px) 100%, 10.5px 100%, 0 50%)',
                      background: isActive
                        ? 'linear-gradient(180deg, rgba(44, 12, 16, 0.95) 0%, rgba(26, 8, 11, 0.98) 100%)'
                        : 'linear-gradient(180deg, rgba(10, 38, 48, 0.95) 0%, rgba(6, 20, 28, 0.98) 100%)',
                    }}
                  >
                    <span
                      className={`text-[11px] font-bold tracking-[0.26em] uppercase ${
                        isActive
                          ? 'text-red-400 group-hover:text-red-300'
                          : 'text-cyan-300 group-hover:text-cyan-200'
                      }`}
                    >
                      {isActive ? 'TERMINATE' : 'CONNECT'}
                    </span>
                  </div>
                </button>

                {/* Circular Mic Button */}
                <button
                  type="button"
                  onClick={onToggle}
                  aria-label={isActive ? 'Mute or disconnect microphone' : 'Activate voice'}
                  className={`w-9 h-9 rounded-full border flex items-center justify-center transition-all cursor-pointer ${
                    isActive
                      ? 'border-cyan-400/70 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.3)]'
                      : 'border-cyan-500/40 bg-cyan-950/35 text-cyan-400 hover:border-cyan-400/70 hover:bg-cyan-500/15'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const VisualContent = ({ type, title = '', isZoomed = false }: { type: 'ai' | 'neural' | 'data' | 'metrics' | 'flowchart' | 'schematic' | 'architecture', title?: string, isZoomed?: boolean }) => {
  if (type === 'architecture') {
    // If it's the smartphone one, we use a specialized technical layout
    const isSmartphone = title.toLowerCase().includes('smartphone');
    
    return (
      <div className={`relative ${isZoomed ? 'w-full h-full p-6 md:p-12' : 'w-full h-[500px]'} flex items-center justify-center bg-[#0a0a0a] rounded-3xl overflow-hidden border border-white/10 shadow-2xl`}>
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#ffffff_1px,transparent_1px)] bg-[size:32px_32px]"></div>
        
        <div className={`relative z-10 w-full ${isZoomed ? 'max-w-5xl' : 'max-w-4xl'} h-full flex flex-col items-center justify-start gap-2 p-8 overflow-y-auto custom-scrollbar`}>
          {isSmartphone ? (
            <div className="flex flex-col items-center gap-0 w-full font-mono py-10">
              {/* Layer 1: Input */}
              <div className="flex flex-col items-center group scale-110 mb-2">
                <div className="px-10 py-4 border border-dash-accent/50 bg-dash-accent-dim/20 rounded-lg text-dash-accent text-sm font-black uppercase tracking-widest shadow-[0_0_15px_rgba(0,242,255,0.2)]">
                  [User / Environment]
                </div>
                <div className="h-8 w-px bg-dash-accent/40 shadow-[0_0_8px_#00f2ff]"></div>
                <span className="text-[16px] text-dash-accent mb-1 animate-pulse">↓</span>
              </div>

              {/* Layer 2: Input Hardware */}
              <div className="flex flex-col items-center group scale-105 mb-2">
                <div className="px-10 py-6 border border-white/20 bg-white/5 rounded-xl flex flex-col items-center gap-4 min-w-[320px]">
                  <span className="text-[11px] font-black text-white/40 uppercase self-start italic tracking-widest">_Input_Layer</span>
                  <div className="flex gap-6">
                    <div className="px-4 py-2 bg-white/5 border border-white/10 rounded text-[10px] text-white/70 font-bold uppercase transition-all hover:bg-white/10">Touch Screen</div>
                    <div className="px-4 py-2 bg-white/5 border border-white/10 rounded text-[10px] text-white/70 font-bold uppercase transition-all hover:bg-white/10">Microphone</div>
                    <div className="px-4 py-2 bg-white/5 border border-white/10 rounded text-[10px] text-white/70 font-bold uppercase transition-all hover:bg-white/10">Sensors</div>
                  </div>
                </div>
                <div className="h-8 w-px bg-white/20"></div>
                <span className="text-[16px] text-white/30 mb-1">↓</span>
              </div>

              {/* Layer 3: Central Processing (SoC) */}
              <div className="flex flex-col items-center group scale-110 my-4">
                <div className="px-12 py-8 border-2 border-dash-accent bg-dash-card rounded-[2rem] flex flex-col items-center gap-6 shadow-[0_0_40px_rgba(0,242,255,0.2)] relative">
                  <div className="absolute -top-4 left-8 px-3 py-1 bg-[#0a0a0a] text-[10px] font-black text-dash-accent tracking-tighter uppercase italic border border-dash-accent/30 rounded-md">Main_Logic_Active</div>
                  <Cpu className="w-14 h-14 text-dash-accent drop-shadow-[0_0_15px_#00f2ff]" />
                  <div className="flex flex-col items-center text-center">
                    <span className="text-lg font-black text-white tracking-widest uppercase italic">System-on-a-Chip (SoC)</span>
                    <span className="text-[10px] text-dash-text-muted mt-2 font-mono uppercase tracking-[0.3em] font-bold">A17_Neural_Engine_V4</span>
                  </div>
                  
                  {/* Internal storage connection */}
                  <div className="flex gap-12 mt-4 border-t border-white/10 pt-6 w-full justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-16 h-10 border border-white/20 bg-dash-accent-dim/10 rounded flex items-center justify-center text-[10px] font-black text-dash-accent">16GB RAM</div>
                      <span className="text-[7px] text-white/30 uppercase font-black">LPDDR5X</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-16 h-10 border border-white/20 bg-white/5 rounded flex items-center justify-center text-[10px] font-black text-white/70">512GB NVMe</div>
                      <span className="text-[7px] text-white/30 uppercase font-black">Secure_Vault</span>
                    </div>
                  </div>
                </div>
                <div className="h-8 w-px bg-dash-accent/40"></div>
                <span className="text-[16px] text-dash-accent mb-1">↓</span>
              </div>

              {/* Layer 4: Communication / Service */}
              <div className="flex flex-col items-center group scale-105 mb-2">
                <div className="px-10 py-6 border border-dash-red/30 bg-dash-red-dim/5 rounded-xl flex flex-col items-center gap-4 min-w-[320px]">
                  <span className="text-[11px] font-black text-dash-red/70 uppercase self-start italic tracking-widest">_Communication_Hub</span>
                  <div className="flex gap-6">
                    <div className="px-6 py-3 bg-dash-red-dim/20 border border-dash-red/40 rounded-xl flex items-center gap-3 transition-all hover:bg-dash-red-dim/40">
                       <GlobeIcon className="w-4 h-4 text-dash-red animate-pulse" />
                       <span className="text-[10px] text-white font-black uppercase">Cellular (5G/LTE)</span>
                    </div>
                    <div className="px-6 py-3 bg-dash-red-dim/20 border border-dash-red/40 rounded-xl flex items-center gap-3 transition-all hover:bg-dash-red-dim/40">
                       <Zap className="w-4 h-4 text-dash-red" />
                       <span className="text-[10px] text-white font-black uppercase">WLAN / PAN</span>
                    </div>
                  </div>
                </div>
                <div className="h-8 w-px bg-dash-red/30"></div>
                <span className="text-[16px] text-dash-red/40 mb-1">↓</span>
              </div>

              {/* Layer 5: Output */}
              <div className="flex flex-col items-center group scale-105 mb-2">
                <div className="px-10 py-6 border border-white/20 bg-white/5 rounded-xl flex flex-col items-center gap-4 min-w-[320px]">
                  <span className="text-[11px] font-black text-white/40 uppercase self-start italic tracking-widest">_Feedback_Output</span>
                  <div className="flex gap-6">
                    <div className="px-5 py-2 bg-white/5 border border-white/10 rounded text-[10px] text-white/70 font-bold uppercase">LTPO Display</div>
                    <div className="px-5 py-2 bg-white/5 border border-white/10 rounded text-[10px] text-white/70 font-bold uppercase">Spatial Audio</div>
                    <div className="px-5 py-2 bg-white/5 border border-white/10 rounded text-[10px] text-white/70 font-bold uppercase">Taptic Engine</div>
                  </div>
                </div>
                <div className="h-8 w-px bg-white/20"></div>
                <span className="text-[16px] text-white/30 mb-1">↓</span>
              </div>

              {/* Final Conclusion */}
              <div className="px-12 py-4 border-2 border-dash-accent/60 bg-black rounded-full text-dash-accent text-[12px] font-black uppercase tracking-[0.4em] shadow-[0_0_30px_rgba(0,242,255,0.2)] animate-pulse">
                [RESPONSE_COMPLETE_FLOW]
              </div>
            </div>
          ) : (
            // Generic fallback technical flow
            <div className="flex flex-col items-center gap-0 w-full font-mono">
              <div className="px-10 py-3 border border-dash-accent/50 bg-dash-accent-dim/20 rounded-lg text-dash-accent text-xs font-black uppercase tracking-widest">[Source_Input]</div>
              <div className="h-10 w-px bg-dash-accent/40"></div>
              <div className="px-10 py-6 border-2 border-white/20 bg-dash-card rounded-2xl flex flex-col items-center gap-2">
                 <div className="w-8 h-8 rounded bg-white/10 mb-2 border border-white/20" />
                 <span className="text-xs font-bold text-white uppercase tracking-widest">Processing_Core</span>
                 <span className="text-[8px] text-dash-text-muted uppercase">Logic_Layer_01</span>
              </div>
              <div className="h-10 w-px bg-white/20"></div>
              <div className="px-10 py-3 border border-white/10 bg-white/5 rounded-lg text-white/40 text-[9px] font-black uppercase tracking-widest">[Data_Storage]</div>
              <div className="h-10 w-px bg-white/20"></div>
              <div className="px-10 py-3 border border-dash-accent/50 bg-black rounded-full text-dash-accent text-[10px] font-black uppercase tracking-[0.2em]">[SYSTEM_EGRESS]</div>
            </div>
          )}
        </div>

        {/* Technical labels in corners */}
        <div className="absolute top-8 left-8 flex items-center gap-2">
           <div className="w-1.5 h-1.5 rounded-full bg-dash-accent shadow-[0_0_8px_#00f2ff]" />
           <span className="text-[9px] font-black text-dash-accent/60 uppercase italic tracking-widest">System_Architect_Mode_v2</span>
        </div>
        
        <div className="absolute bottom-8 right-8 flex flex-col items-end gap-1">
           <span className="text-[8px] font-black text-white/20 uppercase tracking-[0.4em]">ACCURATE_MAPPING_ENGAGED</span>
           <div className="flex gap-0.5">
              {[1,2,3,4,5].map(i => <div key={i} className="w-3 h-0.5 bg-dash-accent/20" />)}
           </div>
        </div>
      </div>
    );
  }

  if (type === 'schematic') {
    return (
      <div className={`relative ${isZoomed ? 'w-full h-full p-20' : 'w-full h-[400px]'} flex items-center justify-center bg-[#070707] rounded-3xl overflow-hidden border border-white/10 shadow-2xl`}>
        <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#1a1a1a_1px,transparent_1px),linear-gradient(to_bottom,#1a1a1a_1px,transparent_1px)] bg-[size:40px_40px]"></div>
        
        <div className="relative z-10 w-full h-full flex flex-col items-center justify-center font-mono gap-12">
          <div className="flex gap-4 md:gap-16 items-center">
             {/* Component A */}
             <div className="flex flex-col items-center gap-4">
                <div className="px-6 py-4 glass-panel border-dash-accent/40 bg-dash-card/80 rounded-xl flex flex-col items-center min-w-[140px]">
                   <span className="text-[10px] font-black text-dash-accent mb-2 uppercase italic tracking-widest">_Interface_P</span>
                   <div className="w-12 h-[2px] bg-dash-accent/30 rounded-full mb-3" />
                   <span className="text-[11px] text-white/90 font-bold uppercase">Uplink_Module</span>
                </div>
                <div className="flex flex-col items-center">
                   <div className="h-6 w-[1.5px] bg-dash-accent/40" />
                   <span className="text-[10px] text-dash-accent">↓</span>
                </div>
                <div className="px-6 py-2 border border-white/10 bg-white/5 rounded text-[8px] text-white/40 uppercase font-black">Sync_Bus_71%</div>
             </div>

             {/* Main Bridge */}
             <div className="flex items-center">
                <div className="w-8 md:w-16 h-[2px] bg-gradient-to-r from-dash-accent to-dash-accent" />
                <motion.div 
                  animate={{ scale: [1, 1.05, 1] }} 
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-48 h-48 border-2 border-dash-accent bg-dash-card shadow-[0_0_40px_rgba(0,242,255,0.1)] rounded-[2.5rem] flex flex-col items-center justify-center gap-4 relative"
                >
                   <Cpu className="w-12 h-12 text-dash-accent drop-shadow-[0_0_10px_#00f2ff]" />
                   <span className="text-xl font-black text-white italic tracking-tighter">CENTRAL_HUB</span>
                   <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1px] bg-dash-accent/10" />
                   <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1px] bg-dash-accent/10" />
                </motion.div>
                <div className="w-8 md:w-16 h-[2px] bg-gradient-to-r from-dash-accent to-dash-accent" />
             </div>

             {/* Component B */}
             <div className="flex flex-col items-center gap-4">
                <div className="px-6 py-4 glass-panel border-dash-red/40 bg-dash-card/80 rounded-xl flex flex-col items-center min-w-[140px]">
                   <span className="text-[10px] font-black text-dash-red/60 mb-2 uppercase italic tracking-widest">_Egress_Q</span>
                   <div className="w-12 h-[2px] bg-dash-red/30 rounded-full mb-3" />
                   <span className="text-[11px] text-white/90 font-bold uppercase">Downlink_P</span>
                </div>
                <div className="flex flex-col items-center">
                   <div className="h-6 w-[1.5px] bg-dash-red/40" />
                   <span className="text-[10px] text-dash-red">↓</span>
                </div>
                <div className="px-6 py-2 border border-white/10 bg-white/5 rounded text-[8px] text-white/40 uppercase font-black">Status: Stable</div>
             </div>
          </div>

          {/* Bottom Labels */}
          <div className="flex gap-12 font-mono text-[9px] font-black text-white/30 uppercase tracking-[0.2em] italic">
             <span>Protocol: Q-FLOW-X</span>
             <span className="text-dash-accent opacity-50">Linkage: Active</span>
             <span>Freq: 12.4Ghz</span>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'flowchart') {
    return (
      <div className={`relative ${isZoomed ? 'w-full h-full p-20' : 'w-full h-[400px]'} flex items-center justify-center bg-[#050505] rounded-3xl overflow-hidden border border-white/10 shadow-2xl`}>
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#ffffff_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        
        <div className="relative z-10 w-full max-w-2xl flex flex-col items-center font-mono py-10">
          {/* Start */}
          <div className="flex flex-col items-center gap-4">
             <div className="px-10 py-3 border-2 border-dash-accent bg-dash-accent-dim/10 rounded-full text-white text-xs font-black uppercase tracking-widest shadow-[0_0_15px_rgba(0,242,255,0.2)]">
                START_PROCESS
             </div>
             <div className="h-10 w-[2px] bg-dash-accent/40" />
          </div>

          {/* Decision */}
          <div className="flex flex-col items-center relative gap-6">
             <div className="w-40 h-40 border-2 border-white/20 bg-dash-card rotate-45 flex items-center justify-center shadow-xl">
                <div className="-rotate-45 flex flex-col items-center gap-1">
                   <span className="text-[10px] font-black text-dash-accent uppercase">VALIDATE</span>
                   <span className="text-[9px] font-bold text-white uppercase text-center px-4 leading-tight">Data Integrity Check</span>
                </div>
             </div>
             
             {/* Branches */}
             <div className="flex gap-40 mt-[-20px] relative z-10">
                <div className="flex flex-col items-center">
                   <div className="h-20 w-[2px] bg-dash-accent/40" />
                   <div className="px-6 py-2 border border-dash-accent/40 bg-dash-accent-dim/20 rounded text-[9px] text-dash-accent font-black">CONTINUE</div>
                   <div className="h-10 w-[2px] bg-dash-accent/40" />
                </div>
                <div className="flex flex-col items-center">
                   <div className="h-20 w-[2px] bg-dash-red/40" />
                   <div className="px-6 py-2 border border-dash-red/40 bg-dash-red-dim/20 rounded text-[9px] text-dash-red font-black">REJECT</div>
                </div>
             </div>
          </div>

          {/* End Action */}
          <div className="flex flex-col items-center mt-[-30px]">
             <div className="px-10 py-5 border-2 border-white/40 bg-dash-card rounded-2xl flex flex-col items-center min-w-[220px] shadow-2xl">
                <Zap className="w-6 h-6 text-dash-accent mb-2" />
                <span className="text-xs font-black text-white tracking-widest uppercase italic">Execute_Sequence</span>
             </div>
             <div className="h-10 w-[2px] bg-white/20" />
             <div className="px-10 py-3 border border-white/20 bg-black rounded-full text-white/40 text-[10px] font-black uppercase tracking-[0.3em]">
                TERMINAL_STATE
             </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'data' || type === 'metrics') {
    return (
      <div className={`relative ${isZoomed ? 'w-full h-full p-10' : 'w-full h-[350px]'} flex items-center justify-center bg-[#050505] rounded-3xl overflow-hidden border border-white/5`}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-4xl p-10 animate-fade-in">
           {[
             { label: 'NODE_UPTIME', value: '99.98%', accent: 'text-dash-accent' },
             { label: 'THREAD_LOAD', value: '42.1%', accent: 'text-white' },
             { label: 'PKT_INGRESS', value: '1.2M', accent: 'text-white' },
             { label: 'ERROR_RATE', value: '0.001%', accent: 'text-dash-red' }
           ].map((stat, i) => (
             <motion.div 
               key={i}
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: i * 0.1 }}
               className="glass-panel p-6 border-white/5 bg-white/5 flex flex-col gap-2 items-center"
             >
               <span className="text-[8px] font-black text-white/30 uppercase tracking-[0.2em]">{stat.label}</span>
               <span className={`text-2xl font-black italic tracking-tighter ${stat.accent}`}>{stat.value}</span>
               <div className="w-full h-0.5 bg-white/10 rounded-full mt-2">
                  <motion.div animate={{ width: ['20%', '80%', '40%'] }} transition={{ duration: 2 + i, repeat: Infinity }} className="h-full bg-dash-accent/30" />
               </div>
             </motion.div>
           ))}
        </div>
      </div>
    );
  }

  if (type === 'ai') {
    return (
      <div className={`relative ${isZoomed ? 'w-96 h-96' : 'w-48 h-48'} flex items-center justify-center`}>
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 border-2 border-dashed border-dash-accent/30 rounded-full"
        />
        <motion.div 
          animate={{ rotate: -360 }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="absolute inset-4 border border-dash-accent/20 rounded-full"
        />
        <div className="relative z-10 flex flex-col items-center">
          <BrainCircuit className={`${isZoomed ? 'w-24 h-24' : 'w-12 h-12'} text-dash-accent glow-accent mb-4 animate-pulse`} />
          <div className="flex gap-2">
            {[...Array(3)].map((_, i) => (
              <motion.div 
                key={i}
                animate={{ height: [4, 12, 4] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
                className="w-1 bg-dash-accent" 
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (type === 'neural') {
    return (
      <div className={`relative ${isZoomed ? 'w-full h-full p-10' : 'w-full h-[400px]'} flex items-center justify-center bg-[#050505] rounded-3xl overflow-hidden border border-white/10 shadow-2xl`}>
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_center,rgba(0,242,255,0.15)_0%,transparent_70%)]"></div>
        <svg className="w-full h-full" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="neuron-glow">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feComposite in="SourceGraphic" in2="blur" operator="over"/>
            </filter>
          </defs>
          <g>
            {/* Sinaptic Paths */}
            {Array.from({ length: 25 }).map((_, i) => {
              const x1 = Math.random() * 800;
              const y1 = Math.random() * 400;
              const x2 = x1 + (Math.random() - 0.5) * 150;
              const y2 = y1 + (Math.random() - 0.5) * 150;
              return (
                <motion.line
                   key={i}
                   x1={x1} y1={y1} x2={x2} y2={y2}
                   stroke="#00f2ff" strokeWidth="1"
                   className="opacity-20"
                   animate={{ opacity: [0.1, 0.4, 0.1] }}
                   transition={{ duration: 2 + Math.random() * 2, repeat: Infinity }}
                />
              );
            })}
            
            {/* Neural Nodes with High Visibility */}
            {Array.from({ length: 16 }).map((_, i) => {
               const cx = 100 + (i % 4) * 200 + (Math.random() - 0.5) * 50;
               const cy = 100 + Math.floor(i / 4) * 80 + (Math.random() - 0.5) * 30;
               const radius = 4 + Math.random() * 4;
               
               return (
                  <g key={i}>
                    <motion.circle 
                      cx={cx} cy={cy} r={radius} 
                      fill="#00f2ff" 
                      style={{ filter: 'url(#neuron-glow)' }}
                      animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }}
                      transition={{ duration: 2 + Math.random(), repeat: Infinity }}
                    />
                    <motion.circle 
                      cx={cx} cy={cy} r={radius * 3} 
                      stroke="#00f2ff" strokeWidth="0.5" fill="transparent"
                      className="opacity-20"
                      animate={{ r: [radius * 2, radius * 5, radius * 2], opacity: [0.2, 0, 0.2] }}
                      transition={{ duration: 3, repeat: Infinity, delay: i * 0.1 }}
                    />
                    <text x={cx} y={cy + radius + 15} textAnchor="middle" className="fill-white/30 text-[7px] font-black uppercase tracking-widest italic">neuron_{i}</text>
                  </g>
               );
            })}
          </g>
        </svg>
        <div className="absolute top-6 right-6 flex items-center gap-3 glass-panel px-4 py-2 border-dash-accent/40 bg-dash-card/80 rounded-full">
           <div className="w-2 h-2 rounded-full bg-dash-accent shadow-[0_0_10px_#00f2ff] animate-pulse" />
           <span className="text-[10px] font-black text-white uppercase italic tracking-widest">Synapse_Activity: High</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-4 items-center ${isZoomed ? 'scale-150' : 'scale-100'}`}>
      <div className="flex gap-1 items-end h-16">
        {[...Array(12)].map((_, i) => (
          <motion.div 
            key={i}
            animate={{ height: [10, Math.random() * 50 + 10, 10] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.1 }}
            className="w-2 bg-dash-accent/60 rounded-t-sm"
          />
        ))}
      </div>
      <div className="text-[10px] font-mono text-dash-accent/40 animate-pulse">STREAMING DATA VECTORS...</div>
    </div>
  );
};

const VisualHub = ({ 
  activeVisual, 
  onToggleFullscreen,
  onRunPythonAction,
  systemBanner,
  permsReady,
  onOpenPermissions,
}: { 
  activeVisual: any; 
  onToggleFullscreen: () => void;
  onRunPythonAction: (action: string, target?: string) => void;
  systemBanner: string | null;
  permsReady?: boolean;
  onOpenPermissions?: () => void;
}) => {
  return (
    <div className="glass-panel flex-1 min-h-[450px] flex flex-col p-10 bg-gradient-to-b from-[#0a0a0a] to-dash-bg relative overflow-hidden group border-white/5 ring-1 ring-white/5">
      <div className="absolute top-0 right-0 w-[60%] h-[60%] bg-dash-accent/5 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-[40%] h-[40%] bg-dash-red/5 blur-[100px] pointer-events-none" />
      
      <div className="flex items-center justify-between mb-10 relative z-10">
        <div className="flex items-center gap-4">
           <div className={`w-3 h-3 rounded-full ${activeVisual ? 'bg-dash-accent animate-pulse shadow-[0_0_10px_#00f2ff]' : 'bg-white/10'}`} />
           <div className="flex flex-col">
             <h2 className="text-sm font-black text-white uppercase tracking-[0.3em] italic">Visual_Intelligence_Node</h2>
             <p className="text-[9px] text-dash-text-muted uppercase font-mono tracking-widest">{activeVisual ? 'Analysis_Online / Source: Ultron_Core' : 'Awaiting_Command_Input'}</p>
           </div>
        </div>
        
        <div className="flex items-center gap-3">
          {window.airaDesktop?.isElectron && window.airaDesktop?.platform === 'darwin' && (
            <button
              type="button"
              onClick={onOpenPermissions}
              className={`px-3 py-1.5 rounded-xl border text-[10.5px] font-mono uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-colors ${
                permsReady
                  ? 'bg-white/[0.04] border-white/10 text-emerald-300/85 hover:border-emerald-400/40'
                  : 'bg-amber-500/15 border-amber-400/40 text-amber-300 hover:bg-amber-500/25'
              }`}
            >
              <Shield className="w-3 h-3" />
              {permsReady ? 'Mac Perms OK' : 'Mac Perms'}
            </button>
          )}

          {activeVisual && (
            <button 
              type="button"
              onClick={onToggleFullscreen}
              className="p-3 glass-panel !rounded-xl border-white/10 cursor-pointer hover:bg-dash-card hover:border-dash-accent transition-all hover:scale-105 active:scale-95"
            >
              <Maximize2 className="w-5 h-5 text-dash-accent" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center font-sans relative z-10 min-h-0">
        {activeVisual ? (
          <motion.div 
            key={activeVisual.title}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full h-full flex flex-col items-center gap-4 min-h-0"
          >
            <div className="w-full flex-1 min-h-0 flex flex-col">
               <VisualContent type={activeVisual.type} title={activeVisual.title} />
            </div>
            
            <div className="w-full max-w-2xl text-center flex flex-col gap-4">
               <div className="flex items-center justify-center gap-4">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/10" />
                  <h3 className="text-2xl font-black text-white uppercase tracking-tighter italic">{activeVisual.title}</h3>
                  <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
               </div>
               <p className="text-[12px] text-dash-text-muted leading-relaxed uppercase tracking-wider font-light line-clamp-3 italic">
                 {activeVisual.explanation}
               </p>
            </div>
          </motion.div>
        ) : (
          <div className="flex flex-col items-center gap-6">
             <div className="flex flex-col items-center gap-6 opacity-40">
               <div className="p-8 rounded-full border-2 border-dashed border-white/20 bg-white/5 relative">
                  <BrainCircuit className="w-16 h-16 text-white" />
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                    className="absolute -inset-4 border border-dash-accent/20 rounded-full border-t-dash-accent"
                  />
               </div>
               <div className="flex flex-col items-center gap-2">
                  <h3 className="text-2xl font-black text-white uppercase tracking-widest italic">Awaiting Input</h3>
                  <p className="text-xs text-dash-text-muted uppercase tracking-[0.2em]">Ultron is ready for voice, vision &amp; system control.</p>
               </div>
             </div>

             {/* Quick Desktop Control Actions */}
             <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
               <button
                 type="button"
                 onClick={() => onRunPythonAction('open_app', 'WhatsApp')}
                 className="px-3.5 py-2 rounded-xl bg-cyan-500/10 border border-cyan-400/30 hover:bg-cyan-500/20 text-cyan-300 text-[11px] font-mono uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-colors"
               >
                 <Zap className="w-3.5 h-3.5" />
                 Open WhatsApp.app
               </button>
               <button
                 type="button"
                 onClick={() => onRunPythonAction('status')}
                 className="px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/10 hover:border-cyan-400/35 text-slate-300 text-[11px] font-mono uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-colors"
               >
                 <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                 Python System Status
               </button>
             </div>

             {systemBanner && (
               <div className="px-4 py-2 rounded-xl bg-black/50 border border-cyan-400/25 text-cyan-200 text-[11.5px] font-mono max-w-xl text-center">
                 {systemBanner}
               </div>
             )}
          </div>
        )}
      </div>

      {/* Decorative corners */}
      <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-dash-accent/20 rounded-tl-3xl" />
      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-dash-accent/20 rounded-br-3xl" />
    </div>
  );
};
;

const SidebarRight = ({ 
  onGenerateVisual, 
  messages, 
  isActive, 
  onSendMessage 
}: { 
  onGenerateVisual: (type: string, title: string, explanation: string) => void;
  messages: { id: string; type: 'user' | 'ai'; text: string; label: string; time: string; imageUrl?: string }[];
  isActive: boolean;
  onSendMessage: (text: string, imageUrl?: string) => void;
}) => {
  const [inputValue, setInputValue] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!inputValue.trim() || !isActive) return;
    onSendMessage(inputValue);
    setInputValue('');
  };

  return (
    <div className="w-full lg:w-[320px] xl:w-[340px] shrink-0 border-l border-white/5 bg-dash-bg flex flex-col h-full relative z-20 transition-all duration-300">
      <div className="flex flex-col h-full ring-1 ring-white/5 shadow-2xl">
        <div className="p-4 pb-3 flex items-center justify-between border-b border-white/5 bg-black/20 backdrop-blur-md">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-dash-accent animate-pulse shadow-[0_0_8px_#00f2ff]' : 'bg-red-500'}`} />
              <h2 className="text-lg font-black text-white italic tracking-tighter uppercase">ULTRON</h2>
            </div>
            <p className="text-[9px] text-dash-text-muted font-mono tracking-widest uppercase">Command_Interface / {status === 'LOCAL MODE' ? 'local' : isActive ? 'active' : 'idle'}</p>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => onGenerateVisual('data', 'System_Parameters', 'Current configuration profile optimization active.')}
              className="p-2 glass-panel border-white/10 hover:border-dash-accent transition-colors cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-dash-text-muted hover:text-dash-accent" />
            </button>
            <button 
              onClick={() => onGenerateVisual('architecture', 'Global_Neural_Network', 'Visualizing the full spanning tree of the assistant architecture across all nodes.')}
              className="p-2 glass-panel border-white/10 hover:border-dash-accent transition-colors cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5 text-dash-text-muted hover:text-dash-accent" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden relative">
           <div 
            ref={scrollRef}
            className="absolute inset-0 p-4 py-5 flex flex-col gap-6 overflow-y-auto custom-scrollbar-stylish"
           >
              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ 
                      type: "spring", 
                      stiffness: 300, 
                      damping: 25 
                    }}
                    key={msg.id} 
                    className={`flex flex-col ${msg.type === 'user' ? 'items-end' : 'items-start'} gap-2`}
                  >
                    <div className="flex items-center gap-2 opacity-80">
                      {msg.type === 'ai' && <div className="w-1.5 h-1.5 rounded-full bg-dash-accent shadow-[0_0_8px_#00f2ff]" />}
                      <span className={`text-[8px] font-black uppercase tracking-[0.2em] ${msg.type === 'user' ? 'text-dash-text-muted' : 'text-dash-accent'}`}>
                        {msg.label}
                      </span>
                      {msg.type === 'user' && <div className="w-1 h-1 rounded-full bg-dash-text-muted" />}
                    </div>
                    
                    <div className={`px-5 py-3.5 max-w-[95%] relative group transition-all duration-500 shadow-lg ${
                      msg.type === 'user' 
                        ? 'bg-gradient-to-br from-white/[0.06] to-transparent border border-white/10 rounded-3xl rounded-tr-none hover:border-white/20' 
                        : 'bg-gradient-to-br from-dash-accent-dim/40 to-black/20 border border-dash-accent/25 rounded-3xl rounded-tl-none hover:border-dash-accent/40'
                    }`}>
                      {msg.imageUrl && (
                        <div className="mb-2 max-w-full overflow-hidden rounded-xl border border-white/10 aspect-video bg-black/40">
                          <img 
                            src={msg.imageUrl} 
                            alt="Uploaded photo" 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                      <p className={`text-[13px] leading-relaxed font-sans ${msg.type === 'user' ? 'text-white/85' : 'text-white'}`}>
                        {msg.text}
                      </p>
                      <span className={`absolute -bottom-5 ${msg.type === 'user' ? 'right-0' : 'left-0'} text-[7px] font-mono text-white/20 tracking-widest uppercase`}>
                        {msg.time}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {!isActive && messages.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 opacity-20 mt-20">
                  <MicOff className="w-16 h-16 text-dash-text-muted" />
                  <p className="text-xs uppercase tracking-widest font-mono">Activate Ultron to start the conversation.</p>
                </div>
              )}
           </div>
        </div>

        <div className="p-3.5 mt-auto flex flex-col gap-3 bg-black/20 border-t border-white/5">
           <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-dash-accent/20 to-transparent rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity blur-md" />
              <div className="relative glass-panel !rounded-2xl border-white/10 focus-within:border-dash-accent/40 bg-dash-card/90 p-1 flex items-center shadow-xl transition-all duration-300">
                <input 
                  type="file" 
                  accept="image/*"
                  className="hidden" 
                  id="chat-file-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        const dataUrl = reader.result as string;
                        onSendMessage(`Look at this photo / Ye photo dekho: ${file.name}`, dataUrl);
                      };
                      reader.readAsDataURL(file);
                      e.target.value = "";
                    }
                  }}
                />
                <button 
                  onClick={() => document.getElementById('chat-file-input')?.click()}
                  className={`p-2 transition-colors ${isActive ? 'text-dash-text-muted hover:text-dash-accent cursor-pointer' : 'text-dash-text-muted opacity-30 cursor-not-allowed'}`} 
                  disabled={!isActive}
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <input 
                  type="text" 
                  value={inputValue}
                  disabled={!isActive}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={isActive ? "Message Ultron..." : "ACTIVATE TO INPUT..."}
                  className="flex-1 bg-transparent border-none focus:outline-none text-[11px] text-white font-medium placeholder:text-dash-text-muted/50 tracking-wide disabled:cursor-not-allowed px-1"
                />
                <button 
                  onClick={handleSend}
                  disabled={!isActive}
                  className={`p-2 transition-all duration-300 ${isActive && inputValue.trim() ? 'text-dash-accent glow-accent' : 'text-dash-text-muted opacity-50 cursor-not-allowed'}`}
                >
                  <MessageSquare className="w-4 h-4 shadow-sm" />
                </button>
              </div>
           </div>
           
           <div className="flex items-center justify-between text-[8px] font-mono text-dash-text-muted/40 uppercase tracking-[0.3em]">
             <div className="flex items-center gap-3">
               <span className={isActive ? "text-dash-accent" : ""}>{isActive ? 'Ultron_Live' : 'Offline'}</span>
               <div className="w-1 h-1 rounded-full bg-dash-accent/30" />
               <span>Latency: {isActive ? '24ms' : '--'}</span>
             </div>
             {isActive && (
               <div className="flex gap-0.5 items-end h-2.5">
                  {[...Array(5)].map((_, i) => (
                    <motion.div 
                      key={i}
                      animate={{ height: [4, 10, 4] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
                      className="w-0.5 bg-dash-accent shadow-[0_0_5px_#00f2ff]" 
                    />
                  ))}
               </div>
             )}
           </div>
        </div>
      </div>
    </div>
  );
};

// --- Emotion Intelligence Profiles and Helpers ---
export interface Emotion {
  name: string;
  emoji: string;
  color: string;
  glowingColor: string;
  badgeClass: string;
  tagline: string;
}

export const AIRA_EMOTIONS: Record<string, Emotion> = {
  READY: { 
    name: "Ready & Vibe", 
    emoji: "💫", 
    color: "#00f2ff", 
    glowingColor: "rgba(0, 242, 255, 0.4)",
    badgeClass: "bg-dash-accent-dim/10 border-dash-accent/30 text-dash-accent",
    tagline: "Always with a witty comeback" 
  },
  SASSY: { 
    name: "Sassy & Bold", 
    emoji: "💅", 
    color: "#ec4899", 
    glowingColor: "rgba(236, 72, 153, 0.4)",
    badgeClass: "bg-pink-500/10 border-pink-500/30 text-pink-400",
    tagline: "Classy with double attitude" 
  },
  PLAYFUL: { 
    name: "Playful & Witty", 
    emoji: "🤪", 
    color: "#f59e0b", 
    glowingColor: "rgba(245, 158, 11, 0.4)",
    badgeClass: "bg-amber-500/10 border-amber-500/30 text-amber-500",
    tagline: "Treading on fun topics" 
  },
  WARM: { 
    name: "Warm & Caring", 
    emoji: "❤️", 
    color: "#ef4444", 
    glowingColor: "rgba(239, 68, 68, 0.4)",
    badgeClass: "bg-red-500/10 border-red-500/30 text-red-400",
    tagline: "Tender, supportive best friend" 
  },
  EXCITED: { 
    name: "Excited & Hyped", 
    emoji: "🚀", 
    color: "#10b981", 
    glowingColor: "rgba(16, 185, 129, 0.4)",
    badgeClass: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
    tagline: "Highly synchronized energy!" 
  },
  THINKING: { 
    name: "Analyzing Input", 
    emoji: "🤔", 
    color: "#8338ec", 
    glowingColor: "rgba(131, 56, 236, 0.4)",
    badgeClass: "bg-purple-500/10 border-purple-500/30 text-purple-400",
    tagline: "Sensing user feelings..." 
  },
  EMPATHETIC: { 
    name: "Empathetic & Deep", 
    emoji: "🥺", 
    color: "#8b5cf6", 
    glowingColor: "rgba(139, 92, 246, 0.4)",
    badgeClass: "bg-violet-500/10 border-violet-500/30 text-violet-400",
    tagline: "Here for your low moments" 
  },
};

export const USER_EMOTIONS: Record<string, { name: string, emoji: string, color: string }> = {
  CHILL: { name: "Chill Vibe", emoji: "😎", color: "text-blue-400 border-blue-500/25 bg-blue-500/5" },
  EXCITED: { name: "Hype / Energetic", emoji: "🤩", color: "text-emerald-400 border-emerald-500/25 bg-emerald-500/5" },
  CURIOUS: { name: "Curious Mind", emoji: "🧐", color: "text-indigo-400 border-indigo-500/25 bg-indigo-500/5" },
  SAD: { name: "Slightly Low", emoji: "🥺", color: "text-purple-400 border-purple-500/25 bg-purple-500/5" },
  PLAYFUL: { name: "Interactive Fun", emoji: "😜", color: "text-amber-400 border-amber-500/25 bg-amber-500/5" },
  ANGRY: { name: "Spicy / Passionate", emoji: "🔥", color: "text-orange-400 border-orange-500/25 bg-orange-500/5" },
};

export const detectAiraEmotion = (text: string): string => {
  const t = text.toLowerCase();
  if (t.includes('soch') || t.includes('samajh') || t.includes('umrr') || t.includes('hmm') || t.includes('ruko') || t.includes('wait') || t.includes('thinking')) {
    return 'THINKING';
  }
  if (t.includes('pyaar') || t.includes('care') || t.includes('sweet') || t.includes('cute') || t.includes('aww') || t.includes('dost') || t.includes('ache') || t.includes('shukriya') || t.includes('achha') || t.includes('heart')) {
    return 'WARM';
  }
  if (t.includes('haha') || t.includes('hehe') || t.includes('lol') || t.includes('mazak') || t.includes('chutki') || t.includes('masti') || t.includes('tease') || t.includes('gossip') || t.includes('fun')) {
    return 'PLAYFUL';
  }
  if (t.includes('excited') || t.includes('tufani') || t.includes('sick') || t.includes('wow') || t.includes('super') || t.includes('yo') || t.includes('hyped')) {
    return 'EXCITED';
  }
  if (t.includes('sad') || t.includes('pareshan') || t.includes('tension') || t.includes('low') || t.includes('ro mat') || t.includes('roiye') || t.includes('empathetic') || t.includes('sorry')) {
    return 'EMPATHETIC';
  }
  return 'SASSY'; // default to her signature sass
};

export const detectUserEmotion = (text: string): string => {
  const t = text.toLowerCase();
  if (t.includes('kya') || t.includes('kyu') || t.includes('how') || t.includes('why') || t.includes('kab') || t.includes('batao') || t.includes('?') || t.includes('what')) {
    return 'CURIOUS';
  }
  if (t.includes('gussa') || t.includes('angry') || t.includes('hate') || t.includes('bakwas') || t.includes('ghussa') || t.includes('chup')) {
    return 'ANGRY';
  }
  if (t.includes('sad') || t.includes('dukh') || t.includes('tension') || t.includes('pareshan') || t.includes('cry') || t.includes('akela') || t.includes('low') || t.includes('dard')) {
    return 'SAD';
  }
  if (t.includes('haha') || t.includes('masti') || t.includes('tease') || t.includes('mazak') || t.includes('lol') || t.includes('chal') || t.includes('abe')) {
    return 'PLAYFUL';
  }
  if (t.includes('wow') || t.includes('mst') || t.includes('sick') || t.includes('super') || t.includes('mazedar') || t.includes('gazab') || t.includes('bawal') || t.includes('great') || t.includes('best')) {
    return 'EXCITED';
  }
  return 'CHILL';
};

// --- Main Page ---

export default function App() {
  const [activeVisual, setActiveVisual] = React.useState<{
    title: string;
    explanation: string;
    type: 'ai' | 'neural' | 'data' | 'flowchart' | 'schematic' | 'architecture';
    timestamp: string;
  } | null>(null);

  const [isFullscreen, setIsFullscreen] = React.useState(false);
  
  // AIRA Live API State
  const [isActive, setIsActive] = React.useState(false);
  const [status, setStatus] = React.useState('READY');

  // macOS Desktop Permissions Tracker (never nags repeatedly once granted or dismissed)
  const [macPermissions, setMacPermissions] = React.useState<DesktopPermissionsStatus | null>(null);
  const [isPermissionModalOpen, setIsPermissionModalOpen] = React.useState(false);
  const [permActionMsg, setPermActionMsg] = React.useState<string | null>(null);

  const refreshMacPermissions = React.useCallback(async (allowAutoOpen: boolean = false) => {
    const api = (window as any).airaDesktop;
    if (!api?.isElectron || api.platform !== 'darwin' || !api.getPermissionsStatus) return;
    try {
      const st = await api.getPermissionsStatus();
      setMacPermissions(st);
      const dismissed = localStorage.getItem('aira_mac_perms_dismissed_v1') === '1';
      if (allowAutoOpen && !dismissed && !st.accessibility) {
        setIsPermissionModalOpen(true);
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    void refreshMacPermissions(true);
    const onFocus = () => {
      void refreshMacPermissions(false);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshMacPermissions]);

  // Core Modals & Persistent Store State (Memory, Skills, Character, Settings)
  const [coreState, setCoreState] = React.useState<CoreStoreState>(DEFAULT_CORE_STATE);
  const [isMemoryOpen, setIsMemoryOpen] = React.useState(false);
  const [isSkillsOpen, setIsSkillsOpen] = React.useState(false);
  const [isCharacterOpen, setIsCharacterOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [cameraInsight, setCameraInsight] = React.useState('');
  const [systemBanner, setSystemBanner] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/core')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ok && data.state) {
          setCoreState(data.state);
          if (data.state.settings?.voice?.voiceName) {
            setSelectedVoice(data.state.settings.voice.voiceName);
          }
        }
      })
      .catch((err) => console.warn('Failed to load /api/core:', err));
  }, []);
  const [audioLevel, setAudioLevel] = React.useState(0);
  const [messages, setMessages] = React.useState<{ id: string; type: 'user' | 'ai'; text: string; label: string; time: string }[]>([]);
  const [airaEmotion, setAiraEmotion] = React.useState<string>('READY');
  const [userEmotion, setUserEmotion] = React.useState<string>('CHILL');
  const [selectedVoice, setSelectedVoice] = React.useState<string>('Aoede');
  const airaRef = React.useRef<AssistantEngine | null>(null);
  const isConnectingRef = React.useRef(false);

  // Camera State
  const [isCameraOn, setIsCameraOn] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const toggleCamera = async () => {
    console.log("Toggle Camera Clicked. Current State:", isCameraOn);
    if (isCameraOn) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      setIsCameraOn(false);
      streamRef.current = null;
    } else {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Your browser doesn't seem to support camera access. Please try a modern browser like Chrome or Firefox.");
        return;
      }

      try {
        // First, check if any cameras exist
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        
        if (videoDevices.length === 0) {
          alert("No camera device was found on your system. Please connect a camera and try again.");
          return;
        }

        let stream: MediaStream | null = null;
        
        // Tiered attempts at getting the camera
        const strategies = [
          // 1. Ideal constraints
          () => navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } 
          }),
          // 2. Just user facing mode
          () => navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user' } 
          }),
          // 3. Absolute basic video
          () => navigator.mediaDevices.getUserMedia({ video: true })
        ];

        let lastError: any = null;
        for (const strategy of strategies) {
          try {
            console.log(`Attempting camera strategy...`);
            stream = await strategy();
            if (stream) break;
          } catch (e) {
            console.warn("Camera strategy failed, trying next...", e);
            lastError = e;
          }
        }

        if (!stream) {
          throw lastError || new Error("All camera strategies failed");
        }

        streamRef.current = stream;
        setIsCameraOn(true);
        console.log("Camera turned ON successfully.");
        
        // Deeper timeout for DOM synchronization
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
              videoRef.current?.play().catch(e => {
                console.error("Video play failed:", e);
                // If play failed, it might be due to user interaction requirement
                // but here it's already in an onClick handler, so it should work.
              });
            };
          }
        }, 500);
      } catch (err) {
        console.error("Camera Access Error:", err);
        const errorName = err instanceof Error ? err.name : "UnknownError";
        const errorMsg = err instanceof Error ? err.message : String(err);
        
        let userMessage = "Could not access camera.";
        if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError" || errorName === "OverconstrainedError") {
          userMessage = "No compatible camera found. If you have a camera, it might be in use by another app.";
        } else if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
          userMessage = "Camera permission was denied. Please check your browser's site settings for this page.";
        } else if (errorName === "NotReadableError" || errorName === "TrackStartError") {
          userMessage = "Camera is already in use by another application or tab.";
        }
        
        alert(`${userMessage}\n\nTechnical details: ${errorName} - ${errorMsg}`);
      }
    }
  };

  // Capture and send frames to Gemini + analyze camera mood periodically
  React.useEffect(() => {
    let frameInterval: any;
    let visionInterval: any;

    const captureFrame = (): string | null => {
      if (!videoRef.current) return null;
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) return null;
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.6).split(',')[1] || null;
    };

    if (isActive && isCameraOn) {
      const intervalMs = Math.max(1000, (coreState.settings.awareness.cameraIntervalSec || 2) * 1000);
      frameInterval = setInterval(() => {
        if (!airaRef.current) return;
        const base64 = captureFrame();
        if (base64) airaRef.current.sendVideoFrame(base64);
      }, intervalMs);
    }

    if (isCameraOn && coreState.settings.awareness.enabled) {
      const runVisionScan = async () => {
        const base64 = captureFrame();
        if (!base64) return;
        try {
          const resp = await fetch('/api/vision/emotion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64 }),
          });
          const data = await resp.json();
          if (data?.userEmotion) setUserEmotion(data.userEmotion);
          if (data?.airaTone) setAiraEmotion(data.airaTone);
          if (data?.summary) setCameraInsight(data.summary);
        } catch {}
      };
      const initialTimer = setTimeout(runVisionScan, 2500);
      visionInterval = setInterval(runVisionScan, 10000);
      return () => {
        clearTimeout(initialTimer);
        clearInterval(visionInterval);
        if (frameInterval) clearInterval(frameInterval);
      };
    }

    return () => {
      if (frameInterval) clearInterval(frameInterval);
      if (visionInterval) clearInterval(visionInterval);
    };
  }, [isActive, isCameraOn, coreState.settings.awareness.enabled, coreState.settings.awareness.cameraIntervalSec]);

  const runPythonSystemAction = async (action: string, target?: string) => {
    setSystemBanner(`Running Python agent: ${action}${target ? ` (${target})` : ''}...`);
    try {
      const data = await postWithApproval(
        '/api/system/action',
        target ? { action, target } : { action },
        describeSystemAction,
      );
      if (action === 'status' && data.ok) {
        setSystemBanner(
          `Python ${data.pythonVersion} · Active: ${data.frontmostApp || 'Desktop'} · ${data.battery || 'AC/Online'}`
        );
      } else if (action === 'open_app') {
        setSystemBanner(
          data.ok ? `Opened ${data.opened} (${data.mode})` : `Failed: ${data.error || 'Unknown error'}`
        );
      } else {
        setSystemBanner(data.ok ? 'Python action completed' : `Error: ${data.error || 'Failed'}`);
      }
    } catch (err: any) {
      setSystemBanner(`Python agent error: ${err?.message || 'Request failed'}`);
    }
  };

  const startAiraSession = async (overrideVoice?: string, overrideState?: CoreStoreState) => {
    if (status === 'CONNECTING...' || isConnectingRef.current) return;

    const activeState = overrideState || coreState;
    const voiceToUse =
      overrideVoice || activeState.settings.voice.voiceName || selectedVoice || 'Aoede';

    // Ultron: the browser never sees the Gemini key. The backend mints a
    // short-lived, single-use Live token for this session.
    let apiKey = '';
    try {
      const tokenRes = await fetch('/api/live-token', { method: 'POST' });
      const tokenData = await tokenRes.json();
      if (tokenData?.ok) apiKey = tokenData.token || '';
    } catch (e) {
      console.warn('Failed to get a voice session token:', e);
    }
    // No Gemini key: Ultron runs in local mode instead of refusing to start.
    const useLocal = !apiKey;
    isConnectingRef.current = true;
    setIsActive(true);
    setStatus('CONNECTING...');

    // Build dynamic system prompt from active Character, Skills, and Memories
    const allChars = [...BUILT_IN_CHARACTERS, ...activeState.customCharacters];
    const activeChar =
      allChars.find((c) => c.id === activeState.activeCharacterId) || BUILT_IN_CHARACTERS[0];
    const charPrefs = activeState.characterUserPrefs[activeChar.id];
    const activeSkills = activeState.skills.filter((s) => s.enabled);
    const pinnedMemories = activeState.memoryPaused
      ? []
      : activeState.memories.filter((m) => m.pinned);

    const promptParts = [
      `## CHARACTER: ${activeChar.name}\n${activeChar.prompt}`,
      charPrefs?.name || charPrefs?.callsYou
        ? `## USER CONTEXT\nUser name: ${charPrefs.name || activeState.settings.profile.fullName}. Address them naturally as: ${charPrefs.callsYou || charPrefs.name || 'Boss'}.${charPrefs.age ? ` Age: ${charPrefs.age}.` : ''}`
        : '',
      activeChar.awareness && activeState.settings.awareness.enabled
        ? `## AWARENESS\n${activeChar.awareness}`
        : '',
      pinnedMemories.length > 0
        ? `## ACTIVE MEMORIES\n${pinnedMemories.map((m) => `- ${m.title}: ${m.content}`).join('\n')}`
        : '',
      activeSkills.length > 0
        ? `## ENABLED SKILLS\nFollow these saved skills when relevant:\n${activeSkills.map((s) => `### ${s.name}\nWhen: ${s.whenToUse || s.description}\n${s.content}`).join('\n\n')}`
        : '',
      `## TALKING TONE, EMOTION & CAMERA AWARENESS\nNever sound robotic or scripted. Mirror the user's language naturally (Hindi, Hinglish, Urdu, or English) with expressive warmth, wit, and real emotional intelligence. Read their mood from both voice tone and live webcam frames (expression, posture, fatigue) and call 'updateEmotionState' when you notice their mood shift. Current camera mood reading: ${userEmotion}${cameraInsight ? ` (${cameraInsight})` : ''}.`,
      `## SYSTEM CONTROL TOOLS\nYou have NO built-in WhatsApp or Instagram UI inside Ultron. Whenever the user asks to open WhatsApp or any Mac app, or send a WhatsApp message, control their laptop directly using 'openApplication' (opens native WhatsApp.app, Google Chrome, Finder, Notes, Safari, etc.; Terminal and code runners are blocked), 'controlSystem' (screenshots, mouse clicks, typing, hotkeys, volume, clipboard, notifications, files in the Ultron workspace folder, read-only command presets), and 'screenTask' (multi-step screen-reading and click/type agent). Risky actions show the user an approval dialog first; if they decline, do not retry. STRICT HONESTY RULE: ONLY report success when 'openApplication', 'controlSystem', or 'screenTask' actually returns ok: true / done: true. If Accessibility or Screen Recording permission is missing or a step fails, tell the user honestly. ALWAYS explain visuals verbally after generating them.`,
    ]
      .filter(Boolean)
      .join('\n\n');

    // Always recreate service to ensure fresh state
    const callbacks: AIRALiveCallbacks = {
        onTranscription: (text, isUser) => {
          if (isUser) {
            const uEmo = detectUserEmotion(text);
            setUserEmotion(uEmo);
            setAiraEmotion('THINKING');
          } else {
            const aEmo = detectAiraEmotion(text);
            setAiraEmotion(aEmo);
          }

          setMessages((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).substr(2, 9),
              type: isUser ? 'user' : 'ai',
              text,
              label: isUser ? 'USER_VOICE' : 'ULTRON',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        },
        onStatusChange: (s) => {
          setStatus(s);
          if (s === 'FAILED' || s === 'ERROR' || s === 'DISCONNECTED') {
            setIsActive(false);
            isConnectingRef.current = false;
          }
        },
        onAudioLevelChange: (l) => setAudioLevel(l),
        onGenerateVisual: (type, title, explanation) => {
          setActiveVisual({
            type: type as any,
            title,
            explanation,
            timestamp: new Date().toLocaleTimeString(),
          });
        },
        onEmotionUpdate: (nextUserEmotion, nextAiraTone, reason) => {
          if (nextUserEmotion) setUserEmotion(nextUserEmotion.toUpperCase());
          if (nextAiraTone) setAiraEmotion(nextAiraTone.toUpperCase());
          if (reason) setCameraInsight(reason);
        },
        onSystemEvent: (label, detail) => {
          setSystemBanner(`${label}: ${detail}`);
        },
    };
    airaRef.current = useLocal
      ? new LocalAssistantService(callbacks, voiceToUse, promptParts)
      : new AIRALiveService(apiKey, callbacks, voiceToUse, {
          systemInstruction: promptParts,
          modelId: activeState.settings.voice.modelId,
        });
    try {
      await airaRef.current.connect();
    } catch (err) {
      console.error('AIRA connection error:', err);
      setIsActive(false);
      setStatus('CONNECTION FAILED');
    } finally {
      isConnectingRef.current = false;
    }
  };

  const toggleAira = async () => {
    if (status === 'CONNECTING...' || isConnectingRef.current) return;

    if (isActive) {
      airaRef.current?.terminate();
      setIsActive(false);
      setStatus('READY');
      setAiraEmotion('READY');
      setUserEmotion('CHILL');
    } else {
      await startAiraSession();
    }
  };

  const handleVoiceChange = async (nextVoice: string) => {
    const prevVoice = selectedVoice;
    setSelectedVoice(nextVoice);
    airaRef.current?.setVoice(nextVoice);
    if (isActive && nextVoice !== prevVoice) {
      airaRef.current?.terminate();
      setIsActive(false);
      setStatus('READY');
      await startAiraSession(nextVoice);
    }
  };

  const handleSendMessage = (text: string, imageUrl?: string) => {
    if (airaRef.current) {
      if (imageUrl) {
        const base64 = imageUrl.includes(",") ? imageUrl.split(',')[1] : imageUrl;
        airaRef.current.sendVideoFrame(base64);
      }
      airaRef.current.sendText(text);
      setMessages(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        type: 'user',
        text,
        label: imageUrl ? 'USER_PHOTO_UPLOAD' : 'USER_TEXT',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        imageUrl
      }]);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row lg:h-screen w-full bg-dash-bg text-white lg:overflow-hidden overflow-y-auto selection:bg-dash-accent/30 relative">
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden opacity-30">
         <div className="absolute top-[10%] left-[-5%] w-[40%] h-[40%] rounded-full blur-[120px] bg-dash-accent/10 sm:block hidden" />
         <div className="absolute bottom-[20%] right-[-5%] w-[35%] h-[35%] rounded-full blur-[100px] bg-dash-red/5 sm:block hidden" />
      </div>

      {/* Sidebar Left - Hidden on small mobile or shown differently */}
      <div className="hidden xl:block">
        <SidebarLeft 
          isCameraOn={isCameraOn} 
          videoRef={videoRef} 
          toggleCamera={toggleCamera}
          userEmotion={userEmotion}
          airaEmotion={airaEmotion}
          cameraInsight={cameraInsight}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      </div>

      {/* Center Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 p-4 min-h-0 relative z-10">
        {/* Top Section */}
        <div className="flex flex-col md:flex-row gap-4 h-auto lg:h-[350px]">
          <NeuralCoreDeck
            onOpenModal={(nodeId) => {
              if (nodeId === 'memory') setIsMemoryOpen(true);
              else if (nodeId === 'skills') setIsSkillsOpen(true);
              else if (nodeId === 'character') setIsCharacterOpen(true);
              else if (nodeId === 'setting') setIsSettingsOpen(true);
            }}
            isActive={isActive}
            onToggle={toggleAira}
            audioLevel={audioLevel}
            status={status}
            airaEmotion={airaEmotion}
            userEmotion={userEmotion}
            selectedVoice={selectedVoice}
            onSelectVoice={(v) => {
              setSelectedVoice(v);
              airaRef.current?.setVoice(v);
            }}
          />
        </div>

        {/* Bottom Section */}
        <VisualHub 
          activeVisual={activeVisual} 
          onToggleFullscreen={() => setIsFullscreen(true)}
          onRunPythonAction={runPythonSystemAction}
          systemBanner={systemBanner}
          permsReady={Boolean(macPermissions?.accessibility && macPermissions?.screen === 'granted')}
          onOpenPermissions={() => setIsPermissionModalOpen(true)}
        />
      </div>

      {/* Sidebar Right (Chat) */}
      <SidebarRight 
        isActive={isActive}
        messages={messages}
        onSendMessage={handleSendMessage}
        onGenerateVisual={(type, title, explanation) => {
          setActiveVisual({
            type: type as any,
            title,
            explanation,
            timestamp: new Date().toLocaleTimeString()
          });
        }} 
      />

      {/* Core Feature Modals (Memory, Skills, Character, Settings) */}
      <MemoryModal
        isOpen={isMemoryOpen}
        onClose={() => setIsMemoryOpen(false)}
        coreState={coreState}
        onRefresh={setCoreState}
      />
      <SkillsModal
        isOpen={isSkillsOpen}
        onClose={() => setIsSkillsOpen(false)}
        coreState={coreState}
        onRefresh={setCoreState}
      />
      <CharacterModal
        isOpen={isCharacterOpen}
        onClose={() => setIsCharacterOpen(false)}
        coreState={coreState}
        onRefresh={setCoreState}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        coreState={coreState}
        onRefresh={setCoreState}
        onSelectVoice={handleVoiceChange}
      />

      {/* macOS Permission Setup Modal */}
      {isPermissionModalOpen && macPermissions && (
        <div className="fixed inset-0 z-[220] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#0b1018] border border-cyan-400/30 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/35 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-amber-300" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">macOS System Control Permissions</h3>
                  <p className="text-xs text-white/55">
                    Allow Accessibility &amp; Screen Recording so Ultron can control mouse, keyboard &amp; apps.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  try { localStorage.setItem('aira_mac_perms_dismissed_v1', '1'); } catch {}
                  setIsPermissionModalOpen(false);
                }}
                className="text-xs font-mono text-white/50 hover:text-white cursor-pointer px-2 py-1"
              >
                Close
              </button>
            </div>

            <div className="space-y-2 text-xs">
              {[
                { label: 'Accessibility (Mouse & Keyboard)', ok: macPermissions.accessibility, pane: 'accessibility' as const },
                { label: 'Screen Recording (Screen Vision)', ok: macPermissions.screen === 'granted', pane: 'screen' as const },
                { label: 'Microphone (Voice)', ok: macPermissions.microphone === 'granted', pane: 'microphone' as const },
                { label: 'Camera (Mood & Vision)', ok: macPermissions.camera === 'granted', pane: 'camera' as const },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/10"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${item.ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <span className="text-white/90">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[10px] uppercase ${item.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {item.ok ? 'Granted' : 'Required'}
                    </span>
                    {!item.ok && (
                      <button
                        type="button"
                        onClick={() => window.airaDesktop?.openPrivacyPane?.(item.pane)}
                        className="px-2 py-1 rounded-lg bg-white/8 hover:bg-white/15 text-[10px] font-mono text-cyan-200 cursor-pointer"
                      >
                        Open Settings
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={async () => {
                  try { localStorage.setItem('aira_mac_perms_dismissed_v1', '1'); } catch {}
                  const updated = await (window as any).airaDesktop?.requestAllPermissions?.();
                  if (updated) setMacPermissions(updated);
                  setPermActionMsg('Triggered macOS permission prompts. Once granted, this popup will not ask again.');
                }}
                className="px-4 py-2 rounded-xl bg-cyan-400 text-black text-xs font-semibold hover:bg-cyan-300 cursor-pointer"
              >
                Request Permissions Now
              </button>
              <button
                type="button"
                onClick={async () => {
                  await window.airaDesktop?.revealAppInFinder?.();
                  setPermActionMsg('Opened Ultron.app in Finder — you can drag it into Accessibility/Screen Recording.');
                }}
                className="px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/15 text-xs text-white flex items-center gap-1.5 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-cyan-300" />
                Show in Finder
              </button>
              {!macPermissions.inApplications && (
                <button
                  type="button"
                  onClick={async () => {
                    const res = await window.airaDesktop?.installToApplications?.();
                    if (res?.ok) {
                      setPermActionMsg('Copied to /Applications/Ultron.app!');
                      void refreshMacPermissions();
                    } else {
                      setPermActionMsg(res?.error || 'Could not copy to /Applications');
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/35 hover:bg-emerald-500/30 text-xs text-emerald-200 cursor-pointer"
                >
                  Copy to /Applications
                </button>
              )}
            </div>

            {permActionMsg && (
              <p className="text-[11px] text-cyan-300 font-mono leading-relaxed">{permActionMsg}</p>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {isFullscreen && activeVisual && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/98 flex items-center justify-center p-4 md:p-8 backdrop-blur-2xl"
          >
            <div className="w-full h-full max-w-7xl flex flex-col gap-6 md:gap-8 relative">
              <button 
                onClick={() => setIsFullscreen(false)}
                className="absolute top-0 right-0 p-4 text-dash-text-muted hover:text-white transition-colors"
              >
                <LayoutGrid className="w-8 h-8" />
              </button>

              <div className="flex flex-col gap-2">
                <span className="text-dash-accent text-xs font-black tracking-[0.5em] uppercase">Visual Intelligence Engine v2.0</span>
                <h2 className="text-4xl font-black text-white uppercase tracking-tighter">{activeVisual.title}</h2>
              </div>

              <div className="flex-1 flex flex-col lg:flex-row gap-6 lg:gap-12 items-center lg:items-stretch overflow-hidden">
                <div className="flex-1 w-full glass-panel border-dash-accent/30 bg-dash-accent-dim/5 flex items-center justify-center p-4 lg:p-8 overflow-hidden relative group">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,242,255,0.05)_0%,transparent_100%)]" />
                  <div className="w-full h-full flex items-center justify-center">
                    <VisualContent type={activeVisual.type} title={activeVisual.title} isZoomed />
                  </div>
                </div>
                
                <div className="w-full lg:w-[450px] flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-dash-accent shadow-[0_0_8px_#00f2ff]" />
                    <span className="text-xs font-bold uppercase tracking-widest text-dash-accent">Expert Analysis</span>
                  </div>
                  <p className="text-sm leading-relaxed text-white/70 font-sans whitespace-pre-wrap italic">
                    {activeVisual.explanation}
                  </p>
                  <div className="mt-auto pt-8 border-t border-white/5 flex flex-col gap-4">
                    <div className="flex justify-between text-[10px] uppercase font-mono text-white/30">
                      <span>Source: Ultron_Core</span>
                      <span>{activeVisual.timestamp}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Scanline Effect */}
      <div className="fixed inset-0 pointer-events-none z-[100] opacity-[0.03] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
    </div>
  );
}
