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

const COLLECTION_NAME = "Bio_sic";

function formatDateId(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function getRoundValues(round) {
  if (Array.isArray(round)) {
    return round
      .map((value) =>
        value && typeof value === "object" ? Object.values(value)[0] : value,
      )
      .filter((value) => value !== undefined && value !== null);
  }

  if (round && typeof round === "object") {
    return Object.values(round);
  }

  return [];
}

function valueColor(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "default";
  if (number > 10) return "error";
  if (number === 10) return "warning";
  return "success";
}

function formatValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "-");
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function valueState(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "unknown";
  if (number > 10) return "high";
  if (number < 10) return "low";
  return "target";
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

  const chartRows = useMemo(
    () =>
      rows
        .map(([time, round]) => {
          const value = getRoundValues(round)[0];
          const number = Number(value);
          return {
            time,
            value,
            number,
            state: valueState(value),
          };
        })
        .filter(({ number }) => Number.isFinite(number))
        .reverse(),
    [rows],
  );

  const chartSummary = useMemo(
    () =>
      chartRows.reduce(
        (summary, { state }) => ({ ...summary, [state]: summary[state] + 1 }),
        { high: 0, low: 0, target: 0, unknown: 0 },
      ),
    [chartRows],
  );

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
              Round history
            </Typography>
            <Typography color="text.secondary">
            Live game results from the Bio_sic Firestore collection.
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
                refreshing ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon />
              }
              onClick={loadData}
              disabled={refreshing}
              sx={{ minWidth: 125, fontWeight: 700 }}
            >
              Refresh
            </Button>
          </Stack>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

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
                  {rows.length} saved rounds · Last update: {updatedAt}
                </Typography>
              </Box>
              <Chip
                label={rows.length ? "Data available" : "No rounds found"}
                color={rows.length ? "success" : "default"}
                variant="outlined"
              />
            </Stack>

            {loading ? (
              <Stack alignItems="center" sx={{ py: 10 }}>
                <CircularProgress />
              </Stack>
            ) : rows.length === 0 ? (
              <Alert severity="info">
                No round data exists for this date.
              </Alert>
            ) : (
              <>
                <Box className="chart-panel sic-board">
                  <Stack
                    direction={{ xs: "column", md: "row" }}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", md: "center" }}
                    spacing={2}
                    sx={{ mb: 3 }}
                  >
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 800 }}>
                        SIC-BIO live board
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Each vertical column is one round · first value drives the timeline below
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip className="chart-legend-chip high" label={`Above 10 · ${chartSummary.high}`} size="small" />
                      <Chip className="chart-legend-chip target" label={`At 10 · ${chartSummary.target}`} size="small" />
                      <Chip className="chart-legend-chip low" label={`Below 10 · ${chartSummary.low}`} size="small" />
                    </Stack>
                  </Stack>

                  {chartRows.length === 0 ? (
                    <Typography color="text.secondary">No numeric first values are available to plot.</Typography>
                  ) : (
                    <Box className="chart-scroll-area">
                      <Box className="sic-board-grid sic-lobby-table">
                        {chartRows.map(({ time, value }) => {
                          return (
                            <Box className="sic-round-column" key={time} title={`${time}: ${formatValue(value)}`}>
                              <Box className="sic-round-values">
                                <Box className={`sic-value-cell primary ${valueState(value)}`}>
                                  {formatValue(value)}
                                </Box>
                              </Box>
                              <Typography className="sic-time-label">{time}</Typography>
                            </Box>
                          );
                        })}
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
