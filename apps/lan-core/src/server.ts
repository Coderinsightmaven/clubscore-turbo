import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { toDisplayGamePoints } from "@clubscore/scoring-core";
import { ClubscoreStore, SequenceConflictError } from "./db.js";
import { startMdnsAdvertisement } from "./mdns.js";

const port = Number(process.env.PORT ?? "7310");
const host = process.env.HOST ?? "0.0.0.0";
const sqlitePath = process.env.CLUBSCORE_DB_PATH ?? "./clubscore.db";
const setupWebDistPath = resolve(
  process.cwd(),
  process.env.SETUP_WEB_DIST ?? "../setup-web/dist",
);

const app = Fastify({ logger: true });
const store = new ClubscoreStore(sqlitePath);
const sockets = new Set<{
  readyState: number;
  send: (payload: string) => void;
}>();

await app.register(cors, { origin: true });
await app.register(websocket);

if (existsSync(setupWebDistPath)) {
  await app.register(fastifyStatic, {
    root: setupWebDistPath,
    prefix: "/setup/",
    wildcard: false,
  });

  app.get("/setup", async (_, reply) => {
    return reply.sendFile("index.html");
  });
}

function serializeMatch(match: ReturnType<ClubscoreStore["getMatchById"]>) {
  if (!match) {
    return null;
  }

  return {
    ...match,
    displayGamePoints: toDisplayGamePoints(match.snapshot),
  };
}

function pushMessage(message: Record<string, unknown>): void {
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === 1) {
      socket.send(payload);
    }
  }
}

function pushScoreboardRefresh(): void {
  const matches = store.getScoreboardView(null).map((match) => ({
    ...match,
    displayGamePoints: toDisplayGamePoints(match.snapshot),
  }));

  pushMessage({ type: "scoreboard_refresh", payload: matches });
}

app.get("/health", async () => {
  return {
    status: "ok",
    service: "clubscore-lan-core",
    time: new Date().toISOString(),
  };
});

app.get("/api/discovery", async (request) => {
  const hostname = request.hostname;
  return {
    name: "clubscore-lan",
    host: hostname,
    port,
    wsPath: "/ws",
    apiBase: "/api",
    mdnsService: "_clubscore._tcp.local",
  };
});

app.get("/api/courts", async () => {
  return { courts: store.listCourts() };
});

app.post("/api/courts", async (request, reply) => {
  const schema = z.object({
    name: z.string().trim().min(1).max(40),
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.format() });
  }

  try {
    const court = store.createCourt(parsed.data.name);
    pushScoreboardRefresh();
    return reply.status(201).send({ court });
  } catch (error) {
    request.log.error(error);
    return reply.status(409).send({ error: "Court already exists" });
  }
});

app.post("/api/matches/start", async (request, reply) => {
  const schema = z.object({
    courtId: z.coerce.number().int().positive(),
    teamAName: z.string().trim().min(1).max(40),
    teamBName: z.string().trim().min(1).max(40),
  });

  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.format() });
  }

  try {
    const match = store.startMatch(parsed.data);
    pushScoreboardRefresh();
    return reply.status(201).send({ match: serializeMatch(match) });
  } catch (error) {
    request.log.error(error);
    return reply.status(400).send({ error: (error as Error).message });
  }
});

app.get("/api/matches/active", async () => {
  const matches = store.getActiveMatches().map((match) => ({
    ...match,
    displayGamePoints: toDisplayGamePoints(match.snapshot),
  }));
  return { matches };
});

app.get("/api/matches/:matchId", async (request, reply) => {
  const params = z.object({
    matchId: z.coerce.number().int().positive(),
  });

  const parsed = params.safeParse(request.params);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.format() });
  }

  const match = store.getMatchById(parsed.data.matchId);
  if (!match) {
    return reply.status(404).send({ error: "Match not found" });
  }

  return { match: serializeMatch(match) };
});

app.post("/api/matches/:matchId/events", async (request, reply) => {
  const params = z.object({
    matchId: z.coerce.number().int().positive(),
  });

  const body = z.object({
    type: z.literal("point_won"),
    winner: z.union([z.literal("A"), z.literal("B")]),
    sourceDevice: z.string().trim().min(1).max(80).default("android-scorer"),
    expectedSeq: z.coerce.number().int().positive().optional(),
  });

  const parsedParams = params.safeParse(request.params);
  const parsedBody = body.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    return reply.status(400).send({
      params: parsedParams.success ? undefined : parsedParams.error.format(),
      body: parsedBody.success ? undefined : parsedBody.error.format(),
    });
  }

  try {
    const updated = store.applyPointEvent({
      matchId: parsedParams.data.matchId,
      winner: parsedBody.data.winner,
      sourceDevice: parsedBody.data.sourceDevice,
      expectedSeq: parsedBody.data.expectedSeq,
    });

    pushMessage({ type: "match_updated", payload: serializeMatch(updated) });
    pushScoreboardRefresh();

    return reply.status(201).send({ match: serializeMatch(updated) });
  } catch (error) {
    if (error instanceof SequenceConflictError) {
      return reply.status(409).send({
        error: "Sequence mismatch",
        expectedSeq: error.expectedSeq,
        actualSeq: error.actualSeq,
      });
    }

    request.log.error(error);
    return reply.status(400).send({ error: (error as Error).message });
  }
});

app.post("/api/matches/:matchId/undo", async (request, reply) => {
  const params = z.object({
    matchId: z.coerce.number().int().positive(),
  });

  const parsedParams = params.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.status(400).send({
      params: parsedParams.success ? undefined : parsedParams.error.format(),
    });
  }

  try {
    const updated = store.undoLastEvent(parsedParams.data.matchId);
    pushMessage({ type: "match_updated", payload: serializeMatch(updated) });
    pushScoreboardRefresh();
    return reply.status(200).send({ match: serializeMatch(updated) });
  } catch (error) {
    request.log.error(error);
    return reply.status(400).send({ error: (error as Error).message });
  }
});

app.get("/api/scoreboard", async (request, reply) => {
  const querySchema = z.object({
    courtIds: z.string().optional(),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.format() });
  }

  const ids = parsed.data.courtIds
    ? parsed.data.courtIds
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0)
    : null;

  const matches = store.getScoreboardView(ids).map((match) => ({
    ...match,
    displayGamePoints: toDisplayGamePoints(match.snapshot),
  }));

  return {
    viewport: {
      width: 384,
      height: 256,
      border: 0,
      yOffsetOnly: true,
    },
    matches,
  };
});

app.get("/ws", { websocket: true }, (socket) => {
  sockets.add(socket);
  socket.send(
    JSON.stringify({
      type: "scoreboard_refresh",
      payload: store.getScoreboardView(null).map((match) => ({
        ...match,
        displayGamePoints: toDisplayGamePoints(match.snapshot),
      })),
    }),
  );

  socket.on("close", () => {
    sockets.delete(socket);
  });
});

const mdns = startMdnsAdvertisement(port);

const close = async () => {
  mdns.stop();
  await app.close();
  store.close();
};

process.on("SIGINT", () => {
  void close().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void close().finally(() => process.exit(0));
});

try {
  await app.listen({ host, port });
  app.log.info(`LAN core running on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  await close();
  process.exit(1);
}
