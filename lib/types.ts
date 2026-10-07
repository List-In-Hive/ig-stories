export type Role = 'admin';
export type User = { id: string; name: string; username: string; role: Role; active: number };
export type Project = {
  id: string;
  name: string;
  industry: string;
  status: 'active' | 'paused' | 'archived';
  description: string;
  services: string;
  audience: string;
  instagram: string;
  visualDirection: string;
  colors: string[];
  font: 'Inter' | 'Lora';
  rules: string;
  prohibited: string;
  facts: string;
  allowEngagement: boolean;
  generateAt: string;
  webResearch: boolean;
  logoId: string | null;
  website: string;
  email: string;
  phone: string;
  address: string;
  location: string;
  createdAt: string;
  updatedAt: string;
};
export type Layer = {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  color: string;
  font: 'Inter' | 'Lora';
  align: 'left' | 'center' | 'right';
  visible: boolean;
};
export type Layout = {
  headline: Layer;
  body: Layer;
  cta: Layer;
  contact: Layer;
  logo: { x: number; y: number; width: number; visible: boolean };
};
export type Script = {
  kind?: 'standard' | 'poll' | 'question' | 'dm';
  topic: string;
  headline: string;
  body: string;
  cta: string;
  visual: string;
  sources: string[];
  review?: { reviewer: string; passed: boolean; notes: string[]; revised: boolean };
};
export type Snapshot = {
  script: Script;
  layout: Layout;
  backgroundId: string;
  logoId: string | null;
  project: Project;
  provider: 'demo' | 'live';
  seed: number;
  prompt: string;
  label: string;
  fontAssets?: Record<string, string>;
};
export type Version = {
  id: string;
  storyId: string;
  revision: number;
  data: Snapshot;
  createdBy: string | null;
  createdAt: string;
  reviewer?: string;
  approvedAt?: string;
};
export type Story = {
  id: string;
  projectId: string;
  runId: string | null;
  slot: number | null;
  businessDate: string;
  latestVersionId: string;
  createdAt: string;
  version: Version;
  approvedVersionId: string | null;
  exportCount: number;
};
export type ResearchRecord = {
  id: string;
  projectId: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  provider: string;
  status: string;
  data: { message: string };
};
export type Run = {
  id: string;
  projectId: string;
  businessDate: string;
  kind: string;
  status: string;
  createdAt: string;
  completed: number;
  failed: number;
  total: number;
};
export type Job = {
  id: string;
  runId: string;
  slot: number;
  status: string;
  attempts: number;
  availableAt: string;
  error: string | null;
  storyId: string | null;
  projectId?: string;
};
export type AppState = {
  user: User;
  projects: Project[];
  stories: Story[];
  runs: Run[];
  jobs: Job[];
  research: ResearchRecord[];
  settings: {
    providerMode: string;
    missingKeys: string[];
    automationEnabled: boolean;
    timeZone: string;
  };
  worker: { online: boolean; heartbeat: string | null; nextRun: string };
  today: string;
  historyStart: string;
  retention: { lastCleanup: string | null; awaitingDailyBatch: boolean };
  counts: { drafts: number; approved: number; failed: number; projects: number };
  devMode: boolean;
};
export interface Repository {
  getProject(id: string): Project;
  listProjects(): Project[];
  getVersion(id: string): Version;
  listStories(): Story[];
}
export interface FileStorage {
  put(bytes: Buffer, mime: string, kind: string, width: number, height: number): string;
  read(id: string): { bytes: Buffer; mime: string; width: number; height: number };
}
export interface Authentication {
  signIn(username: string, password: string): { token: string; user: User };
  session(token: string): User | null;
}
export interface ResearchProvider {
  fetch(project: Project): Promise<{
    status: string;
    message: string;
    sourceUrl: string | null;
    publishedAt: string | null;
  }>;
}
export interface ScriptProvider {
  generate(project: Project, slot: number, seed: number, recent: string[]): Promise<Script>;
}
export interface ImageProvider {
  generate(
    project: Project,
    script: Script,
    seed: number,
  ): Promise<{ bytes: Buffer; mime: string }>;
}
export interface JobRunner {
  tick(now?: Date): Promise<void>;
}
