import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { PALETTE_ROLES, describePalette, luminance, palette, readable } from './palette';
import sharp from 'sharp';
import { z } from 'zod';
import { AppError } from './errors';
import { assertEngagementAllowed } from './engagement';
import type { ImageProvider, Placement, Project, Script } from './types';

// Live providers: Claude researches and writes story scripts and applies written feedback,
// ChatGPT reviews the drafts, and OpenAI paints the background artwork. All are server-only.
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
export const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const OPENAI_IMAGE_QUALITY = (process.env.OPENAI_IMAGE_QUALITY || 'medium') as
  'low' | 'medium' | 'high';

export function missingLiveKeys() {
  return [
    !process.env.ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY',
    !process.env.OPENAI_API_KEY && 'OPENAI_API_KEY',
  ].filter(Boolean) as string[];
}
export function assertLiveConfigured() {
  const missing = missingLiveKeys();
  if (missing.length)
    throw new AppError(
      `Live AI is not configured. Set ${missing.join(' and ')} on the server, or choose Demo in Settings.`,
      503,
    );
}

let anthropic: Anthropic | undefined;
let openai: OpenAI | undefined;
const claude = () => (anthropic ??= new Anthropic());
const images = () => (openai ??= new OpenAI());
// Tests replace the SDK clients with fakes so no paid call is ever made.
export function setLiveClients(clients: { anthropic?: Anthropic; openai?: OpenAI }) {
  anthropic = clients.anthropic;
  openai = clients.openai;
}

const storySchema = z.object({
  kind: z.enum(['standard', 'poll', 'question', 'dm']),
  topic: z.string(),
  headline: z.string(),
  body: z.string(),
  cta: z.string(),
  visual: z.string(),
  sources: z.array(z.string()),
});
const planSchema = z.object({ stories: z.array(storySchema) });
const rewriteSchema = z.object({ headline: z.string(), body: z.string(), cta: z.string() });
const visualSchema = z.object({ visual: z.string() });
const reviewSchema = z.object({
  reviews: z.array(
    z.object({ index: z.number(), passed: z.boolean(), issues: z.array(z.string()) }),
  ),
});
export const OPENAI_REVIEW_MODEL = process.env.OPENAI_REVIEW_MODEL || 'gpt-5.5';
export const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || OPENAI_REVIEW_MODEL;

const SYSTEM = `You write Instagram Stories for small brands managed by a creative agency.
Each story is one 1080x1920 frame: a short headline, one or two sentences of body copy, and a call to action, placed as text over AI-generated background artwork.

Rules that always apply:
- Claims about the brand itself (products, prices, offers, history, quality) must come from the brief. Never invent prices, discounts, statistics, awards, testimonials, or dates.
- Timely angles found through web research (seasons, local events, industry news, trends) are welcome, but only when a search result supports them; list the URLs you relied on in "sources", otherwise leave "sources" empty.
- Respect the brand's content rules and never touch a prohibited topic.
- Keep copy short so it fits the frame: headline at most 6 words, body at most 160 characters, CTA at most 32 characters.
- Write in the language the content rules ask for; otherwise English.
- "visual" is a prompt for an image model: describe one specific scene in the brand's visual direction and palette, written in the photo style and text position assigned to that story. It must contain no text, letters, numbers, logos, or people's faces. Keep the part of the frame where the text sits calm and uncluttered so overlaid text stays readable.
- The brand's visual direction sets the mood, palette, and world of subjects; the assigned photo style decides the shot. Do not fall back to the same signature shot every time.
- Variety matters: a follower sees these stories day after day. Each story needs its own subject, setting, camera distance and angle, and dominant color; never reuse a scene, setting, or composition from the recent image prompts.`;

const webSearch = {
  type: 'web_search_20260209' as const,
  name: 'web_search' as const,
  max_uses: 5,
};
const webFetch = { type: 'web_fetch_20260209' as const, name: 'web_fetch' as const, max_uses: 6 };
type ServerTool = typeof webSearch | typeof webFetch;

function brief(project: Project) {
  return JSON.stringify(
    {
      name: project.name,
      industry: project.industry,
      description: project.description,
      services: project.services,
      audience: project.audience,
      approvedFacts: project.facts,
      contentRules: project.rules,
      prohibitedTopics: project.prohibited,
      visualDirection: project.visualDirection,
      palette: describePalette(project.colors),
      website: project.website,
      location: project.location || project.address,
    },
    null,
    2,
  );
}

function engagementRules(project: Project) {
  return project.allowEngagement
    ? `Story kinds: "standard" is informational. "question" asks the audience something, "dm" invites a direct message, "poll" offers 2 to 4 answers listed at the end of the body as separate lines "A. ...", "B. ...". Mix kinds, but keep at least half of the stories "standard".`
    : `Every story must have kind "standard" and be purely informational: no questions, no question marks, no polls or answer choices, and no requests to reply, vote, comment, or send a message.`;
}

// Runs one Claude request to completion and returns the parsed output plus every URL that
// web search actually returned, so cited sources can be checked against real results.
async function parse<T extends z.ZodType>(
  schema: T,
  prompt: string | Anthropic.Beta.BetaContentBlockParam[],
  tools: ServerTool[] = [],
  system = SYSTEM,
) {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
  const seen = new Set<string>();
  for (let turn = 0; turn < 4; turn++) {
    const response = await claude().beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
      system,
      messages,
      ...(tools.length ? { tools } : {}),
    });
    for (const block of response.content ?? [])
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content))
        for (const result of block.content) seen.add(result.url);
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (response.stop_reason === 'refusal')
      throw new AppError('Claude declined to write this story. Adjust the brief and retry.');
    if (response.stop_reason === 'max_tokens' || !response.parsed_output)
      throw new AppError('Claude returned an incomplete story. Retry the generation.');
    return { output: response.parsed_output as z.infer<T>, urls: seen };
  }
  throw new AppError('Claude research did not finish. Retry the generation.');
}

function toScript(project: Project, story: z.infer<typeof storySchema>, urls: Set<string>): Script {
  const script: Script = {
    topic: story.topic.slice(0, 180),
    headline: story.headline,
    body: story.body,
    cta: story.cta,
    visual: story.visual,
    // Keep only sources that web search really returned during this request.
    sources: story.sources.filter((url) => urls.has(url)).slice(0, 5),
    ...(story.kind !== 'standard' ? { kind: story.kind } : {}),
  };
  assertEngagementAllowed(project, script);
  return script;
}

export type PlanContext = {
  today: string;
  approved: string[];
  skipped: string[];
  feedback: string[];
  // An admin's own prompt for this one story, from the editor.
  direction?: string;
  // What the brand's recent stories already used, so new ones can look different.
  recentVisuals?: string[];
  recentLooks?: string[];
  recentPlacements?: Placement[];
};
// Photo styles rotated across stories so a brand's feed does not repeat one composition.
export const LOOKS = [
  'Macro close-up of a texture or small detail, shallow depth of field',
  'Flat lay shot from directly above, objects arranged on a surface',
  'Wide establishing shot of a place, lots of environment and air',
  'Hands in action doing the work or using the product, cropped at the wrists',
  'Single hero object on a bold solid-color backdrop, studio light',
  'Clean graphic illustration with simple shapes, flat vector style',
  'Abstract composition of shapes, light and gradients in the brand colors',
  'Candid lifestyle moment with people seen from behind or far away',
  'Low-key moody shot with dramatic side light and deep shadows',
  'Bright outdoor daylight scene in the local neighborhood or street',
  'Playful 3D render or paper-craft style scene',
  'Minimal still life with one or two objects and generous negative space',
];
// Picks looks the brand has not used recently, starting from a different spot each day.
export function pickLooks(count: number, recent: string[], day: string) {
  const offset = [...day].reduce((sum, c) => sum + c.charCodeAt(0), 0) % LOOKS.length;
  const rotated = [...LOOKS.slice(offset), ...LOOKS.slice(0, offset)];
  const fresh = rotated.filter((look) => !recent.includes(look));
  return [...fresh, ...rotated].slice(0, count);
}
// Alternates where the text sits, continuing from the brand's most recent story.
export function pickPlacements(count: number, recent: Placement[]): Placement[] {
  const start: Placement = recent[0] === 'top' ? 'bottom' : 'top';
  return Array.from({ length: count }, (_, i) =>
    i % 2 === 0 ? start : start === 'top' ? 'bottom' : 'top',
  );
}
const placementGuide = (placement: Placement) =>
  placement === 'top'
    ? 'text at the top: keep the upper 45% calm and simple, put the main subject in the lower half'
    : 'text at the bottom: keep the lower 50% calm and simple, put the main subject in the upper half';
function assignments(count: number, context: PlanContext) {
  const looks = pickLooks(count, context.recentLooks ?? [], context.today);
  const placements = pickPlacements(count, context.recentPlacements ?? []);
  return looks.map((look, i) => ({ look, placement: placements[i] }));
}
const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : 'none');
function planPrompt(
  project: Project,
  count: number,
  recent: string[],
  context: PlanContext,
  plan: { look: string; placement: Placement }[],
) {
  const research = project.webResearch !== false;
  return `Today is ${context.today}.

Brand brief:
${brief(project)}

Recent story topics to avoid repeating (pick different products, services and angles):
${list(recent)}

Recent image prompts (do not repeat their subjects, settings, or compositions):
${list(context.recentVisuals ?? [])}

Stories the reviewer approved recently (more like these):
${list(context.approved)}

Stories the reviewer left unapproved (less like these):
${list(context.skipped)}

Recent reviewer feedback:
${list(context.feedback)}

${engagementRules(project)}

${
  research
    ? `First use web search to find a few timely, relevant angles for this brand: things happening this week in its location, seasonal moments, or recent news and trends in its industry. Skip anything unrelated to the brand or its audience.\n\n`
    : ''
}${
    context.direction
      ? `Write ${count === 1 ? 'one story' : `${count} stories`} that follows this request from the brand's admin closely, while keeping the brand rules above:\n${context.direction}`
      : `Write ${count} stories for today with ${count} clearly different topics. Vary the angles: for example a useful tip, a timely hook, a product or service highlight, and a brand moment.`
  }

Write the stories in this order, each "visual" in its assigned photo style and text position:
${plan.map((p, i) => `${i + 1}. Photo style: ${p.look}. Layout: ${placementGuide(p.placement)}.`).join('\n')}`;
}

// ChatGPT reviews Claude's drafts as an independent editor.
async function review(project: Project, scripts: Script[]) {
  const response = await images().responses.parse({
    model: OPENAI_REVIEW_MODEL,
    instructions:
      'You are a strict social media editor reviewing Instagram Story drafts before a human sees them. Fail a story if it states a brand claim not supported by the brief, cites a timely fact without a source, touches a prohibited topic, breaks the content rules, is too long for a story frame (headline over 6 words, body over 160 characters, CTA over 32 characters), or is bland and generic. Keep each issue to one short, actionable sentence. Pass good stories with no issues.',
    input: `Brand brief:\n${brief(project)}\n\n${engagementRules(project)}\n\nDrafts:\n${JSON.stringify(
      scripts.map(({ kind, topic, headline, body, cta, sources }, index) => ({
        index,
        kind: kind || 'standard',
        topic,
        headline,
        body,
        cta,
        sources,
      })),
      null,
      2,
    )}`,
    text: { format: zodTextFormat(reviewSchema, 'story_review') },
  });
  return response.output_parsed?.reviews ?? [];
}

export const claudeScripts = {
  async plan(
    project: Project,
    count: number,
    recentTopics: string[],
    context: PlanContext = {
      today: new Date().toDateString(),
      approved: [],
      skipped: [],
      feedback: [],
    },
  ): Promise<Script[]> {
    assertLiveConfigured();
    const plan = assignments(count, context);
    let problem = '';
    let scripts: Script[] | undefined;
    for (let attempt = 0; attempt < 2 && !scripts; attempt++) {
      const { output, urls } = await parse(
        planSchema,
        planPrompt(project, count, recentTopics, context, plan) +
          (problem ? `\n\nYour previous attempt was rejected: ${problem} Fix that.` : ''),
        project.webResearch !== false ? [webSearch] : [],
      );
      try {
        if (output.stories.length < count) throw new AppError(`Expected ${count} stories.`);
        scripts = output.stories
          .slice(0, count)
          .map((s, i) => ({ ...toScript(project, s, urls), ...plan[i] }));
      } catch (error) {
        problem = (error as Error).message;
      }
    }
    if (!scripts) throw new AppError(`Claude could not follow the brief: ${problem}`);
    return this.reviewAndRevise(project, scripts);
  },
  // Stories that fail the ChatGPT review are rewritten once by Claude with the reviewer's notes.
  async reviewAndRevise(project: Project, scripts: Script[]) {
    const reviews = await review(project, scripts);
    const results: Script[] = [];
    for (const [index, script] of scripts.entries()) {
      const verdict = reviews.find((r) => r.index === index);
      const notes = verdict?.issues ?? [];
      if (!verdict || verdict.passed) {
        results.push({
          ...script,
          review: { reviewer: OPENAI_REVIEW_MODEL, passed: !!verdict, notes, revised: false },
        });
        continue;
      }
      let revised = script;
      try {
        revised = await this.rewrite(project, script, notes.join('\n'));
      } catch {
        // Keep the original draft; the reviewer notes stay visible in the editor.
      }
      results.push({
        ...revised,
        review: {
          reviewer: OPENAI_REVIEW_MODEL,
          passed: false,
          notes,
          revised: revised !== script,
        },
      });
    }
    return results;
  },
  async rewrite(project: Project, script: Script, feedback: string) {
    assertLiveConfigured();
    const { output } = await parse(
      rewriteSchema,
      `Brand brief:\n${brief(project)}\n\n${engagementRules(project)}\n\nCurrent story (${
        script.kind || 'standard'
      }):\nHeadline: ${script.headline}\nBody: ${script.body}\nCTA: ${script.cta}\nSources: ${
        script.sources.join(', ') || 'none'
      }\n\nRewrite the story text to apply this feedback, keeping everything else as it is:\n${feedback}`,
    );
    const next = { ...script, ...output };
    assertEngagementAllowed(project, next);
    return next;
  },
  async revisualize(project: Project, script: Script, feedback: string) {
    assertLiveConfigured();
    const { output } = await parse(
      visualSchema,
      `Brand brief:\n${brief(project)}\n\nCurrent image prompt:\n${script.visual}\n\nLayout: ${placementGuide(script.placement ?? 'top')}.\n\nWrite a new image prompt that applies this direction from the brand's admin. Follow it closely; keep the brand's look only where the direction leaves room:\n${feedback}`,
    );
    return output.visual;
  },
};

// A soft wash behind the text areas keeps copy readable on photos: light behind dark text,
// dark behind light text, and strongest where this story's text sits.
export function wash(placement: Placement, darkText: boolean) {
  const color = darkText ? '#fff' : '#000';
  const stops =
    placement === 'top'
      ? [
          [0, 0.55],
          [0.4, 0.35],
          [0.6, 0.05],
          [0.82, 0.1],
          [1, 0.5],
        ]
      : [
          [0, 0.15],
          [0.3, 0.02],
          [0.5, 0.2],
          [0.7, 0.45],
          [1, 0.6],
        ];
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="w" x2="0" y2="1">${stops
      .map(
        ([at, opacity]) => `<stop offset="${at}" stop-color="${color}" stop-opacity="${opacity}"/>`,
      )
      .join('')}</linearGradient></defs><rect width="1080" height="1920" fill="url(#w)"/></svg>`,
  );
}

// Whether this brand's story text is drawn dark or light, matching defaultLayout.
function storyInk(project: Project) {
  const colors = palette(project.colors);
  return luminance(readable(colors.text, colors.background)) > 0.4 ? 'light' : 'dark';
}
export const openAIImages: ImageProvider = {
  async generate(project, script) {
    assertLiveConfigured();
    const result = await images().images.generate({
      model: OPENAI_IMAGE_MODEL,
      prompt: `${script.visual}\n\n${script.look ? `Photo style: ${script.look}. ` : ''}Brand palette: ${describePalette(project.colors)}. Vertical 9:16 composition, ${placementGuide(script.placement ?? 'top')}. Absolutely no text, letters, numbers, watermarks, or logos.`,
      size: '1024x1536',
      quality: OPENAI_IMAGE_QUALITY,
      n: 1,
    });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new AppError('OpenAI returned no image. Retry the generation.');
    const bytes = await sharp(Buffer.from(b64, 'base64'))
      .resize(1080, 1920, { fit: 'cover' })
      .composite([{ input: wash(script.placement ?? 'top', storyInk(project) === 'dark') }])
      .png()
      .toBuffer();
    return { bytes, mime: 'image/png' };
  },
};

// Claude reads the business (website, search); ChatGPT studies the post photos. Both run at once.
const paletteSchema = z.object({
  background: z.string(),
  text: z.string(),
  accent: z.string(),
  secondary: z.string(),
});
const paletteGuide =
  'palette: six-digit hex colors by role. background: the main backdrop tone; text: a headline color that reads clearly on the background; accent: the call-to-action and highlight color; secondary: a soft supporting tone';
// Shortens AI text to the form's limit, cutting at a word or list boundary.
function clip(value: string, max: number) {
  const text = value.trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(';'), cut.lastIndexOf(' '));
  return (stop > max / 2 ? cut.slice(0, stop) : cut).replace(/[\s,;:&-]+$/, '');
}
const businessSchema = z.object({
  name: z.string(),
  industry: z.string(),
  description: z.string(),
  services: z.string(),
  audience: z.string(),
  facts: z.string(),
  rules: z.string(),
  prohibited: z.string(),
  visualDirection: z.string(),
  palette: paletteSchema,
  font: z.enum(['Inter', 'Lora', 'Montserrat']),
  email: z.string(),
  phone: z.string(),
  address: z.string(),
  location: z.string(),
});
const styleSchema = z.object({
  visualDirection: z.string(),
  palette: paletteSchema,
  font: z.enum(['Inter', 'Lora', 'Montserrat']),
  themes: z.string(),
  visibleFacts: z.string(),
  brandName: z.string(),
  industry: z.string(),
});
type Keep = { colors?: string[]; font?: string; visualDirection?: string };
const hex = /^#[0-9a-fA-F]{6}$/;
const fontGuide =
  '"Lora" (serif) for classic, warm, or premium brands, "Montserrat" (geometric, bold) for energetic or modern brands, otherwise "Inter"';

async function studyPhotos(photos: Buffer[], keep: Keep) {
  const response = await images().responses.parse({
    model: OPENAI_VISION_MODEL,
    instructions:
      "You are an art director studying a brand's Instagram posts so new Instagram Stories match their look. Describe only what the images show.",
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `These are ${photos.length} images the brand has posted on Instagram.
- visualDirection: 2-3 sentences an image generator can follow to match the brand's imagery: subjects, photography or illustration style, lighting, composition, and color mood.
- ${paletteGuide}, taken from the images.
- font: ${fontGuide}, judged from any lettering and the overall feel.
- themes: recurring subjects and topics, comma-separated.
- visibleFacts: facts written in the images (offers, prices, opening hours, slogans), one per line; empty if none.
- brandName and industry: only if clearly shown, else empty strings. industry is a short label of 2-4 words, such as "Coffee & café".${
              keep.colors || keep.font || keep.visualDirection
                ? '\nThe admin already chose some styles by hand; they will be kept, so describe the photos honestly anyway.'
                : ''
            }`,
          },
          ...photos.map((bytes) => ({
            type: 'input_image' as const,
            image_url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
            detail: 'auto' as const,
          })),
        ],
      },
    ],
    text: { format: zodTextFormat(styleSchema, 'brand_style') },
  });
  const style = response.output_parsed;
  if (!style) throw new AppError('ChatGPT could not read the photos. Try again.');
  return style;
}

async function readBusiness(website: string, instagram: string, keep: Keep) {
  const kept = [
    keep.colors &&
      `brand palette ${keep.colors.map((c, i) => `${PALETTE_ROLES[i].toLowerCase()} ${c}`).join(', ')}`,
    keep.font && `story font ${keep.font === 'Brand' ? "the brand's own typeface" : keep.font}`,
    keep.visualDirection && `visual direction "${keep.visualDirection}"`,
  ].filter(Boolean);
  const text = `Prepare a brief for a new brand account.
Website: ${website || 'none given'}
Instagram profile: ${instagram || 'none given'}
${kept.length ? `\nThe admin has already set the ${kept.join('; ')}. Keep these exactly and make the rest of the brief fit them.\n` : ''}
Read the website with web_fetch (home page plus at most a few key pages such as about, menu, services, or contact). Use web_search only to confirm the business name, location, or what it offers if the website is missing or thin; Instagram pages usually cannot be read, so do not rely on them.

Fill every field:
- name: the brand name only, no tagline.
- industry: a short label of 2-4 words, such as "Coffee & café".
- description: 2-3 sentences on what the business is and what makes it distinct.
- services: main products or services, comma-separated.
- audience: who they serve.
- facts: one verifiable fact per line, taken only from what you read (offers, specialties, history, opening hours). No guesses.
- rules: tone of voice and language for stories, based on how the brand writes.
- prohibited: sensible topics to avoid for this kind of business, comma-separated.
- visualDirection: 2-3 sentences an image generator can follow to match the brand's imagery.
- ${paletteGuide}, taken from the brand; guess tastefully if the site gives no clear palette.
- font: ${fontGuide}.
- email, phone, address, location: public contact details if listed, else empty strings.`;
  const { output } = await parse(
    businessSchema,
    text,
    website ? [webFetch, webSearch] : [webSearch],
    'You set up brand briefs for a creative agency that writes Instagram Stories. Be accurate: copy facts only from sources you actually read, and leave a field empty rather than invent it.',
  );
  return output;
}

const lines = (...values: string[]) =>
  [
    ...new Set(
      values
        .flatMap((v) => v.split('\n'))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ].join('\n');

// Drafts a project brief for the admin to review. Claude researches the business while ChatGPT
// studies the post photos in parallel; the photos decide the look, the research decides the words.
export async function draftBrief(input: {
  website: string;
  instagram: string;
  photos?: Buffer[];
  // Styles the admin already set by hand; the AI works with them and never replaces them.
  keep?: Keep;
}) {
  assertLiveConfigured();
  const photos = input.photos ?? [];
  const keep = input.keep ?? {};
  const research = input.website || input.instagram;
  const [business, style] = await Promise.all([
    research ? readBusiness(input.website, input.instagram, keep) : null,
    photos.length ? studyPhotos(photos, keep) : null,
  ]);
  const found = style?.palette ?? business?.palette;
  const colors = found
    ? [found.background, found.text, found.accent, found.secondary].filter((c) => hex.test(c))
    : [];
  return {
    name: clip(business?.name || style?.brandName || '', 80),
    industry: clip(business?.industry || style?.industry || '', 80),
    description: clip(business?.description || '', 3000),
    services: business?.services || style?.themes || '',
    audience: business?.audience || '',
    facts: lines(business?.facts || '', style?.visibleFacts || ''),
    rules: business?.rules || '',
    prohibited: business?.prohibited || '',
    visualDirection: style?.visualDirection || business?.visualDirection || '',
    colors: colors.length === 4 ? colors : ['#f3eee8', '#172420', '#2525e0', '#e8e6f7'],
    font: style?.font || business?.font || 'Inter',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(business?.email || '') ? business!.email : '',
    phone: business?.phone || '',
    address: business?.address || '',
    location: business?.location || '',
    website: input.website,
    instagram: input.instagram,
    ...keep,
  };
}
