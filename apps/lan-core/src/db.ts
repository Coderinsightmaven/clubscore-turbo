import Database from "better-sqlite3";
import {
  applyScoreEvent,
  createInitialSnapshot,
  type MatchMeta,
  type TeamSide,
  type TennisMatchSnapshot,
  type TennisScoreEvent,
} from "@clubscore/scoring-core";

export interface Court {
  id: number;
  name: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface MatchSummary {
  id: number;
  courtId: number;
  courtName: string;
  teamAName: string;
  teamBName: string;
  status: "live" | "complete";
  startedAt: string;
  snapshot: TennisMatchSnapshot;
}

class SequenceConflictError extends Error {
  constructor(
    public readonly expectedSeq: number,
    public readonly actualSeq: number,
  ) {
    super("Sequence mismatch");
  }
}

export class ClubscoreStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS courts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        court_id INTEGER NOT NULL,
        team_a_name TEXT NOT NULL,
        team_b_name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (court_id) REFERENCES courts(id)
      );

      CREATE TABLE IF NOT EXISTS score_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        source_device TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (match_id) REFERENCES matches(id)
      );

      CREATE TABLE IF NOT EXISTS match_snapshots (
        match_id INTEGER PRIMARY KEY,
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (match_id) REFERENCES matches(id)
      );

      CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
      CREATE INDEX IF NOT EXISTS idx_matches_court ON matches(court_id);
      CREATE INDEX IF NOT EXISTS idx_score_events_match ON score_events(match_id, seq);
    `);
  }

  listCourts(): Court[] {
    const stmt = this.db.prepare<
      [],
      {
        id: number;
        name: string;
        display_order: number;
        is_active: number;
        created_at: string;
      }
    >(
      `SELECT id, name, display_order, is_active, created_at FROM courts ORDER BY display_order ASC, id ASC`,
    );

    return stmt.all().map((row) => ({
      id: row.id,
      name: row.name,
      displayOrder: row.display_order,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
    }));
  }

  createCourt(name: string): Court {
    const now = new Date().toISOString();
    const maxOrderRow = this.db
      .prepare<
        [],
        { max_order: number | null }
      >("SELECT MAX(display_order) AS max_order FROM courts")
      .get();
    const nextOrder = (maxOrderRow?.max_order ?? -1) + 1;

    const insert = this.db.prepare<[string, number, string]>(
      "INSERT INTO courts (name, display_order, created_at) VALUES (?, ?, ?)",
    );
    const result = insert.run(name.trim(), nextOrder, now);

    return {
      id: Number(result.lastInsertRowid),
      name: name.trim(),
      displayOrder: nextOrder,
      isActive: true,
      createdAt: now,
    };
  }

  startMatch(input: {
    courtId: number;
    teamAName: string;
    teamBName: string;
  }): MatchSummary {
    const court = this.db
      .prepare<
        [number],
        { id: number; name: string }
      >("SELECT id, name FROM courts WHERE id = ?")
      .get(input.courtId);

    if (!court) {
      throw new Error("Court not found");
    }

    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db
        .prepare<
          [string, number]
        >("UPDATE matches SET status = 'complete', completed_at = ? WHERE court_id = ? AND status = 'live'")
        .run(now, input.courtId);

      const insertMatch = this.db.prepare<[number, string, string, string]>(
        "INSERT INTO matches (court_id, team_a_name, team_b_name, status, started_at) VALUES (?, ?, ?, 'live', ?)",
      );

      const matchResult = insertMatch.run(
        input.courtId,
        input.teamAName.trim(),
        input.teamBName.trim(),
        now,
      );

      const matchId = Number(matchResult.lastInsertRowid);
      const meta: MatchMeta = {
        matchId,
        courtId: input.courtId,
        teamAName: input.teamAName.trim(),
        teamBName: input.teamBName.trim(),
      };

      const initialSnapshot = createInitialSnapshot(meta);
      this.db
        .prepare<
          [number, string, string]
        >("INSERT OR REPLACE INTO match_snapshots (match_id, snapshot_json, updated_at) VALUES (?, ?, ?)")
        .run(matchId, JSON.stringify(initialSnapshot), now);

      return {
        id: matchId,
        courtId: input.courtId,
        courtName: court.name,
        teamAName: input.teamAName.trim(),
        teamBName: input.teamBName.trim(),
        status: "live" as const,
        startedAt: now,
        snapshot: initialSnapshot,
      };
    });

    return transaction();
  }

  getActiveMatches(): MatchSummary[] {
    const rows = this.db
      .prepare<
        [],
        {
          id: number;
          court_id: number;
          court_name: string;
          team_a_name: string;
          team_b_name: string;
          status: "live" | "complete";
          started_at: string;
          snapshot_json: string;
        }
      >(
        `
          SELECT
            m.id,
            m.court_id,
            c.name AS court_name,
            m.team_a_name,
            m.team_b_name,
            m.status,
            m.started_at,
            ms.snapshot_json
          FROM matches m
          INNER JOIN courts c ON c.id = m.court_id
          INNER JOIN match_snapshots ms ON ms.match_id = m.id
          WHERE m.status = 'live'
          ORDER BY c.display_order ASC, c.id ASC
        `,
      )
      .all();

    return rows.map((row) => ({
      id: row.id,
      courtId: row.court_id,
      courtName: row.court_name,
      teamAName: row.team_a_name,
      teamBName: row.team_b_name,
      status: row.status,
      startedAt: row.started_at,
      snapshot: JSON.parse(row.snapshot_json) as TennisMatchSnapshot,
    }));
  }

  getMatchById(matchId: number): MatchSummary | null {
    const row = this.db
      .prepare<
        [number],
        {
          id: number;
          court_id: number;
          court_name: string;
          team_a_name: string;
          team_b_name: string;
          status: "live" | "complete";
          started_at: string;
          snapshot_json: string;
        }
      >(
        `
          SELECT
            m.id,
            m.court_id,
            c.name AS court_name,
            m.team_a_name,
            m.team_b_name,
            m.status,
            m.started_at,
            ms.snapshot_json
          FROM matches m
          INNER JOIN courts c ON c.id = m.court_id
          INNER JOIN match_snapshots ms ON ms.match_id = m.id
          WHERE m.id = ?
        `,
      )
      .get(matchId);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      courtId: row.court_id,
      courtName: row.court_name,
      teamAName: row.team_a_name,
      teamBName: row.team_b_name,
      status: row.status,
      startedAt: row.started_at,
      snapshot: JSON.parse(row.snapshot_json) as TennisMatchSnapshot,
    };
  }

  applyPointEvent(input: {
    matchId: number;
    winner: TeamSide;
    sourceDevice: string;
    expectedSeq?: number;
  }): MatchSummary {
    const transaction = this.db.transaction(() => {
      const summary = this.getMatchById(input.matchId);
      if (!summary) {
        throw new Error("Match not found");
      }

      if (summary.status !== "live") {
        throw new Error("Match is not live");
      }

      const nextSeq = summary.snapshot.seq + 1;
      if (input.expectedSeq !== undefined && input.expectedSeq !== nextSeq) {
        throw new SequenceConflictError(nextSeq, input.expectedSeq);
      }

      const event: TennisScoreEvent = {
        type: "point_won",
        winner: input.winner,
      };
      const nextSnapshot = applyScoreEvent(summary.snapshot, event);

      const now = new Date().toISOString();
      this.db
        .prepare<
          [number, number, string, string, string, string]
        >("INSERT INTO score_events (match_id, seq, event_type, payload, source_device, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(
          input.matchId,
          nextSnapshot.seq,
          event.type,
          JSON.stringify(event),
          input.sourceDevice,
          now,
        );

      this.db
        .prepare<[string, number]>("UPDATE matches SET status = ? WHERE id = ?")
        .run(nextSnapshot.status, input.matchId);

      this.db
        .prepare<
          [string, string, number]
        >("UPDATE match_snapshots SET snapshot_json = ?, updated_at = ? WHERE match_id = ?")
        .run(JSON.stringify(nextSnapshot), now, input.matchId);

      return this.getMatchById(input.matchId);
    });

    const updated = transaction();
    if (!updated) {
      throw new Error("Unable to load updated match");
    }
    return updated;
  }

  undoLastEvent(matchId: number): MatchSummary {
    const transaction = this.db.transaction(() => {
      const summary = this.getMatchById(matchId);
      if (!summary) {
        throw new Error("Match not found");
      }

      const lastEvent = this.db
        .prepare<
          [number],
          { id: number; seq: number }
        >("SELECT id, seq FROM score_events WHERE match_id = ? ORDER BY seq DESC LIMIT 1")
        .get(matchId);

      if (!lastEvent) {
        return summary;
      }

      this.db
        .prepare<[number]>("DELETE FROM score_events WHERE id = ?")
        .run(lastEvent.id);

      const meta: MatchMeta = {
        matchId: summary.id,
        courtId: summary.courtId,
        teamAName: summary.teamAName,
        teamBName: summary.teamBName,
      };

      let rebuilt = createInitialSnapshot(
        meta,
        "A",
        summary.snapshot.bestOfSets,
      );

      const events = this.db
        .prepare<
          [number],
          { payload: string }
        >("SELECT payload FROM score_events WHERE match_id = ? ORDER BY seq ASC")
        .all(matchId);

      for (const row of events) {
        const event = JSON.parse(row.payload) as TennisScoreEvent;
        rebuilt = applyScoreEvent(rebuilt, event);
      }

      const now = new Date().toISOString();
      this.db
        .prepare<[string, number]>("UPDATE matches SET status = ? WHERE id = ?")
        .run(rebuilt.status, matchId);

      this.db
        .prepare<
          [string, string, number]
        >("UPDATE match_snapshots SET snapshot_json = ?, updated_at = ? WHERE match_id = ?")
        .run(JSON.stringify(rebuilt), now, matchId);

      return this.getMatchById(matchId);
    });

    const updated = transaction();
    if (!updated) {
      throw new Error("Unable to load updated match");
    }
    return updated;
  }

  getScoreboardView(courtIds: number[] | null): MatchSummary[] {
    const matches = this.getActiveMatches();
    if (!courtIds || courtIds.length === 0) {
      return matches;
    }

    const allow = new Set(courtIds);
    return matches.filter((match) => allow.has(match.courtId));
  }

  close(): void {
    this.db.close();
  }
}

export { SequenceConflictError };
