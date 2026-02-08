import { expect, test } from "bun:test";
import {
  applyScoreEvent,
  createInitialSnapshot,
  toDisplayGamePoints,
} from "./tennis.js";

test("wins a game after four straight points", () => {
  let snapshot = createInitialSnapshot({
    matchId: 1,
    courtId: 1,
    teamAName: "Alpha",
    teamBName: "Beta",
  });

  snapshot = applyScoreEvent(snapshot, { type: "point_won", winner: "A" });
  snapshot = applyScoreEvent(snapshot, { type: "point_won", winner: "A" });
  snapshot = applyScoreEvent(snapshot, { type: "point_won", winner: "A" });
  snapshot = applyScoreEvent(snapshot, { type: "point_won", winner: "A" });

  expect(snapshot.sets[0]?.gamesA).toBe(1);
  expect(snapshot.sets[0]?.gamesB).toBe(0);
  expect(snapshot.game.pointsA).toBe(0);
  expect(snapshot.game.pointsB).toBe(0);
});

test("deuce and advantage display", () => {
  let snapshot = createInitialSnapshot({
    matchId: 2,
    courtId: 1,
    teamAName: "Alpha",
    teamBName: "Beta",
  });

  for (let i = 0; i < 3; i += 1) {
    snapshot = applyScoreEvent(snapshot, { type: "point_won", winner: "A" });
    snapshot = applyScoreEvent(snapshot, { type: "point_won", winner: "B" });
  }

  expect(toDisplayGamePoints(snapshot)).toEqual({ teamA: "40", teamB: "40" });

  snapshot = applyScoreEvent(snapshot, { type: "point_won", winner: "A" });
  expect(toDisplayGamePoints(snapshot)).toEqual({ teamA: "AD", teamB: "40" });
});
