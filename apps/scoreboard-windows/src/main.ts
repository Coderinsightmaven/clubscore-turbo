import "./style.css";
import { invoke } from "@tauri-apps/api/core";

interface MatchTile {
  id: number;
  courtName: string;
  teamAName: string;
  teamBName: string;
  displayGamePoints: {
    teamA: string;
    teamB: string;
  };
  snapshot: {
    sets: Array<{ gamesA: number; gamesB: number }>;
  };
}

interface ScoreboardResponse {
  matches: MatchTile[];
}

interface DiscoveryResult {
  host: string;
  port: number;
}

const storageKey = "clubscore-scoreboard-config";

const serverInput = document.getElementById("server-url") as HTMLInputElement;
const yOffsetInput = document.getElementById("y-offset") as HTMLInputElement;
const discoverButton = document.getElementById("discover") as HTMLButtonElement;
const saveButton = document.getElementById("save") as HTMLButtonElement;
const fullscreenButton = document.getElementById(
  "fullscreen",
) as HTMLButtonElement;
const statusNode = document.getElementById("status") as HTMLParagraphElement;
const virtualWall = document.getElementById("virtual-wall") as HTMLDivElement;

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;

function setStatus(text: string): void {
  statusNode.textContent = text;
}

function setDefaultConfig(): void {
  if (!serverInput.value) {
    serverInput.value = "http://clubscore-lan.local:7310";
  }
  if (!yOffsetInput.value) {
    yOffsetInput.value = "0";
  }
}

function applyYOffset(): void {
  const offset = Number(yOffsetInput.value || "0");
  const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
  virtualWall.style.transform = `translateY(-${safeOffset}px)`;
}

function saveConfig(): void {
  const config = {
    serverUrl: serverInput.value.trim(),
    yOffset: Number(yOffsetInput.value || "0"),
  };
  localStorage.setItem(storageKey, JSON.stringify(config));
}

function loadConfig(): void {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    setDefaultConfig();
    return;
  }

  try {
    const parsed = JSON.parse(saved) as {
      serverUrl?: string;
      yOffset?: number;
    };
    serverInput.value = parsed.serverUrl ?? "http://clubscore-lan.local:7310";
    yOffsetInput.value = String(parsed.yOffset ?? 0);
  } catch {
    setDefaultConfig();
  }
}

function renderMatches(matches: MatchTile[]): void {
  if (matches.length === 0) {
    virtualWall.innerHTML = `<div class="empty-state">Waiting for live matches.</div>`;
    applyYOffset();
    return;
  }

  virtualWall.innerHTML = matches
    .map((match) => {
      const currentSet = match.snapshot.sets[
        match.snapshot.sets.length - 1
      ] ?? {
        gamesA: 0,
        gamesB: 0,
      };

      return `
        <section class="court-tile">
          <div class="court-row">
            <span class="court-name">${match.courtName}</span>
            <span>Set ${currentSet.gamesA}-${currentSet.gamesB}</span>
          </div>
          <div class="court-row score-main">
            <span>${match.teamAName} ${match.displayGamePoints.teamA}</span>
            <span>${match.displayGamePoints.teamB} ${match.teamBName}</span>
          </div>
        </section>
      `;
    })
    .join("");

  applyYOffset();
}

async function fetchSnapshot(): Promise<void> {
  const serverUrl = serverInput.value.trim();
  if (!serverUrl) {
    setStatus("Enter a LAN server URL");
    return;
  }

  try {
    const response = await fetch(`${serverUrl}/api/scoreboard`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = (await response.json()) as ScoreboardResponse;
    renderMatches(json.matches);
    setStatus("Snapshot synced");
  } catch (error) {
    setStatus(`Fetch failed: ${(error as Error).message}`);
  }
}

function connectWebsocket(): void {
  const serverUrl = serverInput.value.trim();
  if (!serverUrl) {
    return;
  }

  const wsUrl = serverUrl
    .replace("https://", "wss://")
    .replace("http://", "ws://")
    .concat("/ws");

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setStatus("Realtime connected");
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data as string) as {
        type: string;
        payload: MatchTile[];
      };

      if (
        message.type === "scoreboard_refresh" &&
        Array.isArray(message.payload)
      ) {
        renderMatches(message.payload);
      }
    } catch {
      setStatus("Realtime parse warning");
    }
  };

  ws.onerror = () => {
    setStatus("Realtime error");
  };

  ws.onclose = () => {
    setStatus("Realtime disconnected, retrying");
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
    reconnectTimer = window.setTimeout(() => {
      void fetchSnapshot();
      connectWebsocket();
    }, 1500);
  };
}

async function autoDiscover(): Promise<void> {
  try {
    const discovery = await invoke<DiscoveryResult | null>("discover_server", {
      timeoutMs: 2500,
    });

    if (!discovery) {
      setStatus("No mDNS LAN core discovered, keep manual URL fallback.");
      return;
    }

    serverInput.value = `http://${discovery.host}:${discovery.port}`;
    saveConfig();
    setStatus(`Discovered ${serverInput.value}`);
    void fetchSnapshot();
    if (ws) {
      ws.close();
    }
    connectWebsocket();
  } catch {
    setStatus("mDNS discovery unavailable, using manual URL.");
  }
}

loadConfig();
applyYOffset();
void fetchSnapshot();
connectWebsocket();

saveButton.addEventListener("click", () => {
  saveConfig();
  applyYOffset();
  void fetchSnapshot();
  if (ws) {
    ws.close();
  }
  connectWebsocket();
  setStatus("Configuration saved");
});

yOffsetInput.addEventListener("input", () => {
  applyYOffset();
});

discoverButton.addEventListener("click", () => {
  void autoDiscover();
});

fullscreenButton.addEventListener("click", () => {
  void document.documentElement.requestFullscreen();
});
