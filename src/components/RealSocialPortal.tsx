import React from 'react';
import {
  MessageCircle,
  ExternalLink,
  RefreshCw,
  Smartphone,
  QrCode,
  Instagram,
  Monitor,
  CheckCircle2,
  AlertCircle,
  Send,
  Plus,
  User,
  LogOut,
} from 'lucide-react';

export interface DesktopPermissionsStatus {
  platform: string;
  accessibility: boolean;
  screen: string;
  microphone: string;
  camera: string;
  appPath?: string;
  inApplications?: boolean;
}

declare global {
  interface Window {
    airaDesktop?: {
      isElectron: boolean;
      platform: string;
      openExternal: (url: string) => Promise<{ ok: boolean }>;
      openApp: (target: string) => Promise<{ ok: boolean; opened?: string; error?: string }>;
      openWebWindow: (opts: { url: string; title?: string; partition?: string }) => Promise<{ ok: boolean }>;
      getPermissionsStatus?: () => Promise<DesktopPermissionsStatus>;
      requestAllPermissions?: () => Promise<DesktopPermissionsStatus>;
      openPrivacyPane?: (pane: 'accessibility' | 'screen' | 'microphone' | 'camera' | 'automation') => Promise<{ ok: boolean }>;
      revealAppInFinder?: () => Promise<{ ok: boolean; path?: string }>;
      installToApplications?: () => Promise<{ ok: boolean; path?: string; error?: string }>;
    };
  }
}

export interface RealContact {
  name: string;
  phone: string;
  avatar: string;
  status: string;
  lastSeen: string;
}

export interface RealChatMessage {
  id: string;
  sender: string;
  text: string;
  time: string;
  isMe: boolean;
  status?: 'sent' | 'delivered' | 'read';
}

interface RealSocialPortalProps {
  initialTab?: 'baileys' | 'instagram';
  realQrCodeUrl: string | null;
  realPairingCode: string | null;
  isLinked: boolean;
  whatsAppStatus?: string;
  accountUser?: { id?: string; name?: string } | null;
  contacts?: RealContact[];
  chats?: Record<string, RealChatMessage[]>;
  activeChatContact?: string | null;
  onSelectChatContact?: (name: string) => void;
  onSendChatMessage?: (contactName: string, text: string) => void;
  onAddContact?: (name: string, phone: string) => void;
  onRequestQr?: () => void;
  onGenerateRealPairingCode: (phone: string) => void;
  onResetSession: () => void;
  onLaunchApp: (target: string) => void;
}

export const RealSocialPortal = ({
  initialTab = 'baileys',
  realQrCodeUrl,
  realPairingCode,
  isLinked,
  whatsAppStatus = 'disconnected',
  accountUser = null,
  contacts = [],
  chats = {},
  activeChatContact = null,
  onSelectChatContact,
  onSendChatMessage,
  onAddContact,
  onRequestQr,
  onGenerateRealPairingCode,
  onResetSession,
  onLaunchApp,
}: RealSocialPortalProps) => {
  const isElectron = Boolean(window.airaDesktop?.isElectron);
  const [activeTab, setActiveTab] = React.useState<'baileys' | 'instagram'>(initialTab);
  const [phoneInput, setPhoneInput] = React.useState('');
  const [statusMsg, setStatusMsg] = React.useState<string | null>(null);
  const [replyText, setReplyText] = React.useState('');
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');
  const webviewRef = React.useRef<any>(null);

  React.useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const selectedContactName =
    activeChatContact && (contacts.some((c) => c.name === activeChatContact) || chats[activeChatContact])
      ? activeChatContact
      : contacts[0]?.name || Object.keys(chats)[0] || null;
  const activeMessages = selectedContactName ? chats[selectedContactName] || [] : [];

  const openRealWindow = async (url: string, title: string, partition: string) => {
    if (window.airaDesktop?.openWebWindow) {
      await window.airaDesktop.openWebWindow({ url, title, partition });
      setStatusMsg(`Opened ${title} in native Electron session.`);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
      setStatusMsg(`Opened ${title} in browser tab.`);
    }
  };

  const reloadWebview = () => {
    try {
      webviewRef.current?.reload?.();
    } catch {}
  };

  return (
    <div className="w-full h-full min-h-[380px] flex flex-col bg-[#080d14] rounded-2xl border border-white/10 overflow-hidden">
      {/* Top Toolbar */}
      <div className="px-4 py-2.5 bg-black/40 border-b border-white/8 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('baileys')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-colors ${
              activeTab === 'baileys'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/35'
                : 'text-white/55 hover:text-white border border-transparent'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            My WhatsApp Sync
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('instagram')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-mono uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-colors ${
              activeTab === 'instagram'
                ? 'bg-pink-500/20 text-pink-300 border border-pink-400/35'
                : 'text-white/55 hover:text-white border border-transparent'
            }`}
          >
            <Instagram className="w-3.5 h-3.5" />
            Instagram
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onLaunchApp('WhatsApp')}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-[10.5px] font-mono text-emerald-200 flex items-center gap-1.5 cursor-pointer"
          >
            <Monitor className="w-3 h-3 text-emerald-400" />
            Open WhatsApp.app
          </button>
          {isElectron && activeTab === 'instagram' && (
            <>
              <button
                type="button"
                onClick={reloadWebview}
                title="Reload Instagram"
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => openRealWindow('https://www.instagram.com', 'Instagram', 'persist:instagram')}
                className="px-2.5 py-1.5 rounded-lg bg-pink-500/15 hover:bg-pink-500/25 border border-pink-400/30 text-[10.5px] font-mono text-pink-200 flex items-center gap-1.5 cursor-pointer"
              >
                <ExternalLink className="w-3 h-3" />
                Pop Out
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 relative flex flex-col">

        {activeTab === 'instagram' &&
          (isElectron ? (
            React.createElement('webview', {
              ref: webviewRef,
              src: 'https://www.instagram.com',
              partition: 'persist:instagram',
              useragent:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              className: 'w-full flex-1 bg-black',
              style: { width: '100%', height: '100%', minHeight: '360px' },
              allowpopups: 'true',
            })
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-pink-500/15 border border-pink-400/30 flex items-center justify-center">
                <Instagram className="w-7 h-7 text-pink-400" />
              </div>
              <div className="max-w-md space-y-1.5">
                <h3 className="text-base font-semibold text-white">Real Instagram Portal</h3>
                <p className="text-xs text-white/55">
                  Launch real Instagram in the AIRA Mac Electron app or open in your default browser.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  openRealWindow('https://www.instagram.com', 'Instagram', 'persist:instagram')
                }
                className="px-4 py-2.5 rounded-xl bg-pink-500 text-white text-xs font-semibold hover:bg-pink-400 cursor-pointer flex items-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                Open Real Instagram
              </button>
            </div>
          ))}

        {activeTab === 'baileys' &&
          (isLinked ? (
            <div className="flex-1 min-h-[360px] flex flex-col md:flex-row overflow-hidden">
              {/* Real Contacts List */}
              <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-white/10 bg-black/35 flex flex-col min-h-0">
                <div className="px-3 py-2.5 border-b border-white/8 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-[11px] font-mono text-emerald-300 truncate">
                      {accountUser?.name || accountUser?.id?.split(':')[0] || 'My WhatsApp'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {onAddContact && (
                      <button
                        type="button"
                        onClick={() => setShowAddForm((v) => !v)}
                        title="Add real contact by phone number"
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/75 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onResetSession}
                      title="Unlink account"
                      className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {showAddForm && onAddContact && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newName.trim() && newPhone.trim()) {
                        onAddContact(newName.trim(), newPhone.trim());
                        onSelectChatContact?.(newName.trim());
                        setNewName('');
                        setNewPhone('');
                        setShowAddForm(false);
                      }
                    }}
                    className="p-2.5 border-b border-white/8 bg-white/[0.02] flex flex-col gap-1.5"
                  >
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Contact name"
                      className="bg-black/60 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-400/50"
                    />
                    <div className="flex gap-1.5">
                      <input
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                        placeholder="+919876543210"
                        className="flex-1 bg-black/60 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-400/50"
                      />
                      <button
                        type="submit"
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-400 text-black text-xs font-semibold cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </form>
                )}

                <div className="flex-1 overflow-y-auto divide-y divide-white/5">
                  {contacts.length === 0 ? (
                    <div className="p-4 text-center text-xs text-white/40 leading-relaxed">
                      Connected to your real WhatsApp. Incoming chats appear automatically, or click + above to message any number.
                    </div>
                  ) : (
                    contacts.map((c) => {
                      const active = selectedContactName === c.name;
                      return (
                        <button
                          key={c.phone + c.name}
                          type="button"
                          onClick={() => onSelectChatContact?.(c.name)}
                          className={`w-full px-3 py-2.5 text-left flex items-center gap-2.5 cursor-pointer transition-colors ${
                            active ? 'bg-emerald-500/15 border-l-2 border-emerald-400' : 'hover:bg-white/[0.04]'
                          }`}
                        >
                          <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center text-xs shrink-0">
                            <User className="w-4 h-4 text-emerald-300" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-white truncate">{c.name}</div>
                            <div className="text-[10px] font-mono text-white/40 truncate">
                              {c.phone.split('@')[0]}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Real Chat Thread */}
              <div className="flex-1 flex flex-col min-h-0 bg-[#05090e]">
                {selectedContactName ? (
                  <>
                    <div className="px-4 py-2.5 border-b border-white/8 flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">{selectedContactName}</span>
                      <span className="text-[10px] font-mono text-emerald-400 uppercase">Live WhatsApp Sync</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                      {activeMessages.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-xs text-white/35">
                          No messages synced in this thread yet. Send a real WhatsApp message below.
                        </div>
                      ) : (
                        activeMessages.map((m) => (
                          <div key={m.id} className={`flex ${m.isMe ? 'justify-end' : 'justify-start'}`}>
                            <div
                              className={`max-w-[78%] rounded-xl px-3 py-2 text-xs ${
                                m.isMe
                                  ? 'bg-emerald-500/20 border border-emerald-400/30 text-white'
                                  : 'bg-white/[0.06] border border-white/10 text-white/90'
                              }`}
                            >
                              <p className="whitespace-pre-wrap break-words">{m.text}</p>
                              <span className="block text-[9px] font-mono text-white/40 mt-1 text-right">{m.time}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    {onSendChatMessage && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (replyText.trim() && selectedContactName) {
                            onSendChatMessage(selectedContactName, replyText.trim());
                            setReplyText('');
                          }
                        }}
                        className="p-3 border-t border-white/8 flex items-center gap-2"
                      >
                        <input
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder={`Message ${selectedContactName} on real WhatsApp...`}
                          className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-400/50"
                        />
                        <button
                          type="submit"
                          className="px-3.5 py-2 rounded-xl bg-emerald-400 text-black text-xs font-semibold hover:bg-emerald-300 cursor-pointer flex items-center gap-1.5"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Send
                        </button>
                      </form>
                    )}
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-white/40 p-6 text-center">
                    Select a contact or click + to message someone from your real WhatsApp account.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 p-6 flex flex-col md:flex-row items-center justify-center gap-8 overflow-y-auto">
              <div className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-white/[0.03] border border-white/10 min-w-[230px]">
                <span className="text-[11px] font-mono uppercase tracking-wider text-white/60">
                  Link Your Real WhatsApp ({whatsAppStatus})
                </span>
                {realQrCodeUrl ? (
                  <img
                    src={realQrCodeUrl}
                    alt="Real WhatsApp QR Code"
                    className="w-44 h-44 rounded-xl bg-white p-2"
                  />
                ) : (
                  <div className="w-44 h-44 flex flex-col items-center justify-center gap-2 text-white/40 text-center text-xs px-3">
                    <AlertCircle className="w-7 h-7 text-amber-400/70" />
                    <span>Click Generate QR to link your own WhatsApp account</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {onRequestQr && (
                    <button
                      type="button"
                      onClick={onRequestQr}
                      className="px-3 py-1.5 rounded-lg bg-emerald-400 text-black text-[11px] font-semibold cursor-pointer"
                    >
                      Generate QR
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onResetSession}
                    className="px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 text-[11px] font-mono text-white/80 cursor-pointer"
                  >
                    Reset / Refresh
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3 max-w-xs w-full">
                <div className="flex items-center gap-2 text-white text-sm font-semibold">
                  <Smartphone className="w-4 h-4 text-cyan-400" />
                  Pair with Phone Number
                </div>
                <p className="text-xs text-white/50">
                  Enter your WhatsApp number with country code (e.g. +919876543210) to link your own WhatsApp account via 8-digit code.
                </p>
                <div className="flex gap-2">
                  <input
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="+919876543210"
                    className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400/50"
                  />
                  <button
                    type="button"
                    onClick={() => phoneInput.trim() && onGenerateRealPairingCode(phoneInput.trim())}
                    className="px-3.5 py-2 rounded-xl bg-cyan-400 text-black text-xs font-semibold hover:bg-cyan-300 cursor-pointer"
                  >
                    Get Code
                  </button>
                </div>
                {realPairingCode && (
                  <div className="p-3 rounded-xl bg-cyan-500/15 border border-cyan-400/35 text-center font-mono text-lg tracking-[0.25em] text-cyan-200">
                    {realPairingCode}
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>

      {statusMsg && (
        <div className="px-4 py-1.5 bg-black/60 border-t border-white/8 text-[11px] font-mono text-cyan-300">
          {statusMsg}
        </div>
      )}
    </div>
  );
};
