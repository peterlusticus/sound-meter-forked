import React, { useEffect, useRef, useState, useCallback } from "react";
// Importieren Sie das Stylesheet für die Ästhetik
// HINWEIS: Wir verwenden inline CSS und ein <style>-Tag für die Haupt-Styles
// Da wir hier keine separate styles.css Datei zur Verfügung haben.

// --- KONSTANTEN UND EINSTELLUNGEN ---

const settings = {
  bars: 1, // ZURÜCK AUF EINEN BALKEN (Single VU-Meter)
  width: 80, // Breite des einzelnen Balkens erhöht
  height: 250, // Höhe leicht erhöht für bessere Sichtbarkeit
};

// Verwenden Sie eine URL, die lokal oder im Browser verfügbar ist
const AIRHORN_SOUND_URL = "/airhorn.mp3";

// Konstanten für die Lautstärkeskala (getByteTimeDomainData liefert 0-255)
const MAX_AMPLITUDE = 128; // Maximale Amplitude = 127
const MIN_AMPLITUDE_FLOOR = 2; // Minimaler Wert für die RMS-Berechnung

// Konstanten für die dB-Skala (dB-Kalibrierung)
const MAX_DB = 90; // Entspricht ungefähr der maximalen Amplitude (127)
const MIN_DB_FLOOR = 30; // Realistischer Grundrauschpegel
const INITIAL_WARNING_DB = 75;

// Alarm-Logik
const ALARM_DELAY_MS = 50;
const ALARM_DURATION_MS = 2000;

// --- HILFSFUNKTIONEN ---

// Konvertiert RMS-Amplitude (0-128) zu dB (dBFS-ähnlich)
const amplitudeToDb = (rms) => {
  if (rms < MIN_AMPLITUDE_FLOOR) {
    return MIN_DB_FLOOR;
  }
  const normalizedRms = rms / MAX_AMPLITUDE;
  let db = 20 * Math.log10(normalizedRms) + MAX_DB;
  return Math.min(MAX_DB, Math.max(MIN_DB_FLOOR, db));
};

// Konvertiert dB zu RMS-Amplitude (0-128) für den Schwellenwert
const dbToRms = (db) => {
  if (db <= MIN_DB_FLOOR) return MIN_AMPLITUDE_FLOOR;
  let rms = MAX_AMPLITUDE * Math.pow(10, (db - MAX_DB) / 20);
  return Math.min(MAX_AMPLITUDE, Math.max(MIN_AMPLITUDE_FLOOR, rms));
};

const Meter = () => {
  const [warningThreshold, setWarningThreshold] = useState(
    dbToRms(INITIAL_WARNING_DB)
  );
  const [warningDbInput, setWarningDbInput] = useState(
    INITIAL_WARNING_DB.toFixed(0)
  );

  const [isLoud, setIsLoud] = useState(false);
  const [currentDb, setCurrentDb] = useState(0.0);

  // State für die Visualisierung der Balken (RMS-Werte) - Enthält nur den aktuellen Wert
  const [barVolumes, setBarVolumes] = useState(
    new Array(settings.bars).fill(0)
  );

  // volume.current speichert den aktuellen RMS-Wert (0-128) vom Audio-Thread
  const volume = useRef(0);
  const currentSmoothedDb = useRef(0.0);
  const loudnessDuration = useRef(0);
  const lastTimeCheck = useRef(performance.now());

  const airhorn = useRef(null);
  const alarmTriggered = useRef(false);
  const alarmTimeoutRef = useRef(null);

  // Ref für den aktuellen RMS-Schwellenwert
  const currentVolumeThresholdRef = useRef(dbToRms(INITIAL_WARNING_DB));

  // Synchronisiert den State (RMS-Wert) mit dem Ref
  useEffect(() => {
    currentVolumeThresholdRef.current = warningThreshold;
  }, [warningThreshold]);

  useEffect(() => {
    airhorn.current = new Audio(AIRHORN_SOUND_URL);
    airhorn.current.loop = false;
  }, []);

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
    if (airhorn.current) {
      airhorn.current.currentTime = 0;
      airhorn.current
        .play()
        .catch((e) => console.error("Fehler beim Abspielen des Tons:", e));
    }

    alarmTimeoutRef.current = setTimeout(() => {
      resetAlarm();
    }, ALARM_DURATION_MS);
  }, [resetAlarm]);

  // --- AUDIO-VERARBEITUNG ---

  const getMedia = useCallback(() => {
    let audioContext;

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

        // Glättung für ruhigere Bewegung
        analyser.smoothingTimeConstant = 0.85;
        analyser.fftSize = 1024;

        microphone.connect(analyser);
        analyser.connect(javascriptNode);
        javascriptNode.connect(audioContext.destination);

        const dataArray = new Uint8Array(analyser.fftSize);

        javascriptNode.onaudioprocess = () => {
          analyser.getByteTimeDomainData(dataArray);

          let sumOfSquares = 0;

          for (let i = 0; i < dataArray.length; i++) {
            const amplitude = dataArray[i] - 128;
            sumOfSquares += amplitude * amplitude;
          }

          const rms = Math.sqrt(sumOfSquares / dataArray.length);
          volume.current = rms;

          const db = amplitudeToDb(rms);
          currentSmoothedDb.current = db;

          const volumeThreshold = currentVolumeThresholdRef.current;

          const now = performance.now();
          const delta = now - lastTimeCheck.current;
          lastTimeCheck.current = now;

          // Alarm-Logik (unverändert)
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
        };
      })
      .catch(function (err) {
        console.error("Fehler beim Zugriff auf das Mikrofon:", err);
      });

    return () => {
      if (audioContext && audioContext.state !== "closed") {
        audioContext
          .close()
          .catch((e) =>
            console.error("Fehler beim Schließen des AudioContext:", e)
          );
      }
    };
  }, [setWarning]);

  useEffect(() => {
    const cleanup = getMedia();
    return cleanup;
  }, [getMedia]);

  // Funktion zur Anzeige
  const getThresholdDb = useCallback(() => {
    return amplitudeToDb(warningThreshold);
  }, [warningThreshold]);

  // EFFEKT: Datenaktualisierung für den Einzelbalken VU-Meter
  useEffect(() => {
    const intervalId = setInterval(() => {
      const currentRms = volume.current;

      setBarVolumes(() => {
        // Setze den Zustand auf einen Array mit dem aktuellen RMS-Wert
        return [currentRms];
      });

      setCurrentDb(currentSmoothedDb.current);
    }, 50);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  // Funktion zum Rendern des einzelnen Balkens
  const renderVisualizerBars = () => {
    const thresholdDb = getThresholdDb();

    // Wir verwenden nur den ersten (und einzigen) Wert im State
    const barVolume = barVolumes[0] || MIN_AMPLITUDE_FLOOR;

    // Stellt sicher, dass der minimale Wert nicht Null ist
    const safeBarVolume = Math.max(barVolume, MIN_AMPLITUDE_FLOOR);

    // Berechnung von Farbe und Höhe auf Basis des State-Wertes
    const isBarLoud = amplitudeToDb(safeBarVolume) >= thresholdDb;
    const barColor = isBarLoud ? "rgb(255, 60, 60)" : "rgb(0, 191, 165)"; // Hellere Farben

    return (
      <div
        className="meter-bar"
        key={`vu-0`}
        style={{
          // Hintergrundfarbe basierend auf Lautstärke
          background: barColor,
          // Breitere Bar
          width: settings.width + "px",
          height: settings.height + "px",
          transformOrigin: "bottom",
          alignSelf: "flex-end",
          borderRadius: "4px",
          boxShadow: `0 0 15px rgba(0, 191, 165, ${isBarLoud ? 0.9 : 0.5})`, // Subtiler Schatten
          // Skalierung der Höhe
          transform: `scaleY(${safeBarVolume / MAX_AMPLITUDE})`,
          transition: "transform 0.05s ease-out", // Weichere Transition
        }}
      />
    );
  };

  const handleDbInputChange = (e) => {
    const value = e.target.value;
    const db = Number(value);

    setWarningDbInput(value);

    if (isNaN(db) || db < MIN_DB_FLOOR || db > MAX_DB) {
      return;
    }

    const newVolumeThreshold = dbToRms(db);
    setWarningThreshold(newVolumeThreshold);
  };

  const currentDbThreshold = amplitudeToDb(warningThreshold).toFixed(1);
  const currentVolumeValue = volume.current.toFixed(1);

  // Berechnung der Position der Schwellenwertlinie in Prozent
  // Wir skalieren den RMS-Threshold (0-128) relativ zur MAX_AMPLITUDE (128)
  // und ziehen es von 100% ab, da 0% oben ist und 100% unten.
  const thresholdPercentage = 100 - (warningThreshold / MAX_AMPLITUDE) * 100;

  return (
    <div className="App">
      {/* GLOBAL STYLES FÜR EIN ANSPRECHENDES DESIGN */}
      <style>{`
        .App {
            font-family: 'Inter', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #1e1e1e; /* Dunkler Hintergrund */
            color: #f0f0f0;
        }

        .meter-container-wrapper {
            display: flex;
            flex-direction: column;
            align-items: center;
            background: #2a2a2a; /* Dunkle Karte */
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            width: 90%;
            max-width: 400px;
        }

        .control-panel {
            width: 100%;
            margin-bottom: 20px;
            text-align: center;
        }

        .panel-title {
            color: #00bfa5;
            font-size: 1.5rem;
            margin-bottom: 15px;
        }

        .db-display {
            font-size: 1.2rem;
            margin: 10px 0 20px 0;
            display: flex;
            justify-content: center;
            gap: 10px;
            align-items: baseline;
        }
        
        .current-db {
            font-size: 2.5rem;
            color: ${isLoud ? "rgb(255, 60, 60)" : "#f0f0f0"};
            transition: color 0.1s ease-in-out;
            font-weight: bold;
        }

        .db-input-group {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 15px;
            padding: 10px 0;
            border-top: 1px solid #333;
        }

        .db-input {
            width: 80px;
            padding: 8px;
            border-radius: 6px;
            border: 1px solid #444;
            background: #3a3a3a;
            color: #f0f0f0;
            text-align: center;
        }

        .threshold-info {
            font-size: 0.9rem;
            color: #aaa;
            margin-top: 10px;
        }
        
        /* VISUALIZER STYLES */
        .meter-visualizer {
            width: ${settings.width + 40}px; /* Etwas breiter als der Balken */
            position: relative;
            background: linear-gradient(to top, #00bfa5 70%, #ffc107 90%, #ff3c3c 100%); /* Farbskala: Grün, Gelb, Rot */
            border-radius: 8px;
            box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5);
            overflow: hidden; /* Wichtig für die Skalierung des Balkens */
        }
        
        .meter-bar-container {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            display: flex;
            justify-content: center;
            align-items: flex-end;
            height: 100%;
        }

        .threshold-line {
            position: absolute;
            width: 100%;
            height: 3px;
            background: #ff3c3c;
            top: ${thresholdPercentage}%; 
            box-shadow: 0 0 8px #ff3c3c;
            z-index: 10;
        }

        .alarm-message {
            position: absolute;
            top: -50px;
            width: 100%;
            padding: 10px;
            background: #ff3c3c;
            color: white;
            font-weight: bold;
            text-align: center;
            border-radius: 8px;
            box-shadow: 0 5px 15px rgba(255, 60, 60, 0.7);
            animation: pulse 1s infinite alternate;
            z-index: 20;
        }

        @keyframes pulse {
            from { transform: scale(1); opacity: 1; }
            to { transform: scale(1.05); opacity: 0.9; }
        }
      `}</style>

      <div className="meter-container-wrapper">
        <div className="control-panel">
          <h3 className="panel-title">Volume Control 📊</h3>

          <div className="db-display">
            <span>Aktuelle DB:</span>
            <strong className="current-db">{currentDb.toFixed(1)} dB</strong>
          </div>

          <p className="debug-info">
            (RMS-Wert: {currentVolumeValue} / {MAX_AMPLITUDE})
          </p>

          <div className="db-input-group">
            <label htmlFor="threshold-db-input">Grenzwert-Schwelle (dB):</label>
            <input
              id="threshold-db-input"
              type="number"
              min={MIN_DB_FLOOR.toFixed(0)}
              max={MAX_DB.toFixed(0)}
              step="1"
              value={warningDbInput}
              onChange={handleDbInputChange}
              className="db-input"
            />
          </div>

          <p className="threshold-info">
            Warnung ab: <strong>{currentDbThreshold} dB</strong>
          </p>
        </div>

        <div
          className="meter-visualizer"
          style={{
            height: settings.height + "px",
          }}
        >
          {isLoud && (
            <div className="alarm-message">⚠️ ZU LAUT! KLASSE ENTDECKT! ⚠️</div>
          )}

          {/* Schwellenwertlinie */}
          <div
            className="threshold-line"
            style={{ top: `${thresholdPercentage}%` }}
          />

          <div className="meter-bar-container">{renderVisualizerBars()}</div>
        </div>
      </div>
    </div>
  );
};

export default () => {
  return <Meter />;
};
