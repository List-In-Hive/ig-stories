import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import OpenAI from 'openai';
import sharp from 'sharp';
import { z } from 'zod';
import { AppError } from './errors';
import { assertEngagementAllowed } from './engagement';
import type { ImageProvider, Project, Script } from './types';

// Live providers: Claude writes story scripts and applies written feedback,
// OpenAI paints the background artwork. Both are server-only.
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
export const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const OPENAI_IMAGE_QUALITY = (process.env.OPENAI_IMAGE_QUALITY || 'medium') as
  | 'low'
  | 'medium'
  | 'high';

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
});
const planSchema = z.object({ stories: z.array(storySchema) });
const rewriteSchema = z.object({ headline: z.string(), body: z.string(), cta: z.string() });
const visualSchema = z.object({ visual: z.string() });

const SYSTEM = `You write Instagram Stories for small brands managed by a creative agency.
Each story is one 1080x1920 frame: a short headline, one or two sentences of body copy, and a call to action, placed as text over AI-generated background artwork.

Rules that always apply:
- Use only facts present in the brief. Never invent prices, discounts, statistics, awards, testimonials, dates, or claims.
- Respect the brand's content rules and never touch a prohibited topic.
- Keep copy short so it fits the frame: headline at most 6 words, body at most 160 characters, CTA at most 32 characters.
- Write in the language the content rules ask for; otherwise English.
- "visual" is a prompt for an image model: describe a photographic or illustrated scene in the brand's visual direction and palette. It must contain no text, letters, numbers, logos, or people's faces, and should keep the upper two thirds calm and uncluttered so overlaid text stays readable.`;

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
      location: project.location,
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

async function parse<T extends z.ZodType>(schema: T, prompt: string) {
  const response = await claude().beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal')
    throw new AppError('Claude declined to write this story. Adjust the brief and retry.');
  if (response.stop_reason === 'max_tokens' || !response.parsed_output)
    throw new AppError('Claude returned an incomplete story. Retry the generation.');
  return response.parsed_output as z.infer<T>;
}

function toScript(project: Project, story: z.infer<typeof storySchema>): Script {
  const script: Script = {
    topic: story.topic.slice(0, 180),
    headline: story.headline,
    body: story.body,
    cta: story.cta,
    visual: story.visual,
    sources: [],
    ...(story.kind !== 'standard' ? { kind: story.kind } : {}),
  };
  assertEngagementAllowed(project, script);
  return script;
}

export const claudeScripts = {
  async plan(project: Project, count: number, recentTopics: string[]): Promise<Script[]> {
    assertLiveConfigured();
    let problem = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await parse(
        planSchema,
        `Brand brief:\n${brief(project)}\n\nRecent story topics to avoid repeating: ${
          recentTopics.length ? recentTopics.join('; ') : 'none'
        }\n\n${engagementRules(project)}\n\nWrite ${count} stories for today with ${count} clearly different topics.${
          problem ? `\n\nYour previous attempt was rejected: ${problem} Fix that.` : ''
        }`,
      );
      try {
        if (result.stories.length < count) throw new AppError(`Expected ${count} stories.`);
        return result.stories.slice(0, count).map((s) => toScript(project, s));
      } catch (error) {
        problem = (error as Error).message;
      }
    }
    throw new AppError(`Claude could not follow the brief: ${problem}`);
  },
  async rewrite(project: Project, script: Script, feedback: string) {
    assertLiveConfigured();
    const result = await parse(
      rewriteSchema,
      `Brand brief:\n${brief(project)}\n\n${engagementRules(project)}\n\nCurrent story (${
        script.kind || 'standard'
      }):\nHeadline: ${script.headline}\nBody: ${script.body}\nCTA: ${script.cta}\n\nRewrite the story text to apply this reviewer feedback, keeping everything else as it is:\n${feedback}`,
    );
    const next = { ...script, ...result };
    assertEngagementAllowed(project, next);
    return next;
  },
  async revisualize(project: Project, script: Script, feedback: string) {
    assertLiveConfigured();
    const { visual } = await parse(
      visualSchema,
      `Brand brief:\n${brief(project)}\n\nCurrent image prompt:\n${script.visual}\n\nWrite a new image prompt that applies this reviewer feedback:\n${feedback}`,
    );
    return visual;
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
