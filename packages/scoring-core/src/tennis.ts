import type {
  DisplayGamePoints,
  MatchMeta,
  TeamSide,
  TennisMatchSnapshot,
  TennisScoreEvent,
} from "./types.js";

function cloneSnapshot(snapshot: TennisMatchSnapshot): TennisMatchSnapshot {
  return {
    ...snapshot,
    sets: snapshot.sets.map((set) => ({ ...set })),
    game: { ...snapshot.game },
  };
}

function setsWon(snapshot: TennisMatchSnapshot, side: TeamSide): number {
  return snapshot.sets.filter((set) => {
    if (side === "A") {
      return set.gamesA > set.gamesB;
    }
    return set.gamesB > set.gamesA;
  }).length;
}

function hasWonSet(gamesA: number, gamesB: number): TeamSide | null {
  if (gamesA >= 6 && gamesA - gamesB >= 2) {
    return "A";
  }
  if (gamesB >= 6 && gamesB - gamesA >= 2) {
    return "B";
  }
  return null;
}

function hasWonGame(pointsA: number, pointsB: number): TeamSide | null {
  if (pointsA >= 4 && pointsA - pointsB >= 2) {
    return "A";
  }
  if (pointsB >= 4 && pointsB - pointsA >= 2) {
    return "B";
  }
  return null;
}

function swapServer(server: TeamSide): TeamSide {
  return server === "A" ? "B" : "A";
}

function requiredSets(bestOfSets: 3 | 5): number {
  return Math.floor(bestOfSets / 2) + 1;
}

export function createInitialSnapshot(
  meta: MatchMeta,
  server: TeamSide = "A",
  bestOfSets: 3 | 5 = 3,
): TennisMatchSnapshot {
  const now = new Date().toISOString();
  return {
    ...meta,
    status: "live",
    sets: [{ gamesA: 0, gamesB: 0 }],
    currentSetIndex: 0,
    game: { pointsA: 0, pointsB: 0 },
    server,
    bestOfSets,
    seq: 0,
    winner: null,
    updatedAt: now,
  };
}

export function applyScoreEvent(
  snapshot: TennisMatchSnapshot,
  event: TennisScoreEvent,
): TennisMatchSnapshot {
  const next = cloneSnapshot(snapshot);
  if (next.status === "complete") {
    return next;
  }

  if (event.type === "point_won") {
    if (event.winner === "A") {
      next.game.pointsA += 1;
    } else {
      next.game.pointsB += 1;
    }

    const gameWinner = hasWonGame(next.game.pointsA, next.game.pointsB);
    if (gameWinner !== null) {
      const currentSet = next.sets[next.currentSetIndex];
      if (gameWinner === "A") {
        currentSet.gamesA += 1;
      } else {
        currentSet.gamesB += 1;
      }

      next.game.pointsA = 0;
      next.game.pointsB = 0;
      next.server = swapServer(next.server);

      const setWinner = hasWonSet(currentSet.gamesA, currentSet.gamesB);
      if (setWinner !== null) {
        const target = requiredSets(next.bestOfSets);
        const winnerSets = setsWon(next, setWinner);
        if (winnerSets >= target) {
          next.status = "complete";
          next.winner = setWinner;
        } else {
          next.currentSetIndex += 1;
          next.sets.push({ gamesA: 0, gamesB: 0 });
        }
      }
    }
  }

  next.seq += 1;
  next.updatedAt = new Date().toISOString();
  return next;
}

function mapBasicPoints(points: number): string {
  if (points <= 0) {
    return "0";
  }
  if (points === 1) {
    return "15";
  }
  if (points === 2) {
    return "30";
  }
  return "40";
}

export function toDisplayGamePoints(
  snapshot: TennisMatchSnapshot,
): DisplayGamePoints {
  const { pointsA, pointsB } = snapshot.game;

  if (pointsA >= 3 && pointsB >= 3) {
    if (pointsA === pointsB) {
      return { teamA: "40", teamB: "40" };
    }
    if (pointsA > pointsB) {
      return { teamA: "AD", teamB: "40" };
    }
    return { teamA: "40", teamB: "AD" };
  }

  return {
    teamA: mapBasicPoints(pointsA),
    teamB: mapBasicPoints(pointsB),
  };
}
