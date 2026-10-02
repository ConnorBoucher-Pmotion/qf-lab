export type StoredRecording = {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  bytes: number;
};

const DB_NAME = "qf-lab";
const STORE = "recordings";

const memory = new Map<string, StoredRecording>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
  });
}

export async function putRecording(id: string, recording: StoredRecording): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(recording, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not store the video"));
    });
    db.close();
    memory.delete(id);
  } catch {
    memory.set(id, recording);
  }
}

export async function getRecording(id: string): Promise<StoredRecording | null> {
  const cached = memory.get(id);
  if (cached) return cached;
  try {
    const db = await openDb();
    const value = await new Promise<StoredRecording | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result as StoredRecording | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value ?? null;
  } catch {
    return null;
  }
}

export async function listRecordingIds(): Promise<string[]> {
  const ids = new Set(memory.keys());
  try {
    const db = await openDb();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    for (const key of keys) ids.add(String(key));
  } catch {
    // Session memory still lists anything that could not be written to disk.
  }
  return [...ids];
}

export async function deleteRecording(id: string): Promise<void> {
  memory.delete(id);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Already removed from memory.
  }
}

export async function clearRecordings(): Promise<void> {
  memory.clear();
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Memory is already empty.
  }
}

export function recordingFilename(trial: { side: string; trialNumber: number; timestamp: string }, mimeType: string): string {
  const date = new Date(trial.timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  const side = trial.side === "left" ? "Left" : "Right";
  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  return `QF_${side}_Trial_${pad(trial.trialNumber)}_${stamp}.${ext}`;
}

export function videoAction(id: string, videoIds: ReadonlySet<string>, savingId: string | null): { label: string; enabled: boolean } {
  if (videoIds.has(id)) return { label: "Review", enabled: true };
  if (savingId === id) return { label: "Saving…", enabled: false };
  return { label: "—", enabled: false };
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
