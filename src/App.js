import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

// --- KONSTANTEN UND EINSTELLUNGEN ---

const settings = {
  bars: 30,
  width: 10,
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

// NEUE HILFSFUNKTION: Konvertiert RMS-Amplitude (0-128) zu dB (dBFS-ähnlich)
const amplitudeToDb = (rms) => {
  // Wenn der RMS-Wert nahe dem Ruhewert ist (Stille), gib den Rauschpegel zurück.
  if (rms < MIN_AMPLITUDE_FLOOR) {
    return MIN_DB_FLOOR;
  }

  // 1. Normalisiere den RMS-Wert (relativ zur maximalen Amplitude 128)
  const normalizedRms = rms / MAX_AMPLITUDE;

  // 2. Logarithmische Berechnung der Dezibel (20 * log10(A/A_ref))
  // Dies gibt einen negativen Wert relativ zur Vollaussteuerung (dBFS).
  // Durch das Addieren von MAX_DB kalibrieren wir es auf die dBSPL-Skala (z.B. 0dBFS -> 90dBSPL).
  // Wir subtrahieren einen kleinen Betrag, um den MAX_DB-Wert bei voller Lautstärke genauer zu treffen.
  let db = 20 * Math.log10(normalizedRms) + MAX_DB;

  // Begrenze den Wert auf den definierten Maximal- und Minimalwert
  return Math.min(MAX_DB, Math.max(MIN_DB_FLOOR, db));
};

// NEUE HILFSFUNKTION: Konvertiert dB zu RMS-Amplitude (0-128) für den Schwellenwert
const dbToRms = (db) => {
  // Stellt sicher, dass dB nicht unter dem Grundrauschpegel liegt
  if (db <= MIN_DB_FLOOR) return MIN_AMPLITUDE_FLOOR;

  // Reziproke exponentielle Formel: A = A_ref * 10^((dB - dB_ref) / 20)
  let rms = MAX_AMPLITUDE * Math.pow(10, (db - MAX_DB) / 20);

  return Math.min(MAX_AMPLITUDE, Math.max(MIN_AMPLITUDE_FLOOR, rms));
};

const Meter = () => {
  const [warningThreshold, setWarningThreshold] = useState(
    dbToRms(INITIAL_WARNING_DB) // threshold ist jetzt RMS-Wert (0-128)
  );
  const [warningDbInput, setWarningDbInput] = useState(
    INITIAL_WARNING_DB.toFixed(0)
  );

  const [isLoud, setIsLoud] = useState(false);
  const [currentDb, setCurrentDb] = useState(0.0);

  const refs = useRef([]);
  // volume.current speichert jetzt den aktuellen RMS-Wert (0-128)
  const volume = useRef(0);
  const volumeRefs = useRef(new Array(settings.bars).fill(0));

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
        // Wir brauchen den ScriptProcessor nicht wirklich, aber er funktioniert für die Schleife
        const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

        analyser.smoothingTimeConstant = 0.75;
        // Für RMS im Zeitbereich muss die fftSize nicht groß sein, aber 1024 ist okay
        analyser.fftSize = 1024;

        microphone.connect(analyser);
        analyser.connect(javascriptNode);
        javascriptNode.connect(audioContext.destination);

        // Array für die Amplitudendaten (Zeitbereich)
        const dataArray = new Uint8Array(analyser.fftSize);

        javascriptNode.onaudioprocess = () => {
          // NEU: GetByteTimeDomainData für Amplituden-Messung
          analyser.getByteTimeDomainData(dataArray);

          let sumOfSquares = 0;

          // NEU: Berechnung des RMS-Wertes
          for (let i = 0; i < dataArray.length; i++) {
            // Zentrierung der Werte um den Ruhewert 128 (0-255)
            const amplitude = dataArray[i] - 128;
            sumOfSquares += amplitude * amplitude;
          }

          // Root Mean Square (RMS) berechnen: sqrt(Summe der Quadrate / Anzahl der Samples)
          const rms = Math.sqrt(sumOfSquares / dataArray.length);

          // Der aktuelle RMS-Wert (0-128)
          volume.current = rms;

          // Konvertierung des RMS-Wertes in dB
          const db = amplitudeToDb(rms);
          currentSmoothedDb.current = db;

          const volumeThreshold = currentVolumeThresholdRef.current;

          const now = performance.now();
          const delta = now - lastTimeCheck.current;
          lastTimeCheck.current = now;

          // Alarm-Logik (unverändert)
          if (!alarmTriggered.current) {
            // Vergleich mit dem RMS-Wert (0-128)
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
        // stream.getTracks().forEach(track => track.stop()); // Stream stoppen für sauberen Abbau
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

  // Funktion zur Anzeige (verwendet die neue RMS -> dB Funktion)
  const getThresholdDb = useCallback(() => {
    return amplitudeToDb(warningThreshold);
  }, [warningThreshold]);

  useEffect(() => {
    // Intervall (50ms) zur Aktualisierung der ANZEIGE
    const intervalId = setInterval(() => {
      // 1. HORIZONTALE VERSCHIEBUNG ENTFERNT
      // volumeRefs.current.unshift(volume.current);
      // volumeRefs.current.pop();

      // 2. UI-Update
      setCurrentDb(currentSmoothedDb.current);

      const thresholdDb = getThresholdDb();
      const currentRms = volume.current; // Den aktuellen RMS-Wert einmal abrufen
      const isLoud = amplitudeToDb(currentRms) >= thresholdDb; // Gesamtfarbe bestimmen

      for (let i = 0; i < refs.current.length; i++) {
        if (refs.current[i]) {
          // NEU: Alle Balken zeigen den GLEICHEN, aktuellen Wert
          refs.current[i].style.transform = `scaleY(${
            currentRms / MAX_AMPLITUDE
          })`;

          // NEU: Alle Balken haben dieselbe Farbe basierend auf dem Schwellenwert
          refs.current[i].style.background = isLoud
            ? "rgb(255, 99, 71)"
            : "#00bfa5";
        }
      }
    }, 50);
    return () => {
      clearInterval(intervalId);
    };
  }, [getThresholdDb]);

  const createElements = () => {
    let elements = [];
    for (let i = 0; i < settings.bars; i++) {
      elements.push(
        <div
          ref={(ref) => {
            if (ref && !refs.current.includes(ref)) {
              refs.current.push(ref);
            }
          }}
          key={`vu-${i}`}
          style={{
            background: "#00bfa5",
            minWidth: settings.width + "px",
            flexGrow: 1,
            height: settings.height + "px",
            transformOrigin: "bottom",
            margin: "0 1px",
            alignSelf: "flex-end",
            borderRadius: "0",
          }}
        />
      );
    }
    return elements;
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
        }}
      >
        {isLoud && (
          <div className="alarm-message">⚠️ ZU LAUT! KLASSE ENTDECKT! ⚠️</div>
        )}
        {createElements()}
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
