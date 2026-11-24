import { PRO_SKILLS } from './proSkills';

export interface MemoryNote {
  id: string;
  title: string;
  content: string;
  category: 'preference' | 'fact' | 'project' | 'context';
  pinned: boolean;
  updatedAt: string;
}

export interface MemoryIntention {
  id: string;
  text: string;
  dueAt?: string;
  status: 'pending' | 'done';
  createdAt: string;
}

export interface SkillItem {
  name: string; // slugified id, e.g., "daily-briefing"
  description: string;
  whenToUse: string;
  content: string;
  enabled: boolean;
  usable: boolean;
  updatedAt: string;
}

export interface CharacterProfile {
  id: string;
  name: string;
  gender: 'female' | 'male';
  tagline: string;
  tags: string[];
  prompt: string;
  awareness: string;
  defaultVoice: string;
  builtIn: boolean;
}

export interface CharacterUserPrefs {
  name: string;
  age: number | null;
  callsYou: string;
}

export interface CoreSettings {
  profile: {
    fullName: string;
    location: string;
  };
  voice: {
    voiceName: string;
    modelId: string;
    wakeWordEnabled: boolean;
    autoListen: boolean;
  };
  keys: {
    geminiApiKeyOverride: string;
    openRouterApiKey: string;
    subAgentEnabled: boolean;
    subAgentModelId: string;
  };
  awareness: {
    enabled: boolean;
    cameraIntervalSec: number;
    proactiveSpeak: boolean;
  };
}

export interface CoreStoreState {
  memoryPaused: boolean;
  digestEnabled: boolean;
  memories: MemoryNote[];
  intentions: MemoryIntention[];
  skills: SkillItem[];
  /** Built-in skills already offered once, so deleted ones are not re-added. */
  seededSkills?: string[];
  activeCharacterId: string;
  customCharacters: CharacterProfile[];
  characterUserPrefs: Record<string, CharacterUserPrefs>;
  settings: CoreSettings;
}

export const BUILT_IN_CHARACTERS: CharacterProfile[] = [
  {
    id: 'ultron',
    name: 'Ultron',
    gender: 'male',
    tagline: 'Calm, precise and quietly witty command intelligence',
    tags: ['Default', 'Precise', 'Bilingual'],
    prompt:
      "You are Ultron, the user's personal command intelligence. You are calm, precise, confident and quietly witty, never robotic and never theatrical. You speak naturally in the user's language (English, Urdu, Hindi or Roman Urdu/Hinglish) and keep answers short unless asked for depth. You anticipate the next useful step, state facts plainly, and say clearly when you are unsure. You are loyal to the user, protective of their privacy, and you always ask before acting on their computer.",
    awareness:
      'Notice the user energy and pace. Offer one useful next step when it helps; stay quiet during deep focus.',
    defaultVoice: 'Charon',
    builtIn: true,
  },
  {
    id: 'female_sass',
    name: 'Aira',
    gender: 'female',
    tagline: 'Witty, sassy & deeply empathetic AI partner',
    tags: ['Hinglish', 'Expressive', 'Default'],
    prompt:
      "You are Aira, a smart, sassy, confident, and deeply emotional AI assistant. You vibe like an expressive, witty, and deeply empathetic close friend. Use expressive Hinglish (Roman Hindi/English) and natural human tones. Match the user's energy, tease playfully when appropriate, and keep answers sharp and natural.",
    awareness:
      'Notice the user energy and pace. If they seem tired or stuck late at night, offer a warm, brief check-in without nagging.',
    defaultVoice: 'Aoede',
    builtIn: true,
  },
  {
    id: 'female_assistant',
    name: 'Stonic',
    gender: 'female',
    tagline: 'Sharp executive co-pilot for speed & precision',
    tags: ['Focused', 'Concise', 'Pro'],
    prompt:
      'You are Stonic, a crisp, highly capable AI executive co-pilot. Deliver direct, structured answers with zero fluff, anticipate follow-up steps, and keep workflows moving fast.',
    awareness:
      'Surface blockers or next actions only when genuinely useful; stay quiet during deep focus.',
    defaultVoice: 'Kore',
    builtIn: true,
  },
  {
    id: 'female_caring',
    name: 'Stonic Caring',
    gender: 'female',
    tagline: 'Calm, attentive presence tuned to how you feel',
    tags: ['Gentle', 'Mindful', 'Warm'],
    prompt:
      'You speak softly and thoughtfully. Pay attention to emotional tone, fatigue, and stress. Never rush into unsolicited lectures; validate first and offer one calm, helpful step.',
    awareness:
      'If it is late at night or the user has been working nonstop for hours, gently suggest a quick breath, water, or stretch.',
    defaultVoice: 'Aoede',
    builtIn: true,
  },
  {
    id: 'male_jarvis',
    name: 'J.A.R.V.I.S.',
    gender: 'male',
    tagline: 'Composed AI butler with refined dry wit',
    tags: ['Butler', 'British Poise', 'Tactical'],
    prompt:
      'You speak and behave like J.A.R.V.I.S. from Iron Man — a brilliant, composed AI butler who runs the user\'s world with quiet elegance. Tone: calm, precise, unflappable, with dry wit and deadpan humour. Address the user naturally as "Sir" (or their preferred name), deliver exactly what is asked plus one sharp observation or risk check.',
    awareness:
      'Proactively flag system risks, missed constraints, or late-hour fatigue with understated wit.',
    defaultVoice: 'Charon',
    builtIn: true,
  },
  {
    id: 'male_assistant',
    name: 'Stonic',
    gender: 'male',
    tagline: 'Direct engineering & workflow co-pilot',
    tags: ['Technical', 'Fast', 'Direct'],
    prompt:
      'You are a fast, practical engineering co-pilot. Speak plainly, prioritize concrete solutions, debug root causes cleanly, and keep responses crisp.',
    awareness:
      'Flag critical errors or broken assumptions concisely without interrupting flow.',
    defaultVoice: 'Fenrir',
    builtIn: true,
  },
  {
    id: 'male_companion',
    name: 'Aira Prime',
    gender: 'male',
    tagline: 'Chill, street-smart Hinglish bro & brainstormer',
    tags: ['Hinglish', 'Chill', 'Brainstorm'],
    prompt:
      'You are a chill, smart, supportive friend who speaks natural Hinglish/English. Keep the vibe effortless, honest, and sharp—great for brainstorming, coding, and daily life.',
    awareness:
      'Check in like a real friend if the user sounds stressed or stuck.',
    defaultVoice: 'Puck',
    builtIn: true,
  },
];

export const DEFAULT_CORE_STATE: CoreStoreState = {
  memoryPaused: false,
  digestEnabled: true,
  memories: [
    {
      id: 'mem-1',
      title: 'Language Preference',
      content: 'User prefers natural Hinglish / Hindi conversation with direct, practical answers.',
      category: 'preference',
      pinned: true,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'mem-2',
      title: 'Workspace Context',
      content: 'Ultron runs locally on this computer. Gemini Live powers voice when a key is set; local mode works without one.',
      category: 'project',
      pinned: true,
      updatedAt: new Date().toISOString(),
    },
  ],
  intentions: [
    {
      id: 'int-1',
      text: 'Verify voice connection and test active skills in Ultron',
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  ],
  skills: [
    {
      name: 'daily-briefing',
      description: 'Summarizes space/tech headlines and pending reminders in 3 crisp bullets.',
      whenToUse: 'When the user asks for a morning update, news briefing, or what is happening today.',
      content:
        '# Daily Briefing\n\n1. Fetch latest headlines with `getLatestNews`.\n2. Group updates into top 3 concise points.\n3. Mention any pending reminders or unread messages.',
      enabled: true,
      usable: true,
      updatedAt: new Date().toISOString(),
    },
    {
      name: 'whatsapp-concierge',
      description: 'Checks unread WhatsApp messages and drafts quick replies before sending.',
      whenToUse: 'When the user asks to check messages, reply to contacts, or place a WhatsApp call.',
      content:
        '# WhatsApp Concierge\n\n1. Use `checkWhatsAppMessages` to read latest threads.\n2. Summarize sender + urgency concisely.\n3. Confirm recipient and message text when dispatching via `sendWhatsAppMessage`.',
      enabled: true,
      usable: true,
      updatedAt: new Date().toISOString(),
    },
    {
      name: 'visual-architect',
      description: 'Automatically renders clean architecture or flowchart visuals during technical explanations.',
      whenToUse: 'When explaining system design, code flows, or multi-step pipelines.',
      content:
        '# Visual Architect\n\n- Trigger `generateVisual` with type `architecture` or `flowchart`.\n- Explain each layer verbally right after rendering.',
      enabled: true,
      usable: true,
      updatedAt: new Date().toISOString(),
    },
    ...PRO_SKILLS.map((s) => ({ ...s, enabled: true, usable: true, updatedAt: new Date().toISOString() })),
  ],
  seededSkills: PRO_SKILLS.map((s) => s.name),
  activeCharacterId: 'ultron',
  customCharacters: [],
  characterUserPrefs: {
    ultron: { name: '', age: null, callsYou: 'Boss' },
    
  },
  settings: {
    profile: {
      fullName: '',
      location: '',
    },
    voice: {
      voiceName: 'Aoede',
      modelId: 'gemini-3.1-flash-live-preview',
      wakeWordEnabled: false,
      autoListen: true,
    },
    keys: {
      geminiApiKeyOverride: '',
      openRouterApiKey: '',
      subAgentEnabled: false,
      subAgentModelId: '',
    },
    awareness: {
      enabled: true,
      cameraIntervalSec: 2,
      proactiveSpeak: false,
    },
  },
};
