import type {
  ScriptProvider,
  ImageProvider,
  ResearchProvider,
  Repository,
  FileStorage,
  Authentication,
  JobRunner,
} from './types';
import { AppError } from './errors';
import { setting } from './db';
import { assertEngagementAllowed } from './engagement';
export function assertDemo() {
  if (setting('providerMode', process.env.PROVIDER_MODE || 'demo') !== 'demo')
    throw new AppError(
      'Live providers are not configured. Choose Demo in Integrations to generate local drafts.',
      503,
    );
}
const xml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
export const demoResearch: ResearchProvider = {
  async fetch(project) {
    return {
      status: 'unavailable',
      message: `Instagram is not connected. Drafts use ${project.name}'s approved brief and evergreen topics. No live news was fetched.`,
      sourceUrl: null,
      publishedAt: null,
    };
  },
};
const topics = [
  'A closer look',
  'Your everyday ritual',
  'Small details, big meaning',
  'Meet your next favorite',
  'A moment for you',
  'Made for your day',
  'Start with what matters',
  'The thoughtful choice',
  'In good company',
  'Find your inspiration',
  'A fresh perspective',
  'A little everyday joy',
  'Behind the idea',
  'Simple, considered, yours',
  'Something to come back to',
  'Make room for possibility',
];
export const demoScript: ScriptProvider = {
  async generate(project, slot, seed, recent) {
    assertDemo();
    const banned = project.prohibited
      .toLowerCase()
      .split(/[\n,]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    const pool = topics.filter((t) => !banned.some((b) => t.toLowerCase().includes(b)));
    if (pool.length < 4)
      throw new AppError('Prohibited topics leave too few demo ideas. Update the brief.');
    const start = (seed + slot * 3) % pool.length;
    let topic = pool[start];
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[(start + i) % pool.length];
      if (!recent.includes(candidate)) {
        topic = candidate;
        break;
      }
    }
    const facts = project.facts
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean);
    const service = project.services
      .split(/[\n,]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    const body = facts.length ? facts[(seed + slot) % facts.length] : project.description;
    const detail = service.length ? service[(seed + slot) % service.length] : project.industry;
    const safeBody =
      body || `Explore the ${project.industry.toLowerCase()} world of ${project.name}.`;
    if (banned.some((b) => safeBody.toLowerCase().includes(b)))
      throw new AppError(
        'Approved facts conflict with prohibited topics. Review the project brief.',
      );
    const kind =
      project.allowEngagement && slot > 0
        ? (['standard', 'poll', 'question', 'dm'] as const)[(slot - 1) % 4]
        : 'standard';
    const headline =
      kind === 'poll'
        ? 'Which would you choose?'
        : kind === 'question'
          ? 'Do you like this idea?'
          : kind === 'dm'
            ? "Let's start a conversation."
            : `${topic}.`;
    const script = {
      topic,
      headline,
      body: kind === 'poll' ? `${safeBody}\n\nA. Tell me more\nB. Show me the details` : safeBody,
      cta:
        kind === 'poll'
          ? 'Vote for your favorite'
          : kind === 'question'
            ? 'Reply and let us know'
            : kind === 'dm'
              ? 'DM us to find out more'
              : detail
                ? `Discover ${detail.toLowerCase()}`
                : 'Discover more',
      visual: `${project.visualDirection}. Abstract composition in ${project.colors.join(', ')}. No lettering, logo, or contact details. ${project.rules}\n${project.allowEngagement ? 'Question, poll, and DM prompts are allowed.' : 'Informational stories only. No questions, answer choices, voting, replies, or DM prompts.'}`,
      sources: [],
      ...(kind !== 'standard' ? { kind } : {}),
    };
    assertEngagementAllowed(project, script);
    return script;
  },
};
export const demoImage: ImageProvider = {
  async generate(project, script, seed) {
    assertDemo();
    const [a, b, c] = project.colors;
    const shift = seed % 200;
    const circle = (x: number, y: number, r: number, color: string, opacity: number) =>
      `<circle cx="${x}" cy="${y}" r="${r}" fill="${xml(color)}" opacity="${opacity}"/>`;
    const shapes = project.industry.toLowerCase().includes('coffee')
      ? `<path d="M220 1020h540v380q-270 210-540 0z" fill="${b}"/><path d="M760 1090q300 0 120 250H760" fill="none" stroke="${b}" stroke-width="70"/><ellipse cx="490" cy="1020" rx="270" ry="80" fill="${c}"/><path d="M420 890q-70-120 0-230m160 230q70-120 0-230" fill="none" stroke="${b}" stroke-width="15" opacity=".25"/>`
      : project.industry.toLowerCase().includes('plant')
        ? `<path d="M540 1780V960" stroke="${c}" stroke-width="14"/><path d="M540 1550Q40 1520 180 1100Q560 1110 540 1550M540 1350Q950 1390 930 890Q480 880 540 1350" fill="${b}" opacity=".55"/><path d="M350 1780L300 1470h480l-60 310z" fill="${c}" opacity=".85"/>`
        : `<path d="M140 1700V1120a400 400 0 0 1 800 0v580z" fill="${b}" opacity=".45"/><path d="M350 1700V1170a190 190 0 0 1 380 0v530z" fill="${c}" opacity=".55"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><defs><linearGradient id="g" x2=".8" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#g)"/>${circle(930 - shift, 180 + shift, 380, b, 0.22)}${circle(70 + shift, 780 - shift, 280, c, 0.13)}<g transform="translate(${shift / 5 - 20},${shift / 4})">${shapes}</g><path d="M70 1830H1010" stroke="${b}" stroke-opacity=".2" stroke-width="2"/></svg>`;
    return { bytes: Buffer.from(svg), mime: 'image/svg+xml' };
  },
};
const unavailable = (name: string): never => {
  throw new AppError(`${name} is not configured. See the integration checklist.`, 503);
};
// Explicit boundaries: activating live mode never falls back to simulated responses.
export const openAIScript: ScriptProvider = {
  async generate() {
    return unavailable('OpenAI script generation');
  },
};
export const openAIImage: ImageProvider = {
  async generate() {
    return unavailable('OpenAI image generation');
  },
};
export const instagramResearch: ResearchProvider = {
  async fetch() {
    return unavailable('Instagram retrieval');
  },
};
export const newsResearch: ResearchProvider = {
  async fetch() {
    return unavailable('News research');
  },
};
export const supabaseRepository: Repository = {
  getProject() {
    return unavailable('Supabase database');
  },
  listProjects() {
    return unavailable('Supabase database');
  },
  getVersion() {
    return unavailable('Supabase database');
  },
  listStories() {
    return unavailable('Supabase database');
  },
};
export const supabaseStorage: FileStorage = {
  put() {
    return unavailable('Supabase Storage');
  },
  read() {
    return unavailable('Supabase Storage');
  },
};
export const supabaseAuth: Authentication = {
  signIn() {
    return unavailable('Supabase Auth');
  },
  session() {
    return unavailable('Supabase Auth');
  },
};
export const triggerRunner: JobRunner = {
  async tick() {
    return unavailable('Trigger.dev scheduling');
  },
};
