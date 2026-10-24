import React, { useCallback, useEffect, useMemo, useState } from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import RefreshIcon from "@mui/icons-material/Refresh";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import "./App.css";

const ROUND_HISTORY_API_URL = (
  process.env.REACT_APP_ROUND_HISTORY_API_URL || "http://localhost:9000"
).replace(/\/$/, "");

function getRoundValues(round) {
  if (Array.isArray(round)) {
    return round
      .flatMap((value) => {
        if (Array.isArray(value)) return getRoundValues(value);
        if (value && typeof value === "object") {
          return Object.values(value).slice(0, 1);
        }
        return [value];
      })
      .filter((value) => value !== undefined && value !== null);
  }

  if (round && typeof round === "object") {
    return Object.values(round);
  }

  return [];
}

function formatValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "-");
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function getBaccaratColor(result, color) {
  if (typeof color === "string" && /^#[\da-f]{3,8}$/i.test(color)) {
    return color;
  }

  const normalizedResult = String(result || "").toLowerCase();
  if (normalizedResult.includes("banker")) return "#ec2024";
  if (normalizedResult.includes("player")) return "#2475d0";
  if (normalizedResult.includes("tie")) return "#27a36a";
  return "#8491a5";
}

function getBaccaratSide(result) {
  const normalizedResult = String(result || "").toLowerCase();
  if (normalizedResult.includes("banker")) return "banker";
  if (normalizedResult.includes("player")) return "player";
  return null;
}

function getCoordinateIndex(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export default function App() {
  const [historyData, setHistoryData] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState("");

  const loadData = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch(`${ROUND_HISTORY_API_URL}/round-history`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || data?.success === false) {
        throw new Error(
          data?.error || `Round-history API returned HTTP ${response.status}.`,
        );
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Round-history API returned invalid JSON data.");
      }
      setHistoryData(data);
      setLastFetchedAt(new Date().toLocaleString());
    } catch (loadError) {
      console.error("Unable to load round-history API data:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load round-history API data.",
      );
      setHistoryData({});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [loadData]);

  const coordinateHistory =
    historyData.coordinateHistory ||
    (Array.isArray(historyData.results) ? historyData : null);
  const coordinateResults = useMemo(
    () =>
      Array.isArray(coordinateHistory?.results)
        ? coordinateHistory.results.filter(
            (result) => result && typeof result === "object",
          )
        : [],
    [coordinateHistory],
  );
  const rows = useMemo(
    () =>
      Array.isArray(historyData.parsedSvgRounds)
        ? historyData.parsedSvgRounds
        : [],
    [historyData],
  );

  const results = useMemo(
    () =>
      coordinateResults.length > 0
        ? coordinateResults.map((result, index) => ({
            time: historyData.dateId || `Result ${index + 1}`,
            value: result.value,
          }))
        : rows.flatMap((round, index) =>
            getRoundValues(round).map((value) => ({
              time: `Round ${index + 1}`,
              value,
            })),
          ),
    [coordinateResults, historyData.dateId, rows],
  );

  const uniqueResultCount = useMemo(
    () => new Set(results.map(({ value }) => formatValue(value))).size,
    [results],
  );

  const resultCounts = useMemo(
    () =>
      results.reduce((counts, { value }) => {
        const formattedValue = formatValue(value);
        counts.set(formattedValue, (counts.get(formattedValue) || 0) + 1);
        return counts;
      }, new Map()),
    [results],
  );

  const resultSummary = useMemo(
    () =>
      Array.from(resultCounts.entries()).sort(([left], [right]) => {
        const leftNumber = Number(left);
        const rightNumber = Number(right);
        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
          return leftNumber - rightNumber;
        }
        return left.localeCompare(right);
      }),
    [resultCounts],
  );

  const coordinateCounts = useMemo(
    () =>
      coordinateResults.reduce((counts, result) => {
        const name = result.result || "Unknown";
        counts.set(name, (counts.get(name) || 0) + 1);
        return counts;
      }, new Map()),
    [coordinateResults],
  );
  const { duplicatePairs, pairedResultIndexes } = useMemo(() => {
    const pairs = [];
    const pairedIndexes = new Map();
    for (let index = 0; index + 1 < coordinateResults.length; index += 1) {
      const value = String(coordinateResults[index].value ?? "").trim();
      const nextValue = String(coordinateResults[index + 1].value ?? "").trim();
      if (!value || value !== nextValue) continue;

      const pairId = `${value}-${index}-${index + 1}`;
      pairs.push({
        id: pairId,
        value,
        firstIndex: index,
        secondIndex: index + 1,
      });
      pairedIndexes.set(index, pairId);
      pairedIndexes.set(index + 1, pairId);
      index += 1;
    }

    return { duplicatePairs: pairs, pairedResultIndexes: pairedIndexes };
  }, [coordinateResults]);
  const sequenceSignals = useMemo(() => {
    const signals = [];
    for (let index = 0; index + 2 < coordinateResults.length; index += 1) {
      const value = String(coordinateResults[index].value ?? "").trim();
      const nextValue = String(coordinateResults[index + 1].value ?? "").trim();
      const targetResult = coordinateResults[index + 2];
      const targetSide = getBaccaratSide(targetResult.result);
      if (!value || value !== nextValue || !targetSide) continue;

      signals.push({
        id: `${index}-${targetSide}`,
        precedingResults: [
          ...Array(Math.max(0, 3 - index)).fill(null),
          ...coordinateResults.slice(Math.max(0, index - 3), index),
        ],
        matchingResults: coordinateResults.slice(index, index + 2),
        targetResult,
        targetSide,
      });
    }
    if (coordinateResults.length > 0) {
      signals.push({
        id: "latest-results",
        precedingResults: [
          ...Array(Math.max(0, 5 - coordinateResults.length)).fill(null),
          ...coordinateResults.slice(-5),
        ],
        matchingResults: [],
        targetResult: null,
        targetSide: "pending",
      });
    }
    return signals;
  }, [coordinateResults]);
  const baccaratRows = Math.max(
    1,
    ...coordinateResults.map((result) => getCoordinateIndex(result.y, 0) + 1),
  );
  const baccaratColumns = Math.max(
    1,
    ...coordinateResults.map(
      (result, index) => getCoordinateIndex(result.x, index) + 1,
    ),
  );
  const displayCount = coordinateResults.length || results.length;
  const updatedAt = historyData.time || lastFetchedAt || "Not available";

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#f4f7fb",
        px: { xs: 2, md: 6 },
        py: { xs: 3, md: 6 },
      }}
    >
      <Box sx={{ maxWidth: 1400, mx: "auto" }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "stretch", md: "center" }}
          spacing={3}
          sx={{ mb: 4 }}
        >
          <Box>
            <Typography
              variant="overline"
              sx={{ color: "primary.main", fontWeight: 800, letterSpacing: 2 }}
            >
              Round-history API
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 800, color: "#172033" }}>
              Baccarat results
            </Typography>
            <Typography color="text.secondary">
              Live results from the round-history API JSON.
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Button
              variant="contained"
              startIcon={
                refreshing ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <RefreshIcon />
                )
              }
              onClick={loadData}
              disabled={refreshing}
              sx={{ minWidth: 125, fontWeight: 700 }}
            >
              Refresh
            </Button>
          </Stack>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Card
          elevation={0}
          sx={{
            border: "1px solid #e3e9f2",
            borderRadius: 4,
            overflow: "hidden",
            boxShadow: "0 18px 50px rgba(30, 56, 92, 0.08)",
          }}
        >
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              justifyContent="space-between"
              spacing={1}
              sx={{ mb: 2 }}
            >
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  {historyData.dateId || "Live results"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {displayCount} results · Last update: {updatedAt}
                </Typography>
              </Box>
              <Chip
                label={displayCount ? "Data available" : "No results found"}
                color={displayCount ? "success" : "default"}
                variant="outlined"
              />
            </Stack>

            {loading ? (
              <Stack alignItems="center" sx={{ py: 10 }}>
                <CircularProgress />
              </Stack>
            ) : coordinateResults.length > 0 ? (
              <Box className="result-board baccarat-board">
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", md: "center" }}
                  spacing={2}
                  sx={{ mb: 3 }}
                >
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                      Baccarat road board
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Results from round-history API JSON
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip
                      className="result-summary-chip"
                      label={`${coordinateHistory.count} results`}
                      size="small"
                    />
                    {duplicatePairs.length > 0 && (
                      <Chip
                        className="pair-summary-chip"
                        label={`${duplicatePairs.length} matching pairs`}
                        size="small"
                      />
                    )}
                    {Array.from(coordinateCounts.entries()).map(
                      ([name, count]) => (
                        <Chip
                          className="baccarat-legend-chip"
                          key={name}
                          label={`${name} · ${count}`}
                          size="small"
                          style={{
                            "--result-color": getBaccaratColor(name),
                          }}
                        />
                      ),
                    )}
                  </Stack>
                </Stack>
                {sequenceSignals.length > 0 && (
                  <Box className="sequence-signals-panel">
                    <Typography className="sequence-signals-title">
                      Consecutive number signals
                    </Typography>
                    <Box className="sequence-signals-list">
                      {sequenceSignals.map((signal) => (
                        <Box
                          className={`sequence-signal ${signal.targetSide}`}
                          key={signal.id}
                          style={{
                            "--signal-color": signal.targetResult
                              ? getBaccaratColor(
                                  signal.targetResult.result,
                                  signal.targetResult.color,
                                )
                              : "#8491a5",
                          }}
                        >
                          <Typography
                            className="sequence-signal-heading"
                            component="span"
                          >
                            {signal.targetSide === "pending"
                              ? "Latest results · next"
                              : signal.targetSide === "banker"
                                ? "Banker target"
                                : "Player target"}
                          </Typography>
                          <Box className="sequence-signal-values">
                            {signal.precedingResults.map((result, index) => (
                              <Typography
                                className={`sequence-signal-value${result ? " result-colored" : ""}`}
                                component="span"
                                key={`before-${index}`}
                                style={
                                  result
                                    ? {
                                        "--result-color": getBaccaratColor(
                                          result.result,
                                          result.color,
                                        ),
                                      }
                                    : undefined
                                }
                                title="Previous result"
                              >
                                {result ? formatValue(result.value) : "-"}
                              </Typography>
                            ))}
                            {signal.matchingResults.map((result, index) => (
                              <Typography
                                className="sequence-signal-value matching result-colored"
                                component="span"
                                key={`matching-${index}`}
                                style={{
                                  "--result-color": getBaccaratColor(
                                    result.result,
                                    result.color,
                                  ),
                                }}
                                title="Consecutive matching result"
                              >
                                {formatValue(result.value)}
                              </Typography>
                            ))}
                            {signal.targetResult ? (
                              <Typography
                                className="sequence-signal-value result-colored target"
                                component="span"
                                style={{
                                  "--result-color": getBaccaratColor(
                                    signal.targetResult.result,
                                    signal.targetResult.color,
                                  ),
                                }}
                                title={`${signal.targetResult.result} target`}
                              >
                                {formatValue(signal.targetResult.value)}
                              </Typography>
                            ) : (
                              <Typography
                                className="sequence-signal-value target"
                                component="span"
                                title="Next result"
                              >
                                -
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
                <Box className="baccarat-board-scroll">
                  <Box
                    className="baccarat-grid"
                    style={{
                      gridTemplateColumns: `repeat(${baccaratColumns}, 64px)`,
                      gridTemplateRows: `repeat(${baccaratRows}, 64px)`,
                    }}
                  >
                    {coordinateResults.map((result, index) => {
                      const x = getCoordinateIndex(result.x, index);
                      const y = getCoordinateIndex(result.y, 0);
                      const resultColor = getBaccaratColor(
                        result.result,
                        result.color,
                      );
                      const pairId = pairedResultIndexes.get(index);

                      return (
                        <Box
                          className={`baccarat-cell${pairId ? " paired" : ""}`}
                          key={`${x}-${y}-${index}`}
                          style={{
                            gridColumn: x + 1,
                            gridRow: y + 1,
                            "--result-color": resultColor,
                          }}
                          title={`${result.result || "Unknown"} · ${result.value ?? "-"} · (${result.x ?? "?"}, ${result.y ?? "?"})${pairId ? " · Matching value pair" : ""}`}
                        >
                          {pairId && (
                            <Typography
                              className="baccarat-pair-badge"
                              component="span"
                            >
                              PAIR
                            </Typography>
                          )}
                          <Typography
                            className="baccarat-coordinate"
                            component="span"
                          >
                            {result.x ?? "?"},{result.y ?? "?"}
                          </Typography>
                          <Typography
                            className="baccarat-value"
                            component="span"
                          >
                            {result.value ?? "-"}
                          </Typography>
                          <Box className="baccarat-markers">
                            {(Array.isArray(result.markers)
                              ? result.markers
                              : []
                            ).map((marker, markerIndex) => (
                              <Box
                                className="baccarat-marker"
                                key={`${marker.cx}-${marker.cy}-${markerIndex}`}
                                style={{
                                  backgroundColor: getBaccaratColor(
                                    result.result,
                                    marker.fill,
                                  ),
                                }}
                              />
                            ))}
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              </Box>
            ) : results.length === 0 ? (
              <Alert severity="info">
                No Baccarat results are available from the round-history API.
              </Alert>
            ) : (
              <>
                <Box className="result-board">
                  <Stack
                    direction={{ xs: "column", md: "row" }}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", md: "center" }}
                    spacing={2}
                    sx={{ mb: 3 }}
                  >
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 800 }}>
                        Result sequence
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Values returned by the round-history API
                      </Typography>
                    </Box>
                    <Stack
                      direction="row"
                      spacing={1}
                      flexWrap="wrap"
                      useFlexGap
                    >
                      <Chip
                        className="result-summary-chip"
                        label={`${results.length} results`}
                        size="small"
                      />
                      <Chip
                        className="result-summary-chip"
                        label={`${uniqueResultCount} unique values`}
                        size="small"
                      />
                    </Stack>
                  </Stack>

                  {results.length === 0 ? (
                    <Typography color="text.secondary">
                      No results are available to display.
                    </Typography>
                  ) : (
                    <Box className="results-content">
                      <Box className="result-summary">
                        {resultSummary.map(([value, count]) => (
                          <Typography
                            className="result-frequency"
                            component="span"
                            key={value}
                          >
                            {value}: {count}
                          </Typography>
                        ))}
                      </Box>
                      <Box className="result-grid">
                        {results.map(({ time, value }, index) => (
                          <Box
                            className="result-tile"
                            key={`${time}-${index}`}
                            title={`${time} · Result ${index + 1}`}
                          >
                            <Typography
                              className="result-index"
                              component="span"
                            >
                              {index + 1}
                            </Typography>
                            <Typography
                              className="result-value"
                              component="span"
                            >
                              {formatValue(value)}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )}
                </Box>
              </>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
