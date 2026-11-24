import React from 'react';
import {
  X,
  Plus,
  Search,
  Pin,
  PinOff,
  Trash2,
  Edit3,
  Download,
  Check,
  ArrowLeft,
  Sparkles,
  Brain,
  BookOpen,
  Drama,
  Settings as SettingsIcon,
  Key,
  Volume2,
  Eye,
  User,
  RefreshCw,
} from 'lucide-react';
import {
  BUILT_IN_CHARACTERS,
  type CharacterProfile,
  type CoreSettings,
  type CoreStoreState,
  type MemoryNote,
  type SkillItem,
} from '../types/core';

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

// ---------------------------------------------------------------------------
// 1. MEMORY MODAL (matches Stonic YLe / OJe / FLe)
// ---------------------------------------------------------------------------

export const MemoryModal = ({
  isOpen,
  onClose,
  coreState,
  onRefresh,
}: {
  isOpen: boolean;
  onClose: () => void;
  coreState: CoreStoreState;
  onRefresh: (next: CoreStoreState) => void;
}) => {
  const [tab, setTab] = React.useState<'memories' | 'intentions' | 'settings'>('memories');
  const [search, setSearch] = React.useState('');
  const [editing, setEditing] = React.useState<MemoryNote | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [content, setContent] = React.useState('');
  const [category, setCategory] = React.useState<MemoryNote['category']>('fact');
  const [pinned, setPinned] = React.useState(false);
  const [newIntention, setNewIntention] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) {
      setEditing(null);
      setIsCreating(false);
      setToast(null);
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };

  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setContent('');
    setCategory('fact');
    setPinned(false);
    setIsCreating(true);
  };

  const openEdit = (m: MemoryNote) => {
    setIsCreating(false);
    setEditing(m);
    setTitle(m.title);
    setContent(m.content);
    setCategory(m.category);
    setPinned(m.pinned);
  };

  const saveMemory = async () => {
    if (!content.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/core/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing?.id,
          title: title.trim() || 'Saved Memory',
          content: content.trim(),
          category,
          pinned,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onRefresh(data.state);
        setEditing(null);
        setIsCreating(false);
        notify('Memory saved');
      }
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (m: MemoryNote) => {
    const res = await fetch(`/api/core/memory/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !m.pinned }),
    });
    const data = await res.json();
    if (data.ok) onRefresh(data.state);
  };

  const deleteMemory = async (id: string) => {
    const res = await fetch(`/api/core/memory/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      onRefresh(data.state);
      if (editing?.id === id) setEditing(null);
      notify('Memory deleted');
    }
  };

  const addIntention = async () => {
    if (!newIntention.trim()) return;
    const res = await fetch('/api/core/intentions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newIntention.trim() }),
    });
    const data = await res.json();
    if (data.ok) {
      onRefresh(data.state);
      setNewIntention('');
    }
  };

  const toggleIntention = async (id: string, current: 'pending' | 'done') => {
    const res = await fetch(`/api/core/intentions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: current === 'done' ? 'pending' : 'done' }),
    });
    const data = await res.json();
    if (data.ok) onRefresh(data.state);
  };

  const deleteIntention = async (id: string) => {
    const res = await fetch(`/api/core/intentions/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) onRefresh(data.state);
  };

  const updateFlags = async (patch: { memoryPaused?: boolean; digestEnabled?: boolean }) => {
    const res = await fetch('/api/core/memory/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.ok) {
      onRefresh(data.state);
      notify('Memory preferences updated');
    }
  };

  const exportMemoryJson = () => {
    const blob = new Blob(
      [JSON.stringify({ memories: coreState.memories, intentions: coreState.intentions }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aira-memory-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Memory exported');
  };

  const filtered = coreState.memories.filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      m.title.toLowerCase().includes(q) ||
      m.content.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl h-[82vh] bg-[#0a0d13] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center">
              <Brain className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-[20px] font-semibold text-white tracking-tight">Memory</h2>
              <p className="text-[12px] text-white/45">
                {coreState.memoryPaused
                  ? 'Memory recording is paused'
                  : `${coreState.memories.length} memories stored · synced with Silvia`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="px-6 pt-3 pb-3 border-b border-white/6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 bg-white/[0.03] p-1 rounded-xl border border-white/8">
            {(['memories', 'intentions', 'settings'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setIsCreating(false);
                  setEditing(null);
                }}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-medium capitalize transition-all cursor-pointer ${
                  tab === t
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/30'
                    : 'text-white/50 hover:text-white/80 border border-transparent'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'memories' && !isCreating && !editing && (
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-cyan-400 text-black text-[12px] font-semibold rounded-xl hover:bg-cyan-300 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              New Memory
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {tab === 'memories' && (isCreating || editing) && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setEditing(null);
                }}
                className="flex items-center gap-1.5 text-[12px] text-white/50 hover:text-white cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to memories
              </button>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-white/45 mb-1.5">
                  Title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Preferred Code Stack"
                  className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white focus:outline-none focus:border-cyan-400/50"
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-[11px] uppercase tracking-wider text-white/45 mb-1.5">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as MemoryNote['category'])}
                    className="w-full bg-[#111621] border border-white/10 rounded-xl px-3 py-2.5 text-[13px] text-white focus:outline-none focus:border-cyan-400/50"
                  >
                    <option value="fact">Fact</option>
                    <option value="preference">Preference</option>
                    <option value="project">Project</option>
                    <option value="context">Context</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 pt-5 text-[13px] text-white/75 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(e) => setPinned(e.target.checked)}
                    className="accent-cyan-400"
                  />
                  Pin to active context
                </label>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-white/45 mb-1.5">
                  Memory Content *
                </label>
                <textarea
                  rows={5}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="What should Silvia remember?"
                  className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-3 text-[13px] text-white focus:outline-none focus:border-cyan-400/50 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setEditing(null);
                  }}
                  className="px-4 py-2 text-[13px] text-white/50 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveMemory}
                  disabled={!content.trim() || busy}
                  className="px-5 py-2 bg-cyan-400 text-black text-[13px] font-semibold rounded-xl hover:bg-cyan-300 disabled:opacity-40 cursor-pointer"
                >
                  {busy ? 'Saving...' : 'Save Memory'}
                </button>
              </div>
            </div>
          )}

          {tab === 'memories' && !isCreating && !editing && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-white/30 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search stored memories..."
                  className="w-full bg-[#111621] border border-white/8 rounded-xl pl-10 pr-4 py-2.5 text-[13px] text-white placeholder:text-white/25 focus:outline-none focus:border-cyan-400/40"
                />
              </div>

              {filtered.length === 0 ? (
                <div className="py-14 text-center text-white/40 text-[13px]">
                  No memories match your search.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filtered.map((m) => (
                    <div
                      key={m.id}
                      className="p-4 rounded-xl bg-white/[0.025] border border-white/8 hover:border-cyan-400/30 transition-colors flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-white truncate">
                            {m.title}
                          </span>
                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-white/5 text-white/55">
                            {m.category}
                          </span>
                          {m.pinned && (
                            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-400/25">
                              pinned
                            </span>
                          )}
                        </div>
                        <p className="text-[12.5px] text-white/65 leading-relaxed">{m.content}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => togglePin(m)}
                          title={m.pinned ? 'Unpin' : 'Pin'}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            m.pinned
                              ? 'text-cyan-300 bg-cyan-500/15'
                              : 'text-white/30 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          {m.pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(m)}
                          title="Edit"
                          className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/5 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteMemory(m.id)}
                          title="Delete"
                          className="p-1.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'intentions' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  value={newIntention}
                  onChange={(e) => setNewIntention(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addIntention()}
                  placeholder="Add an intention or follow-up reminder..."
                  className="flex-1 bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white focus:outline-none focus:border-cyan-400/40"
                />
                <button
                  type="button"
                  onClick={addIntention}
                  className="px-4 py-2.5 bg-cyan-400 text-black text-[12px] font-semibold rounded-xl hover:bg-cyan-300 cursor-pointer"
                >
                  Add
                </button>
              </div>

              <div className="space-y-2">
                {coreState.intentions.map((item) => (
                  <div
                    key={item.id}
                    className="px-4 py-3 rounded-xl bg-white/[0.025] border border-white/8 flex items-center justify-between gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => toggleIntention(item.id, item.status)}
                      className="flex items-center gap-3 text-left flex-1 cursor-pointer"
                    >
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center ${
                          item.status === 'done'
                            ? 'bg-cyan-400 border-cyan-400 text-black'
                            : 'border-white/25'
                        }`}
                      >
                        {item.status === 'done' && <Check className="w-3 h-3" />}
                      </span>
                      <span
                        className={`text-[13px] ${
                          item.status === 'done' ? 'line-through text-white/35' : 'text-white/85'
                        }`}
                      >
                        {item.text}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteIntention(item.id)}
                      className="p-1.5 text-white/30 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'settings' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white/[0.025] border border-white/8 flex items-center justify-between">
                <div>
                  <p className="text-[13.5px] font-medium text-white">Pause Memory Recording</p>
                  <p className="text-[12px] text-white/45">
                    When paused, Silvia stops injecting or recording new memory notes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateFlags({ memoryPaused: !coreState.memoryPaused })}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer ${
                    coreState.memoryPaused ? 'bg-amber-400' : 'bg-white/15'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      coreState.memoryPaused ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.025] border border-white/8 flex items-center justify-between">
                <div>
                  <p className="text-[13.5px] font-medium text-white">Auto-Consolidate Digest</p>
                  <p className="text-[12px] text-white/45">
                    Automatically organize pinned preferences and project facts for live sessions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateFlags({ digestEnabled: !coreState.digestEnabled })}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer ${
                    coreState.digestEnabled ? 'bg-cyan-400' : 'bg-white/15'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      coreState.digestEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.025] border border-white/8 flex items-center justify-between">
                <div>
                  <p className="text-[13.5px] font-medium text-white">Export Memory Snapshot</p>
                  <p className="text-[12px] text-white/45">
                    Download all memories and intentions as a portable JSON file.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={exportMemoryJson}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/8 hover:bg-white/12 text-[12.5px] font-medium text-white border border-white/10 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export JSON
                </button>
              </div>
            </div>
          )}
        </div>

        {toast && (
          <div className="px-6 py-2.5 border-t border-white/8 bg-cyan-500/10 text-cyan-300 text-[12px] flex items-center gap-2">
            <Check className="w-3.5 h-3.5" />
            {toast}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 2. SKILLS MODAL (matches Stonic WCe)
// ---------------------------------------------------------------------------

export const SkillsModal = ({
  isOpen,
  onClose,
  coreState,
  onRefresh,
}: {
  isOpen: boolean;
  onClose: () => void;
  coreState: CoreStoreState;
  onRefresh: (next: CoreStoreState) => void;
}) => {
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<SkillItem | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [whenToUse, setWhenToUse] = React.useState('');
  const [content, setContent] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!isOpen) {
      setSelected(null);
      setIsCreating(false);
      setError('');
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const openSkill = (skill: SkillItem) => {
    setIsCreating(false);
    setSelected(skill);
    setName(skill.name);
    setDescription(skill.description);
    setWhenToUse(skill.whenToUse);
    setContent(skill.content);
    setError('');
  };

  const openCreate = () => {
    setSelected(null);
    setIsCreating(true);
    setName('');
    setDescription('');
    setWhenToUse('');
    setContent('');
    setError('');
  };

  const closeEditor = () => {
    setSelected(null);
    setIsCreating(false);
    setError('');
  };

  const toggleSkill = async (skill: SkillItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await fetch(`/api/core/skills/${encodeURIComponent(skill.name)}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !skill.enabled }),
    });
    const data = await res.json();
    if (data.ok) onRefresh(data.state);
  };

  const saveSkill = async () => {
    const slug = slugify(name);
    if (!slug || !description.trim()) {
      setError('Skill name and description are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/core/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: slug,
          description: description.trim(),
          whenToUse: whenToUse.trim(),
          content: content.trim(),
          originalName: selected?.name,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onRefresh(data.state);
        closeEditor();
      } else {
        setError(data.error || 'Could not save skill.');
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteSkill = async () => {
    if (!selected) return;
    const res = await fetch(`/api/core/skills/${encodeURIComponent(selected.name)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (data.ok) {
      onRefresh(data.state);
      closeEditor();
    }
  };

  const filtered = coreState.skills.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.whenToUse.toLowerCase().includes(q)
    );
  });

  const previewSlug = slugify(name);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl h-[82vh] bg-[#0a0a0a] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-400/30 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-[20px] font-semibold text-white">Skills</h2>
              <p className="text-white/40 text-[12px] mt-0.5">
                Save the steps for a job once. Next time you ask for it, Silvia follows them without being told again.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="h-px bg-white/6" />

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
          {!isCreating && !selected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-white/30 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search skills..."
                    className="w-full bg-[#111] border border-white/8 rounded-xl pl-10 pr-4 py-2.5 text-[13px] text-white placeholder:text-white/25 focus:outline-none focus:border-white/20"
                  />
                </div>
                <button
                  type="button"
                  onClick={openCreate}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-white text-black text-[13px] font-semibold rounded-xl hover:bg-white/90 transition-colors shrink-0 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  New Skill
                </button>
              </div>

              {filtered.length === 0 ? (
                <div className="py-20 text-center text-white/35 text-[13px]">
                  No skills match your search
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((skill) => (
                    <div
                      key={skill.name}
                      onClick={() => openSkill(skill)}
                      className="group flex items-center gap-4 px-4 py-3.5 rounded-xl bg-white/[0.02] border border-white/6 hover:bg-white/[0.045] hover:border-white/15 cursor-pointer transition-colors"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          skill.enabled
                            ? 'bg-emerald-400 shadow-[0_0_8px_#4ade80]'
                            : 'bg-white/20'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13.5px] font-semibold text-white truncate">
                            {skill.name}
                          </span>
                          <span className="text-[10px] font-mono text-white/35 uppercase">
                            {skill.enabled ? 'active' : 'off'}
                          </span>
                        </div>
                        <p className="text-[12px] text-white/45 truncate mt-0.5">
                          {skill.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        title={skill.enabled ? 'Click to turn off' : 'Click to turn on'}
                        onClick={(e) => toggleSkill(skill, e)}
                        className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                          skill.enabled ? 'bg-emerald-500/80' : 'bg-white/15'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white transition-transform ${
                            skill.enabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                onClick={closeEditor}
                className="flex items-center gap-1.5 text-white/40 hover:text-white text-[13px] cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to skills
              </button>

              <div>
                <label className="block text-[11px] font-medium text-white/40 uppercase tracking-wider mb-2">
                  Skill Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., weekly-report"
                  maxLength={120}
                  className="w-full bg-[#111] border border-white/8 rounded-xl px-4 py-3 text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/20"
                />
                <p className="text-[11px] text-white/30 mt-1.5">
                  {previewSlug ? (
                    <>
                      Saved as <span className="font-mono text-white/55">{previewSlug}</span>
                    </>
                  ) : (
                    'Saved in lowercase, with hyphens instead of spaces.'
                  )}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider">
                    Description <span className="text-red-400">*</span>
                  </label>
                  <span
                    className={`text-[11px] ${
                      description.trim().length > 180 ? 'text-red-400' : 'text-white/25'
                    }`}
                  >
                    {description.trim().length}/180
                  </span>
                </div>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="One-line summary of what this skill does"
                  className="w-full bg-[#111] border border-white/8 rounded-xl px-4 py-3 text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/20"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-white/40 uppercase tracking-wider mb-2">
                  When to Use
                </label>
                <input
                  value={whenToUse}
                  onChange={(e) => setWhenToUse(e.target.value)}
                  placeholder="Trigger condition (e.g., when user asks for morning news)"
                  className="w-full bg-[#111] border border-white/8 rounded-xl px-4 py-3 text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/20"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider">
                    Instructions
                  </label>
                  <span className="text-[11px] text-white/25">Markdown supported</span>
                </div>
                <textarea
                  rows={6}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Step-by-step instructions Silvia should follow..."
                  className="w-full bg-[#111] border border-white/8 rounded-xl px-4 py-3 text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 resize-none font-mono"
                />
              </div>

              {error && <p className="text-[12px] text-red-400">{error}</p>}
            </div>
          )}
        </div>

        {(isCreating || selected) && (
          <div className="shrink-0 px-6 py-4 border-t border-white/6 flex items-center justify-between gap-3 bg-black/40">
            <div>
              {selected && (
                <button
                  type="button"
                  onClick={deleteSkill}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] text-red-400 hover:bg-red-500/10 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeEditor}
                className="px-4 py-2 text-[13px] text-white/45 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveSkill}
                disabled={saving}
                className="px-5 py-2 bg-emerald-400 text-black text-[13px] font-semibold rounded-xl hover:bg-emerald-300 disabled:opacity-40 cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Skill'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 3. CHARACTER MODAL (matches Stonic QLe)
// ---------------------------------------------------------------------------

export const CharacterModal = ({
  isOpen,
  onClose,
  coreState,
  onRefresh,
}: {
  isOpen: boolean;
  onClose: () => void;
  coreState: CoreStoreState;
  onRefresh: (next: CoreStoreState) => void;
}) => {
  const allCharacters = React.useMemo(
    () => [...BUILT_IN_CHARACTERS, ...coreState.customCharacters],
    [coreState.customCharacters]
  );

  const activeChar =
    allCharacters.find((c) => c.id === coreState.activeCharacterId) || BUILT_IN_CHARACTERS[0];

  const [mode, setMode] = React.useState<'browse' | 'create'>('browse');
  const [genderFilter, setGenderFilter] = React.useState<'female' | 'male'>(activeChar.gender);
  const [previewId, setPreviewId] = React.useState<string>(activeChar.id);

  const [userName, setUserName] = React.useState('');
  const [userAge, setUserAge] = React.useState<string>('');
  const [callsYou, setCallsYou] = React.useState('');

  // Custom character fields
  const [customName, setCustomName] = React.useState('');
  const [customGender, setCustomGender] = React.useState<'female' | 'male'>('female');
  const [customTagline, setCustomTagline] = React.useState('');
  const [customPrompt, setCustomPrompt] = React.useState('');
  const [customAwareness, setCustomAwareness] = React.useState('');
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setMode('browse');
    setGenderFilter(activeChar.gender);
    setPreviewId(activeChar.id);
    setToast(null);
  }, [isOpen, activeChar.gender, activeChar.id]);

  const previewChar =
    allCharacters.find((c) => c.id === previewId) ||
    allCharacters.find((c) => c.gender === genderFilter) ||
    allCharacters[0];

  React.useEffect(() => {
    const prefs = coreState.characterUserPrefs[previewChar.id];
    setUserName(prefs?.name || coreState.settings.profile.fullName || '');
    setUserAge(prefs?.age ? String(prefs.age) : '');
    setCallsYou(prefs?.callsYou || '');
  }, [previewChar.id, coreState.characterUserPrefs, coreState.settings.profile.fullName]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredChars = allCharacters.filter((c) => c.gender === genderFilter);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const activateCharacter = async (charId: string) => {
    const parsedAge = userAge.trim() ? Number(userAge) : null;
    const res = await fetch('/api/core/character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeCharacterId: charId,
        characterUserPrefs: {
          [charId]: {
            name: userName.trim() || 'Arvind',
            age: Number.isFinite(parsedAge) ? parsedAge : null,
            callsYou: callsYou.trim(),
          },
        },
      }),
    });
    const data = await res.json();
    if (data.ok) {
      onRefresh(data.state);
      showToast('Character activated for next connection');
    }
  };

  const createCustomCharacter = async () => {
    if (!customName.trim() || customPrompt.trim().length < 10) return;
    const newChar: CharacterProfile = {
      id: `custom_${Date.now().toString(36)}`,
      name: customName.trim(),
      gender: customGender,
      tagline: customTagline.trim() || 'Your custom character',
      tags: ['Custom'],
      prompt: customPrompt.trim(),
      awareness: customAwareness.trim(),
      defaultVoice: customGender === 'female' ? 'Aoede' : 'Charon',
      builtIn: false,
    };
    const nextCustom = [...coreState.customCharacters, newChar];
    const res = await fetch('/api/core/character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activeCharacterId: newChar.id,
        customCharacters: nextCustom,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      onRefresh(data.state);
      setCustomName('');
      setCustomTagline('');
      setCustomPrompt('');
      setCustomAwareness('');
      setGenderFilter(newChar.gender);
      setPreviewId(newChar.id);
      setMode('browse');
      showToast(`${newChar.name} created & activated`);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl h-[84vh] bg-[#0a0d14] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-400/30 flex items-center justify-center">
              <Drama className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h2 className="text-[20px] font-semibold text-white">Character</h2>
              <p className="text-[12px] text-white/45">
                Active: <span className="text-cyan-300">{activeChar.name}</span> ({activeChar.gender})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white/[0.04] p-1 rounded-xl border border-white/8">
              <button
                type="button"
                onClick={() => setMode('browse')}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer ${
                  mode === 'browse' ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white'
                }`}
              >
                Browse
              </button>
              <button
                type="button"
                onClick={() => setMode('create')}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer flex items-center gap-1 ${
                  mode === 'create' ? 'bg-red-500/20 text-red-300 border border-red-400/30' : 'text-white/45 hover:text-white'
                }`}
              >
                <Plus className="w-3.5 h-3.5" /> Custom
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/5 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {mode === 'browse' ? (
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">
            {/* Left Character List */}
            <div className="w-full md:w-[260px] border-b md:border-b-0 md:border-r border-white/[0.07] p-4 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
              <div className="flex gap-1.5 bg-white/[0.03] p-1 rounded-xl border border-white/8">
                {(['female', 'male'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      setGenderFilter(g);
                      const first = allCharacters.find((c) => c.gender === g);
                      if (first) setPreviewId(first.id);
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium capitalize cursor-pointer ${
                      genderFilter === g
                        ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/30'
                        : 'text-white/45 hover:text-white/80'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {filteredChars.map((ch) => {
                  const isActiveChar = ch.id === coreState.activeCharacterId;
                  const isPreview = ch.id === previewChar.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setPreviewId(ch.id)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isPreview
                          ? 'bg-cyan-500/[0.1] border-cyan-400/40'
                          : 'bg-white/[0.02] border-white/6 hover:border-white/15'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[14px] font-semibold text-white">{ch.name}</span>
                        {isActiveChar && (
                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-[11.5px] text-white/45 mt-1 line-clamp-2">{ch.tagline}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Detail View */}
            <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-[22px] font-semibold text-white">{previewChar.name}</h3>
                    {previewChar.id === coreState.activeCharacterId && (
                      <span className="px-2.5 py-1 rounded-full font-mono text-[10px] font-bold uppercase tracking-wider bg-cyan-500/15 text-cyan-300 border border-cyan-400/30">
                        Active character
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-white/55 mt-1">{previewChar.tagline}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {previewChar.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2.5 py-0.5 rounded-full text-[11px] bg-white/[0.05] border border-white/10 text-white/65"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.025] border border-white/8 space-y-3">
                <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-white/45">
                  How they know you
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-white/40 mb-1">Your Name</label>
                    <input
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder="Arvind"
                      className="w-full bg-[#111621] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none focus:border-cyan-400/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-white/40 mb-1">Age</label>
                    <input
                      type="number"
                      value={userAge}
                      onChange={(e) => setUserAge(e.target.value)}
                      placeholder="24"
                      className="w-full bg-[#111621] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none focus:border-cyan-400/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-white/40 mb-1">Calls You</label>
                    <input
                      value={callsYou}
                      onChange={(e) => setCallsYou(e.target.value)}
                      placeholder="Sir / Boss / Bhai"
                      className="w-full bg-[#111621] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none focus:border-cyan-400/40"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.025] border border-white/8 space-y-2">
                <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-white/45">
                  Behavior
                </span>
                <p className="text-[13px] text-white/75 leading-relaxed whitespace-pre-line">
                  {previewChar.prompt}
                </p>
              </div>

              {previewChar.awareness && (
                <div className="p-4 rounded-xl bg-white/[0.025] border border-white/8 space-y-2">
                  <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-white/45">
                    Awareness
                  </span>
                  <p className="text-[13px] text-white/65 leading-relaxed">
                    {previewChar.awareness}
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() => activateCharacter(previewChar.id)}
                className="w-full h-11 rounded-xl font-semibold text-[13.5px] bg-cyan-400 text-black hover:bg-cyan-300 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {previewChar.id === coreState.activeCharacterId
                  ? 'Save Relationship Preferences'
                  : `Activate ${previewChar.name}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] text-white/45 mb-1.5">Character Name *</label>
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g., Nova"
                  className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white focus:outline-none focus:border-red-400/50"
                />
              </div>
              <div>
                <label className="block text-[12px] text-white/45 mb-1.5">Gender</label>
                <select
                  value={customGender}
                  onChange={(e) => setCustomGender(e.target.value as 'female' | 'male')}
                  className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white focus:outline-none focus:border-red-400/50"
                >
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[12px] text-white/45 mb-1.5">Short Tagline</label>
              <input
                value={customTagline}
                onChange={(e) => setCustomTagline(e.target.value)}
                placeholder="e.g., Sharp midnight coding partner"
                className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white focus:outline-none focus:border-red-400/50"
              />
            </div>

            <div>
              <label className="block text-[12px] text-white/45 mb-1.5">
                Behavior & Personality Prompt *
              </label>
              <textarea
                rows={5}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Kya kare, kya na kare, kaise bole..."
                className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-3 text-[13px] text-white focus:outline-none focus:border-red-400/50 resize-none"
              />
            </div>

            <div>
              <label className="block text-[12px] text-white/45 mb-1.5">
                Awareness on ho to ye character kis cheez ka khayal rakhe aur kab khud bole
              </label>
              <textarea
                rows={3}
                value={customAwareness}
                onChange={(e) => setCustomAwareness(e.target.value)}
                placeholder="Khali chhorein to personality se hi chalega."
                className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-3 text-[13px] text-white focus:outline-none focus:border-red-400/50 resize-none"
              />
            </div>

            <button
              type="button"
              onClick={createCustomCharacter}
              disabled={!customName.trim() || customPrompt.trim().length < 10}
              className="w-full h-11 rounded-xl font-semibold text-[13.5px] bg-red-400 text-black hover:bg-red-300 disabled:opacity-40 cursor-pointer"
            >
              Create & Activate Character
            </button>
          </div>
        )}

        {toast && (
          <div className="px-6 py-2.5 border-t border-white/8 bg-cyan-500/10 text-cyan-300 text-[12px] flex items-center gap-2">
            <Check className="w-3.5 h-3.5" />
            {toast}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 4. SETTINGS MODAL (matches Stonic pCe)
// ---------------------------------------------------------------------------

export const SettingsModal = ({
  isOpen,
  onClose,
  coreState,
  onRefresh,
  onSelectVoice,
}: {
  isOpen: boolean;
  onClose: () => void;
  coreState: CoreStoreState;
  onRefresh: (next: CoreStoreState) => void;
  onSelectVoice: (voice: string) => void;
}) => {
  const [tab, setTab] = React.useState<'profile' | 'voice' | 'keys' | 'awareness'>('profile');
  const [draft, setDraft] = React.useState<CoreSettings>(coreState.settings);
  const [saving, setSaving] = React.useState(false);
  const [models, setModels] = React.useState<{ id: string; name: string }[]>([]);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [toast, setToast] = React.useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setDraft(coreState.settings);
      setToast(null);
    }
  }, [isOpen, coreState.settings]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const selectVoiceNow = async (voiceName: string) => {
    const nextDraft: CoreSettings = {
      ...draft,
      voice: { ...draft.voice, voiceName },
    };
    setDraft(nextDraft);
    onSelectVoice(voiceName);
    try {
      const res = await fetch('/api/core/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextDraft),
      });
      const data = await res.json();
      if (data.ok) {
        onRefresh(data.state);
        setToast({ type: 'ok', text: `Voice set to ${voiceName}` });
      }
    } catch {
      setToast({ type: 'error', text: 'Failed to save voice selection' });
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch('/api/core/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (data.ok) {
        onRefresh(data.state);
        onSelectVoice(draft.voice.voiceName);
        setToast({ type: 'ok', text: 'Configuration saved' });
      } else {
        setToast({ type: 'error', text: data.error || 'Error saving configuration' });
      }
    } catch {
      setToast({ type: 'error', text: 'Error saving configuration' });
    } finally {
      setSaving(false);
    }
  };

  const fetchOpenRouterModels = async () => {
    setLoadingModels(true);
    try {
      const res = await fetch('/api/core/openrouter-models');
      const data = await res.json();
      if (data.ok) {
        setModels(data.models || []);
        setToast({ type: 'ok', text: `Loaded ${data.models?.length || 0} OpenRouter models` });
      }
    } catch {
      setToast({ type: 'error', text: 'Failed to load OpenRouter models' });
    } finally {
      setLoadingModels(false);
    }
  };

  const navItems = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'voice', label: 'Voice & Model', icon: Volume2 },
    { id: 'keys', label: 'API Keys', icon: Key },
    { id: 'awareness', label: 'Awareness', icon: Eye },
  ] as const;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl h-[82vh] bg-[#0a0d13] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
              <SettingsIcon className="w-5 h-5 text-slate-300" />
            </div>
            <div>
              <h2 className="text-[20px] font-semibold text-white">Settings</h2>
              <p className="text-[12px] text-white/45">
                Engine, voice, keys, and awareness configuration
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <div className="w-full md:w-[210px] border-b md:border-b-0 md:border-r border-white/[0.07] p-4 flex md:flex-col gap-1.5 overflow-x-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-colors cursor-pointer shrink-0 ${
                    tab === item.id
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/30'
                      : 'text-white/50 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-5">
            {tab === 'profile' && (
              <div className="space-y-4">
                <h3 className="text-[16px] font-semibold text-white">Profile</h3>
                <div>
                  <label className="block text-[12px] text-white/45 mb-1.5">Full Name</label>
                  <input
                    value={draft.profile.fullName}
                    onChange={(e) =>
                      setDraft({ ...draft, profile: { ...draft.profile, fullName: e.target.value } })
                    }
                    className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white focus:outline-none focus:border-cyan-400/40"
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-white/45 mb-1.5">Location</label>
                  <input
                    value={draft.profile.location}
                    onChange={(e) =>
                      setDraft({ ...draft, profile: { ...draft.profile, location: e.target.value } })
                    }
                    className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white focus:outline-none focus:border-cyan-400/40"
                  />
                </div>
              </div>
            )}

            {tab === 'voice' && (
              <div className="space-y-4">
                <h3 className="text-[16px] font-semibold text-white">Voice & Model</h3>
                <div>
                  <label className="block text-[12px] text-white/45 mb-1.5">Voice Persona</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir'].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => selectVoiceNow(v)}
                        className={`px-3 py-2.5 rounded-xl border text-[13px] font-medium cursor-pointer transition-colors ${
                          draft.voice.voiceName === v
                            ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300'
                            : 'bg-white/[0.025] border-white/10 text-white/65 hover:text-white'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] text-white/45 mb-1.5">Live Model ID</label>
                  <select
                    value={draft.voice.modelId}
                    onChange={(e) =>
                      setDraft({ ...draft, voice: { ...draft.voice, modelId: e.target.value } })
                    }
                    className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white focus:outline-none focus:border-cyan-400/40"
                  >
                    <option value="gemini-3.8-live">gemini-3.8-live (recommended)</option>
                    <option value="gemini-3.8-live-extended-thinking">gemini-3.8-live-extended-thinking (smarter, slower)</option>
                  </select>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.025] border border-white/8 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-white">Wake Word / Auto Listen</p>
                    <p className="text-[11.5px] text-white/45">
                      Automatically open microphone stream when Live session starts
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        voice: { ...draft.voice, autoListen: !draft.voice.autoListen },
                      })
                    }
                    className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer ${
                      draft.voice.autoListen ? 'bg-cyan-400' : 'bg-white/15'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition-transform ${
                        draft.voice.autoListen ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {tab === 'keys' && (
              <div className="space-y-4">
                <h3 className="text-[16px] font-semibold text-white">API Keys</h3>
                <div>
                  <label className="block text-[12px] text-white/45 mb-1.5">
                    Gemini API Key Override (leave blank to use .env)
                  </label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={draft.keys.geminiApiKeyOverride.startsWith('••••') ? '' : draft.keys.geminiApiKeyOverride}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        keys: {
                          ...draft.keys,
                          // Empty field keeps the saved key; the real key never comes back to the browser.
                          geminiApiKeyOverride: e.target.value || coreState.settings.keys.geminiApiKeyOverride,
                        },
                      })
                    }
                    placeholder={coreState.settings.keys.geminiApiKeyOverride ? `Saved (${coreState.settings.keys.geminiApiKeyOverride}). Type to replace.` : 'AIza...'}
                    className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white focus:outline-none focus:border-cyan-400/40"
                  />
                </div>

                <div>
                  <label className="block text-[12px] text-white/45 mb-1.5">
                    OpenRouter API Key (optional sub-agent)
                  </label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={draft.keys.openRouterApiKey.startsWith('••••') ? '' : draft.keys.openRouterApiKey}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        keys: {
                          ...draft.keys,
                          // Empty field keeps the saved key; the real key never comes back to the browser.
                          openRouterApiKey: e.target.value || coreState.settings.keys.openRouterApiKey,
                        },
                      })
                    }
                    placeholder={coreState.settings.keys.openRouterApiKey ? `Saved (${coreState.settings.keys.openRouterApiKey}). Type to replace.` : 'sk-or-...'}
                    className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white focus:outline-none focus:border-cyan-400/40"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[12px] text-white/50">
                    Inspect available OpenRouter models
                  </span>
                  <button
                    type="button"
                    onClick={fetchOpenRouterModels}
                    disabled={loadingModels}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-[12px] text-white cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingModels ? 'animate-spin' : ''}`} />
                    Fetch Models
                  </button>
                </div>

                {models.length > 0 && (
                  <select
                    value={draft.keys.subAgentModelId}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        keys: { ...draft.keys, subAgentModelId: e.target.value },
                      })
                    }
                    className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[12.5px] text-white"
                  >
                    <option value="">Select OpenRouter model...</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {tab === 'awareness' && (
              <div className="space-y-4">
                <h3 className="text-[16px] font-semibold text-white">Awareness & Camera</h3>
                <div className="p-4 rounded-xl bg-white/[0.025] border border-white/8 flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-white">Contextual Awareness</p>
                    <p className="text-[11.5px] text-white/45">
                      Silvia notices active camera context and character awareness cues.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        awareness: { ...draft.awareness, enabled: !draft.awareness.enabled },
                      })
                    }
                    className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer ${
                      draft.awareness.enabled ? 'bg-cyan-400' : 'bg-white/15'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition-transform ${
                        draft.awareness.enabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div>
                  <label className="block text-[12px] text-white/45 mb-1.5">
                    Camera Frame Interval (seconds)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={draft.awareness.cameraIntervalSec}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        awareness: {
                          ...draft.awareness,
                          cameraIntervalSec: Math.max(1, Number(e.target.value) || 2),
                        },
                      })
                    }
                    className="w-full bg-[#111621] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-white"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.07] flex items-center justify-between gap-3 bg-black/40">
          <div className="text-[12px]">
            {toast && (
              <span className={toast.type === 'ok' ? 'text-cyan-300' : 'text-red-400'}>
                {toast.text}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[13px] text-white/45 hover:text-white cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-cyan-400 text-black text-[13px] font-semibold hover:bg-cyan-300 disabled:opacity-40 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
