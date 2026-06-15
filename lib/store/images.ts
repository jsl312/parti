"use client";

/**
 * IndexedDB-backed image store. Image bytes live here (not in localStorage,
 * which has a ~5MB cap). Project records only reference blobs by `blobKey`.
 */

const DB_NAME = "research-brief-app";
const DB_VERSION = 1;
const STORE = "concept_images";

type StoredImage = {
  blobKey: string;
  projectId: string;
  blob: Blob;
  createdAt: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("IndexedDB unavailable on server"));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "blobKey" });
        store.createIndex("projectId", "projectId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function newBlobKey(): string {
  return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function putImage(
  projectId: string,
  blob: Blob,
): Promise<string> {
  const db = await openDb();
  const blobKey = newBlobKey();
  const record: StoredImage = {
    blobKey,
    projectId,
    blob,
    createdAt: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve(blobKey);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getImage(blobKey: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(blobKey);
    req.onsuccess = () => {
      const rec = req.result as StoredImage | undefined;
      resolve(rec?.blob ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteImagesForProject(projectId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const idx = tx.objectStore(STORE).index("projectId");
    const cursorReq = idx.openCursor(IDBKeyRange.only(projectId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Re-point all images from oldProjectId to newProjectId (used when a
 * project's id is migrated to a readable slug). blobKey stays the same.
 */
export async function reindexProjectImages(
  oldProjectId: string,
  newProjectId: string,
): Promise<void> {
  if (oldProjectId === newProjectId) return;
  const db = await openDb();

  // 1) Collect blobKeys for the old project id.
  const keys: string[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("projectId");
    const out: string[] = [];
    const cur = idx.openCursor(IDBKeyRange.only(oldProjectId));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        out.push((c.value as StoredImage).blobKey);
        c.continue();
      }
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  if (keys.length === 0) return;

  // 2) Rewrite each record with the new projectId (same blobKey/keyPath).
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const k of keys) {
      const g = store.get(k);
      g.onsuccess = () => {
        const rec = g.result as StoredImage | undefined;
        if (rec) store.put({ ...rec, projectId: newProjectId });
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Helper: persist a data: URL (e.g. "data:image/png;base64,...") as a blob
 * in the image store and return the blob key.
 */
export async function putDataUrl(
  projectId: string,
  dataUrl: string,
): Promise<{ blobKey: string; mime: string }> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid data URL");
  const mime = match[1];
  const b64 = match[2];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const blobKey = await putImage(projectId, blob);
  return { blobKey, mime };
}

/** Returns an object URL for use as <img src>. Caller must revokeObjectURL. */
export async function getImageObjectUrl(
  blobKey: string,
): Promise<string | null> {
  const blob = await getImage(blobKey);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

// ─── Backup export / import ──────────────────────────────────────────────

/** Serialized image record for backup files (blob → base64). */
export type ExportedImage = {
  blobKey: string;
  projectId: string;
  mime: string;
  createdAt: string;
  dataBase64: string;
};

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function getAllRecords(): Promise<StoredImage[]> {
  return openDb().then(
    (db) =>
      new Promise<StoredImage[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as StoredImage[]) ?? []);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Export every blob belonging to the given projects as base64 records. */
export async function exportImagesForProjects(
  projectIds: string[],
): Promise<ExportedImage[]> {
  const want = new Set(projectIds);
  const records = (await getAllRecords()).filter((r) => want.has(r.projectId));
  const out: ExportedImage[] = [];
  for (const r of records) {
    out.push({
      blobKey: r.blobKey,
      projectId: r.projectId,
      mime: r.blob.type || "application/octet-stream",
      createdAt: r.createdAt,
      dataBase64: await blobToBase64(r.blob),
    });
  }
  return out;
}

/** Restore blob records from a backup, preserving their original blobKey. */
export async function importImages(images: ExportedImage[]): Promise<void> {
  if (!images || images.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const img of images) {
      const record: StoredImage = {
        blobKey: img.blobKey,
        projectId: img.projectId,
        blob: base64ToBlob(img.dataBase64, img.mime),
        createdAt: img.createdAt,
      };
      store.put(record);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
