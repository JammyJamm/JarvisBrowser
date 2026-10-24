import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import db from "./firebaseConfig";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import RefreshIcon from "@mui/icons-material/Refresh";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import "./App.css";

const COLLECTION_NAME = "Bacart";

function formatDateId(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

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

function formatUpdatedAt(value) {
  if (value instanceof Timestamp) return value.toDate().toLocaleString();
  if (value?.toDate) return value.toDate().toLocaleString();
  return "Not available";
}

export default function App() {
  const [dateIds, setDateIds] = useState([]);
  const [selectedDate, setSelectedDate] = useState(formatDateId(new Date()));
  const [documentData, setDocumentData] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadDateIds = useCallback(async () => {
    const snapshot = await getDocs(collection(db, COLLECTION_NAME));
    const ids = snapshot.docs
      .map((item) => item.id)
      .filter((id) => id !== "updatedAt")
      .sort((left, right) => right.localeCompare(left));
    setDateIds(ids);
    if (ids.length > 0 && !ids.includes(selectedDate)) {
      setSelectedDate(ids[0]);
    }
  }, [selectedDate]);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const snapshot = await getDoc(doc(db, COLLECTION_NAME, selectedDate));
      setDocumentData(snapshot.exists() ? snapshot.data() : {});
    } catch (loadError) {
      console.error("Unable to load Firestore history:", loadError);
      setError("Unable to load this day's history. Please try again.");
      setDocumentData({});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadDateIds().catch((loadError) => {
      console.error("Unable to load Firestore dates:", loadError);
      setError("Unable to load available dates from Firestore.");
      setLoading(false);
    });
  }, [loadDateIds]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [loadData]);

  const rows = useMemo(
    () =>
      Object.entries(documentData)
        .filter(([time, value]) => time !== "updatedAt" && Array.isArray(value))
        .sort(([left], [right]) => right.localeCompare(left)),
    [documentData],
  );

  const results = useMemo(
    () =>
      rows
        .slice()
        .reverse()
        .flatMap(([time, round]) =>
          getRoundValues(round).map((value) => ({
            time,
            value,
          })),
        ),
    [rows],
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

  const coordinateHistory = documentData.coordinateHistory;
  const coordinateResults = useMemo(
    () =>
      Array.isArray(coordinateHistory?.results)
        ? coordinateHistory.results.filter(
            (result) => result && typeof result === "object",
          )
        : [],
    [coordinateHistory],
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
  const displayCount = coordinateHistory
    ? coordinateResults.length
      ? coordinateHistory.count
      : results.length || rows.length
    : results.length || rows.length;

  const updatedAt = formatUpdatedAt(documentData.updatedAt);

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
              Firestore dashboard
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 800, color: "#172033" }}>
              Baccarat results
            </Typography>
            <Typography color="text.secondary">
              Live road board from the Bacart Firestore collection.
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <FormControl size="small" sx={{ minWidth: 180, bgcolor: "white" }}>
              <InputLabel id="date-label">Game date</InputLabel>
              <Select
                labelId="date-label"
                value={selectedDate}
                label="Game date"
                onChange={(event) => setSelectedDate(event.target.value)}
              >
                {dateIds.length === 0 && (
                  <MenuItem value={selectedDate}>{selectedDate}</MenuItem>
                )}
                {dateIds.map((dateId) => (
                  <MenuItem value={dateId} key={dateId}>
                    {dateId}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
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
                  {selectedDate}
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
                      Results arranged by their SVG coordinates
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
                            "--signal-color": getBaccaratColor(
                              signal.targetResult.result,
                              signal.targetResult.color,
                            ),
                          }}
                        >
                          <Typography
                            className="sequence-signal-heading"
                            component="span"
                          >
                            {signal.targetSide === "banker"
                              ? "Banker target"
                              : "Player target"}
                          </Typography>
                          <Box className="sequence-signal-values">
                            {signal.precedingResults.map((result, index) => (
                              <Typography
                                className="sequence-signal-value"
                                component="span"
                                key={`before-${index}`}
                                title="Previous result"
                              >
                                {result ? formatValue(result.value) : "-"}
                              </Typography>
                            ))}
                            {signal.matchingResults.map((result, index) => (
                              <Typography
                                className="sequence-signal-value matching"
                                component="span"
                                key={`matching-${index}`}
                                title="Consecutive matching result"
                              >
                                {formatValue(result.value)}
                              </Typography>
                            ))}
                            <Typography
                              className="sequence-signal-value target"
                              component="span"
                              style={{
                                "--target-color": getBaccaratColor(
                                  signal.targetResult.result,
                                  signal.targetResult.color,
                                ),
                              }}
                              title={`${signal.targetResult.result} target`}
                            >
                              {formatValue(signal.targetResult.value)}
                            </Typography>
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
            ) : rows.length === 0 ? (
              <Alert severity="info">
                No Baccarat results exist for this date.
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
                        All saved values in chronological order
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
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
