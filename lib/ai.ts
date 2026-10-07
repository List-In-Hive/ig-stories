import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import sharp from 'sharp';
import { z } from 'zod';
import { AppError } from './errors';
import { assertEngagementAllowed } from './engagement';
import type { ImageProvider, Project, Script } from './types';

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

const SYSTEM = `You write Instagram Stories for small brands managed by a creative agency.
Each story is one 1080x1920 frame: a short headline, one or two sentences of body copy, and a call to action, placed as text over AI-generated background artwork.

Rules that always apply:
- Claims about the brand itself (products, prices, offers, history, quality) must come from the brief. Never invent prices, discounts, statistics, awards, testimonials, or dates.
- Timely angles found through web research (seasons, local events, industry news, trends) are welcome, but only when a search result supports them; list the URLs you relied on in "sources", otherwise leave "sources" empty.
- Respect the brand's content rules and never touch a prohibited topic.
- Keep copy short so it fits the frame: headline at most 6 words, body at most 160 characters, CTA at most 32 characters.
- Write in the language the content rules ask for; otherwise English.
- "visual" is a prompt for an image model: describe a photographic or illustrated scene in the brand's visual direction and palette. It must contain no text, letters, numbers, logos, or people's faces, and should keep the upper two thirds calm and uncluttered so overlaid text stays readable.`;

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
      palette: project.colors,
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
};
const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : 'none');
function planPrompt(project: Project, count: number, recent: string[], context: PlanContext) {
  const research = project.webResearch !== false;
  return `Today is ${context.today}.

Brand brief:
${brief(project)}

Recent story topics to avoid repeating:
${list(recent)}

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
}Write ${count} stories for today with ${count} clearly different topics. Vary the angles: for example a useful tip, a timely hook, a product or service highlight, and a brand moment.`;
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
    let problem = '';
    let scripts: Script[] | undefined;
    for (let attempt = 0; attempt < 2 && !scripts; attempt++) {
      const { output, urls } = await parse(
        planSchema,
        planPrompt(project, count, recentTopics, context) +
          (problem ? `\n\nYour previous attempt was rejected: ${problem} Fix that.` : ''),
        project.webResearch !== false ? [webSearch] : [],
      );
      try {
        if (output.stories.length < count) throw new AppError(`Expected ${count} stories.`);
        scripts = output.stories.slice(0, count).map((s) => toScript(project, s, urls));
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
      `Brand brief:\n${brief(project)}\n\nCurrent image prompt:\n${script.visual}\n\nWrite a new image prompt that applies this reviewer feedback:\n${feedback}`,
    );
    return output.visual;
  },
};

// A soft light wash behind the text areas keeps dark copy readable on photos.
const wash = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="w" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".55" stop-color="#fff" stop-opacity=".35"/><stop offset=".75" stop-color="#fff" stop-opacity=".1"/><stop offset=".86" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity=".6"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#w)"/></svg>`,
);

export const openAIImages: ImageProvider = {
  async generate(project, script) {
    assertLiveConfigured();
    const result = await images().images.generate({
      model: OPENAI_IMAGE_MODEL,
      prompt: `${script.visual}\n\nBrand palette: ${project.colors.join(', ')}. Vertical 9:16 composition. Absolutely no text, letters, numbers, watermarks, or logos.`,
      size: '1024x1536',
      quality: OPENAI_IMAGE_QUALITY,
      n: 1,
    });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new AppError('OpenAI returned no image. Retry the generation.');
    const bytes = await sharp(Buffer.from(b64, 'base64'))
      .resize(1080, 1920, { fit: 'cover' })
      .composite([{ input: wash }])
      .png()
      .toBuffer();
    return { bytes, mime: 'image/png' };
  },
};

const briefSchema = z.object({
  name: z.string(),
  industry: z.string(),
  description: z.string(),
  services: z.string(),
  audience: z.string(),
  facts: z.string(),
  rules: z.string(),
  prohibited: z.string(),
  visualDirection: z.string(),
  colors: z.array(z.string()),
  font: z.enum(['Inter', 'Lora']),
  email: z.string(),
  phone: z.string(),
  address: z.string(),
  location: z.string(),
});
const hex = /^#[0-9a-fA-F]{6}$/;
// Drafts a project brief from the brand's website (and public mentions) for the admin to review.
export async function draftBrief(input: {
  website: string;
  instagram: string;
  screenshots?: Buffer[];
}) {
  assertLiveConfigured();
  const screenshots = input.screenshots ?? [];
  const text = `Prepare a brief for a new brand account.
Website: ${input.website || 'none given'}
Instagram profile: ${input.instagram || 'none given'}
${
  screenshots.length
    ? `\nAttached are ${screenshots.length} screenshots of the brand's Instagram profile and posts. Study them closely: the visual style, colors, typography feel, recurring topics, tone of the captions, and any facts they state. Base visualDirection, colors, rules, and topics on what they show.\n`
    : ''
}
Read the website with web_fetch (home page plus at most a few key pages such as about, menu, services, or contact). Use web_search only to confirm the business name, location, or what it offers if the website is missing or thin; Instagram pages usually cannot be read, so do not rely on them.

Fill every field:
- description: 2-3 sentences on what the business is and what makes it distinct.
- services: main products or services, comma-separated.
- audience: who they serve.
- facts: one verifiable fact per line, taken only from what you read (offers, specialties, history, opening hours). No guesses.
- rules: tone of voice and language for stories, based on how the brand writes.
- prohibited: sensible topics to avoid for this kind of business, comma-separated.
- visualDirection: one sentence describing imagery that fits the brand.
- colors: exactly three six-digit hex colors from the brand (background, accent, soft secondary); guess tastefully if the site gives no clear palette.
- font: "Lora" for classic, warm, or premium brands, otherwise "Inter".
- email, phone, address, location: public contact details if listed, else empty strings.`;
  const { output } = await parse(
    briefSchema,
    screenshots.length
      ? [
          ...screenshots.map((bytes) => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: 'image/jpeg' as const,
              data: bytes.toString('base64'),
            },
          })),
          { type: 'text' as const, text },
        ]
      : text,
    input.website ? [webFetch, webSearch] : [webSearch],
    'You set up brand briefs for a creative agency that writes Instagram Stories. Be accurate: copy facts only from sources you actually read, and leave a field empty rather than invent it.',
  );
  const colors = output.colors.filter((c) => hex.test(c)).slice(0, 3);
  return {
    ...output,
    colors: colors.length === 3 ? colors : ['#f3eee8', '#2525e0', '#e8e6f7'],
    website: input.website,
    instagram: input.instagram,
  };
}
