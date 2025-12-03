import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

// ... (Rest der Konstanten und Hilfsfunktionen bleibt unverändert)

const settings = {
  bars: 30,
  width: 10,
  height: 200,
};

const AIRHORN_SOUND_URL = "/airhorn.mp3";

// Konstanten für die Lautstärkeskala
const MAX_ANALYZER_VALUE = 255;
const MIN_THRESHOLD = 1;

// Konstanten für die dB-Skala
const MAX_DB = 100;
const INITIAL_WARNING_DB = 75;

// Hilfsfunktion: Konvertiert Volumen (0-255) zu dB (0-MAX_DB)
const volumeToDb = (volume) => {
  let db = 20 * Math.log10(volume / MAX_ANALYZER_VALUE) + MAX_DB;
  return Math.max(0, db);
};

// Hilfsfunktion: Konvertiert dB (0-MAX_DB) zu Volumen (0-255)
const dbToVolume = (db) => {
  if (db <= 0) return MIN_THRESHOLD;
  let volume = MAX_ANALYZER_VALUE * Math.pow(10, (db - MAX_DB) / 20);
  return Math.min(MAX_ANALYZER_VALUE, Math.max(MIN_THRESHOLD, volume));
};

const Meter = () => {
  const [warningThreshold, setWarningThreshold] = useState(
    dbToVolume(INITIAL_WARNING_DB)
  );
  const [warningDbInput, setWarningDbInput] = useState(
    INITIAL_WARNING_DB.toFixed(0)
  );

  const [isLoud, setIsLoud] = useState(false);
  const [currentDb, setCurrentDb] = useState(0.0);

  const refs = useRef([]);
  const volume = useRef(0);
  const volumeRefs = useRef(new Array(settings.bars).fill(0));

  const airhorn = useRef(null);
  const alarmTriggered = useRef(false);

  // Audioobjekt nur einmal initialisieren
  useEffect(() => {
    airhorn.current = new Audio(AIRHORN_SOUND_URL);
  }, []);

  const setWarning = (loud) => {
    setIsLoud(loud);
    if (loud) {
      if (!alarmTriggered.current && airhorn.current) {
        airhorn.current.currentTime = 0;
        airhorn.current
          .play()
          .catch((e) => console.error("Fehler beim Abspielen des Tons:", e));
        alarmTriggered.current = true;
      }
    } else {
      alarmTriggered.current = false;
    }
  };

  const getMedia = useCallback(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

        // 🚨 ÄNDERUNG 1: Erhöhen der Glättungskonstante für ruhigere Anzeige
        // Von 0.4 (schnell) auf 0.7-0.8 (sanft/ruhig) erhöht.
        analyser.smoothingTimeConstant = 0.75;

        analyser.fftSize = 1024;

        microphone.connect(analyser);
        analyser.connect(javascriptNode);
        javascriptNode.connect(audioContext.destination);

        javascriptNode.onaudioprocess = () => {
          var array = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(array);
          var values = 0;
          var length = array.length;

          for (var i = 0; i < length; i++) {
            values += array[i];
          }

          const avgVolume = values / length;
          volume.current = avgVolume;

          const db = volumeToDb(avgVolume);

          // ACHTUNG: Wir aktualisieren den DB-State HIER nicht, da das
          // onaudioprocess zu schnell ist (~40x pro Sekunde).
          // Wir lassen das nun das setInterval (siehe unten) regeln.
          // setCurrentDb(db);

          // Lautstärke-Warnlogik verwendet den internen Volume-Threshold
          if (volume.current > warningThreshold) {
            setWarning(true);
          } else {
            setWarning(false);
          }
        };
      })
      .catch(function (err) {
        console.error("Fehler beim Zugriff auf das Mikrofon:", err);
      });
  }, [warningThreshold]);

  // Startet das Audio-Processing, wenn sich der Schwellenwert ändert
  useEffect(() => {
    getMedia();
  }, [getMedia]);

  useEffect(() => {
    // 🚨 ÄNDERUNG 2: Aktualisierungsintervall verlangsamt.
    // Von 20ms (50 FPS) auf 50ms (20 FPS). Ruhigere Anzeige.
    const intervalId = setInterval(() => {
      // Aktualisiert die Balken
      volumeRefs.current.unshift(volume.current);
      volumeRefs.current.pop();

      // Aktualisiert den sichtbaren DB-Wert (zieht den aktuellen Volumen-Wert)
      const db = volumeToDb(volume.current);
      setCurrentDb(db);

      for (let i = 0; i < refs.current.length; i++) {
        if (refs.current[i]) {
          const barVolume = volumeRefs.current[i];
          const isBarLoud = barVolume > warningThreshold;

          refs.current[i].style.transform = `scaleY(${
            barVolume / MAX_ANALYZER_VALUE
          })`;

          refs.current[i].style.background = isBarLoud
            ? "rgb(255, 99, 71)"
            : "#00bfa5";
        }
      }
    }, 50); // <-- Hier ist das neue, langsamere Intervall (50ms)
    return () => {
      clearInterval(intervalId);
    };
  }, [warningThreshold]);

  // ... (Rest der Funktionen createElements, handleDbInputChange, und das Render-JSX bleiben unverändert)
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

    if (isNaN(db) || db < 0 || db > MAX_DB) {
      return;
    }

    const newVolumeThreshold = dbToVolume(db);
    setWarningThreshold(newVolumeThreshold);
  };

  const currentDbThreshold = volumeToDb(warningThreshold).toFixed(1);

  return (
    <div className="meter-container-wrapper">
      <div className="control-panel">
        <h3 className="panel-title">Volume Control 📊</h3>

        <div className="db-display">
          <span>Aktuelle DB:</span>
          <strong className="current-db">{currentDb.toFixed(1)} dB</strong>
        </div>

        <div className="db-input-group">
          <label htmlFor="threshold-db-input">Grenzwert-Schwelle (dB):</label>
          <input
            id="threshold-db-input"
            type="number"
            min="0"
            max={MAX_DB.toFixed(0)}
            step="1"
            value={warningDbInput}
            onChange={handleDbInputChange}
            className="db-input"
          />
        </div>

        <p className="threshold-info">
          Warnung ab: <strong>{currentDbThreshold} dB</strong> (Intern:{" "}
          {warningThreshold.toFixed(0)} Vol)
        </p>
      </div>

      <div
        className="meter-visualizer"
        style={{
          height: settings.height + "px",
        }}
      >
        {isLoud && (
          <div className="alarm-message">⚠️ IHR WURDET ENTDECKT! ⚠️</div>
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
