import { FormEvent, useEffect, useMemo, useState } from "react";

interface Court {
  id: number;
  name: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
}

interface MatchSummary {
  id: number;
  courtId: number;
  courtName: string;
  teamAName: string;
  teamBName: string;
  status: "live" | "complete";
  startedAt: string;
  displayGamePoints: {
    teamA: string;
    teamB: string;
  };
}

interface CourtsResponse {
  courts: Court[];
}

interface ActiveMatchesResponse {
  matches: MatchSummary[];
}

const fallbackUrl =
  typeof window === "undefined"
    ? "http://127.0.0.1:7310"
    : `${window.location.protocol}//${window.location.hostname}:7310`;

export function App() {
  const [serverUrl, setServerUrl] = useState(
    localStorage.getItem("clubscore-setup-server") ??
      import.meta.env.VITE_LAN_CORE_URL ??
      fallbackUrl,
  );
  const [courts, setCourts] = useState<Court[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [newCourtName, setNewCourtName] = useState("");
  const [selectedCourtId, setSelectedCourtId] = useState<number | null>(null);
  const [teamAName, setTeamAName] = useState("Team A");
  const [teamBName, setTeamBName] = useState("Team B");
  const [status, setStatus] = useState("Waiting for setup actions.");

  const activeCourtOptions = useMemo(
    () => courts.filter((court) => court.isActive),
    [courts],
  );

  useEffect(() => {
    localStorage.setItem("clubscore-setup-server", serverUrl);
  }, [serverUrl]);

  async function refresh(): Promise<void> {
    try {
      const [courtsResponse, matchesResponse] = await Promise.all([
        fetch(`${serverUrl}/api/courts`),
        fetch(`${serverUrl}/api/matches/active`),
      ]);

      if (!courtsResponse.ok || !matchesResponse.ok) {
        throw new Error("Unable to fetch setup data");
      }

      const courtsJson = (await courtsResponse.json()) as CourtsResponse;
      const matchesJson =
        (await matchesResponse.json()) as ActiveMatchesResponse;

      setCourts(courtsJson.courts);
      setMatches(matchesJson.matches);
      if (courtsJson.courts.length > 0 && selectedCourtId === null) {
        setSelectedCourtId(courtsJson.courts[0].id);
      }
      setStatus("Connected to LAN core server.");
    } catch (error) {
      setStatus(`Connection error: ${(error as Error).message}`);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [serverUrl]);

  async function submitNewCourt(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!newCourtName.trim()) {
      return;
    }

    const response = await fetch(`${serverUrl}/api/courts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCourtName.trim() }),
    });

    if (!response.ok) {
      setStatus("Unable to create court. Name may already exist.");
      return;
    }

    setNewCourtName("");
    setStatus("Court created.");
    await refresh();
  }

  async function startMatch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedCourtId) {
      setStatus("Select a court first.");
      return;
    }

    const response = await fetch(`${serverUrl}/api/matches/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courtId: selectedCourtId,
        teamAName: teamAName.trim(),
        teamBName: teamBName.trim(),
      }),
    });

    if (!response.ok) {
      setStatus("Unable to start match.");
      return;
    }

    setStatus("Match started.");
    await refresh();
  }

  return (
    <main className="layout">
      <header>
        <h1>ClubScore Setup</h1>
        <p>Tennis LAN setup, match assignment, and display ordering.</p>
      </header>

      <section className="card">
        <h2>LAN Core Server</h2>
        <div className="row">
          <input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="http://192.168.1.20:7310"
          />
          <button onClick={() => void refresh()}>Refresh</button>
        </div>
        <p className="status">{status}</p>
      </section>

      <section className="card">
        <h2>Create Court</h2>
        <form
          onSubmit={(event) => void submitNewCourt(event)}
          className="stack"
        >
          <input
            value={newCourtName}
            onChange={(event) => setNewCourtName(event.target.value)}
            placeholder="Court 1"
          />
          <button type="submit">Add Court</button>
        </form>
      </section>

      <section className="card">
        <h2>Start Match</h2>
        <form onSubmit={(event) => void startMatch(event)} className="stack">
          <select
            value={selectedCourtId ?? ""}
            onChange={(event) => setSelectedCourtId(Number(event.target.value))}
          >
            <option value="" disabled>
              Select court
            </option>
            {activeCourtOptions.map((court) => (
              <option key={court.id} value={court.id}>
                {court.name}
              </option>
            ))}
          </select>

          <div className="row">
            <input
              value={teamAName}
              onChange={(event) => setTeamAName(event.target.value)}
              placeholder="Team A"
            />
            <input
              value={teamBName}
              onChange={(event) => setTeamBName(event.target.value)}
              placeholder="Team B"
            />
          </div>
          <button type="submit">Start Live Match</button>
        </form>
      </section>

      <section className="card">
        <h2>Active Matches</h2>
        <ul className="matches">
          {matches.length === 0 ? <li>No live matches.</li> : null}
          {matches.map((match) => (
            <li key={match.id}>
              <strong>{match.courtName}</strong>
              <span>
                {match.teamAName} {match.displayGamePoints.teamA} -{" "}
                {match.displayGamePoints.teamB} {match.teamBName}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>LED Panel Rules (v1)</h2>
        <ul>
          <li>Fixed viewport: 384x256 pixels.</li>
          <li>Full-bleed output: no border/padding.</li>
          <li>Per-panel Y offset for stacked slicing.</li>
        </ul>
      </section>
    </main>
  );
}
