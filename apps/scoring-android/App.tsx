import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type TeamSide = "A" | "B";

interface MatchSummary {
  id: number;
  courtId: number;
  courtName: string;
  teamAName: string;
  teamBName: string;
  displayGamePoints: {
    teamA: string;
    teamB: string;
  };
  snapshot: {
    seq: number;
    sets: Array<{ gamesA: number; gamesB: number }>;
  };
}

interface MatchesResponse {
  matches: MatchSummary[];
}

interface ScoreboardRefreshMessage {
  type: "scoreboard_refresh";
  payload: MatchSummary[];
}

interface MatchUpdatedMessage {
  type: "match_updated";
  payload: MatchSummary;
}

type RealtimeMessage = ScoreboardRefreshMessage | MatchUpdatedMessage;

const storageKey = "clubscore-scorer-server-url";
const defaultMdnsHost = ((
  Constants.expoConfig?.extra as { defaultMdnsHost?: string } | undefined
)?.defaultMdnsHost ?? "http://clubscore-lan.local:7310") as string;

function toWsUrl(serverUrl: string): string {
  if (serverUrl.startsWith("https://")) {
    return serverUrl.replace("https://", "wss://") + "/ws";
  }
  if (serverUrl.startsWith("http://")) {
    return serverUrl.replace("http://", "ws://") + "/ws";
  }
  return `ws://${serverUrl}/ws`;
}

export default function App() {
  const [serverUrl, setServerUrl] = useState(defaultMdnsHost);
  const [status, setStatus] = useState("Idle");
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) ?? null,
    [matches, selectedMatchId],
  );

  const refreshMatches = useCallback(async () => {
    try {
      const response = await fetch(`${serverUrl}/api/matches/active`);
      if (!response.ok) {
        throw new Error("Unable to fetch active matches");
      }
      const data = (await response.json()) as MatchesResponse;
      setMatches(data.matches);
      if (data.matches.length > 0 && selectedMatchId === null) {
        setSelectedMatchId(data.matches[0].id);
      }
      setStatus("Connected");
    } catch (error) {
      setStatus(`Network error: ${(error as Error).message}`);
    }
  }, [selectedMatchId, serverUrl]);

  useEffect(() => {
    AsyncStorage.getItem(storageKey)
      .then((stored) => {
        if (stored) {
          setServerUrl(stored);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(storageKey, serverUrl).catch(() => {});
  }, [serverUrl]);

  useEffect(() => {
    void refreshMatches();
    const timer = setInterval(() => {
      void refreshMatches();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshMatches]);

  useEffect(() => {
    const ws = new WebSocket(toWsUrl(serverUrl));

    ws.onopen = () => {
      setStatus("Realtime connected");
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as RealtimeMessage;

        if (message.type === "scoreboard_refresh") {
          setMatches(message.payload);
          return;
        }

        if (message.type === "match_updated") {
          const updatedMatch = message.payload;
          setMatches((prev) => {
            const found = prev.find((match) => match.id === updatedMatch.id);
            if (!found) {
              return [...prev, updatedMatch];
            }
            return prev.map((match) =>
              match.id === updatedMatch.id ? updatedMatch : match,
            );
          });
        }
      } catch {
        setStatus("Realtime parse warning");
      }
    };

    ws.onerror = () => {
      setStatus("Realtime socket error");
    };

    ws.onclose = () => {
      setStatus("Realtime disconnected");
    };

    return () => {
      ws.close();
    };
  }, [serverUrl]);

  async function autoDiscoverViaMdnsHost(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`${defaultMdnsHost}/api/discovery`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { host: string; port: number };
      const discovered = `http://${payload.host}:${payload.port}`;
      setServerUrl(discovered);
      setStatus(`Discovered ${discovered}`);
      return;
    } catch {
      setStatus("Auto discovery failed, use manual IP fallback.");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function sendPoint(winner: TeamSide): Promise<void> {
    if (!selectedMatch) {
      return;
    }

    const response = await fetch(
      `${serverUrl}/api/matches/${selectedMatch.id}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "point_won",
          winner,
          sourceDevice: "android-scorer",
          expectedSeq: selectedMatch.snapshot.seq + 1,
        }),
      },
    );

    if (!response.ok) {
      const body = (await response.text()).slice(0, 120);
      setStatus(`Score rejected: ${body}`);
      void refreshMatches();
      return;
    }

    setStatus(`Point awarded to ${winner}`);
  }

  async function sendUndo(): Promise<void> {
    if (!selectedMatch) {
      return;
    }

    const response = await fetch(
      `${serverUrl}/api/matches/${selectedMatch.id}/undo`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sourceDevice: "android-scorer" }),
      },
    );

    if (!response.ok) {
      setStatus("Undo failed");
      return;
    }

    setStatus("Last event undone");
    void refreshMatches();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.layout}>
        <View style={styles.card}>
          <Text style={styles.heading}>ClubScore Android Scorer</Text>
          <Text style={styles.subheading}>
            mDNS first, manual fallback supported.
          </Text>

          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://192.168.1.30:7310"
            placeholderTextColor="#94a3b8"
          />
          <View style={styles.row}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => void autoDiscoverViaMdnsHost()}
            >
              <Text style={styles.buttonTextDark}>Auto Discover</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => void refreshMatches()}
            >
              <Text style={styles.buttonTextDark}>Refresh</Text>
            </Pressable>
          </View>
          <Text style={styles.status}>{status}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Live Courts</Text>
          <FlatList
            data={matches}
            scrollEnabled={false}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <Pressable
                style={[
                  styles.matchRow,
                  item.id === selectedMatchId ? styles.matchRowSelected : null,
                ]}
                onPress={() => setSelectedMatchId(item.id)}
              >
                <Text style={styles.matchTitle}>{item.courtName}</Text>
                <Text style={styles.matchScore}>
                  {item.teamAName} {item.displayGamePoints.teamA} -{" "}
                  {item.displayGamePoints.teamB} {item.teamBName}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>No live matches yet.</Text>
            }
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Scoring Pad</Text>
          {!selectedMatch ? (
            <Text style={styles.empty}>Select a court first.</Text>
          ) : null}
          {selectedMatch ? (
            <>
              <Text style={styles.focusCourt}>{selectedMatch.courtName}</Text>
              <View style={styles.scoreBoardRow}>
                <Text style={styles.scoreName}>{selectedMatch.teamAName}</Text>
                <Text style={styles.scorePoints}>
                  {selectedMatch.displayGamePoints.teamA}
                </Text>
              </View>
              <View style={styles.scoreBoardRow}>
                <Text style={styles.scoreName}>{selectedMatch.teamBName}</Text>
                <Text style={styles.scorePoints}>
                  {selectedMatch.displayGamePoints.teamB}
                </Text>
              </View>

              <View style={styles.row}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => void sendPoint("A")}
                >
                  <Text style={styles.buttonTextLight}>Point Team A</Text>
                </Pressable>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => void sendPoint("B")}
                >
                  <Text style={styles.buttonTextLight}>Point Team B</Text>
                </Pressable>
              </View>

              <Pressable
                style={styles.undoButton}
                onPress={() => void sendUndo()}
              >
                <Text style={styles.buttonTextLight}>Undo Last Point</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  layout: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    color: "#020617",
  },
  subheading: {
    color: "#334155",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#020617",
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#64748b",
    backgroundColor: "#ffffff",
    borderRadius: 8,
    paddingHorizontal: 10,
    color: "#0f172a",
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
  },
  secondaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#cbd5e1",
  },
  undoButton: {
    minHeight: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#b91c1c",
  },
  buttonTextLight: {
    color: "#f8fafc",
    fontWeight: "600",
  },
  buttonTextDark: {
    color: "#0f172a",
    fontWeight: "600",
  },
  status: {
    color: "#334155",
    fontSize: 13,
  },
  matchRow: {
    borderWidth: 1,
    borderColor: "#94a3b8",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: "#f8fafc",
    gap: 4,
  },
  matchRowSelected: {
    borderColor: "#0f172a",
    backgroundColor: "#dbeafe",
  },
  matchTitle: {
    fontWeight: "700",
    color: "#0f172a",
  },
  matchScore: {
    color: "#334155",
  },
  empty: {
    color: "#475569",
  },
  focusCourt: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 17,
  },
  scoreBoardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    padding: 8,
    backgroundColor: "#ffffff",
  },
  scoreName: {
    color: "#0f172a",
  },
  scorePoints: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 18,
  },
});
