import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticated, failure, sameOrigin } from '@/lib/http';
import { admin, AppError } from '@/lib/errors';
import {
  saveProject,
  getProject,
  enqueueRun,
  dailyBatch,
  retryRun,
  createManual,
  saveStory,
  reviseStory,
  requestChanges,
  restoreVersion,
  approve,
  versions,
  feedbackFor,
} from '@/lib/services';
import { setSetting } from '@/lib/db';
import { deleteProject } from '@/lib/lifecycle';
import { isTimeZone } from '@/lib/schedule';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = authenticated(request);
    const body = await request.json();
    const action = z.string().parse(body.action);
    let result: unknown;
    switch (action) {
      case 'saveProject':
        result = saveProject(body.project, body.projectId);
        break;
      case 'deleteProject':
        admin(user);
        result = deleteProject(
          z.string().parse(body.projectId),
          z.string().parse(body.confirmation),
        );
        break;
      case 'projectStatus': {
        const project = getProject(z.string().parse(body.projectId));
        result = saveProject(
          { ...project, status: z.enum(['active', 'paused', 'archived']).parse(body.status) },
          project.id,
        );
        break;
      }
      case 'generate':
        result = {
          runId: enqueueRun(
            z.string().parse(body.projectId),
            'manual',
            new Date(),
            z.string().min(10).max(100).parse(body.requestKey),
          ),
        };
        break;
      case 'dailyBatch':
        admin(user);
        result = { runs: dailyBatch() };
        break;
      case 'retry':
        admin(user);
        retryRun(z.string().parse(body.runId));
        result = { ok: true };
        break;
      case 'manual':
        result = await createManual(
          z.string().parse(body.projectId),
          body.script,
          user.id,
          z.string().min(10).max(100).parse(body.requestKey),
        );
        break;
      case 'saveStory':
        result = saveStory(
          z.string().parse(body.storyId),
          z.string().parse(body.expected),
          body.layout,
          user.id,
        );
        break;
      case 'revise':
        result = await reviseStory(
          z.string().parse(body.storyId),
          z.string().parse(body.expected),
          z.enum(['image', 'idea']).parse(body.kind),
          user.id,
        );
        break;
      case 'feedback':
        result = await requestChanges(
          z.string().parse(body.storyId),
          z.string().parse(body.expected),
          z.enum(['text', 'visual', 'layout']).parse(body.target),
          z.string().parse(body.feedback),
          user.id,
        );
        break;
      case 'restore':
        result = restoreVersion(
          z.string().parse(body.storyId),
          z.string().parse(body.versionId),
          z.string().parse(body.expected),
          user.id,
        );
        break;
      case 'approve':
        result = approve(
          z.array(z.object({ storyId: z.string(), versionId: z.string() })).parse(body.items),
          user.id,
        );
        break;
      case 'versions':
        result = {
          versions: versions(z.string().parse(body.storyId)),
          feedback: feedbackFor(body.storyId),
        };
        break;
      case 'settings': {
        admin(user);
        const parsed = z
          .object({
            providerMode: z.enum(['demo', 'live']),
            automationEnabled: z.boolean(),
            timeZone: z.string().refine(isTimeZone, 'Choose a valid time zone.').optional(),
          })
          .parse(body.settings);
        setSetting('providerMode', parsed.providerMode);
        setSetting('automationEnabled', String(parsed.automationEnabled));
        if (parsed.timeZone) setSetting('timeZone', parsed.timeZone);
        result = { ok: true };
        break;
      }
      default:
        throw new AppError('Unknown action.');
    }
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}
