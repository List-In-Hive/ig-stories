import { AppError } from './errors';
import type { Project, Script } from './types';

const responsePrompt =
  /[?？]|\b(?:d\.?m\.?\s+(?:us|me)|direct\s+message|message\s+(?:us|me)|send\s+(?:us|me)\s+(?:a\s+)?message|reply|respond|vote|poll|tell\s+us|let\s+us\s+know|do\s+you\s+like|share\s+your\s+(?:thoughts|opinion))\b/i;
export function hasEngagement(script: Pick<Script, 'headline' | 'body' | 'kind'>) {
  return (
    (!!script.kind && script.kind !== 'standard') ||
    responsePrompt.test([script.headline, script.body].join('\n')) ||
    /(?:^|\n)\s*[A-D][.)]\s+\S/.test(script.body)
  );
}
export function assertEngagementAllowed(
  project: Project,
  script: Pick<Script, 'headline' | 'body' | 'kind'>,
) {
  if (!project.allowEngagement && hasEngagement(script))
    throw new AppError(
      'Question, poll, and response stories are disabled for this project. Turn on “Allow questions & response prompts” in the project settings, or use informational copy.',
    );
  if (script.kind === 'poll') {
    const choices = [...script.body.matchAll(/(?:^|\n)\s*([A-Z])[.)]\s+[^\n]+/g)];
    if (
      choices.length < 2 ||
      choices.length > 4 ||
      choices.some((choice, index) => choice[1] !== String.fromCharCode(65 + index))
    )
      throw new AppError(
        'A poll must have two to four answer choices, labeled A. through D. in the body copy.',
      );
  }
}
