export type TeamSide = "A" | "B";

export type MatchStatus = "live" | "complete";

export interface SetScore {
  gamesA: number;
  gamesB: number;
}

export interface GameScore {
  pointsA: number;
  pointsB: number;
}

export interface MatchMeta {
  matchId: number;
  courtId: number;
  teamAName: string;
  teamBName: string;
}

export interface TennisMatchSnapshot extends MatchMeta {
  status: MatchStatus;
  sets: SetScore[];
  currentSetIndex: number;
  game: GameScore;
  server: TeamSide;
  bestOfSets: 3 | 5;
  seq: number;
  winner: TeamSide | null;
  updatedAt: string;
}

export interface PointWonEvent {
  type: "point_won";
  winner: TeamSide;
}

export type TennisScoreEvent = PointWonEvent;

export interface DisplayGamePoints {
  teamA: string;
  teamB: string;
}
