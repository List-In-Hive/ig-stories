'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Layers3,
  LayoutDashboard,
  FolderKanban,
  History,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Check,
  CheckCheck,
  SlidersHorizontal,
  Sparkles,
  Clock3,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  LogOut,
  Activity,
  MoreHorizontal,
  Pause,
  Play,
  Archive,
  Trash2,
  ShieldCheck,
  Plug,
  Zap,
  LoaderCircle,
  X,
  Info,
  Leaf,
} from 'lucide-react';
import type { AppState, Project, Story, Run } from '@/lib/types';
import {
  api,
  Button,
  Badge,
  Field,
  Empty,
  Modal,
  formatClock,
  formatDate,
  formatTime,
  formatShortTime,
  setDisplayTimeZone,
  zoneLabel,
} from './ui';
// The distinct daily generation times of active projects, such as "8:00 AM, 9:30 AM".
const dailyTimes = (state: AppState) =>
  [
    ...new Set(
      state.projects.filter((p) => p.status === 'active').map((p) => p.generateAt || '08:00'),
    ),
  ]
    .sort()
    .map(formatClock)
    .join(', ') || formatClock('08:00');
import Login from './login';
import Brand from './brand';
import ProjectForm from './project-form';
import { palette } from '@/lib/palette';
import StoryEditor from './story-editor';
import SaveStories from './save-stories';
export type Command = <T = Record<string, unknown>>(
  action: string,
  data?: Record<string, unknown>,
) => Promise<T>;
type Toast = { message: string; error: boolean };
const nav = [
  { path: '/today', label: 'Today', icon: LayoutDashboard },
  { path: '/projects', label: 'Projects', icon: FolderKanban },
  { path: '/history', label: 'History', icon: History },
  { path: '/settings', label: 'Settings', icon: Settings },
];
export default function Workspace() {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<AppState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [projectForm, setProjectForm] = useState<Project | 'new' | null>(null);
  const [manual, setManual] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [activity, setActivity] = useState(false);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const next = await api<AppState>('/api/state');
      setDisplayTimeZone(next.settings.timeZone);
      setState(next);
    } catch (e) {
      if ((e as Error & { status: number }).status === 401) setState(null);
      else setToast({ message: (e as Error).message, error: true });
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const command: Command = async (action, data) => {
    try {
      const result = await api('/api/command', { action, ...data });
      await refresh();
      return result as never;
    } catch (e) {
      setToast({ message: (e as Error).message, error: true });
      throw e;
    }
  };
  function navigate(path: string) {
    if (dirty && !window.confirm('You have unsaved changes. Leave the editor?')) return;
    setDirty(false);
    router.push(path);
  }
  function notify(message: string) {
    setToast({ message, error: false });
  }
  async function signout() {
    if (dirty && !window.confirm('Sign out and discard unsaved changes?')) return;
    await api('/api/auth', { action: 'signout' });
    setState(null);
    setDirty(false);
    router.push('/login');
  }
  if (!loaded)
    return (
      <div className="app-loading">
        <Brand />
        <h2>Opening your workspace</h2>
        <LoaderCircle className="spin" />
      </div>
    );
  if (!state)
    return (
      <Login
        onSuccess={() => {
          void refresh();
          router.push('/today');
        }}
      />
    );
  const section = pathname.startsWith('/projects')
    ? 'Projects'
    : pathname.startsWith('/history')
      ? 'History'
      : pathname.startsWith('/settings')
        ? 'Settings'
        : pathname.startsWith('/editor')
          ? 'Story editor'
          : 'Today';
  const projectId = pathname.startsWith('/projects/') ? pathname.split('/')[2] : null;
  const project = state.projects.find((p) => p.id === projectId);
  const storyId = pathname.startsWith('/editor/') ? pathname.split('/')[2] : null;
  const story = state.stories.find((s) => s.id === storyId);
  const matching = search
    ? state.projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : [];
  return (
    <div className={`workspace ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <button
          className="brand-home"
          onClick={() => navigate('/today')}
          aria-label="Inspirovate Creatives Storyloom home"
        >
          <Brand />
        </button>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav>
          {nav.map((item) => (
            <button
              title={item.label}
              key={item.path}
              onClick={() => navigate(item.path)}
              className={section === item.label ? 'active' : ''}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.label === 'Today' && state.counts.drafts > 0 && <b>{state.counts.drafts}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-projects">
          <div className="sidebar-section-label">
            YOUR PROJECTS{' '}
            <button aria-label="Create project" onClick={() => setProjectForm('new')}>
              <Plus size={15} />
            </button>
          </div>
          {state.projects
            .filter((p) => p.status !== 'archived')
            .map((p) => (
              <button
                className={projectId === p.id ? 'selected' : ''}
                key={p.id}
                onClick={() => navigate(`/projects/${p.id}`)}
                title={p.name}
              >
                <i style={{ background: palette(p.colors).accent }} />
                <span>{p.name}</span>
                {p.status === 'paused' && <Pause size={12} />}
              </button>
            ))}
        </div>
        <div className="sidebar-bottom">
          <button className="demo-box" onClick={() => navigate('/settings')}>
            <Sparkles size={18} />
            <span>
              <strong>Inspirovate workspace</strong>
              <small>Ideas into stories</small>
            </span>
          </button>
          <button
            className="collapse-button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            <span>Collapse sidebar</span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="workspace-name">Storyloom</span> <ChevronRight size={14} />
            <strong>{section}</strong>
            {project && (
              <>
                <ChevronRight size={14} />
                {project.name}
              </>
            )}
          </div>
          <div className="topbar-tools">
            <div className="global-search">
              <Search size={16} />
              <input
                aria-label="Search projects"
                placeholder="Search projects…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <div className="search-results">
                  {matching.length ? (
                    matching.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          navigate(`/projects/${p.id}`);
                          setSearch('');
                        }}
                      >
                        {p.name}
                        <ArrowUpRight size={14} />
                      </button>
                    ))
                  ) : (
                    <p>No matching projects</p>
                  )}
                </div>
              )}
            </div>
            <button
              className="icon-btn"
              aria-label="Recent activity"
              onClick={() => setActivity(true)}
            >
              <Activity size={19} />
            </button>
            <button
              className="avatar"
              onClick={() => navigate('/settings')}
              title={`${state.user.name} · ${state.user.role}`}
            >
              {state.user.name
                .split(' ')
                .map((v) => v[0])
                .join('')
                .slice(0, 2)}
            </button>
            <button className="icon-btn" aria-label="Sign out" onClick={() => void signout()}>
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className={`content ${story ? 'editor-content' : ''}`}>
          {story ? (
            <StoryEditor
              key={story.id}
              story={story}
              project={state.projects.find((p) => p.id === story.projectId)}
              stock={state.settings.stock}
              aiVideo={state.settings.aiVideo}
              command={command}
              notify={notify}
              onDirty={setDirty}
              onBack={() => navigate('/today')}
            />
          ) : storyId ? (
            <Empty
              title="Story not found"
              description="The story may still be generating. Return to Today to see its progress."
              action={<Button onClick={() => navigate('/today')}>Go to Today</Button>}
            />
          ) : project ? (
            <ProjectDetails
              state={state}
              project={project}
              command={command}
              navigate={navigate}
              onEdit={() => setProjectForm(project)}
              onManual={() => setManual(project)}
              onDelete={() => setDeleting(project)}
              notify={notify}
            />
          ) : projectId ? (
            <Empty title="Project not found" description="Choose a project from the sidebar." />
          ) : section === 'Projects' ? (
            <Projects
              state={state}
              navigate={navigate}
              onCreate={() => setProjectForm('new')}
              onEdit={setProjectForm}
              onDelete={setDeleting}
            />
          ) : section === 'Settings' ? (
            <SettingsPage state={state} command={command} notify={notify} />
          ) : (
            <StoryList
              state={state}
              history={section === 'History'}
              command={command}
              navigate={navigate}
              notify={notify}
              onCreate={() => setProjectForm('new')}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>
            <i className={state.worker.online ? 'online-dot' : 'offline-dot'} />
            Local worker {state.worker.online ? 'online' : 'offline'}
            <span className="footer-separator">·</span>
            {state.settings.automationEnabled
              ? `Daily at ${dailyTimes(state)} ${zoneLabel()}`
              : 'Daily automation paused'}
          </span>
          <button onClick={() => setHelp(true)}>
            Workspace guide <Info size={13} />
          </button>
        </footer>
      </div>
      {toast && (
        <div role="alert" className={`toast ${toast.error ? 'error' : ''}`}>
          {toast.error ? <AlertCircle size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <button aria-label="Dismiss message" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {deleting && (
        <DeleteProjectForm
          project={deleting}
          onClose={() => setDeleting(null)}
          onDelete={async (confirmation) => {
            const result = await command<{ pendingFileDeletes: number }>('deleteProject', {
              projectId: deleting.id,
              confirmation,
            });
            setDeleting(null);
            navigate('/projects');
            notify(
              result.pendingFileDeletes
                ? 'Project deleted. File cleanup will retry automatically.'
                : 'Project and its related data and images deleted.',
            );
          }}
        />
      )}
      {projectForm && (
        <ProjectForm
          project={projectForm === 'new' ? undefined : projectForm}
          stock={state.settings.stock}
          onClose={() => setProjectForm(null)}
          onSave={async (p, projectId) => {
            const saved = await command<Project>('saveProject', { project: p, projectId });
            notify('Project saved. Future drafts will use this brief.');
            if (!projectId) navigate(`/projects/${saved.id}`);
          }}
        />
      )}
      {manual && (
        <ManualForm
          project={manual}
          onClose={() => setManual(null)}
          onSave={async (script) => {
            const story = await command<Story>('manual', {
              projectId: manual.id,
              script,
              requestKey: crypto.randomUUID(),
            });
            setManual(null);
            notify('Your exact script was saved as a new draft.');
            navigate(`/editor/${story.id}`);
          }}
        />
      )}
      {activity && (
        <Modal
          title="Recent activity"
          description="Stored generation runs and worker status."
          onClose={() => setActivity(false)}
        >
          <div className="modal-body">
            <p className="soft-note">
              {state.worker.online
                ? 'The local worker is running.'
                : 'The local worker is offline. Start it with the app to continue queued jobs.'}
            </p>
            <RunList runs={state.runs.slice(0, 10)} state={state} command={command} />
          </div>
        </Modal>
      )}
      {help && (
        <Modal title="A calmer daily workflow" onClose={() => setHelp(false)}>
          <div className="modal-body guide">
            <p>
              <strong>1. Shape the brief.</strong> Add approved facts, your original logo, and brand
              direction in Projects.
            </p>
            <p>
              <strong>2. Review the drafts.</strong> The local worker creates four independent story
              slots for each active project at that project’s daily time ({dailyTimes(state)}{' '}
              {zoneLabel()}) while it is running.
            </p>
            <p>
              <strong>3. Make it yours.</strong> Edit text and layout, regenerate artwork, or start
              a new idea. Each save creates a version.
            </p>
            <p>
              <strong>4. Approve and download.</strong> Download the exact approved version as a
              1080 × 1920 image, then post manually.
            </p>
            <div className="soft-note">
              {state.settings.providerMode === 'live'
                ? 'Claude writes the copy from each brief and OpenAI paints the artwork. Instagram is not connected, so posting stays manual.'
                : 'Artwork and copy are demo content. Switch to Live AI in Settings to use Claude and OpenAI.'}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function StoryCard({
  story,
  selected,
  onSelect,
  navigate,
  command,
  notify,
}: {
  story: Story;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  navigate: (path: string) => void;
  command: Command;
  notify: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function approval() {
    setBusy(true);
    try {
      await command('approve', {
        items: [{ storyId: story.id, versionId: story.latestVersionId }],
      });
      notify('This exact story version is approved.');
    } catch {
      // The shared command handler already displayed the server error.
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`story-card ${selected ? 'selected' : ''}`}>
      <div className="story-preview">
        <button
          className="preview-link"
          aria-label={`Edit ${story.version.data.script.topic}`}
          onClick={() => navigate(`/editor/${story.id}`)}
        >
          <img
            loading="lazy"
            alt={story.version.data.script.headline}
            src={`/api/stories/${story.id}/preview?version=${story.latestVersionId}`}
          />
        </button>
        <div className="preview-top">
          {onSelect && (
            <input
              aria-label={`Select ${story.version.data.script.topic}`}
              type="checkbox"
              checked={!!selected}
              onChange={(e) => onSelect(e.target.checked)}
            />
          )}
          <span>STORY {String(story.slot || 1).padStart(2, '0')}</span>
          <button
            className="preview-more"
            aria-label="Open story editor"
            onClick={() => navigate(`/editor/${story.id}`)}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
        <span className="sample-label">SAMPLE ARTWORK</span>
      </div>
      <div className="story-card-info">
        <div className="card-title">
          <h3>{story.version.data.script.topic}</h3>
          <span>v{story.version.revision}</span>
        </div>
        <div className="card-meta">
          <Badge status={story.approvedVersionId ? 'approved' : 'draft'} />
          <span title={`Generated ${formatTime(story.createdAt)}`}>
            Generated {formatShortTime(story.createdAt)}
          </span>
        </div>
        <div className="card-actions">
          <Button variant="ghost" onClick={() => navigate(`/editor/${story.id}`)}>
            <SlidersHorizontal size={14} />
            Edit story
          </Button>
          {story.approvedVersionId ? (
            <SaveStories
              versionIds={[story.approvedVersionId]}
              variant="secondary"
              small
              desktopLabel="Download"
              notify={notify}
            />
          ) : (
            <Button variant="secondary" busy={busy} onClick={() => void approval()}>
              <Check size={14} />
              Approve
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
function StoryList({
  state,
  history,
  command,
  navigate,
  notify,
  onCreate,
}: {
  state: AppState;
  history: boolean;
  command: Command;
  navigate: (path: string) => void;
  notify: (text: string) => void;
  onCreate: () => void;
}) {
  const [projectFilter, setProjectFilter] = useState('all');
  const [projectScope, setProjectScope] = useState('current');
  const [status, setStatus] = useState('all');
  const [date, setDate] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const effectiveDate = date || (!history ? state.today : '');
  const scopedProjects = state.projects.filter((p) =>
    history && projectScope === 'archived' ? p.status === 'archived' : p.status !== 'archived',
  );
  const stories = state.stories.filter(
    (s) =>
      scopedProjects.some((p) => p.id === s.projectId) &&
      (!effectiveDate || s.businessDate === effectiveDate) &&
      (projectFilter === 'all' || s.projectId === projectFilter) &&
      (status === 'all' ||
        (status === 'approved'
          ? !!s.approvedVersionId
          : status === 'draft'
            ? !s.approvedVersionId
            : false)),
  );
  const failed = state.jobs.filter(
    (j) =>
      j.status === 'failed' &&
      scopedProjects.some((p) => p.id === j.projectId) &&
      (!effectiveDate ||
        state.runs.find((r) => r.id === j.runId)?.businessDate === effectiveDate) &&
      (projectFilter === 'all' || j.projectId === projectFilter) &&
      (status === 'all' || status === 'failed'),
  );
  const pending = state.jobs.filter((j) => ['queued', 'running'].includes(j.status));
  const eligible = selected
    .map((id) => state.stories.find((s) => s.id === id))
    .filter((s): s is Story => !!s);
  async function batchApprove() {
    setBusy(true);
    try {
      await command('approve', {
        items: eligible.map((s) => ({ storyId: s.id, versionId: s.latestVersionId })),
      });
      notify(`${eligible.length} exact versions approved.`);
      setSelected([]);
    } catch {
      // The shared command handler already displayed the server error.
    } finally {
      setBusy(false);
    }
  }
  async function downloadZip() {
    setBusy(true);
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionIds: eligible.map((s) => s.approvedVersionId).filter(Boolean),
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'inspirovate-creatives-storyloom-approved-stories.zip';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Downloaded approved versions as a ZIP.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className={`page-heading ${history ? '' : 'today-heading'}`}>
        <div>
          <div className="eyebrow">
            {history
              ? 'TODAY + THE PREVIOUS TWO DAYS'
              : formatDate(state.today, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                }).toUpperCase()}
          </div>
          <h1>{history ? 'Your recent stories.' : 'Good stories. Ready for your day.'}</h1>
          <p>
            {history
              ? 'Keep today and the previous two days. Older stories are deleted after today’s daily batch is ready.'
              : 'A fresh set of stories for your brands. A little review, then they’re yours.'}
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/projects')}>
          <FolderKanban size={16} />
          Manage projects
          <ArrowUpRight size={15} />
        </Button>
      </div>
      {!history && (
        <>
          <div className="stats-grid">
            <Stat
              label="Active projects"
              value={state.counts.projects}
              icon={<FolderKanban size={19} />}
              note="Of 10 available spaces"
            />
            <Stat
              label="Ready to review"
              value={state.counts.drafts}
              icon={<Layers3 size={19} />}
              note="Drafts waiting for your eye"
              accent
            />
            <Stat
              label="Approved today"
              value={state.counts.approved}
              icon={<CheckCheck size={19} />}
              note="Ready to download & post"
            />
            <Stat
              label="Needs attention"
              value={state.counts.failed}
              icon={<AlertCircle size={19} />}
              note={
                state.counts.failed ? 'Generation slots to retry' : 'Everything is looking good'
              }
            />
          </div>
          <div className="daily-banner">
            <div className="banner-icon">
              <Sparkles size={21} />
            </div>
            <div>
              <strong>
                {pending.length
                  ? `Bringing your stories to life · ${pending.length} slots remaining`
                  : 'Your daily creative rhythm'}
              </strong>
              <p>
                {state.worker.online
                  ? `Four drafts per active project, daily at ${dailyTimes(state)} ${zoneLabel()}.`
                  : 'The worker is offline. Start the app and worker together to generate queued drafts.'}
              </p>
            </div>
            <div className="daily-banner-end">
              <span className={`status-pill ${state.worker.online ? '' : 'offline'}`}>
                <i />
                {state.worker.online ? 'Worker online' : 'Worker offline'}
              </span>
              <small>
                {state.settings.automationEnabled
                  ? `Next: ${formatTime(state.worker.nextRun)}`
                  : 'Automation paused'}
              </small>
            </div>
          </div>
        </>
      )}
      {history && (
        <div className="tabs details-tabs" role="tablist" aria-label="History projects">
          {['current', 'archived'].map((scope) => (
            <button
              key={scope}
              role="tab"
              aria-selected={projectScope === scope}
              className={projectScope === scope ? 'active' : ''}
              onClick={() => {
                setProjectScope(scope);
                setProjectFilter('all');
                setSelected([]);
              }}
            >
              {scope === 'current' ? 'Current projects' : 'Archived projects'}
            </button>
          ))}
        </div>
      )}
      <div className="section-heading">
        <h2>
          {history ? 'Story history' : 'Today’s stories'}
          <span className="count-pill">{stories.length}</span>
        </h2>
        <div className="filter-controls">
          <select
            aria-label="Filter by project"
            value={projectFilter}
            onChange={(e) => {
              setProjectFilter(e.target.value);
              setSelected([]);
            }}
          >
            <option value="all">All projects</option>
            {scopedProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setSelected([]);
            }}
          >
            <option value="all">All statuses</option>
            <option value="draft">Needs review</option>
            <option value="approved">Approved</option>
            <option value="failed">Failed generation</option>
          </select>
          <input
            aria-label="Filter by date"
            type="date"
            min={state.historyStart}
            max={state.today}
            value={effectiveDate}
            onChange={(e) => {
              setDate(e.target.value);
              setSelected([]);
            }}
          />
          {history && date && (
            <button className="icon-btn" aria-label="Clear date filter" onClick={() => setDate('')}>
              <X size={15} />
            </button>
          )}
        </div>
      </div>
      {selected.length > 0 && (
        <div className="selection-bar">
          <strong>{selected.length} selected</strong>
          <Button variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
          <div className="spacer" />
          <Button variant="secondary" busy={busy} onClick={() => void batchApprove()}>
            <CheckCheck size={15} />
            Approve selected
          </Button>
          <SaveStories
            versionIds={eligible.map((s) => s.approvedVersionId).filter((v): v is string => !!v)}
            disabled={busy}
            desktopLabel="Download approved ZIP"
            onDesktop={() => void downloadZip()}
            notify={notify}
          />
        </div>
      )}
      <div className="research-note">
        <Info size={14} />
        <span>
          {state.settings.providerMode === 'live'
            ? 'AI drafts from your approved briefs. Review every story before posting.'
            : 'Demo content from your approved briefs. Switch to Live AI in Settings for real drafts.'}
        </span>
      </div>
      {state.projects
        .filter(
          (p) =>
            stories.some((s) => s.projectId === p.id) || failed.some((j) => j.projectId === p.id),
        )
        .map((project) => (
          <section className="project-story-section" key={project.id}>
            <div className="project-story-heading">
              <div
                className="project-mark"
                style={{
                  background: palette(project.colors).background,
                  color: palette(project.colors).accent,
                }}
              >
                {project.name.charAt(0)}
              </div>
              <div>
                <button onClick={() => navigate(`/projects/${project.id}`)}>
                  {project.name}
                  <ChevronRight size={14} />
                </button>
                <span>
                  {project.industry}
                  {project.status !== 'active' ? ` · ${project.status}` : ''}
                </span>
              </div>
              <div className="spacer" />
              <span className="muted">
                {stories.filter((s) => s.projectId === project.id).length} stories
              </span>
              <button
                className="text-button"
                onClick={() =>
                  void command('generate', {
                    projectId: project.id,
                    requestKey: crypto.randomUUID(),
                  })
                    .then(() => notify('Four new draft slots queued.'))
                    .catch(() => {})
                }
                disabled={project.status === 'archived'}
              >
                <RefreshCw size={13} />
                Generate now
              </button>
            </div>
            <div className="stories-grid">
              {stories
                .filter((s) => s.projectId === project.id)
                .map((story) => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    selected={selected.includes(story.id)}
                    onSelect={(checked) =>
                      setSelected((ids) =>
                        checked ? [...ids, story.id] : ids.filter((id) => id !== story.id),
                      )
                    }
                    navigate={navigate}
                    command={command}
                    notify={notify}
                  />
                ))}
              {failed
                .filter((j) => j.projectId === project.id)
                .map((job) => (
                  <article className="failed-card" key={job.id}>
                    <div>
                      <AlertCircle size={30} />
                      <h3>This one needs another try.</h3>
                      <p>Story {job.slot} could not finish generating.</p>
                      <small>{job.error}</small>
                    </div>
                    <footer>
                      <Badge status="failed" />
                      {
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void command('retry', { runId: job.runId })
                              .then(() => notify('Only failed slots were queued for retry.'))
                              .catch(() => {})
                          }
                        >
                          <RefreshCw size={14} />
                          Retry failed
                        </Button>
                      }
                    </footer>
                  </article>
                ))}
            </div>
          </section>
        ))}
      {!stories.length && !failed.length && (
        <Empty
          title={
            state.projects.length
              ? 'A little space for fresh stories.'
              : 'Your first project starts here.'
          }
          description={
            state.projects.length
              ? 'Try changing the filters, or generate drafts from a project.'
              : 'Add a project brief and branding to create your first daily stories.'
          }
          action={
            <Button onClick={state.projects.length ? () => navigate('/projects') : onCreate}>
              {state.projects.length ? 'Browse projects' : 'Create project'}
              <ArrowRight size={16} />
            </Button>
          }
        />
      )}
    </>
  );
}
function Stat({
  label,
  value,
  icon,
  note,
  accent = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat-card ${accent ? 'accent' : ''}`}>
      <div>
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <strong>{String(value).padStart(2, '0')}</strong>
      <small>{note}</small>
    </div>
  );
}
function Projects({
  state,
  navigate,
  onCreate,
  onEdit,
  onDelete,
}: {
  state: AppState;
  navigate: (path: string) => void;
  onCreate: () => void;
  onEdit: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [tab, setTab] = useState('current');
  const scopedProjects = state.projects.filter((p) =>
    tab === 'archived' ? p.status === 'archived' : p.status !== 'archived',
  );
  const projects = scopedProjects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) &&
      (status === 'all' || p.status === status),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A HOME FOR EVERY BRAND</div>
          <h1>Your projects.</h1>
          <p>Good stories begin with a thoughtful brief. Keep every brand’s details together.</p>
        </div>
        <Button onClick={onCreate}>
          <Plus size={16} />
          Create project
        </Button>
      </div>
      <div className="tabs details-tabs" role="tablist" aria-label="Project groups">
        {['current', 'archived'].map((scope) => (
          <button
            key={scope}
            role="tab"
            aria-selected={tab === scope}
            className={tab === scope ? 'active' : ''}
            onClick={() => {
              setTab(scope);
              setStatus('all');
            }}
          >
            {scope === 'current' ? 'Current projects' : 'Archived'}
            <span className="count-pill">
              {
                state.projects.filter((p) =>
                  scope === 'archived' ? p.status === 'archived' : p.status !== 'archived',
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="section-heading">
        <h2>
          {tab === 'archived' ? 'Archived projects' : 'Current projects'}{' '}
          <span className="count-pill">{scopedProjects.length}</span>
        </h2>
        <div className="filter-controls">
          <div className="input-with-icon">
            <Search size={16} />
            <input
              aria-label="Search project list"
              placeholder="Find a project…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {tab === 'current' && (
            <select
              aria-label="Project status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          )}
        </div>
      </div>
      <div className="projects-grid">
        {projects.map((p) => (
          <article className="project-tile" key={p.id}>
            <div className="project-cover" style={{ background: palette(p.colors).background }}>
              <div className="cover-shapes" style={{ background: palette(p.colors).accent }} />
              {p.logoId ? (
                <img src={`/api/assets/${p.logoId}`} alt={`${p.name} logo`} />
              ) : (
                <span style={{ color: palette(p.colors).accent }}>{p.name.charAt(0)}</span>
              )}
              <Badge status={p.status} />
            </div>
            <div className="project-tile-body">
              <span className="eyebrow">{p.industry}</span>
              <button onClick={() => navigate(`/projects/${p.id}`)}>
                <h2>{p.name}</h2>
                <ArrowUpRight size={20} />
              </button>
              <p>{p.description}</p>
              <div className="project-tile-stats">
                <span>{state.stories.filter((s) => s.projectId === p.id).length} stories</span>
                <div className="palette">
                  {p.colors.map((c) => (
                    <i style={{ background: c }} key={c} />
                  ))}
                </div>
              </div>
              <div className="card-actions">
                <Button variant="secondary" onClick={() => navigate(`/projects/${p.id}`)}>
                  Open project
                  <ArrowRight size={15} />
                </Button>
                <Button variant="ghost" onClick={() => onEdit(p)}>
                  <SlidersHorizontal size={15} />
                  Edit brief
                </Button>
                <Button variant="ghost" onClick={() => onDelete(p)} title={`Delete ${p.name}`}>
                  <Trash2 size={15} /> Delete
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!projects.length && (
        <Empty
          title="No projects here yet."
          description="Create a project or adjust your search."
          action={<Button onClick={onCreate}>Create project</Button>}
        />
      )}
      <p className="capacity-note">
        <Leaf size={15} />
        {state.counts.projects} of 10 active project spaces in use. History keeps today and the
        previous two days for every project.
      </p>
    </>
  );
}
function ProjectDetails({
  state,
  project,
  command,
  navigate,
  onEdit,
  onManual,
  onDelete,
  notify,
}: {
  state: AppState;
  project: Project;
  command: Command;
  navigate: (path: string) => void;
  onEdit: () => void;
  onManual: () => void;
  onDelete: () => void;
  notify: (text: string) => void;
}) {
  const [tab, setTab] = useState('Overview');
  const [busy, setBusy] = useState(false);
  const research = state.research.find((r) => r.projectId === project.id);
  const stories = state.stories.filter((s) => s.projectId === project.id);
  async function generate() {
    setBusy(true);
    try {
      await command('generate', { projectId: project.id, requestKey: crypto.randomUUID() });
      notify('Four independent draft slots queued.');
    } catch {
      // The shared command handler already displayed the server error.
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="back-link" onClick={() => navigate('/projects')}>
        ← All projects
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{project.industry}</div>
          <h1>
            {project.name} <Badge status={project.status} />
          </h1>
          <p>{project.description}</p>
        </div>
        <div className="button-group">
          <Button variant="secondary" onClick={onEdit}>
            <SlidersHorizontal size={16} />
            Edit project
          </Button>
          <Button
            busy={busy}
            onClick={() => void generate()}
            disabled={project.status === 'archived'}
          >
            <Sparkles size={16} />
            Generate now
          </Button>
        </div>
      </div>
      <div className="tabs details-tabs">
        {['Overview', 'Brief', 'Branding', 'Run history'].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? 'active' : ''}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Overview' && (
        <>
          <div className="detail-summary">
            <div className="surface">
              <div className="section-heading">
                <h3>Project rhythm</h3>
                <Clock3 size={18} />
              </div>
              <p>
                4 story drafts · daily at {formatClock(project.generateAt || '08:00')} {zoneLabel()}
              </p>
              <div className="button-group">
                <Button
                  variant="secondary"
                  onClick={onManual}
                  disabled={project.status === 'archived'}
                >
                  <Plus size={15} />
                  Create story manually
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void command('projectStatus', {
                      projectId: project.id,
                      status: project.status === 'active' ? 'paused' : 'active',
                    }).catch(() => {})
                  }
                >
                  {project.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                  {project.status === 'active' ? 'Pause daily drafts' : 'Reactivate project'}
                </Button>
              </div>
            </div>
            <div className="surface">
              <div className="section-heading">
                <h3>Research status</h3>
                <Badge status="unavailable" />
              </div>
              <p>
                {research?.data.message ||
                  'Instagram and news are not connected. Generation uses the approved project brief and evergreen ideas.'}
              </p>
              <small className="muted">
                {research
                  ? `Last demo attempt: ${formatTime(research.fetchedAt)}`
                  : 'No research attempts yet'}
              </small>
            </div>
          </div>
          <div className="section-heading">
            <h2>
              Recent stories <span className="count-pill">{stories.length}</span>
            </h2>
            <button className="text-button" onClick={() => navigate('/history')}>
              View all history
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="stories-grid">
            {stories.slice(0, 4).map((s) => (
              <StoryCard
                key={s.id}
                story={s}
                command={command}
                navigate={navigate}
                notify={notify}
              />
            ))}
          </div>
          {!stories.length && (
            <Empty
              title="Your first drafts are waiting to happen."
              description="Generate four stories, or supply your own script."
              action={<Button onClick={() => void generate()}>Generate now</Button>}
            />
          )}
        </>
      )}
      {tab === 'Brief' && (
        <div className="surface brief-grid">
          {[
            ['Business description', project.description],
            ['Services & products', project.services],
            ['Target audience', project.audience],
            ['Approved facts & offers', project.facts],
            [
              'Questions & response prompts',
              project.allowEngagement
                ? 'Allowed: multiple-answer polls, questions, and DM/reply prompts.'
                : 'Disabled: informational stories only.',
            ],
            ['Content rules', project.rules],
            ['Prohibited topics', project.prohibited],
            ['Instagram profile', project.instagram],
            [
              'Contact details',
              [project.website, project.email, project.phone, project.address, project.location]
                .filter(Boolean)
                .join('\n'),
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <h3>{label}</h3>
              <p className="preserve-lines">{value || 'Not added'}</p>
            </div>
          ))}
        </div>
      )}
      {tab === 'Branding' && (
        <div className="branding-grid">
          <div className="surface">
            <h3>Original logo</h3>
            <div className="brand-logo-preview">
              {project.logoId ? (
                <img alt="Original logo" src={`/api/assets/${project.logoId}`} />
              ) : (
                <p>No logo uploaded</p>
              )}
            </div>
            <p className="muted">
              Saved versions retain their original logo when this project’s branding changes.
            </p>
          </div>
          <div className="surface">
            <h3>Brand palette</h3>
            <div className="big-palette">
              {project.colors.map((c) => (
                <div key={c}>
                  <i style={{ background: c }} />
                  <code>{c}</code>
                </div>
              ))}
            </div>
            <h3>Typography</h3>
            <p
              style={{
                fontFamily: project.font === 'Brand' ? undefined : project.font,
                fontSize: 26,
              }}
            >
              {project.font} · Considered stories, every day.
            </p>
            <h3>Visual direction</h3>
            <p>{project.visualDirection || 'No direction added'}</p>
          </div>
        </div>
      )}
      {tab === 'Run history' && (
        <div className="surface">
          <RunList
            runs={state.runs.filter((r) => r.projectId === project.id)}
            state={state}
            command={command}
          />
        </div>
      )}
      <div className="project-danger">
        <p>
          Archived projects move to their own tab. Story history keeps today and the previous two
          days.
        </p>
        <Button
          variant="ghost"
          disabled={project.status === 'archived'}
          onClick={() => {
            if (
              window.confirm(
                `Archive ${project.name}? It will move to the Archived tab and keep the same three-date history window.`,
              )
            )
              void command('projectStatus', { projectId: project.id, status: 'archived' })
                .then(() => notify('Project moved to the Archived tab.'))
                .catch(() => {});
          }}
        >
          <Archive size={14} />
          Archive project
        </Button>
        <Button variant="danger" onClick={onDelete}>
          <Trash2 size={14} />
          Delete project
        </Button>
      </div>
    </>
  );
}
function RunList({ runs, state, command }: { runs: Run[]; state: AppState; command: Command }) {
  return runs.length ? (
    <div className="run-list">
      {runs.map((r) => (
        <div className="run-row" key={r.id}>
          <span className="run-icon">
            <Zap size={17} />
          </span>
          <div>
            <strong>{state.projects.find((p) => p.id === r.projectId)?.name}</strong>
            <small>
              {formatTime(r.createdAt)} · {r.kind === 'scheduled' ? 'Daily run' : 'Manual run'} ·{' '}
              {r.businessDate}
            </small>
          </div>
          <div className="spacer" />
          <span>{r.total ? `${r.completed}/${r.total} slots` : 'Manual story'}</span>
          <Badge status={r.status} />
          {r.failed > 0 && (
            <Button
              variant="secondary"
              onClick={() => void command('retry', { runId: r.id }).catch(() => {})}
            >
              Retry failed
            </Button>
          )}
        </div>
      ))}
    </div>
  ) : (
    <p className="muted">No runs recorded yet.</p>
  );
}
function ManualForm({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  onSave: (script: Record<string, unknown>) => Promise<void>;
}) {
  const [kind, setKind] = useState('standard');
  const [answers, setAnswers] = useState('');
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [visual, setVisual] = useState(project.visualDirection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title="Create a story manually"
      description={`${project.name} · Your supplied copy is used exactly as written.`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const choices = answers
              .split('\n')
              .map((v) => v.trim())
              .filter(Boolean);
            if (kind === 'poll' && (choices.length < 2 || choices.length > 4))
              throw new Error('Add two to four answer choices, one per line.');
            await onSave({
              topic: headline,
              headline,
              body:
                kind === 'poll'
                  ? [body, choices.map((v, i) => `${String.fromCharCode(65 + i)}. ${v}`).join('\n')]
                      .filter(Boolean)
                      .join('\n\n')
                  : body,
              visual,
              sources: [],
              ...(kind !== 'standard' ? { kind } : {}),
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <Field
            label="Story type"
            hint={
              project.allowEngagement
                ? 'Questions, polls, and response prompts are allowed.'
                : 'Questions and response prompts are disabled in this project’s settings.'
            }
          >
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="standard">Informational story</option>
              {project.allowEngagement && (
                <>
                  <option value="poll">Question with multiple answers</option>
                  <option value="question">Question / Do you like…?</option>
                  <option value="dm">DM / reply prompt</option>
                </>
              )}
            </select>
          </Field>
          <Field label={kind === 'poll' || kind === 'question' ? 'Question *' : 'Headline *'}>
            <input
              required
              maxLength={180}
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
          </Field>
          <Field label="Body copy">
            <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {kind === 'poll' && (
            <Field
              label="Answer choices"
              hint="Two to four choices, one per line. Choices are included as text in the downloaded image."
            >
              <textarea
                required
                rows={4}
                value={answers}
                onChange={(e) => setAnswers(e.target.value)}
                placeholder={'Yes, absolutely\nTell me more'}
              />
            </Field>
          )}
          <Field label="Visual instructions">
            <textarea rows={3} value={visual} onChange={(e) => setVisual(e.target.value)} />
          </Field>
          <p className="soft-note">
            Sample artwork will use the project’s palette. Your instructions are stored for the
            later live image provider.
          </p>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            <Plus size={15} />
            Create draft
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
function DeleteProjectForm({
  project,
  onClose,
  onDelete,
}: {
  project: Project;
  onClose: () => void;
  onDelete: (confirmation: string) => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title={`Delete ${project.name}?`}
      description="This permanently deletes the project, all its stories and versions, approvals, feedback, generation records, and images that no other project uses."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await onDelete(confirmation);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <p className="deletion-warning">This cannot be undone.</p>
          <Field label={`Type ${project.name} to confirm`}>
            <input
              autoComplete="off"
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              disabled={busy}
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            busy={busy}
            disabled={confirmation !== project.name}
          >
            <Trash2 size={15} />
            Delete permanently
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
function SettingsPage({
  state,
  command,
  notify,
}: {
  state: AppState;
  command: Command;
  notify: (text: string) => void;
}) {
  const [tab, setTab] = useState('Account');
  const [notes, setNotes] = useState(false);
  const [provider, setProvider] = useState(state.settings.providerMode);
  const [enabled, setEnabled] = useState(state.settings.automationEnabled);
  const [zone, setZone] = useState(state.settings.timeZone);
  const [format, setFormat] = useState(state.settings.exportFormat);
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf('timeZone');
    return all.includes(zone) ? all : [zone, ...all];
  }, [zone]);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await command('settings', {
        settings: {
          providerMode: provider,
          automationEnabled: enabled,
          timeZone: zone,
          exportFormat: format,
        },
      });
      notify('Workspace settings saved.');
    } catch {
      // The shared command handler already displayed the server error.
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE THE WORKSPACE YOURS</div>
          <h1>Settings.</h1>
          <p>Your admin account, provider connections, and daily creative rhythm.</p>
        </div>
      </div>
      <div className="tabs details-tabs">
        {[
          { name: 'Account', icon: ShieldCheck },
          { name: 'Integrations', icon: Plug },
          { name: 'Automation', icon: Zap },
        ].map((t) => (
          <button
            key={t.name}
            onClick={() => setTab(t.name)}
            className={tab === t.name ? 'active' : ''}
          >
            <t.icon size={16} />
            {t.name}
          </button>
        ))}
      </div>
      {tab === 'Account' && (
        <div className="surface account-surface">
          <div className="section-heading">
            <h2>Your creative workspace</h2>
            <Badge status="active" />
          </div>
          <Brand />
          <div className="account-details">
            <div>
              <span>Username</span>
              <strong>{state.user.username}</strong>
            </div>
            <div>
              <span>Access</span>
              <strong>Administrator</strong>
            </div>
            <div>
              <span>Workspace</span>
              <strong>Inspirovate Creatives Storyloom</strong>
            </div>
          </div>
          <p className="muted">
            One admin account with access to every project and workspace setting.
          </p>
          <a
            className="text-button brand-website"
            href="https://inspirovatecreatives.com/"
            target="_blank"
            rel="noreferrer"
          >
            Visit Inspirovate Creatives <ArrowUpRight size={14} />
          </a>
        </div>
      )}
      {tab === 'Integrations' && (
        <>
          <div className="surface integration-mode">
            <span className="integration-icon">
              <Sparkles size={23} />
            </span>
            <div>
              <h3>Generation provider</h3>
              <p>
                Live AI uses Claude for story copy and OpenAI for artwork, and is billed to your API
                accounts. Demo creates free sample content for trying the app.
              </p>
              {provider === 'live' && state.settings.missingKeys.length > 0 && (
                <p className="form-error" role="alert">
                  Missing on the server: {state.settings.missingKeys.join(', ')}. Live generation
                  will fail until these are set.
                </p>
              )}
            </div>
            <select
              aria-label="Generation provider mode"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="demo">Demo (free sample content)</option>
              <option value="live">Live AI (Claude + OpenAI)</option>
            </select>
          </div>
          <div className="integration-grid">
            {[
              ['Claude', 'Story copy and feedback rewrites', 'ANTHROPIC_API_KEY'],
              ['OpenAI', 'Background artwork', 'OPENAI_API_KEY'],
              ['Instagram', 'Reading account posts and publishing', ''],
            ].map(([name, description, key]) => (
              <div className="surface integration-card" key={name}>
                <div className="section-heading">
                  <h3>{name}</h3>
                  <Badge
                    status={
                      key && !state.settings.missingKeys.includes(key)
                        ? 'connected'
                        : 'disconnected'
                    }
                  />
                </div>
                <p>{description}</p>
                <Button variant="ghost" onClick={() => setNotes(true)}>
                  Connection notes
                  <ArrowUpRight size={14} />
                </Button>
              </div>
            ))}
          </div>
          <Button busy={busy} onClick={() => void save()}>
            Save integration settings
          </Button>
        </>
      )}
      {tab === 'Automation' && (
        <>
          <div className="surface">
            <div className="section-heading">
              <h2>Your daily rhythm</h2>
              <Badge status={state.worker.online ? 'active' : 'offline'} />
            </div>
            <div className="automation-details">
              <div>
                <span>Schedule</span>
                <strong>Every day, per project</strong>
                <small>
                  {[
                    ...new Set(
                      state.projects.filter((p) => p.status === 'active').map((p) => p.generateAt),
                    ),
                  ]
                    .sort()
                    .join(', ') || '08:00'}{' '}
                  · set each time in the project
                </small>
              </div>
              <div>
                <span>Next scheduled time</span>
                <strong>{enabled ? formatTime(state.worker.nextRun) : 'Automation paused'}</strong>
                <small>
                  {state.worker.online
                    ? 'Requires this worker to remain running'
                    : 'Worker is offline; start the local worker'}
                </small>
              </div>
              <div>
                <span>Daily capacity</span>
                <strong>{state.counts.projects * 4} story slots</strong>
                <small>{state.counts.projects} active projects × 4 independent drafts</small>
              </div>
            </div>
            <Field
              label="Workspace time zone"
              hint="Daily generation times and the three-day history follow this time zone."
            >
              <select value={zone} onChange={(e) => setZone(e.target.value)}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Download format"
              hint="JPEG looks the same once Instagram recompresses it and is about five times smaller. PNG is lossless for designers."
            >
              <select value={format} onChange={(e) => setFormat(e.target.value as 'jpeg' | 'png')}>
                <option value="jpeg">JPEG, high quality (recommended)</option>
                <option value="png">PNG, lossless</option>
              </select>
            </Field>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>
                <strong>Enable daily scheduling</strong>
                <small>
                  Paused and archived projects are skipped. If the worker restarts after a project’s
                  time, today’s missing run is caught up.
                </small>
              </span>
            </label>
            <div className="button-group">
              <Button busy={busy} onClick={() => void save()}>
                Save automation settings
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void command('dailyBatch')
                    .then(() =>
                      notify(
                        'Today’s daily slots are queued. Existing scheduled runs were retained.',
                      ),
                    )
                    .catch(() => {})
                }
              >
                <Play size={15} />
                Run daily batch now
              </Button>
            </div>
            <div className="soft-note">
              History keeps today plus the previous two dates. Older stories, versions, and unused
              images are deleted once all active projects have four completed daily drafts.
              {state.retention.awaitingDailyBatch
                ? ' Cleanup is waiting for today’s daily batch.'
                : ` Last cleanup: ${state.retention.lastCleanup || 'not run yet'}.`}
            </div>
            <div className="soft-note">
              The worker runs on the server and continues when browser tabs close. It needs an
              always-on Node host with a persistent disk.
            </div>
          </div>
          <div className="surface">
            <h2>Generation runs</h2>
            <RunList state={state} runs={state.runs.slice(0, 20)} command={command} />
          </div>
        </>
      )}
      {notes && (
        <Modal
          title="Connecting the AI providers"
          description="API keys live only on the server, never in the browser."
          onClose={() => setNotes(false)}
        >
          <div className="modal-body guide">
            <p>
              <strong>Claude:</strong> set <code>ANTHROPIC_API_KEY</code> in the server environment.
              Optional: <code>ANTHROPIC_MODEL</code> to choose another model.
            </p>
            <p>
              <strong>OpenAI:</strong> set <code>OPENAI_API_KEY</code>. Optional:{' '}
              <code>OPENAI_IMAGE_MODEL</code> and <code>OPENAI_IMAGE_QUALITY</code> (low, medium,
              high).
            </p>
            <p>
              <strong>Instagram:</strong> not connected. Approved stories are downloaded and posted
              by hand.
            </p>
            <p className="soft-note">
              Restart the app after changing keys, then choose Live AI above and save.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
