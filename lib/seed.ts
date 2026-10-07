import sharp from 'sharp';
import { one, run, setting, setSetting } from './db';
import { devAccess } from './auth';
import { localStorage } from './storage';
import { saveProject, enqueueRun, claimJob, processJob, listStories, approve } from './services';
export async function seed() {
  if (one('SELECT id FROM projects LIMIT 1') || setting('seeded', '') === 'true') {
    console.log('Existing data retained. Seed skipped.');
    return;
  }
  if (!devAccess())
    throw new Error(
      'Demo seeding is disabled in production. Explicit LOCAL_DEMO_ACCESS=true is required.',
    );
  const adminId = setting('primaryAdminId', '');
  const projects = [
    {
      name: 'Sunday Coffee',
      industry: 'Coffee & café',
      description:
        'A fictional neighborhood café celebrating slow mornings and thoughtfully made coffee.',
      services: 'Seasonal coffee, Fresh pastries',
      audience: 'People who enjoy a slower start to their day',
      facts:
        'A neighborhood space for coffee and conversation.\nOur brief celebrates slow mornings and small rituals.\nSeasonal coffee and freshly baked pastries are part of our menu.\nGood coffee deserves a moment of your day.',
      colors: ['#f5e8d7', '#a67550', '#ecdbc2'],
      font: 'Lora',
      initial: 's.',
      visualDirection: 'Warm paper tones, soft shadows, editorial café details',
    },
    {
      name: 'Forma Studio',
      industry: 'Design & interiors',
      description:
        'A fictional independent design studio exploring considered spaces and everyday objects.',
      services: 'Interior concepts, Object styling',
      audience: 'Design-conscious people who enjoy considered spaces',
      facts:
        'Forma explores the connection between people and the spaces they use.\nOur approved brief focuses on interior concepts and object styling.\nConsidered materials and simple forms guide our visual direction.\nThoughtful details shape everyday spaces.',
      colors: ['#ebe8f3', '#9d91b9', '#ded9e9'],
      font: 'Inter',
      initial: 'F',
      visualDirection: 'Architectural arches, lilac and stone, minimal geometric forms',
    },
    {
      name: 'Fern & Field',
      industry: 'Plants & home',
      description: 'A fictional plant shop bringing a little green into everyday living spaces.',
      services: 'Indoor plants, Planters',
      audience: 'People making space for plants at home',
      facts:
        'A little green can be part of your everyday space.\nIndoor plants and planters are part of our approved product brief.\nFern & Field celebrates the small ritual of caring for plants.\nOur visual direction draws on soft greens and natural forms.',
      colors: ['#e6ebdf', '#638166', '#c9d6bf'],
      font: 'Lora',
      initial: 'f&f',
      visualDirection: 'Botanical silhouettes, natural greens, quiet sunlight',
    },
  ];
  for (const p of projects) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><text x="10" y="85" fill="#24302a" font-size="80" font-family="serif">${p.initial.replace('&', '&amp;')}</text></svg>`;
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
    const logoId = localStorage.put(bytes, 'image/png', 'logo', 320, 120);
    saveProject({
      ...p,
      status: 'active',
      instagram: '',
      rules: 'Calm, thoughtful English. Use only approved project facts.',
      prohibited: 'Discounts, medical claims, fabricated testimonials',
      logoId,
      website: '',
      email: '',
      phone: '',
      address: '',
      location: '',
    });
  }
  const { listProjects } = await import('./services');
  // Sample drafts always use the free demo providers, even when live AI keys are configured.
  const mode = setting('providerMode', '');
  setSetting('providerMode', 'demo');
  try {
    await generateSamples(listProjects().map((p) => p.id));
  } finally {
    if (mode) setSetting('providerMode', mode);
    else run("DELETE FROM settings WHERE key='providerMode'");
  }
  for (const p of listProjects()) {
    const story = listStories().find((s) => s.projectId === p.id);
    if (story) approve([{ storyId: story.id, versionId: story.latestVersionId }], adminId);
  }
  setSetting('seeded', 'true');
  console.log('Seeded three fictional projects, approved drafts, and one retryable failed slot.');
}
async function generateSamples(projectIds: string[]) {
  for (const projectId of projectIds) enqueueRun(projectId, 'scheduled');
  let counter = 0;
  while (true) {
    const job = claimJob();
    if (!job) break;
    counter++;
    if (counter === 12) {
      run('UPDATE jobs SET attempts=3 WHERE id=?', job.id);
      await processJob({ ...job, attempts: 3 }, new Date(), true);
    } else await processJob(job);
  }
}
