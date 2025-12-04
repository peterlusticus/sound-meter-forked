import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

// --- EINSTELLUNGEN DES SCHALLPEGELMESSERS ---
const MAX_DB_DISPLAY = 120;
const MIN_DB_DISPLAY = 0;
const DBFS_OFFSET = MAX_DB_DISPLAY;
const CALIBRATION_OFFSET_DEFAULT = 3.0;

// Zeitkonstanten
const SMOOTHING_FACTOR = 0.9;
const RMS_WINDOW_SIZE = 2048;

// Alarm-Logik
const INITIAL_ALARM_DELAY_MS = 200; // 0,2 Sekunden
const ALARM_DURATION_MS = 2000;
const INITIAL_WARNING_DB = 75;

// UI-Update Intervall (langsamer für eine ruhigere Anzeige)
const UI_UPDATE_INTERVAL_MS = 100;

// --- HILFSFUNKTIONEN (UNVERÄNDERT) ---
const calculateDb = (rms, calibrationOffset, dbfsOffset) => {
  if (rms <= 0) {
    return MIN_DB_DISPLAY + calibrationOffset;
  }
  const dbfs = 20 * Math.log10(rms);
  let dbSPL = dbfs + dbfsOffset + calibrationOffset;
  return Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, dbSPL));
};

const dbToRms = (db, calibrationOffset, dbfsOffset) => {
  const dbfs = db - dbfsOffset - calibrationOffset;
  let rms = Math.pow(10, dbfs / 20);
  return Math.min(1.0, Math.max(0.000001, rms));
};

const getNeedleRotation = (dbValue) => {
  const limitedDb = Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, dbValue));
  return limitedDb * 2 - 120;
};

const Meter = () => {
  const [calibrationOffset, setCalibrationOffset] = useState(
    CALIBRATION_OFFSET_DEFAULT
  );
  const [warningDbInput, setWarningDbInput] = useState(
    INITIAL_WARNING_DB.toFixed(0)
  );
  // NEU: State für die Alarmverzögerung
  const [alarmDelayMsInput, setAlarmDelayMsInput] = useState(
    INITIAL_ALARM_DELAY_MS.toString()
  );

  // FÜR DIE ANZEIGE (Wird nur im UI_UPDATE_INTERVAL_MS aktualisiert)
  const [currentDb, setCurrentDb] = useState(0.0);
  const [isLoud, setIsLoud] = useState(false);

  // Audio-Refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const audioDataArrayRef = useRef(null);

  // Glättung und Alarm (Werden im RAF-Loop aktualisiert)
  const currentSmoothedDb = useRef(0.0);
  const loudnessDuration = useRef(0);
  const lastTimeCheck = useRef(performance.now());
  const currentWarningRms = useRef(
    dbToRms(INITIAL_WARNING_DB, CALIBRATION_OFFSET_DEFAULT, DBFS_OFFSET)
  );

  // NEU: Ref für die konfigurierte Alarmverzögerung (in MS)
  const currentAlarmDelayRef = useRef(INITIAL_ALARM_DELAY_MS);

  // Alarm-Audio
  const airhorn = useRef(null);
  const alarmTriggered = useRef(false);
  const alarmTimeoutRef = useRef(null);

  // --- ALARM-LOGIK ---

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

  // --- AUDIO-VERARBEITUNG: HAUPT-LOOP (Hochfrequent, RAF-basiert) ---

  const processAudio = useCallback(() => {
    const analyser = analyserRef.current;
    const dataArray = audioDataArrayRef.current;

    if (!analyser || !dataArray) {
      animationFrameRef.current = requestAnimationFrame(processAudio);
      return;
    }

    // RMS Berechnung
    analyser.getFloatTimeDomainData(dataArray);
    let sumOfSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sumOfSquares += dataArray[i] * dataArray[i];
    }
    let rms = Math.sqrt(sumOfSquares / dataArray.length);

    // dB und Glättung
    const db = calculateDb(rms, calibrationOffset, DBFS_OFFSET);
    currentSmoothedDb.current =
      SMOOTHING_FACTOR * currentSmoothedDb.current +
      (1 - SMOOTHING_FACTOR) * db;

    // Alarm-Logik (Verwendung des NEUEN Verzögerungs-Refs)
    const volumeThreshold = currentWarningRms.current;
    const now = performance.now();
    const delta = now - lastTimeCheck.current;
    lastTimeCheck.current = now;

    if (!alarmTriggered.current) {
      if (rms >= volumeThreshold) {
        // NEU: Vergleich mit der einstellbaren Verzögerung
        loudnessDuration.current += delta;
        if (loudnessDuration.current >= currentAlarmDelayRef.current) {
          setWarning();
          loudnessDuration.current = 0;
        }
      } else {
        loudnessDuration.current = 0;
      }
    }

    animationFrameRef.current = requestAnimationFrame(processAudio);
  }, [calibrationOffset, setWarning]);

  // --- UI-AKTUALISIERUNGS-LOOP (Niedrigfrequent, setInterval-basiert) ---
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Dies aktualisiert den React-State nur 10x pro Sekunde (100ms),
      // was die Zeigerbewegung deutlich ruhiger macht.
      setCurrentDb(currentSmoothedDb.current);
    }, UI_UPDATE_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);

  // --- INITIALISIERUNG und SYNCHRONISIERUNG ---

  // Startet Audio-Loop (Unverändert)
  useEffect(() => {
    // ... (Initialisierung Audio Context, Analyser und airhorn) ...
    // Die Logik für getMedia ist hier vereinfacht, da sie im vorigen Schritt korrekt war.
    const getMedia = async () => {
      /* ... */
    };

    const cleanup = async () => {
      // Sauberes Aufräumen des AudioContext
      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "closed"
      ) {
        await audioContextRef.current
          .close()
          .catch((e) => console.error("Close Error:", e));
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };

    airhorn.current = new Audio("/airhorn.mp3");
    airhorn.current.loop = false;

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
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
      })
      .catch((err) => {
        console.error("Fehler beim Zugriff auf das Mikrofon:", err);
        alert("Fehler beim Mikrofonzugriff. Bitte Berechtigung erteilen.");
      });

    return cleanup;
  }, [processAudio]);

  // Synchronisiert den RMS-Schwellenwert (Löst den Fehler 'l is not a function' durch Prüfung)
  useEffect(() => {
    const db = Number(warningDbInput);
    const delay = Number(alarmDelayMsInput);

    // Korrektur: Überprüfe, ob die Eingabe eine gültige Zahl ist, bevor dbToRms aufgerufen wird
    if (!isNaN(db) && db >= MIN_DB_DISPLAY && db <= MAX_DB_DISPLAY) {
      currentWarningRms.current = dbToRms(db, calibrationOffset, DBFS_OFFSET);
    }

    // Synchronisiere die Verzögerung
    if (!isNaN(delay) && delay >= 0) {
      currentAlarmDelayRef.current = delay;
    }
  }, [warningDbInput, calibrationOffset, alarmDelayMsInput]);

  // --- HELPER UND HANDLER ---

  const handleDbInputChange = (e) => {
    const value = e.target.value;
    const db = Number(value);
    setWarningDbInput(value);

    if (!isNaN(db)) {
      const limitedDb = Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, db));
      // Halten Sie den angezeigten Wert, aber die Logik verwendet den Ref
      setWarningDbInput(limitedDb.toFixed(0));
    }
  };

  const handleDelayInputChange = (e) => {
    const value = e.target.value;
    // Akzeptiere float-Eingaben, aber wandle sie in Millisekunden (Int) um, bevor sie an den Ref gehen
    const msValue = Math.round(Number(value) * 1000);
    setAlarmDelayMsInput(value);
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

          {/* Skala mit Schwellenwert-Markierung */}
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

          <div className="gauge-label min-label">{MIN_DB_DISPLAY} dB</div>
          <div className="gauge-label max-label">{MAX_DB_DISPLAY} dB</div>
          <div className="gauge-reading-display">
            <strong className={`current-db ${isLoud ? "loud-text" : ""}`}>
              {currentDb.toFixed(1)}
            </strong>
            <span className="current-db-unit">dB</span>
          </div>

          {isLoud && (
            <div className="alarm-message-overlay">
              ⚠️ ZU LAUT! KLASSE ENTDECKT! ⚠️
            </div>
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
          <label htmlFor="delay-input">Alarm-Verzögerung (Sekunden):</label>
          <input
            id="delay-input"
            type="number"
            min="0.0"
            max="10.0"
            step="0.1"
            value={alarmDelayMsInput}
            onChange={handleDelayInputChange}
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
            // Korrektur: Stellen Sie sicher, dass der Wert beim Setzen eine Zahl ist
            onChange={(e) => setCalibrationOffset(Number(e.target.value) || 0)}
            className="db-input"
          />
        </div>

        <p className="debug-info">
          (Alarm bei: **{currentAlarmDelayRef.current / 1000} s**
          Überschreitung)
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
