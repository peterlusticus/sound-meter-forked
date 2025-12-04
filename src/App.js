import React, { useEffect, useRef, useState, useCallback } from "react";
// Importieren Sie das Stylesheet für die Ästhetik
import "./styles.css";

// --- KONSTANTEN UND EINSTELLUNGEN ---

const settings = {
  bars: 1, // NUR NOCH EIN BALKEN FÜR DEN VU-METER
  width: 50, // Breite des einzelnen Balkens
  height: 200,
};

// Verwenden Sie eine URL, die lokal oder im Browser verfügbar ist
const AIRHORN_SOUND_URL = "/airhorn.mp3";

// Konstanten für die Lautstärkeskala (getByteTimeDomainData liefert 0-255)
// Ruhewert (kein Ton) ist 128. Maximale Amplitude = 127
const MAX_AMPLITUDE = 128;
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

  // State für die Visualisierung der Balken (RMS-Werte) - Enthält nur noch einen Wert
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

        // ERHÖHT: Glättung für ruhigere Bewegung
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

  // EFFEKT: Datenaktualisierung für den Einzelbalken
  useEffect(() => {
    // Intervall (50ms) zur Aktualisierung der ANZEIGE
    const intervalId = setInterval(() => {
      const currentRms = volume.current;

      setBarVolumes(() => {
        // Setze den Zustand auf einen Array mit dem aktuellen RMS-Wert
        return [currentRms];
      });

      // 4. Aktuellen dB-Wert aktualisieren
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

    // Berechnung von Farbe und Höhe auf Basis des State-Wertes
    const isBarLoud = amplitudeToDb(barVolume) >= thresholdDb;
    const barColor = isBarLoud ? "rgb(255, 99, 71)" : "#00bfa5";

    return (
      <div
        key={`vu-0`}
        style={{
          background: barColor,
          width: settings.width + "px",
          height: settings.height + "px",
          transformOrigin: "bottom",
          alignSelf: "flex-end",
          borderRadius: "0",
          // Skalierung des Balkens (Höhe) direkt über den State-Wert
          transform: `scaleY(${barVolume / MAX_AMPLITUDE})`,
          // Beibehaltung der Transition für weiche Bewegung
          transition: "transform 0.05s linear",
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

    // Wandelt den eingegebenen dB-Wert in den RMS-Schwellenwert um
    const newVolumeThreshold = dbToRms(db);
    setWarningThreshold(newVolumeThreshold);
  };

  const currentDbThreshold = amplitudeToDb(warningThreshold).toFixed(1);
  const currentVolumeValue = volume.current.toFixed(1);

  return (
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
          Warnung ab: <strong>{currentDbThreshold} dB</strong> (Intern RMS:{" "}
          {warningThreshold.toFixed(1)})
        </p>
      </div>

      <div
        className="meter-visualizer"
        style={{
          height: settings.height + "px",
          // NEU: Flex-Container für die Zentrierung des Einzelbalkens
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-end", // Balken wächst von unten nach oben
        }}
      >
        {isLoud && (
          <div className="alarm-message">⚠️ ZU LAUT! KLASSE ENTDECKT! ⚠️</div>
        )}
        {renderVisualizerBars()}
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
