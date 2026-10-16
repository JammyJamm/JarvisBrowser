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
              Live results from the Bacart Firestore collection.
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
              <Alert severity="info">No round data exists for this date.</Alert>
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
