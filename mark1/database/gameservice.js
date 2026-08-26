// gameservice.js
import db from "./firebaseConfig";
import {
  doc,
  setDoc,
  updateDoc,
  arrayUnion,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";

export const saveRound = async (dateStr, fullData) => {
  //const dateId = getTodayDateId();
  const docRef = doc(db, "Bio_sic", dateStr);
  const snap = await getDoc(docRef);
  const currentTime = Object.keys(fullData[0])[0];

  // await updateDoc(docRef, {
  //   [currentTime]: fullData, // ONLY current data
  // });
  if (snap.exists()) {
    await updateDoc(docRef, {
      [currentTime]: fullData,
    });
    console.log("Document updated");
  } else {
    await setDoc(docRef, {
      [currentTime]: fullData,
    });
    console.log("Document created");
  }

  // const docRef = doc(db, "Game", dateStr);
  // const snap = await getDoc(docRef);
  // const restartId = Date.now();
  // // 🆕 CASE 1: Date doc NOT exists → create
  // if (!snap.exists()) {
  //   await setDoc(docRef, {
  //     round1: [{ time, val }],
  //     meta: {
  //       currentRound: 1,
  //       lastRestartId: restartId,
  //       startedAt: serverTimestamp(),
  //     },
  //   });
  //   console.log("🆕 Date doc created with round1");
  //   return;
  // }
  // // 📄 CASE 2: Date doc EXISTS
  // const data = snap.data();
  // const meta = data.meta || {};
  // let currentRound = meta.currentRound || 1;
  // // 🔁 CASE 2A: Server restarted → create NEW round
  // if (meta.lastRestartId !== restartId) {
  //   currentRound += 1;
  //   await setDoc(
  //     docRef,
  //     {
  //       [`round${currentRound}`]: [{ fullData }],
  //       meta: {
  //         currentRound,
  //         lastRestartId: restartId,
  //         restartedAt: serverTimestamp(),
  //       },
  //     },
  //     { merge: true }
  //   );
  //   console.log(`🔁 New round${currentRound} created`);
  //   return;
  // }
  // // ➕ CASE 2B: Same server → append to CURRENT round
  // await updateDoc(docRef, {
  //   [`round${currentRound}`]: arrayUnion({ fullData }),
  //   "meta.updatedAt": serverTimestamp(),
  // });
  // console.log(`➕ Data added to round${currentRound}`);
};
