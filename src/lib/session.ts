import { db, type Session } from "./db";
import { getSettings } from "./settings";

type LatLon = { lat: number; lon: number };

type StartSessionInput = {
  areaKey?: string | null;
  startLatLon?: LatLon | null;
  note?: string | null;
};

type EndSessionInput = {
  endLatLon?: LatLon | null;
};

function toIso(value: Date) {
  return value.toISOString();
}

async function getLatestOpenSession(): Promise<Session | null> {
  const openSessions = await db.sessions.where("status").anyOf("active", "paused").toArray();
  if (openSessions.length === 0) {
    return null;
  }
  return openSessions.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  )[0];
}

function closeOpenPause(session: Session, endedAtIso: string) {
  if (!session.pauses || session.pauses.length === 0) {
    return session;
  }
  const pauses = session.pauses.map((pause, index) => {
    if (index === session.pauses.length - 1 && pause.endAt === null) {
      return { ...pause, endAt: endedAtIso };
    }
    return pause;
  });
  return { ...session, pauses };
}

export async function getActiveSession(): Promise<Session | null> {
  const session = await db.sessions.where("status").equals("active").last();
  return session ?? null;
}

export async function startSession({
  areaKey,
  startLatLon,
  note
}: StartSessionInput = {}): Promise<Session> {
  await ensureSingleActiveSession();
  const existing = await getLatestOpenSession();
  if (existing) {
    return existing;
  }
  const startedAt = toIso(new Date());
  const session: Session = {
    id: crypto.randomUUID(),
    startedAt,
    endedAt: null,
    status: "active",
    pauses: [],
    note: note ?? null,
    baseAreaKey: areaKey ?? null,
    startLat: startLatLon?.lat ?? null,
    startLon: startLatLon?.lon ?? null,
    endLat: null,
    endLon: null
  };
  await db.sessions.add(session);
  return session;
}

export async function pauseSession(): Promise<Session | null> {
  const active = await getActiveSession();
  if (!active) {
    return null;
  }
  if (active.status === "paused") {
    return active;
  }
  const nowIso = toIso(new Date());
  const next: Session = {
    ...active,
    status: "paused",
    pauses: [...(active.pauses ?? []), { startAt: nowIso, endAt: null }]
  };
  await db.sessions.put(next);
  return next;
}

export async function resumeSession(): Promise<Session | null> {
  const session = await getLatestOpenSession();
  if (!session) {
    return null;
  }
  if (session.status === "active") {
    return session;
  }
  const nowIso = toIso(new Date());
  const next = closeOpenPause(session, nowIso);
  const updated: Session = {
    ...next,
    status: "active"
  };
  await db.sessions.put(updated);
  return updated;
}

export async function endSession({ endLatLon }: EndSessionInput = {}): Promise<Session | null> {
  const session = await getLatestOpenSession();
  if (!session) {
    return null;
  }
  const endedAt = toIso(new Date());
  const next = closeOpenPause(session, endedAt);
  const updated: Session = {
    ...next,
    status: "ended",
    endedAt,
    endLat: endLatLon?.lat ?? next.endLat ?? null,
    endLon: endLatLon?.lon ?? next.endLon ?? null
  };
  await db.sessions.put(updated);
  return updated;
}

export function computeActiveMinutes(session: Session, now: Date = new Date()): number {
  const startMs = new Date(session.startedAt).getTime();
  const endMs = new Date(session.endedAt ?? now.toISOString()).getTime();
  let activeMs = Math.max(endMs - startMs, 0);
  for (const pause of session.pauses ?? []) {
    const pauseStart = new Date(pause.startAt).getTime();
    const pauseEnd = new Date(pause.endAt ?? now.toISOString()).getTime();
    if (pauseEnd > pauseStart) {
      activeMs -= pauseEnd - pauseStart;
    }
  }
  return Math.max(activeMs, 0) / 60_000;
}

export async function attachToActiveSession<T extends { sessionId?: string }>(
  entity: T
): Promise<T> {
  if (entity.sessionId) {
    return entity;
  }
  const settings = await getSettings();
  if (!settings.autoAttachToActiveSession) {
    return entity;
  }
  const active = await getActiveSession();
  if (!active) {
    return entity;
  }
  return {
    ...entity,
    sessionId: active.id
  };
}

export async function ensureSingleActiveSession(): Promise<void> {
  const activeSessions = await db.sessions.where("status").equals("active").toArray();
  if (activeSessions.length <= 1) {
    return;
  }
  const sorted = [...activeSessions].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  const [latest, ...others] = sorted;
  const endedAt = toIso(new Date());
  await Promise.all(
    others.map(async (session) => {
      const closed = closeOpenPause(session, endedAt);
      await db.sessions.put({
        ...closed,
        status: "ended",
        endedAt
      });
    })
  );
  if (!latest) {
    return;
  }
}
