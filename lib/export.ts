import { getStory } from './services';
import type { Version } from './types';
export function filename(version: Version) {
  const project = version.data.project.name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  const story = getStory(version.storyId);
  return `${project}_${story.businessDate}_story-${story.slot || 1}-${story.id.slice(0, 8)}_v${version.revision}.png`;
}
