import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

// --- EINSTELLUNGEN DES SCHALLPEGELMESSERS ---
const MAX_DB_DISPLAY = 120;
const MIN_DB_DISPLAY = 0;
const DBFS_OFFSET = MAX_DB_DISPLAY;
const CALIBRATION_OFFSET_DEFAULT = 3.0; // Kalibrierung (muss oft angepasst werden)

// Zeitkonstanten
const SMOOTHING_FACTOR = 0.9; // Starker Glättungsfaktor für einen "ruhigen" Zeiger
const RMS_WINDOW_SIZE = 2048; // Buffer-Größe für die RMS-Berechnung

// Alarm-Logik (Unverändert übernommen)
const ALARM_DELAY_MS = 50;
const ALARM_DURATION_MS = 2000;
const INITIAL_WARNING_DB = 75;

// --- HILFSFUNKTIONEN ---

// 1. Konvertierung von RMS (0-1) zu dB SPL
const calculateDb = (rms, calibrationOffset, dbfsOffset) => {
  if (rms <= 0) {
    // Grundrauschpegel
    return MIN_DB_DISPLAY + calibrationOffset;
  }
  // dBFS = 20 * log10(RMS)
  const dbfs = 20 * Math.log10(rms);

  // dbSPL = dbFS + DBFS_OFFSET + KALIBRIERUNG
  let dbSPL = dbfs + dbfsOffset + calibrationOffset;

  return Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, dbSPL));
};

// 2. Konvertierung von dB SPL zu RMS (0-1) für den Schwellenwert
const dbToRms = (db, calibrationOffset, dbfsOffset) => {
  const dbfs = db - dbfsOffset - calibrationOffset;
  let rms = Math.pow(10, dbfs / 20);

  // Begrenzung auf einen realistischen Bereich
  return Math.min(1.0, Math.max(0.000001, rms));
};

// 3. Gauge-Hilfsfunktion: dB-Wert in Rotationswinkel umrechnen
const getNeedleRotation = (dbValue) => {
  // Bereich: 0 dB bis 120 dB (Gesamtbereich 120 dB)
  // Zeigerrotation: Start bei -120 Grad (links) bis +120 Grad (rechts) (Gesamtbereich 240 Grad)

  const limitedDb = Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, dbValue));

  // Skalierungsfaktor: 240 Grad / 120 dB = 2 Grad pro dB
  // Rotation = (dB * 2) - 120 (Offset, um bei 0 dB links zu starten)
  const rotation = limitedDb * 2 - 120;

  return rotation;
};

const Meter = () => {
  const [calibrationOffset, setCalibrationOffset] = useState(
    CALIBRATION_OFFSET_DEFAULT
  );
  const [warningDbInput, setWarningDbInput] = useState(
    INITIAL_WARNING_DB.toFixed(0)
  );
  const [currentDb, setCurrentDb] = useState(0.0);
  const [isLoud, setIsLoud] = useState(false);

  // Audio-Refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const audioDataArrayRef = useRef(null);

  // Glättung und Alarm
  const currentSmoothedDb = useRef(0.0);
  const loudnessDuration = useRef(0);
  const lastTimeCheck = useRef(performance.now());
  const currentWarningRms = useRef(
    dbToRms(INITIAL_WARNING_DB, CALIBRATION_OFFSET_DEFAULT, DBFS_OFFSET)
  );

  // Alarm-Audio
  const airhorn = useRef(null);
  const alarmTriggered = useRef(false);
  const alarmTimeoutRef = useRef(null);

  // --- ALARM-LOGIK (UNVERÄNDERT) ---
  const resetAlarm = useCallback(() => {
    setIsLoud(false);
    if (airhorn.current) {
      airhorn.current.pause();
      airhorn.current.currentTime = 0;
    }
    alarmTriggered.current = false;
    if (alarmTimeoutRef.current) {
      clearTimeout(alarmTimeoutRef.current);
      alarmTimeoutRef.current = null;
    }
  }, []);

  const setWarning = useCallback(() => {
    if (alarmTriggered.current) return;

    alarmTriggered.current = true;
    setIsLoud(true);
    // ... Ton abspielen ...

    alarmTimeoutRef.current = setTimeout(() => {
      resetAlarm();
    }, ALARM_DURATION_MS);
  }, [resetAlarm]);

  // --- AUDIO-VERARBEITUNG: HAUPT-LOOP ---

  const processAudio = useCallback(() => {
    const analyser = analyserRef.current;
    const dataArray = audioDataArrayRef.current;

    if (!analyser || !dataArray) {
      animationFrameRef.current = requestAnimationFrame(processAudio);
      return;
    }

    // 1. Daten holen und RMS berechnen (höhere Präzision durch Float32Array)
    analyser.getFloatTimeDomainData(dataArray);
    let sumOfSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sumOfSquares += dataArray[i] * dataArray[i];
    }
    let rms = Math.sqrt(sumOfSquares / dataArray.length);

    // 2. Konvertierung in dB
    const db = calculateDb(rms, calibrationOffset, DBFS_OFFSET);

    // 3. Glättung des dB-Wertes (Smoothing)
    currentSmoothedDb.current =
      SMOOTHING_FACTOR * currentSmoothedDb.current +
      (1 - SMOOTHING_FACTOR) * db;

    // 4. Alarm-Logik (Vergleich mit dem RMS-Schwellenwert)
    const volumeThreshold = currentWarningRms.current;
    const now = performance.now();
    const delta = now - lastTimeCheck.current;
    lastTimeCheck.current = now;

    if (!alarmTriggered.current) {
      if (rms >= volumeThreshold) {
        loudnessDuration.current += delta;
        if (loudnessDuration.current >= ALARM_DELAY_MS) {
          setWarning();
          loudnessDuration.current = 0;
        }
      } else {
        loudnessDuration.current = 0;
      }
    }

    // 5. Aktualisierung des Haupt-dB-Wertes (glatter Wert)
    // Dient als Trigger für das React-Rendering und die Zeigerbewegung
    setCurrentDb(currentSmoothedDb.current);

    // Nächsten Frame anfordern
    animationFrameRef.current = requestAnimationFrame(processAudio);
  }, [calibrationOffset, setWarning]);

  // --- INITIALISIERUNG UND CLEANUP (UNVERÄNDERT) ---

  const getMedia = useCallback(async () => {
    // ... (Logik zum Starten von AudioContext und Analyser) ...
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyserRef.current = analyser;

      const microphone = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 4096;
      audioDataArrayRef.current = new Float32Array(RMS_WINDOW_SIZE);

      microphone.connect(analyser);
      analyser.connect(audioContext.destination);

      processAudio();
    } catch (err) {
      console.error("Fehler beim Zugriff auf das Mikrofon:", err);
      alert("Fehler beim Mikrofonzugriff. Bitte Berechtigung erteilen.");
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        audioContextRef.current
          .close()
          .catch((e) => console.error("Close Error:", e));
      }
    };
  }, [processAudio]);

  useEffect(() => {
    airhorn.current = new Audio("/airhorn.mp3");
    airhorn.current.loop = false;

    const cleanup = getMedia();
    return cleanup;
  }, [getMedia]);

  // Synchronisiert den RMS-Schwellenwert bei Änderung der Kalibrierung oder des dB-Inputs
  useEffect(() => {
    const db = Number(warningDbInput);
    if (!isNaN(db)) {
      currentWarningRms.current = dbToRms(db, calibrationOffset, DBFS_OFFSET);
    }
  }, [warningDbInput, calibrationOffset]);

  // --- HELPER UND HANDLER ---

  const handleDbInputChange = (e) => {
    const value = e.target.value;
    const db = Number(value);
    setWarningDbInput(value);

    // Aktualisiere Schwellenwert direkt (für die UI-Anzeige)
    if (!isNaN(db)) {
      const limitedDb = Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, db));
      setWarningDbInput(limitedDb.toFixed(0)); // Sichert die Anzeige
    }
  };

  const getThresholdDb = () => {
    const db = Number(warningDbInput);
    if (isNaN(db)) return INITIAL_WARNING_DB.toFixed(1);

    const limitedDb = Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, db));
    return limitedDb.toFixed(1);
  };

  return (
    <div className="meter-container-wrapper">
      <div className="gauge-panel">
        <div className="gauge-outer">
          {/* Zeiger des Messinstruments */}
          <div
            className={`gauge-needle ${isLoud ? "loud" : ""}`}
            style={{
              transform: `translate(-50%, -100%) rotate(${getNeedleRotation(
                currentDb
              )}deg)`,
            }}
          ></div>

          {/* Skala mit statischen Markierungen und Schwellenwert-Markierung */}
          <div className="gauge-scale">
            <div
              className="gauge-tick-line min-tick"
              style={{ transform: "rotate(-120deg)" }}
            ></div>
            <div
              className="gauge-tick-line max-tick"
              style={{ transform: "rotate(120deg)" }}
            ></div>

            {/* Schwellenwert-Markierung */}
            <div
              className="gauge-threshold-mark"
              style={{
                transform: `rotate(${getNeedleRotation(
                  Number(getThresholdDb())
                )}deg)`,
              }}
            ></div>
            <div className="gauge-center-dot"></div>
          </div>

          {/* Anzeigen des dB-Wertes */}
          <div className="gauge-label min-label">{MIN_DB_DISPLAY} dB</div>
          <div className="gauge-label max-label">{MAX_DB_DISPLAY} dB</div>
          <div className="gauge-reading-display">
            <strong className={`current-db ${isLoud ? "loud-text" : ""}`}>
              {currentDb.toFixed(1)}
            </strong>
            <span className="current-db-unit">dB</span>
          </div>

          {isLoud && (
            <div className="alarm-message-overlay">⚠️ ZU LAUT! ⚠️</div>
          )}
        </div>
      </div>

      <div className="control-panel">
        <h3 className="panel-title">Einstellungen ⚙️</h3>

        <p className="threshold-info">
          Aktuelle Warnschwelle: <strong>{getThresholdDb()} dB</strong>
        </p>

        <div className="db-input-group">
          <label htmlFor="threshold-db-input">Grenzwert-Schwelle (dB):</label>
          <input
            id="threshold-db-input"
            type="number"
            min={MIN_DB_DISPLAY.toFixed(0)}
            max={MAX_DB_DISPLAY.toFixed(0)}
            step="1"
            value={warningDbInput}
            onChange={handleDbInputChange}
            className="db-input"
          />
        </div>

        <div className="db-input-group">
          <label htmlFor="calibration-input">Kalibrierung (Offset dB):</label>
          <input
            id="calibration-input"
            type="number"
            min="-20.0"
            max="20.0"
            step="0.1"
            value={calibrationOffset.toFixed(1)}
            onChange={(e) => setCalibrationOffset(Number(e.target.value))}
            className="db-input"
          />
        </div>

        <p className="debug-info">
          (Interner RMS-Schwellwert: {currentWarningRms.current.toFixed(5)})
        </p>
      </div>
    </div>
  );
};

export default () => {
  return (
    <div className="App">
      <Meter />
    </div>
  );
};
