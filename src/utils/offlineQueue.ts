import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuid } from 'uuid';

const QUEUE_KEY = 'offline_queue_v1';
const MAX_ATTEMPTS = 5;

export type OfflineActionType = 'report_result' | 'accept_result' | 'create_incident';

export interface OfflineAction<TPayload = unknown> {
  id: string;
  type: OfflineActionType;
  payload: TPayload;
  attempts: number;
  createdAt: string;
}

export async function loadQueue(): Promise<OfflineAction[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as OfflineAction[];
}

async function saveQueue(queue: OfflineAction[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueue<TPayload>(type: OfflineActionType, payload: TPayload) {
  const queue = await loadQueue();
  const action: OfflineAction<TPayload> = {
    id: uuid(),
    type,
    payload,
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  queue.push(action);
  await saveQueue(queue);
  return action.id;
}

export async function processQueue(executor: (action: OfflineAction) => Promise<void>) {
  const queue = await loadQueue();
  const remaining: OfflineAction[] = [];

  for (const action of queue) {
    try {
      await executor(action);
    } catch (error) {
      const nextAttempts = action.attempts + 1;
      if (nextAttempts < MAX_ATTEMPTS) {
        remaining.push({ ...action, attempts: nextAttempts });
      }
    }
  }

  await saveQueue(remaining);
}

export async function clearQueue() {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

