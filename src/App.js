import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

// --- EINSTELLUNGEN DES SCHALLPEGELMESSERS (Konstanten unverändert) ---
const MAX_DB_DISPLAY = 120;
const MIN_DB_DISPLAY = 0;
const DBFS_OFFSET = MAX_DB_DISPLAY;
const CALIBRATION_OFFSET_DEFAULT = 3.0;
const SMOOTHING_FACTOR = 0.9;
const RMS_WINDOW_SIZE = 2048;
const INITIAL_ALARM_DELAY_MS = 200;
const ALARM_DURATION_MS = 2000;
const INITIAL_WARNING_DB = 75;
const UI_UPDATE_INTERVAL_MS = 100;

// --- HILFSFUNKTIONEN (Unverändert) ---
const calculateDb = (rms, calibrationOffset, dbfsOffset) => {
  if (rms <= 0) return MIN_DB_DISPLAY + calibrationOffset;
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
  const [alarmDelayMsInput, setAlarmDelayMsInput] = useState(
    INITIAL_ALARM_DELAY_MS.toString()
  );

  const [currentDb, setCurrentDb] = useState(0.0);
  const [isLoud, setIsLoud] = useState(false); // Steuert Alarm-Anzeige

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
  const currentAlarmDelayRef = useRef(INITIAL_ALARM_DELAY_MS);

  // Alarm-Audio
  const airhorn = useRef(null);
  const alarmTriggered = useRef(false); // Ist der Alarm-Ton gerade aktiv
  const alarmTimeoutRef = useRef(null);

  // --- ALARM-LOGIK ---

  const resetAlarm = useCallback(() => {
    // Stoppt den optischen Alarm und den Ton
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

    // **KORREKTUR:** Setze isLoud auf true (optische Anzeige)
    setIsLoud(true);

    alarmTriggered.current = true;
    if (airhorn.current) {
      airhorn.current.currentTime = 0;
      airhorn.current
        .play()
        .catch((e) => console.error("Fehler beim Abspielen des Tons:", e));
    }

    // Setze den Timeout, um den Alarm nach ALARM_DURATION_MS zurückzusetzen
    // (Dies ist nur für den Ton/die temporäre Anzeige gedacht)
    alarmTimeoutRef.current = setTimeout(() => {
      // **KORREKTUR:** Führe nur den optischen Reset durch, wenn der Pegel nicht mehr hoch ist.
      // Der Audio-Loop kümmert sich um den Reset, aber hier stellen wir sicher, dass der Ton stoppt.
      if (airhorn.current) {
        airhorn.current.pause();
        airhorn.current.currentTime = 0;
      }
      alarmTriggered.current = false; // Ton ist beendet
      // Die optische Anzeige (isLoud) wird durch den Audio-Loop gesteuert.
    }, ALARM_DURATION_MS);
  }, []);

  // --- AUDIO-VERARBEITUNG: HAUPT-LOOP (RAF-basiert) ---

  const processAudio = useCallback(() => {
    const analyser = analyserRef.current;
    const dataArray = audioDataArrayRef.current;
    if (!analyser || !dataArray) {
      animationFrameRef.current = requestAnimationFrame(processAudio);
      return;
    }

    // ... RMS Berechnung ...
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

    // Alarm-Logik und **KORREKTUR DER RÜCKSETZUNG**
    const volumeThreshold = currentWarningRms.current;
    const now = performance.now();
    const delta = now - lastTimeCheck.current;
    lastTimeCheck.current = now;

    const currentDbValue = currentSmoothedDb.current;

    if (rms >= volumeThreshold) {
      // 1. Überschreitung: Zähler hochzählen und Alarm auslösen
      loudnessDuration.current += delta;

      if (loudnessDuration.current >= currentAlarmDelayRef.current) {
        setWarning();
        // Wenn der Alarm ausgelöst wurde, halten Sie die Anzeige solange, bis der RMS wieder fällt
      }

      // **KORREKTUR:** UI-Anzeige (rot) bleibt an, solange der Pegel über dem Schwellwert ist
      // Hier verwenden wir den geglätteten dB-Wert für eine glattere UI-Schaltung
      if (currentDbValue >= Number(getThresholdDb())) {
        setIsLoud(true);
      }
    } else {
      // 2. Unterschreitung:
      loudnessDuration.current = 0; // Zähler zurücksetzen

      // **KORREKTUR:** Wenn die Lautstärke wieder unter den Schwellenwert fällt, muss der optische Alarm sofort aus.
      if (!alarmTriggered.current) {
        setIsLoud(false);
      }

      // Wenn der Ton läuft (alarmTriggered.current ist true), beendet der Timeout den Ton,
      // aber setIsLoud wurde bereits auf false gesetzt oder wird beim nächsten Unterschreiten gesetzt.
      // Das sofortige Zurücksetzen von setIsLoud(false) ist der Schlüssel für die UI-Reaktion.
    }

    animationFrameRef.current = requestAnimationFrame(processAudio);
  }, [calibrationOffset, setWarning]);

  // --- UI-AKTUALISIERUNGS-LOOP (Niedrigfrequent, setInterval-basiert) ---
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Aktualisiert den Zeiger und die dB-Zahl mit dem geglätteten Wert
      setCurrentDb(currentSmoothedDb.current);
    }, UI_UPDATE_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);

  // --- INITIALISIERUNG und SYNCHRONISIERUNG (Unverändert, nur Code gekürzt) ---

  useEffect(() => {
    airhorn.current = new Audio("/airhorn.mp3");
    airhorn.current.loop = false;

    const cleanup = async () => {
      /* ... cleanup logic ... */
    };

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

  useEffect(() => {
    const db = Number(warningDbInput);
    const delay = Math.round(Number(alarmDelayMsInput) * 1000);

    if (!isNaN(db) && db >= MIN_DB_DISPLAY && db <= MAX_DB_DISPLAY) {
      currentWarningRms.current = dbToRms(db, calibrationOffset, DBFS_OFFSET);
    }

    if (!isNaN(delay) && delay >= 0) {
      currentAlarmDelayRef.current = delay;
    }
  }, [warningDbInput, calibrationOffset, alarmDelayMsInput]);

  // --- HELPER UND HANDLER (Unverändert) ---

  const handleDbInputChange = (e) => {
    const value = e.target.value;
    const db = Number(value);
    setWarningDbInput(value);

    if (!isNaN(db)) {
      const limitedDb = Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, db));
      setWarningDbInput(limitedDb.toFixed(0));
    }
  };

  const handleDelayInputChange = (e) => {
    const value = e.target.value;
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
        {/* ... Gauge Visualisierung (unverändert) ... */}
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

          <div className="gauge-scale">
            <div
              className="gauge-tick-line min-tick"
              style={{ transform: "rotate(-120deg)" }}
            ></div>
            <div
              className="gauge-tick-line max-tick"
              style={{ transform: "rotate(120deg)" }}
            ></div>

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
