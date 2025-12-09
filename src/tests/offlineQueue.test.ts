import { enqueue, loadQueue, clearQueue } from '@app/utils/offlineQueue';

describe('offlineQueue', () => {
  beforeEach(async () => {
    await clearQueue();
  });

  it('debe encolar acciones', async () => {
    const id = await enqueue('report_result', { matchId: '1' });
    const queue = await loadQueue();
    expect(queue.find((a) => a.id === id)).toBeTruthy();
  });
});

