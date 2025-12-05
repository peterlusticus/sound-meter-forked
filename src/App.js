import React, { useEffect, useRef, useState, useCallback } from "react";

// --- KONSTANTEN ---
const MAX_DB_DISPLAY = 120;
const MIN_DB_DISPLAY = 0;
const DBFS_OFFSET = MAX_DB_DISPLAY;
const CALIBRATION_OFFSET_DEFAULT = 3.0;
const SMOOTHING_FACTOR = 0.9;
const RMS_WINDOW_SIZE = 2048;
const INITIAL_ALARM_DELAY_MS = 2000; // 2000 Millisekunden (2 Sekunden)
const ALARM_DURATION_MS = 2000;
const INITIAL_WARNING_DB = 75;
const UI_UPDATE_INTERVAL_MS = 100;

// --- HILFSFUNKTIONEN ---

// Berechnet den Dezibel-Wert (dB SPL) aus dem RMS-Wert
const calculateDb = (rms, calibrationOffset, dbfsOffset) => {
  if (rms <= 0) return MIN_DB_DISPLAY + calibrationOffset;
  const dbfs = 20 * Math.log10(rms);
  let dbSPL = dbfs + dbfsOffset + calibrationOffset;
  return Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, dbSPL));
};

// Konvertiert den dB-Wert zurück in den RMS-Wert (für den Schwellenwert)
const dbToRms = (db, calibrationOffset, dbfsOffset) => {
  const dbfs = db - dbfsOffset - calibrationOffset;
  let rms = Math.pow(10, dbfs / 20);
  return Math.min(1.0, Math.max(0.000001, rms));
};

const SoundLevelMeter = () => {
  // --- UI-STATES ---
  const [calibrationOffset, setCalibrationOffset] = useState(
    CALIBRATION_OFFSET_DEFAULT
  );
  const [warningDbInput, setWarningDbInput] = useState(
    INITIAL_WARNING_DB.toFixed(0)
  );
  const [alarmDelayMsInput, setAlarmDelayMsInput] = useState(
    (INITIAL_ALARM_DELAY_MS / 1000).toString() // Eingabe in Sekunden (UI)
  );
  const [currentDb, setCurrentDb] = useState(0.0);
  const [isLoud, setIsLoud] = useState(false); // Steuert Alarm-Anzeige
  const [microphoneError, setMicrophoneError] = useState(false); // Für Fehlermeldungen

  // --- REFS FÜR AUDIO-VERARBEITUNG UND TIMING ---
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const audioDataArrayRef = useRef(null);

  // Glättung und Alarm (Werden im RAF-Loop aktualisiert)
  const currentSmoothedDb = useRef(0.0);
  const loudnessDuration = useRef(0); // Akkumuliert die Zeit über dem Schwellwert (in MS)
  const lastTimeCheck = useRef(performance.now());
  const currentWarningRms = useRef(
    dbToRms(INITIAL_WARNING_DB, CALIBRATION_OFFSET_DEFAULT, DBFS_OFFSET)
  );
  // Speichert die Alarmverzögerung in Millisekunden (interne Einheit)
  const currentAlarmDelayRef = useRef(INITIAL_ALARM_DELAY_MS);

  // Alarm-Audio
  const alarmTriggered = useRef(false); // Ist der Alarm-Ton gerade aktiv
  const alarmTimeoutRef = useRef(null);

  // --- ALARM-LOGIK ---

  const resetAlarm = useCallback(() => {
    // Stoppt den optischen Alarm
    setIsLoud(false);
    alarmTriggered.current = false;
    if (alarmTimeoutRef.current) {
      clearTimeout(alarmTimeoutRef.current);
      alarmTimeoutRef.current = null;
    }
  }, []);

  const setWarning = useCallback(() => {
    if (alarmTriggered.current) return;

    // Setze isLoud auf true (optische Anzeige), nur wenn die Verzögerung abgelaufen ist
    setIsLoud(true);
    alarmTriggered.current = true;

    // Setze den Timeout, um den Alarm nach ALARM_DURATION_MS zurückzusetzen
    alarmTimeoutRef.current = setTimeout(() => {
      alarmTriggered.current = false; // Ton ist beendet
      // Die optische Anzeige wird durch den processAudio Loop (else block) gesteuert
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

    // Alarm-Logik
    const volumeThreshold = currentWarningRms.current;
    const now = performance.now();
    const delta = now - lastTimeCheck.current; // Zeit seit letztem Frame in MS
    lastTimeCheck.current = now;

    if (rms >= volumeThreshold) {
      // 1. Überschreitung: Zähler hochzählen
      loudnessDuration.current += delta;

      // Alarm nur auslösen, wenn die Dauer die Verzögerung überschreitet.
      if (loudnessDuration.current >= currentAlarmDelayRef.current) {
        setWarning();
      }
      
    } else {
      // 2. Unterschreitung:
      loudnessDuration.current = 0; // Zähler zurücksetzen

      // Optische Anzeige ausschalten, aber nur, wenn kein Audio-Alarm läuft
      if (!alarmTriggered.current) {
        setIsLoud(false);
      }
    }

    animationFrameRef.current = requestAnimationFrame(processAudio);
  }, [calibrationOffset, setWarning]);

  // --- UI-AKTUALISIERUNGS-LOOP (Niedrigfrequent, setInterval-basiert) ---
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Aktualisiert die dB-Zahl mit dem geglätteten Wert
      setCurrentDb(currentSmoothedDb.current);
    }, UI_UPDATE_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);

  // --- INITIALISIERUNG und SYNCHRONISIERUNG ---

  useEffect(() => {
    // Initialisierung des AudioContexts und Mikrofonzugriffs
    
    // Cleanup-Funktion zum Beenden des Streams und des AudioContexts
    const cleanup = async () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
          // Stoppt alle Audioquellen, bevor der Context geschlossen wird
          const stream = audioContextRef.current.getSources().find(source => source.mediaStream);
          if (stream) {
              stream.mediaStream.getTracks().forEach(track => track.stop());
          }
          await audioContextRef.current.close();
        } catch (e) {
          console.error("Fehler beim Schließen des AudioContext:", e);
        }
      }
      resetAlarm();
    };

    // Mikrofonzugriff anfordern
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        setMicrophoneError(false); // Reset Fehlerzustand
        const audioContext = new (window.AudioContext ||
          window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        const analyser = audioContext.createAnalyser();
        analyserRef.current = analyser;
        const microphone = audioContext.createMediaStreamSource(stream);

        analyser.fftSize = 4096;
        audioDataArrayRef.current = new Float32Array(RMS_WINDOW_SIZE);

        microphone.connect(analyser);

        // Starte den Audio-Verarbeitungs-Loop
        processAudio();
      })
      .catch((err) => {
        console.error("Fehler beim Zugriff auf das Mikrofon:", err);
        setMicrophoneError(true); // Setze Fehlerzustand für UI-Anzeige
      });

    return cleanup;
  }, [processAudio, resetAlarm]);

  // Synchronisiert die Eingabewerte mit den Audio-Refs (Umrechnung Sek -> MS)
  useEffect(() => {
    const db = Number(warningDbInput);
    // Alarm-Verzögerung wird in Sekunden aus dem Input gelesen
    const delaySeconds = Number(alarmDelayMsInput); 
    // Umrechnung von Sekunden in Millisekunden für die interne Logik
    const delayMs = Math.round(delaySeconds * 1000); 

    if (!isNaN(db) && db >= MIN_DB_DISPLAY && db <= MAX_DB_DISPLAY) {
      currentWarningRms.current = dbToRms(db, calibrationOffset, DBFS_OFFSET);
    }

    // Setze die Verzögerung in Millisekunden
    if (!isNaN(delayMs) && delayMs >= 0) {
      currentAlarmDelayRef.current = delayMs;
    }
  }, [warningDbInput, calibrationOffset, alarmDelayMsInput]);

  // --- HELPER UND HANDLER ---

  // Gibt den aktuell gültigen Schwellenwert zurück (bereinigt)
  const getThresholdDb = () => {
    const db = Number(warningDbInput);
    if (isNaN(db)) return INITIAL_WARNING_DB.toFixed(1);

    const limitedDb = Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, db));
    return limitedDb.toFixed(1);
  };

  const handleDbInputChange = (e) => {
    const value = e.target.value;
    const db = Number(value);
    setWarningDbInput(value);

    // Limitierung auf den gültigen dB-Bereich
    if (!isNaN(db)) {
      const limitedDb = Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, db));
      setWarningDbInput(limitedDb.toFixed(0));
    }
  };

  const handleDelayInputChange = (e) => {
    const value = e.target.value;
    setAlarmDelayMsInput(value);
  };
  
  // Berechnet die Füllhöhe der Balkenanzeige (0% bis 100%)
  const getBarFillPercentage = (dbValue) => {
    const min = MIN_DB_DISPLAY;
    const max = MAX_DB_DISPLAY;
    // Skaliert den dB-Wert auf den Bereich 0-100
    const limitedDb = Math.min(max, Math.max(min, dbValue));
    return ((limitedDb - min) / (max - min)) * 100;
  };

  const barHeight = getBarFillPercentage(currentDb);
  const thresholdDb = Number(getThresholdDb());
  const thresholdPercent = getBarFillPercentage(thresholdDb);
  
  // Wählt die Farbe basierend auf dem Pegel relativ zum Schwellenwert
  const barColor = currentDb >= thresholdDb ? 'bg-red-500' : 
                   currentDb >= 60 ? 'bg-yellow-500' : 
                   'bg-green-500';

  // --- RENDERING ---

  return (
    // 'loud-background-pulse' ist in styles.css definiert
    <div className={`p-4 sm:p-8 bg-gray-50 min-h-screen flex flex-col items-center justify-center font-sans ${isLoud ? 'loud-background-pulse' : ''}`}>
      <div className="max-w-4xl w-full flex flex-col lg:flex-row gap-8">
        
        {/* Haupt-Anzeige: Balken und dB-Wert */}
        <div className={`flex-1 flex flex-col items-center p-6 rounded-xl shadow-2xl bg-white border-4 ${isLoud ? 'border-red-600' : 'border-gray-200'}`}>
          <h1 className="text-3xl font-extrabold mb-4 text-gray-800">
            Schallpegel-Monitor (dB)
          </h1>
          
          {microphoneError && (
              <div className="p-4 bg-red-100 text-red-700 rounded-lg mb-6 border border-red-300 w-full text-center">
                  ⚠️ Fehler beim Mikrofonzugriff. Bitte Berechtigung erteilen.
              </div>
          )}

          {/* Der vertikale Balken-Meter. 'v-bar-meter-container', 'v-bar-threshold-line', und 'v-bar-fill' sind in styles.css definiert. */}
          <div className="v-bar-meter-container">
            {/* Schwellenwert-Linie */}
            <div 
              className="v-bar-threshold-line" 
              style={{ bottom: `${thresholdPercent}%` }}
              title={`Schwellwert: ${thresholdDb} dB`}
            >
              <span className="text-xs absolute -right-10 top-1/2 transform -translate-y-1/2 font-bold text-gray-700">{thresholdDb} dB</span>
            </div>
            
            {/* Die eigentliche Füllung des Balkens */}
            <div 
              className={`v-bar-fill transition-all duration-100 ease-linear rounded-t-lg ${barColor}`} 
              style={{ height: `${barHeight}%` }}
            ></div>
            
            {/* Skalen-Markierungen */}
            <div className="absolute top-0 w-full h-full pointer-events-none text-gray-400">
                <div className="absolute top-0 right-1/2 translate-x-1/2 -mt-2">120 dB</div>
                <div className="absolute bottom-0 right-1/2 translate-x-1/2 -mb-2">0 dB</div>
                <div className="absolute top-1/2 right-full pr-2 -translate-y-1/2">60 dB</div>
            </div>
          </div>
          
          {/* Aktueller dB-Wert */}
          <div className="mt-8 text-center">
            <div className={`text-6xl font-bold transition-colors duration-100 ${isLoud ? "text-red-600 animate-pulse" : "text-gray-900"}`}>
              {currentDb.toFixed(1)}
            </div>
            <div className="text-xl text-gray-500">
              dB SPL (Geglättet)
            </div>
          </div>

          {/* Alarm-Meldung */}
          {isLoud && (
            <div className="mt-6 p-3 bg-red-500 text-white rounded-lg font-bold shadow-lg animate-bounce">
              ⚠️ ZU LAUT! SCHWELLE ÜBERSCHRITTEN! ⚠️
            </div>
          )}
        </div> {/* Schließt die Haupt-Anzeige */}

        {/* Einstellungs-Panel */}
        <div className="lg:w-96 p-6 rounded-xl shadow-xl bg-white flex flex-col gap-4">
          <h3 className="text-2xl font-bold text-gray-800 border-b pb-2 mb-4">
            Einstellungen ⚙️
          </h3>

          <div className="input-group">
            <label htmlFor="threshold-db-input" className="block text-sm font-medium text-gray-700 mb-1">
              Grenzwert-Schwelle (dB):
            </label>
            <input
              id="threshold-db-input"
              type="number"
              min={MIN_DB_DISPLAY.toFixed(0)}
              max={MAX_DB_DISPLAY.toFixed(0)}
              step="1"
              value={warningDbInput}
              onChange={handleDbInputChange}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Aktuell: **{getThresholdDb()} dB**
            </p>
          </div>

          <div className="input-group">
            <label htmlFor="delay-input" className="block text-sm font-medium text-gray-700 mb-1">
              Alarm-Verzögerung (Sekunden):
            </label>
            <input
              id="delay-input"
              type="number"
              min="0.0"
              max="10.0"
              step="0.1"
              value={alarmDelayMsInput}
              onChange={handleDelayInputChange}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Alarm wird nach **{currentAlarmDelayRef.current / 1000} s** Überschreitung ausgelöst.
            </p>
          </div>

          <div className="input-group">
            <label htmlFor="calibration-input" className="block text-sm font-medium text-gray-700 mb-1">
              Kalibrierung (Offset dB):
            </label>
            <input
              id="calibration-input"
              type="number"
              min="-20.0"
              max="20.0"
              step="0.1"
              value={calibrationOffset.toFixed(1)}
              onChange={(e) => setCalibrationOffset(Number(e.target.value) || 0)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Passt die Messung an das Mikrofon an.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Exportieren Sie die Hauptkomponente als Standard-Export
export default SoundLevelMeter;