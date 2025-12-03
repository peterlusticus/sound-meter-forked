import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

const settings = {
  bars: 30,
  width: 10,
  height: 200,
};

const AIRHORN_SOUND_URL = "/airhorn.mp3";

// Konstanten für die Lautstärkeskala
const MAX_ANALYZER_VALUE = 255;
const MIN_THRESHOLD = 1; // Min. Volumen-Wert

// Konstanten für die dB-Skala
const MAX_DB = 100; // Definiert den Höchstwert unserer dB-Skala (Referenzpunkt)
const INITIAL_WARNING_DB = 75; // Standard-DB-Wert, den der Nutzer sieht (statt 150 Vol)

// Hilfsfunktion: Konvertiert Volumen (0-255) zu dB (0-MAX_DB)
const volumeToDb = (volume) => {
  // Berechnung: dBFS (Dezibel Full Scale) - Log-Skalierung
  let db = 20 * Math.log10(volume / MAX_ANALYZER_VALUE) + MAX_DB;
  return Math.max(0, db); // Stellt sicher, dass der Wert nicht negativ ist
};

// Hilfsfunktion: Konvertiert dB (0-MAX_DB) zu Volumen (0-255)
const dbToVolume = (db) => {
  if (db <= 0) return MIN_THRESHOLD;
  // Umgekehrte Log-Skalierung
  let volume = MAX_ANALYZER_VALUE * Math.pow(10, (db - MAX_DB) / 20);
  return Math.min(MAX_ANALYZER_VALUE, Math.max(MIN_THRESHOLD, volume));
};

const Meter = () => {
  // warningThreshold speichert den internen VOLUMEN-Wert (0-255)
  const [warningThreshold, setWarningThreshold] = useState(
    dbToVolume(INITIAL_WARNING_DB)
  );
  // warningDbInput speichert den aktuellen DB-Wert aus dem Eingabefeld
  const [warningDbInput, setWarningDbInput] = useState(
    INITIAL_WARNING_DB.toFixed(0)
  );

  const [isLoud, setIsLoud] = useState(false);
  const [currentDb, setCurrentDb] = useState(0.0); // Aktueller Dezibel-Wert

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
    // ... (unchanged)
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);
        analyser.smoothingTimeConstant = 0.4;
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

          setCurrentDb(db); // Aktualisiert den DB-Wert

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
    const intervalId = setInterval(() => {
      // ... (unchanged)
      volumeRefs.current.unshift(volume.current);
      volumeRefs.current.pop();

      for (let i = 0; i < refs.current.length; i++) {
        if (refs.current[i]) {
          const barVolume = volumeRefs.current[i];
          // Verwendet den internen Volume-Threshold zum Färben
          const isBarLoud = barVolume > warningThreshold;

          // Skalierung relativ zum maximal möglichen Wert (255)
          refs.current[i].style.transform = `scaleY(${
            barVolume / MAX_ANALYZER_VALUE
          })`;

          // Klarere Farben für modernes Design
          refs.current[i].style.background = isBarLoud
            ? "rgb(255, 99, 71)" // Tomato Red
            : "#00bfa5"; // Türkis/Cyan
        }
      }
    }, 20);
    return () => {
      clearInterval(intervalId);
    };
  }, [warningThreshold]);

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

    // Aktualisiert den Wert im Eingabefeld
    setWarningDbInput(value);

    // Nur gültige Zahlen verarbeiten
    if (isNaN(db) || db < 0 || db > MAX_DB) {
      // Ungültige Eingabe: Threshold nicht ändern, aber das Feld aktualisieren
      return;
    }

    // Konvertiert den DB-Wert in den internen Volumen-Wert und aktualisiert den Threshold
    const newVolumeThreshold = dbToVolume(db);
    setWarningThreshold(newVolumeThreshold);
  };

  // Anzeige-DB des Schwellenwerts (basiert auf dem internen Volume-Wert)
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
            value={warningDbInput} // Gebundener Wert für das Eingabefeld
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
