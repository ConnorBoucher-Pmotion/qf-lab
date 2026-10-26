/**
 * Local IndexedDB storage for TL Junction trial records + assessment index.
 * Videos live in the existing recordings store keyed by trialId / videoId.
 */

import { clearRecordings, deleteRecording, getRecording, putRecording, type StoredRecording } from "../recording/recordingStore";
import type { TlAssessmentSummary, TlTrialRecord } from "./trialTypes";

const DB_NAME = "tl-oblique-trials";
const DB_VERSION = 1;
const TRIALS = "trials";
const ASSESSMENTS = "assessments";

const trialMem = new Map<string, TlTrialRecord>();
const assessMem = new Map<string, TlAssessmentSummary>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRIALS)) db.createObjectStore(TRIALS, { keyPath: "trialId" });
      if (!db.objectStoreNames.contains(ASSESSMENTS)) db.createObjectStore(ASSESSMENTS, { keyPath: "assessmentId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
  });
}

export async function saveTrial(trial: TlTrialRecord): Promise<void> {
  trialMem.set(trial.trialId, trial);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([TRIALS, ASSESSMENTS], "readwrite");
      tx.objectStore(TRIALS).put(trial);
      const assessStore = tx.objectStore(ASSESSMENTS);
      const getReq = assessStore.get(trial.assessmentId);
      getReq.onsuccess = () => {
        const existing = (getReq.result as TlAssessmentSummary | undefined) ?? {
          assessmentId: trial.assessmentId,
          createdAt: trial.timestamp,
          trialIds: [],
          leftRawMax: null,
          rightRawMax: null,
        };
        if (!existing.trialIds.includes(trial.trialId)) existing.trialIds.push(trial.trialId);
        if (trial.direction === "left" && trial.rawMaxRom != null) {
          existing.leftRawMax =
            existing.leftRawMax == null ? trial.rawMaxRom : Math.max(existing.leftRawMax, trial.rawMaxRom);
        }
        if (trial.direction === "right" && trial.rawMaxRom != null) {
          existing.rightRawMax =
            existing.rightRawMax == null ? trial.rawMaxRom : Math.max(existing.rightRawMax, trial.rawMaxRom);
        }
        assessStore.put(existing);
        assessMem.set(existing.assessmentId, existing);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("saveTrial failed"));
    });
    db.close();
  } catch {
    // Memory still holds the trial for this session.
  }
}

export async function listTrials(): Promise<TlTrialRecord[]> {
  const map = new Map(trialMem);
  try {
    const db = await openDb();
    const rows = await new Promise<TlTrialRecord[]>((resolve, reject) => {
      const tx = db.transaction(TRIALS, "readonly");
      const req = tx.objectStore(TRIALS).getAll();
      req.onsuccess = () => resolve((req.result as TlTrialRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    for (const row of rows) map.set(row.trialId, row);
  } catch {
    // memory only
  }
  return [...map.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function getTrial(trialId: string): Promise<TlTrialRecord | null> {
  if (trialMem.has(trialId)) return trialMem.get(trialId)!;
  try {
    const db = await openDb();
    const row = await new Promise<TlTrialRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(TRIALS, "readonly");
      const req = tx.objectStore(TRIALS).get(trialId);
      req.onsuccess = () => resolve(req.result as TlTrialRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return row ?? null;
  } catch {
    return null;
  }
}

export async function deleteTrial(trialId: string): Promise<void> {
  const trial = await getTrial(trialId);
  trialMem.delete(trialId);
  if (trial?.videoId) await deleteRecording(trial.videoId);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([TRIALS, ASSESSMENTS], "readwrite");
      tx.objectStore(TRIALS).delete(trialId);
      if (trial) {
        const assessStore = tx.objectStore(ASSESSMENTS);
        const getReq = assessStore.get(trial.assessmentId);
        getReq.onsuccess = () => {
          const existing = getReq.result as TlAssessmentSummary | undefined;
          if (!existing) return;
          existing.trialIds = existing.trialIds.filter((id) => id !== trialId);
          if (existing.trialIds.length === 0) assessStore.delete(trial.assessmentId);
          else assessStore.put(existing);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // memory cleared
  }
}

export async function clearAllTlTrialData(): Promise<void> {
  trialMem.clear();
  assessMem.clear();
  await clearRecordings();
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([TRIALS, ASSESSMENTS], "readwrite");
      tx.objectStore(TRIALS).clear();
      tx.objectStore(ASSESSMENTS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // done
  }
}

export async function attachTrialVideo(trialId: string, recording: StoredRecording): Promise<void> {
  const trial = await getTrial(trialId);
  if (!trial) {
    await putRecording(trialId, recording);
    return;
  }
  const videoId = trial.videoId ?? trial.trialId;
  await putRecording(videoId, recording);
  if (trial.videoId !== videoId) {
    trial.videoId = videoId;
    await saveTrial(trial);
  }
}

export async function loadTrialVideo(trial: TlTrialRecord): Promise<StoredRecording | null> {
  const id = trial.videoId ?? trial.trialId;
  return getRecording(id);
}
