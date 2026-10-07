import { workerTick } from '../lib/services';
import { setSetting } from '../lib/db';
console.log('Local worker started. Each project generates at its own daily time.');
let stopping = false;
let idle = 0;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopping = true;
    setSetting('workerHeartbeat', '');
  });
while (!stopping) {
  let processed = 0;
  try {
    processed = await workerTick();
  } catch (error) {
    console.error('Worker:', (error as Error).message);
  }
  // Check every 2 seconds while there is work, easing to every 15 seconds when idle.
  idle = processed ? 0 : Math.min(idle + 1, 6);
  await new Promise((resolve) => setTimeout(resolve, idle < 6 ? 2000 : 15000));
}
