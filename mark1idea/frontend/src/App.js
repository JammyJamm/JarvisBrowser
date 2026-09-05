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
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

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
  if (number >= 10) return "error";
  if (number >= 2) return "warning";
  return "success";
}

function formatValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : String(value ?? "-");
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

  const columnCount = useMemo(
    () => Math.max(4, ...rows.map(([, round]) => getRoundValues(round).length)),
    [rows],
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
              <TableContainer sx={{ maxHeight: "65vh" }}>
                <Table stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 800 }}>#</TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>Time</TableCell>
                      {Array.from({ length: columnCount }, (_, index) => (
                        <TableCell align="center" sx={{ fontWeight: 800 }} key={index}>
                          Value {index + 1}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map(([time, round], index) => {
                      const values = getRoundValues(round);
                      return (
                        <TableRow hover key={time}>
                          <TableCell sx={{ color: "text.secondary" }}>
                            {rows.length - index}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap", fontWeight: 600 }}>
                            {time}
                          </TableCell>
                          {Array.from({ length: columnCount }, (_, valueIndex) => {
                            const value = values[valueIndex];
                            return (
                              <TableCell align="center" key={valueIndex}>
                                {value === undefined ? (
                                  "-"
                                ) : (
                                  <Chip
                                    label={formatValue(value)}
                                    color={valueColor(value)}
                                    size="small"
                                    sx={{ minWidth: 72, fontWeight: 700 }}
                                  />
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
