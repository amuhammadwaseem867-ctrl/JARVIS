import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Phone, 
  MessageSquare, 
  QrCode, 
  Check, 
  CheckCheck, 
  Send, 
  PhoneCall, 
  ShieldCheck, 
  Zap, 
  Globe, 
  Network,
  XCircle,
  Clock,
  UserCheck,
  Mic
} from 'lucide-react';

interface Contact {
  name: string;
  status: string;
  lastSeen: string;
  avatar: string;
  phone: string;
}

interface Message {
  id: string;
  sender: string;
  text: string;
  time: string;
  isMe: boolean;
  status?: 'sent' | 'delivered' | 'read';
  audioUrl?: string;
  isAudio?: boolean;
}

interface WhatsAppBridgeViewProps {
  isLinked: boolean;
  onLink: () => void;
  contacts: Contact[];
  activeChatContact: string;
  onSelectChatContact: (name: string) => void;
  chats: Record<string, Message[]>;
  onSendChatMessage: (contactName: string, text: string, audioUrl?: string, audioBytes?: string) => void;
  activeCall: { contact: string; status: 'ringing' | 'connected' | 'ended'; duration: number } | null;
  onInitiateCall: (name: string) => void;
  onEndCall: () => void;
  isZoomed?: boolean;
  realQrCodeUrl?: string | null;
  realPairingCode?: string | null;
  onGenerateRealPairingCode?: (phone: string) => void;
  onResetSession?: () => void;
  onAddContact?: (name: string, phone: string, avatar?: string) => void;
  whatsAppCalls?: Array<{
    id: string;
    sender: string;
    senderName: string;
    type: 'incoming' | 'outgoing' | 'missed';
    time: string;
    duration?: string;
  }>;
}

const AudioPlayer: React.FC<{ src: string }> = ({ src }) => {
  const [playing, setPlaying] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState("0:00");

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.warn(e));
    }
    setPlaying(!playing);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const cur = audioRef.current.currentTime;
    const dur = audioRef.current.duration || 1;
    setProgress((cur / dur) * 100);
    
    const minutes = Math.floor(cur / 60);
    const seconds = Math.floor(cur % 60);
    setDuration(`${minutes}:${seconds < 10 ? '0' : ''}${seconds}`);
  };

  const handleEnded = () => {
    setPlaying(false);
    setProgress(0);
  };

  return (
    <div className="flex items-center gap-2.5 py-1 min-w-[180px] font-sans">
      <audio 
        ref={audioRef} 
        src={src} 
        onTimeUpdate={handleTimeUpdate} 
        onEnded={handleEnded}
        preload="metadata"
      />
      <button 
        onClick={togglePlay}
        className="w-8 h-8 rounded-full bg-dash-accent/15 border border-dash-accent/30 text-dash-accent flex items-center justify-center hover:bg-dash-accent/35 active:scale-90 transition-all cursor-pointer shrink-0"
      >
        {playing ? (
          <div className="flex gap-0.5 justify-center items-center">
            <span className="w-0.5 h-3 bg-dash-accent animate-pulse" />
            <span className="w-0.5 h-3.5 bg-dash-accent animate-pulse" />
          </div>
        ) : (
          <svg className="w-3 h-3 fill-dash-accent ml-0.5" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="h-1 bg-white/10 rounded-full overflow-hidden w-full relative">
          <div 
            className="absolute top-0 left-0 h-full bg-gradient-to-r from-dash-accent to-indigo-500 transition-all duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-[8px] font-mono text-white/40 tracking-wider">
          <span>VOICE NOTE</span>
          <span>{duration}</span>
        </div>
      </div>
    </div>
  );
};

export const WhatsAppBridgeView: React.FC<WhatsAppBridgeViewProps> = ({
  isLinked,
  onLink,
  contacts,
  activeChatContact,
  onSelectChatContact,
  chats,
  onSendChatMessage,
  activeCall,
  onInitiateCall,
  onEndCall,
  isZoomed = false,
  realQrCodeUrl = null,
  realPairingCode = null,
  onGenerateRealPairingCode,
  onResetSession,
  onAddContact,
  whatsAppCalls = []
}) => {
  const [linkMethod, setLinkMethod] = React.useState<'qr' | 'phone'>('qr');
  const [activeSidebarTab, setActiveSidebarTab] = React.useState<'chats' | 'calls'>('chats');
  const [phoneNumber, setPhoneNumber] = React.useState('');
  const [phoneError, setPhoneError] = React.useState('');
  const [countryCode, setCountryCode] = React.useState('+91');
  const [pairingCode, setPairingCode] = React.useState('');
  const [isGeneratingCode, setIsGeneratingCode] = React.useState(false);
  const [phoneProgress, setPhoneProgress] = React.useState<number | null>(null);

  const [qrProgress, setQrProgress] = React.useState<number | null>(null);
  const [localInput, setLocalInput] = React.useState('');

  // Dynamic Contact & Search State
  const [searchQuery, setSearchQuery] = React.useState('');
  const [showAddContactForm, setShowAddContactForm] = React.useState(false);
  const [newContactName, setNewContactName] = React.useState('');
  const [newContactPhone, setNewContactPhone] = React.useState('');
  const [newContactAvatar, setNewContactAvatar] = React.useState('👥');

  const handleSaveCustomContact = () => {
    if (!newContactName.trim()) {
      alert("Please specify a contact Name.");
      return;
    }
    if (!newContactPhone.trim()) {
      alert("Please specify JID Phone number.");
      return;
    }
    if (onAddContact) {
      onAddContact(newContactName.trim(), newContactPhone.trim(), newContactAvatar);
      // Reset
      setNewContactName('');
      setNewContactPhone('');
      setShowAddContactForm(false);
    }
  };
  
  // Voice Note Recording State
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = React.useState(false);
  const [recordingDuration, setRecordingDuration] = React.useState(0);
  const recordingTimerRef = React.useRef<any>(null);

  React.useEffect(() => {
    if (isRecording) {
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(recordingTimerRef.current);
    }
    return () => clearInterval(recordingTimerRef.current);
  }, [isRecording]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Your browser/frame doesn't support mic access or voice recording.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        // Convert to base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Data = reader.result as string;
          onSendChatMessage(activeChatContact, "[Voice Note]", base64Data, base64Data);
        };
        
        // Stop all tracks to clear native mic indicators
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
    } catch (err) {
      console.error("Failed to start speech message recording:", err);
      alert("Could not access microphone for live recording. Please check your browser's site permissions.");
    }
  };

  const stopAndSendRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = () => {
        const stream = mediaRecorderRef.current?.stream;
        stream?.getTracks().forEach(track => track.stop());
      };
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const chatEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat feed when chats or active chat updates
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chats, activeChatContact, isLinked]);

  const handleStartLinking = () => {
    setQrProgress(0);
    const interval = setInterval(() => {
      setQrProgress(prev => {
        if (prev === null) return null;
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            onLink();
            setQrProgress(null);
          }, 500);
          return 100;
        }
        return prev + 10;
      });
    }, 250);
  };

  React.useEffect(() => {
    if (realPairingCode) {
      setPairingCode(realPairingCode);
    }
  }, [realPairingCode]);

  const handleGeneratePhoneCode = async () => {
    setPhoneError('');
    if (!phoneNumber.trim()) {
      setPhoneError("Kripya apna mobile number enter karein!");
      return;
    }
    // Simple basic validation
    if (phoneNumber.length < 7) {
      setPhoneError("Kripya ek valid phone number enter karein (kam se kam 7 digits)!");
      return;
    }
    setIsGeneratingCode(true);
    
    if (onGenerateRealPairingCode) {
      try {
        const fullNumber = `${countryCode}${phoneNumber}`;
        onGenerateRealPairingCode(fullNumber);
      } catch (err) {
        console.error(err);
      }
    } else {
      setTimeout(() => {
        // Create a classic 8-character pairing code with a hyphen (e.g., Z4RF-G79X)
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let code1 = "";
        let code2 = "";
        for (let i = 0; i < 4; i++) {
          code1 += chars.charAt(Math.floor(Math.random() * chars.length));
          code2 += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        setPairingCode(`${code1}-${code2}`);
        setIsGeneratingCode(false);
      }, 1000);
    }
  };

  // Run auto completion check
  React.useEffect(() => {
    if (isGeneratingCode && realPairingCode) {
      setIsGeneratingCode(false);
    }
  }, [realPairingCode, isGeneratingCode]);

  const handleSimulatePhoneActivation = () => {
    setPhoneProgress(0);
    const interval = setInterval(() => {
      setPhoneProgress(prev => {
        if (prev === null) return null;
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            onLink();
            setPhoneProgress(null);
          }, 500);
          return 100;
        }
        return prev + 25;
      });
    }, 200);
  };

  const handleSend = () => {
    if (!localInput.trim()) return;
    onSendChatMessage(activeChatContact, localInput);
    setLocalInput('');
  };

  const renderCallingInterface = (call: typeof activeCall) => {
    if (!call) return null;
    
    const contactInfo = contacts.find(c => c.name === call.contact) || {
      name: call.contact,
      avatar: "👤",
      phone: "Voice Line"
    };

    const formatDuration = (s: number) => {
      const mins = Math.floor(s / 60).toString().padStart(2, '0');
      const secs = (s % 60).toString().padStart(2, '0');
      return `${mins}:${secs}`;
    };

    return (
      <div className="absolute inset-0 z-50 bg-[#070707] flex flex-col items-center justify-between p-8 font-mono">
        {/* Sky glow effect */}
        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-dash-accent/10 to-transparent pointer-events-none" />
        
        <div className="flex flex-col items-center gap-1 z-10 w-full mt-6">
          <div className="flex items-center gap-2 px-3 py-1 bg-dash-accent-dim/20 border border-dash-accent/30 rounded-full text-dash-accent text-[9px] uppercase tracking-[0.2em] animate-pulse">
            <Globe className="w-3 h-3" />
            <span>AIRA Quantum Voip Bridge</span>
          </div>
          <span className="text-white/40 text-[10px] uppercase mt-2">WhatsApp Call En Route</span>
        </div>

        <div className="flex flex-col items-center gap-6 z-10">
          <div className="relative">
            {/* Pulsing rings around avatar */}
            <AnimatePresence>
              {call.status === 'ringing' && (
                <>
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0.5 }}
                    animate={{ scale: 2.2, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ repeat: Infinity, duration: 2, ease: "easeOut" }}
                    className="absolute inset-0 bg-dash-accent/20 rounded-full border border-dash-accent/30"
                  />
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0.4 }}
                    animate={{ scale: 3.0, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ repeat: Infinity, duration: 2.5, ease: "easeOut", delay: 0.5 }}
                    className="absolute inset-0 bg-dash-accent/15 rounded-full border border-dash-accent/20"
                  />
                </>
              )}
            </AnimatePresence>
            
            <div className={`w-36 h-36 rounded-full border-2 ${call.status === 'connected' ? 'border-dash-accent shadow-[0_0_20px_#00f2ff]' : 'border-white/25'} bg-dash-card flex items-center justify-center text-6xl relative z-10 overflow-hidden`}>
              <span className="relative z-10">{contactInfo.avatar}</span>
              <div className="absolute inset-0 bg-gradient-to-tr from-black/60 to-transparent" />
            </div>
          </div>

          <div className="flex flex-col items-center text-center gap-1">
            <h4 className="text-2xl font-black text-white uppercase italic">{contactInfo.name}</h4>
            <span className="text-xs text-white/50 tracking-wider font-sans">{contactInfo.phone}</span>
            <span className={`text-[11px] font-black uppercase tracking-[0.3em] mt-3 ${call.status === 'connected' ? 'text-dash-accent' : 'text-dash-red animate-pulse'}`}>
              {call.status === 'ringing' ? 'RINGING...' : `CONNECTED / ${formatDuration(call.duration)}`}
            </span>
          </div>

          {call.status === 'connected' && (
            <div className="flex gap-1 h-8 items-end w-48 mt-2 justify-center">
              {[...Array(12)].map((_, i) => (
                <motion.div 
                  key={i}
                  animate={{ height: [8, Math.random() * 28 + 4, 8] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.05 }}
                  className="w-1 bg-dash-accent shadow-[0_0_6px_#00f2ff] rounded-full"
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-4 z-10 w-full mb-8">
          <button
            onClick={onEndCall}
            className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-white cursor-pointer hover:scale-110 active:scale-95 transition-all shadow-[0_0_20px_rgba(220,38,38,0.4)] border-none"
          >
            <XCircle className="w-8 h-8" />
          </button>
          <span className="text-[9px] text-white/30 uppercase tracking-widest font-sans">terminate connection</span>
        </div>
      </div>
    );
  };

  return (
    <div className="relative w-full h-full flex flex-col min-h-[400px] bg-[#070707] rounded-3xl overflow-hidden border border-white/5 shadow-2xl">
      {/* Background patterns */}
      <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

      {/* Embedded Active VoIP Screen Overlay */}
      {activeCall && renderCallingInterface(activeCall)}

      {!isLinked ? (
        // Link Setup Screen with QR/Phone tabs
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center font-mono relative z-10">
          <div className="absolute top-6 left-6 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-dash-red animate-pulse" />
            <span className="text-[9px] text-white/40 uppercase tracking-wider">Bridge State: Unlinked</span>
          </div>

          {/* Tab Selector */}
          <div className="flex bg-[#0f0f0f] border border-white/10 p-1 rounded-2xl gap-1 mb-4 z-20 select-none">
            <button 
              onClick={() => {
                setLinkMethod('qr');
                setPhoneError('');
              }}
              className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 border cursor-pointer ${
                linkMethod === 'qr' 
                  ? 'bg-dash-accent/15 text-dash-accent border-dash-accent/30 shadow-[0_0_15px_rgba(0,242,255,0.05)]' 
                  : 'text-white/40 hover:text-white/80 bg-transparent border-transparent'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              QR Code Link
            </button>
            <button 
              onClick={() => {
                setLinkMethod('phone');
                setPhoneError('');
              }}
              className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 border cursor-pointer ${
                linkMethod === 'phone' 
                  ? 'bg-dash-accent/15 text-dash-accent border-dash-accent/30 shadow-[0_0_15px_rgba(0,242,255,0.05)]' 
                  : 'text-white/40 hover:text-white/80 bg-transparent border-transparent'
              }`}
            >
              <Phone className="w-3.5 h-3.5" />
              Phone Number
            </button>
          </div>

          <div className="max-w-md w-full flex flex-col items-center gap-6">
            {linkMethod === 'qr' ? (
              // Option A: QR Code Screen
              <>
                <div 
                  onClick={handleStartLinking}
                  className="relative p-6 glass-panel border-dash-accent/40 bg-dash-card/50 rounded-3xl shadow-[0_0_30px_rgba(0,242,255,0.05)] group cursor-pointer"
                  title="Click QR or use your phone camera dynamically!"
                >
                  <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-dash-accent rounded-tl-xl" />
                  <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-dash-accent rounded-tr-xl" />
                  <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-dash-accent rounded-bl-xl" />
                  <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-dash-accent rounded-br-xl" />
                  
                  <div className="w-48 h-48 bg-white p-3 rounded-2xl flex items-center justify-center relative overflow-hidden transition-transform duration-500 group-hover:scale-[1.02]">
                    {realQrCodeUrl ? (
                      <img 
                        src={realQrCodeUrl} 
                        alt="WhatsApp Web Live QR" 
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <QrCode className="w-2/3 h-2/3 text-black/40 animate-pulse" />
                    )}
                    
                    {/* Visual scanning line effect */}
                    <motion.div 
                      animate={{ top: ['0%', '100%', '0%'] }} 
                      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                      className="absolute left-0 right-0 h-0.5 bg-dash-accent shadow-[0_0_10px_#00f2ff] opacity-80"
                    />
                  </div>
                  
                  <div className="absolute -bottom-3 inset-x-4 bg-black/90 border border-dash-accent/30 text-dash-accent text-[9px] py-1 rounded-full uppercase tracking-wider animate-pulse select-none text-center">
                    👉 Click QR to force link trial
                  </div>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <h3 className="text-xl font-black text-white uppercase italic tracking-wider">WhatsApp Quantum Link</h3>
                  <p className="text-[11px] text-dash-text-muted max-w-sm uppercase leading-relaxed font-sans mt-1">
                    Scan the QR code with WhatsApp on your phone or initiate automatic sandbox authentication below.
                  </p>
                  
                  {/* Contextual help in Hindi / Hinglish for best user comprehension in playground */}
                  <div className="mt-2 p-3 bg-dash-accent-dim/10 border border-dash-accent/20 rounded-xl text-[10px] text-dash-accent/90 max-w-sm text-left leading-normal font-sans">
                    💡 <strong>Playground Notice:</strong> Google AI Studio ke sandbox env me mobile QR code real link fail details bypass karne ke liye aap seedhe <strong>QR Code par click</strong> kar sakte hain, ya neeche di gayi <strong>"INITIATE SECURE SYNC"</strong> button dabayein! Isse aapka trial session turant sync ho jayega.
                  </div>
                </div>

                {qrProgress !== null ? (
                  <div className="w-64 mt-4">
                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: '0%' }}
                        animate={{ width: `${qrProgress}%` }}
                        className="h-full bg-dash-accent shadow-[0_0_10px_#00f2ff]" 
                      />
                    </div>
                    <div className="flex items-center justify-between text-[8px] text-dash-accent uppercase tracking-widest mt-2">
                      <span>Pairing Node Session...</span>
                      <span>{qrProgress}%</span>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleStartLinking}
                    className="mt-4 px-8 py-3.5 bg-dash-accent/15 border-2 border-dash-accent text-dash-accent rounded-2xl hover:bg-dash-accent/35 hover:scale-105 active:scale-95 transition-all text-xs font-black tracking-[0.2em] uppercase glow-accent cursor-pointer border-none flex items-center gap-3"
                  >
                    <Zap className="w-4 h-4" />
                    Initiate Secure Sync
                  </button>
                )}
              </>
            ) : (
              // Option B: Phone Number Pairing Screen
              <div className="w-full max-w-sm flex flex-col items-center gap-4 bg-dash-card/20 p-6 rounded-3xl border border-white/5">
                {!pairingCode ? (
                  // Phase 1: Enter Number
                  <div className="w-full flex flex-col gap-4 text-left">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] text-white/50 uppercase tracking-widest">Enter WhatsApp Mobile Number</label>
                      <div className="flex gap-2 font-sans">
                        <select 
                          value={countryCode} 
                          onChange={(e) => setCountryCode(e.target.value)}
                          className="bg-black/80 border border-white/10 text-white text-xs rounded-xl px-2.5 py-3 focus:outline-none focus:border-dash-accent/40 cursor-pointer"
                        >
                          <option value="+91">🇮🇳 IN (+91)</option>
                          <option value="+1">🇺🇸 US (+1)</option>
                          <option value="+44">🇬🇧 UK (+44)</option>
                          <option value="+971">🇦🇪 AE (+971)</option>
                        </select>
                        <input 
                          type="tel"
                          value={phoneNumber}
                          onChange={(e) => {
                            setPhoneNumber(e.target.value.replace(/\D/g, ''));
                            setPhoneError('');
                          }}
                          placeholder="e.g. 9876543210"
                          className="flex-1 bg-black/80 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-dash-accent/40 placeholder:text-white/20 tracking-wide font-mono"
                        />
                      </div>
                      {phoneError && (
                        <p className="text-[10px] text-dash-red tracking-wider uppercase mt-1 font-mono">{phoneError}</p>
                      )}
                    </div>

                    <div className="p-3.5 bg-dash-accent-dim/10 border border-dash-accent/25 rounded-xl text-[10.5px] text-dash-accent/95 leading-relaxed font-sans">
                      💬 <strong>Mobile Link Step:</strong> Jab aap apna target number daalkar check karenge, tab AIRA Quantum server aapki device ke liye ek <strong>8-character verification pairing code</strong> generate karega. Is code ko apne WhatsApp app par enter karein.
                    </div>

                    <button
                      onClick={handleGeneratePhoneCode}
                      disabled={isGeneratingCode}
                      className="w-full py-3.5 bg-dash-accent/15 hover:bg-dash-accent/25 border-2 border-dash-accent hover:border-dash-accent text-dash-accent rounded-xl hover:scale-[1.02] active:scale-95 transition-all text-xs font-black tracking-[0.2em] uppercase cursor-pointer flex items-center justify-center gap-2.5"
                    >
                      {isGeneratingCode ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-dash-accent border-t-transparent rounded-full animate-spin" />
                          Generating Pairing Node...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          Generte Pairing Code
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  // Phase 2: Enter pairing code in mobile simulation
                  <div className="w-full flex flex-col items-center gap-5">
                    <div className="text-center">
                      <span className="text-[9px] text-white/40 uppercase tracking-widest">Active Verification pairing Key</span>
                      
                      {/* Pairing Code Grid (8 Characters separated as standard WhatsApp Web) */}
                      <div className="flex items-center gap-2 mt-2 select-all font-mono">
                        {pairingCode.split('').map((char, index) => {
                          if (char === '-') {
                            return (
                              <span key={index} className="text-dash-accent text-2xl px-1 font-sans font-black select-none opacity-40">-</span>
                            );
                          }
                          return (
                            <div 
                              key={index} 
                              className="w-9 h-11 bg-black border border-dash-accent/30 rounded-lg flex items-center justify-center text-xl font-black text-white text-center shadow-[0_0_12px_rgba(0,242,255,0.06)]"
                            >
                              {char}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="w-full flex flex-col gap-2.5 text-left text-[11px] font-sans text-dash-text-muted leading-snug border-t border-b border-white/5 py-4">
                      <div className="flex gap-2">
                        <span className="text-dash-accent font-black">1.</span>
                        <p>Apne phone par **WhatsApp** open karein.</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-dash-accent font-black">2.</span>
                        <p>Settings / Linked Devices (शीर्ष 3 बिन्दु) me **"Link a Device"** chunein.</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-dash-accent font-black">3.</span>
                        <p>Screen par **"Link with phone number instead" (फ़ोन नंबर से लिंक करें)** option par tap karein.</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-dash-accent font-black">4.</span>
                        <p>Apne phone screen me upar diya gaya **{pairingCode}** code daalein.</p>
                      </div>
                    </div>

                    {phoneProgress !== null ? (
                      <div className="w-full">
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: '0%' }}
                            animate={{ width: `${phoneProgress}%` }}
                            className="h-full bg-dash-accent shadow-[0_0_10px_#00f2ff]" 
                          />
                        </div>
                        <div className="flex items-center justify-between text-[8px] text-dash-accent uppercase tracking-widest mt-2">
                          <span>Connecting & Syncing chats via {countryCode} {phoneNumber}...</span>
                          <span>{phoneProgress}%</span>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full flex flex-col gap-2 mt-1">
                        <button
                          onClick={handleSimulatePhoneActivation}
                          className="w-full py-3.5 bg-dash-accent/20 hover:bg-dash-accent/30 border border-dash-accent/30 hover:border-dash-accent rounded-xl hover:scale-[1.02] active:scale-95 transition-all text-xs font-black tracking-widest uppercase cursor-pointer"
                        >
                          ✅ Confirm Code Entered on Phone
                        </button>
                        
                        <button
                          onClick={() => {
                            setPairingCode('');
                            setPhoneProgress(null);
                          }}
                          className="w-full py-2 text-white/30 hover:text-white/60 text-[9px] uppercase tracking-wider cursor-pointer border-none bg-transparent"
                        >
                          Change Phone Number
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="absolute bottom-6 right-6 flex items-center gap-2 text-[9px] text-white/20">
            <ShieldCheck className="w-4 h-4 text-dash-accent/30" />
            <span>ECC-256 Symmetric Session Encryption</span>
          </div>
        </div>
      ) : (
        // Connected Chat Hub Interface
        <div className="flex-1 flex flex-row min-h-[400px] z-10 divide-x divide-white/5">
          {/* Chat Sidebar (Contacts) */}
          <div className="w-1/3 flex flex-col h-full bg-black/30">
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-dash-accent animate-pulse" />
                <span className="text-[10px] font-black text-white/80 tracking-widest uppercase font-mono">Sync_Endpoints</span>
              </div>
              <span className="text-[8px] bg-dash-accent/10 text-dash-accent border border-dash-accent/20 px-2 py-0.5 rounded font-mono uppercase">ONLINE</span>
            </div>

            {/* Sidebar Tabs */}
            <div className="px-3 py-2 border-b border-white/5 flex gap-1.5 bg-white/[0.01]">
              <button
                onClick={() => setActiveSidebarTab('chats')}
                className={`flex-1 py-1.5 rounded-lg border text-[9px] font-mono text-center transition-all cursor-pointer font-bold uppercase tracking-wider ${
                  activeSidebarTab === 'chats'
                    ? 'bg-dash-accent/10 border-dash-accent/30 text-dash-accent'
                    : 'bg-transparent border-transparent text-white/30 hover:text-white/60'
                }`}
              >
                Chats
              </button>
              <button
                onClick={() => setActiveSidebarTab('calls')}
                className={`flex-1 py-1.5 rounded-lg border text-[9px] font-mono text-center transition-all cursor-pointer font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 ${
                  activeSidebarTab === 'calls'
                    ? 'bg-dash-accent/10 border-dash-accent/30 text-dash-accent'
                    : 'bg-transparent border-transparent text-white/30 hover:text-white/60'
                }`}
              >
                Calls
                {(whatsAppCalls || []).filter(c => c.type === 'missed').length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-dash-red animate-ping" />
                )}
              </button>
            </div>

            {activeSidebarTab === 'chats' ? (
              <>
                {/* Search and Node Injection Bar */}
                <div className="px-3 py-2 border-b border-white/5 bg-black/15 flex items-center gap-2">
                  <input 
                    type="text"
                    placeholder="Search context or JID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2 text-[11px] text-white focus:outline-none focus:border-dash-accent/35 tracking-wide placeholder:text-white/25 font-sans"
                  />
                  <button
                    onClick={() => setShowAddContactForm(!showAddContactForm)}
                    title="Add Custom Contact node"
                    className="p-1.5 bg-dash-accent/10 hover:bg-dash-accent/25 border border-dash-accent/25 rounded-lg text-dash-accent hover:scale-105 active:scale-95 transition-all cursor-pointer text-[10px] font-mono font-bold flex items-center gap-1 shrink-0 uppercase tracking-wider"
                  >
                    <span>+</span>
                    <span>Node</span>
                  </button>
                </div>

                {/* Inline custom addition form */}
                {showAddContactForm && (
                  <div className="p-3 m-2 rounded-xl bg-black/50 border border-dash-accent/25 flex flex-col gap-2 font-sans relative z-30">
                    <div className="flex justify-between items-center bg-white/[0.01] p-1 rounded-md mb-0.5">
                      <span className="text-[9px] font-black text-dash-accent uppercase tracking-widest font-mono">➕ Inject Contact Node</span>
                      <button 
                        onClick={() => setShowAddContactForm(false)}
                        className="text-[9px] text-white/40 hover:text-dash-red font-bold uppercase tracking-wider bg-transparent border-none cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <input
                        type="text"
                        placeholder="Name (e.g. Mom Real)"
                        value={newContactName}
                        onChange={(e) => setNewContactName(e.target.value)}
                        className="bg-[#0b0b0b] border border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-dash-accent/30 font-sans"
                      />
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="Phone (e.g. 919876543210)"
                          value={newContactPhone}
                          onChange={(e) => setNewContactPhone(e.target.value.replace(/[^0-9+]/g, ''))}
                          className="flex-1 bg-[#0b0b0b] border border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-dash-accent/30 font-mono"
                        />
                        <select
                          value={newContactAvatar}
                          onChange={(e) => setNewContactAvatar(e.target.value)}
                          className="bg-[#0b0b0b] border border-[#222] rounded-lg px-2 text-xs text-white cursor-pointer focus:outline-none focus:border-dash-accent/35"
                        >
                          <option value="👩‍🦰">👩‍🦰</option>
                          <option value="👨‍💻">👨‍💻</option>
                          <option value="💼">💼</option>
                          <option value="🚴‍♂️">🚴‍♂️</option>
                          <option value="👤">👤</option>
                          <option value="❤️">❤️</option>
                          <option value="👑">👑</option>
                        </select>
                      </div>
                      <p className="text-[7.5px] text-white/35 leading-normal font-sans">
                        * Include country code directly (e.g. 91 for India, 1 for US) with no spaces. Must be on WhatsApp.
                      </p>
                    </div>
                    <button
                      onClick={handleSaveCustomContact}
                      className="py-1.5 w-full bg-dash-accent/15 hover:bg-dash-accent/30 text-dash-accent border border-dash-accent/30 hover:border-dash-accent/60 rounded-lg text-[9px] font-bold uppercase tracking-wider font-mono cursor-pointer transition-all active:scale-95 text-center mt-1"
                    >
                      Establish Connection Route
                    </button>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-1">
                  {(() => {
                    const filteredContacts = searchQuery
                      ? contacts.filter(c => 
                          c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          c.phone.replace(/\D/g, '').includes(searchQuery.replace(/\D/g, ''))
                        )
                      : contacts;

                    if (filteredContacts.length === 0) {
                      return (
                        <div className="p-4 text-center border border-dashed border-white/5 rounded-2xl m-2 bg-white/[0.01]">
                          <p className="text-[10px] text-white/30 font-mono uppercase tracking-widest mb-2">No Contact Route Found</p>
                          {searchQuery ? (
                            <button
                              onClick={() => {
                                setNewContactName(searchQuery);
                                setShowAddContactForm(true);
                              }}
                              className="text-[9px] text-dash-accent hover:underline font-bold uppercase tracking-widest font-mono cursor-pointer border-none bg-transparent"
                            >
                              + Create Node "{searchQuery}"
                            </button>
                          ) : (
                            <span className="text-[9px] text-white/20 font-mono">List empty. Use "+ Node" to inject.</span>
                          )}
                        </div>
                      );
                    }

                    return filteredContacts.map((contact) => {
                      const isSelected = contact.name === activeChatContact;
                      const contactChats = chats[contact.name] || [];
                      const lastMsg = contactChats[contactChats.length - 1];

                      // Calculate how many calls received for this contact
                      const receivedCallCount = (whatsAppCalls || []).filter(
                        c => c.senderName === contact.name && (c.type === 'incoming' || c.type === 'missed')
                      ).length;

                      return (
                        <button
                          key={contact.name}
                          id={`contact-${contact.name.replace(/\s+/g, '-').toLowerCase()}`}
                          onClick={() => {
                            onSelectChatContact(contact.name);
                          }}
                          className={`p-3 rounded-2xl flex items-center gap-3 transition-all hover:bg-white/[0.04] text-left border-none w-full cursor-pointer ${
                            isSelected 
                              ? 'bg-gradient-to-br from-dash-accent-dim/30 to-transparent border border-dash-accent/20' 
                              : 'bg-transparent border border-transparent'
                          }`}
                        >
                          <div className="w-10 h-10 rounded-full bg-dash-card border border-white/10 flex items-center justify-center text-lg relative shrink-0">
                            <span>{contact.avatar}</span>
                            {contact.status === 'Online' && (
                              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-dash-accent rounded-full border border-[#070707] shadow-[0_0_6px_#00f2ff]" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0 font-sans">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-black text-white uppercase italic truncate">
                                {contact.name}
                              </span>
                              {lastMsg && (
                                <span className="text-[7px] text-white/20 font-mono shrink-0 ml-1">{lastMsg.time}</span>
                              )}
                            </div>
                            <div className="flex items-center justify-between mt-1 gap-1.5">
                              <p className="text-[10px] text-dash-text-muted truncate font-light flex-1">
                                {lastMsg ? lastMsg.text : 'Awaiting sync transmission.'}
                              </p>
                              {receivedCallCount > 0 && (
                                <span className="text-[8px] bg-dash-accent/15 text-dash-accent border border-dash-accent/30 px-1.5 py-0.5 rounded-md font-mono font-bold flex items-center gap-1 shrink-0 scale-90" title={`${receivedCallCount} Calls Received`}>
                                  <Phone className="w-2 h-2 text-dash-accent" />
                                  <span>{receivedCallCount}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    });
                  })()}
                </div>
              </>
            ) : (
              <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-1.5">
                {(whatsAppCalls || []).map((call) => {
                  const isMissed = call.type === 'missed';
                  const isIncoming = call.type === 'incoming';
                  const isOutgoing = call.type === 'outgoing';
                  
                  return (
                    <div
                      key={call.id}
                      className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs border shrink-0 ${
                          isMissed 
                            ? 'bg-dash-red/10 border-dash-red/20 text-dash-red' 
                            : isOutgoing 
                            ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                            : 'bg-green-500/10 border-green-500/25 text-green-400'
                        }`}>
                          <Phone className="w-3.5 h-3.5" />
                        </div>
                        
                        <div className="flex flex-col min-w-0 font-sans">
                          <span className="text-xs font-black text-white uppercase italic truncate">{call.senderName}</span>
                          <div className="flex items-center gap-1 mt-0.5 font-mono text-[7px] text-white/40 tracking-wider">
                            <span className={`w-1 h-1 rounded-full ${
                              isMissed ? 'bg-dash-red' : isOutgoing ? 'bg-blue-400' : 'bg-green-400'
                            }`} />
                            <span className="uppercase">{call.type}</span>
                            <span>•</span>
                            <span className="truncate">{call.time}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0 font-mono text-[9px] text-right">
                        {call.duration && call.duration !== "00:00" ? (
                          <span className="text-white/60 font-semibold">{call.duration}</span>
                        ) : (
                          <span className="text-dash-red bg-dash-red/5 border border-dash-red/10 text-[7px] px-1 py-0.2 rounded font-black tracking-widest uppercase">Missed</span>
                        )}
                        <button
                          onClick={() => {
                            // Find corresponding contact matching name/phone to select chat then call
                            const match = contacts.find(c => c.name === call.senderName || c.phone === call.sender);
                            if (match) onSelectChatContact(match.name);
                            onInitiateCall(call.senderName);
                          }}
                          className="text-[7px] text-dash-accent hover:text-white uppercase font-bold tracking-widest transition-colors cursor-pointer border-none bg-transparent"
                        >
                          CALL
                        </button>
                      </div>
                    </div>
                  );
                })}

                {(whatsAppCalls || []).length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-white/20 select-none">
                    <PhoneCall className="w-8 h-8 text-white/5 animate-pulse mb-3" />
                    <span className="text-[10px] uppercase font-mono tracking-widest font-black">No Call Logs</span>
                    <p className="text-[8px] max-w-[150px] mt-1 italic font-light font-sans text-white/10 leading-normal">
                      Real incoming peer calls will sync here automatically.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Core Chat Console */}
          <div className="flex-1 flex flex-col h-full bg-[#0a0a0a]/50">
            {/* Header */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/20 font-mono">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-dash-card border border-white/10 flex items-center justify-center text-lg shrink-0">
                  <span>{(contacts.find(c => c.name === activeChatContact) || { avatar: "👤" }).avatar}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-white uppercase italic">{activeChatContact}</span>
                  <span className="text-[8px] text-dash-accent flex items-center gap-1.5 uppercase tracking-wider font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-dash-accent animate-pulse" />
                    <span>Secure Sync Stream</span>
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => onInitiateCall(activeChatContact)}
                  className="p-2.5 hover:bg-dash-accent-dim/20 rounded-xl border border-white/5 hover:border-dash-accent/40 text-dash-text-muted hover:text-dash-accent transition-all cursor-pointer bg-none"
                  title="Initiate Peer VoIP Call"
                >
                  <Phone className="w-4 h-4" />
                </button>

                {onResetSession && (
                  <button
                    onClick={onResetSession}
                    className="p-2.5 hover:bg-dash-red/10 rounded-xl border border-white/5 hover:border-dash-red/40 text-dash-text-muted hover:text-dash-red transition-all cursor-pointer bg-none font-sans flex items-center gap-1 text-[10px] uppercase font-bold"
                    title="Reset Session / Log out"
                  >
                    <XCircle className="w-4 h-4" />
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar-stylish flex flex-col gap-4 bg-gradient-to-b from-transparent to-black/10">
              {(chats[activeChatContact] || []).map((msg) => (
                <div 
                  key={msg.id} 
                  className={`flex flex-col ${msg.isMe ? 'items-end' : 'items-start'} gap-1 font-sans`}
                >
                  <div className={`px-4 py-2.5 max-w-[80%] rounded-2xl text-xs leading-relaxed shadow-md relative group ${
                    msg.isMe 
                      ? 'bg-gradient-to-br from-dash-accent-dim/40 to-black/20 border border-dash-accent/25 text-white rounded-tr-none' 
                      : 'bg-white/[0.04] border border-white/5 text-white/90 rounded-tl-none'
                  }`}>
                    {msg.isAudio && msg.audioUrl ? (
                      <AudioPlayer src={msg.audioUrl} />
                    ) : (
                      msg.text
                    )}
 
                    <div className="absolute -bottom-4 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none duration-300">
                      <span className="text-[7px] text-white/20 font-mono tracking-widest">{msg.time}</span>
                      {msg.isMe && (
                        msg.status === 'read' ? (
                          <CheckCheck className="w-3 h-3 text-dash-accent" />
                        ) : (
                          <Check className="w-3 h-3 text-white/30" />
                        )
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
 
            {/* Input Bar */}
            <div className="p-3 border-t border-white/5 bg-black/10 flex items-center gap-2">
              {isRecording ? (
                <div className="flex-1 bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-2 flex items-center justify-between gap-3 font-mono">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                    <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">RECORDING VOICE</span>
                    <span className="text-xs text-white/80">{formatDuration(recordingDuration)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={cancelRecording}
                      title="Discard Recording"
                      className="p-1.5 bg-white/5 hover:bg-red-500/20 text-white/50 hover:text-red-400 border border-transparent hover:border-red-500/30 rounded-lg transition-all cursor-pointer"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                    <button
                      onClick={stopAndSendRecording}
                      title="Send Voice Note"
                      className="p-1.5 bg-dash-accent/15 border border-dash-accent/30 text-dash-accent hover:bg-dash-accent hover:text-black rounded-lg transition-all cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <input 
                    type="text"
                    value={localInput}
                    onChange={(e) => setLocalInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder={`Encrypt message payload to ${activeChatContact}...`}
                    className="flex-1 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-dash-accent/40 focus:bg-white/[0.05] tracking-wide font-sans placeholder:text-white/20"
                  />
                  <button
                    onClick={startRecording}
                    title="Record Voice Note"
                    className="p-3 bg-white/[0.03] hover:bg-dash-accent/10 border border-white/10 hover:border-dash-accent/35 text-white/40 hover:text-dash-accent rounded-xl hover:scale-105 active:scale-95 transition-all cursor-pointer"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleSend}
                    className="p-3 bg-dash-accent-dim/30 hover:bg-dash-accent-dim/60 border border-dash-accent/30 hover:border-dash-accent/60 rounded-xl text-dash-accent hover:scale-105 active:scale-95 transition-all cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
