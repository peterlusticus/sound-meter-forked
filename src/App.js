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
const MIN_THRESHOLD = 1;

// Konstanten für die dB-Skala
const MAX_DB = 90; // Realistischerer Höchstwert (z.B. 90-100 dB)
const INITIAL_WARNING_DB = 75;

// Hilfsfunktion: Konvertiert Volumen (0-255) zu dB (0-MAX_DB)
// 🚨 VERBESSERTE DB-BERECHNUNG für realistischere Skalierung
const volumeToDb = (volume) => {
  // Volumen normalisieren (0 bis 1)
  const normalizedVolume = volume / MAX_ANALYZER_VALUE;

  // Realistische dB-Skala: 20 * log10(Amplitude)
  // Wichtig: Die 0-255 Werte des Analysers sind Frequenz-Amplituden, nicht reines RMS.
  // Wir verwenden einen festen Offset, um 0-dBFS (255) auf MAX_DB zu legen.

  if (normalizedVolume < 0.001) {
    // Rauschen (entspricht ca. 30 dB)
    return 30;
  }

  // Wir nehmen 20 * log10(normVolume) und addieren dann den MAX_DB-Wert,
  // damit 1.0 (max) genau MAX_DB ergibt.
  let db = 20 * Math.log10(normalizedVolume) + MAX_DB;

  // Werte auf den realistischen Bereich begrenzen (z.B. 30 dB bis MAX_DB)
  return Math.min(MAX_DB, Math.max(30, db));
};

// Hilfsfunktion: Konvertiert dB (0-MAX_DB) zu Volumen (0-255)
const dbToVolume = (db) => {
  if (db <= 30) return MIN_THRESHOLD;

  // Umgekehrte Log-Skalierung
  // dB_DIFF = dB - MAX_DB
  // VOLUME = MAX_ANALYZER_VALUE * 10^(dB_DIFF / 20)
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

  // NEU: Speichert den geglätteten DB-Wert zur Synchronisation von Anzeige und Alarm
  const currentSmoothedDb = useRef(0.0);

  const airhorn = useRef(null);
  const alarmTriggered = useRef(false);

  useEffect(() => {
    airhorn.current = new Audio(AIRHORN_SOUND_URL);
  }, []);

  // setWarning muss jetzt den DB-Wert-Vergleich durchführen
  const setWarning = (loud, currentDbValue, thresholdDbValue) => {
    // 🚨 ÄNDERUNG 2: Warnung wird ausgelöst, wenn der GEGLÄTTETE DB-Wert
    // den als DB eingegebenen Grenzwert überschreitet.
    const mustBeLoud = currentDbValue >= thresholdDbValue;

    // Nur den State aktualisieren, wenn sich der Zustand ändert
    if (mustBeLoud !== isLoud) {
      setIsLoud(mustBeLoud);
    }

    if (mustBeLoud) {
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

  // Hilfsfunktion, um den DB-Schwellenwert aus dem Volume-Threshold zu bekommen
  const getThresholdDb = useCallback(() => {
    return volumeToDb(warningThreshold);
  }, [warningThreshold]);

  const getMedia = useCallback(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

        // Glättung beibehalten (0.75) für ruhige Messung
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
          // 🚨 ÄNDERUNG 1: Den GEGLÄTTETEN DB-Wert speichern
          currentSmoothedDb.current = db;

          // 🚨 ÄNDERUNG 3: Warnlogik RUFT setWarning SOFORT auf,
          // basierend auf dem GEGLÄTTETEN DB-Wert.
          const thresholdDb = getThresholdDb();
          setWarning(db >= thresholdDb, db, thresholdDb);
        };
      })
      .catch(function (err) {
        console.error("Fehler beim Zugriff auf das Mikrofon:", err);
      });
  }, [getThresholdDb]);

  // Startet das Audio-Processing neu, wenn sich der Schwellenwert ändert
  useEffect(() => {
    getMedia();
  }, [getMedia]);

  useEffect(() => {
    // Intervall (50ms) wird nur zur Aktualisierung der ANZEIGE verwendet
    const intervalId = setInterval(() => {
      // Aktualisiert die Balken
      volumeRefs.current.unshift(volume.current);
      volumeRefs.current.pop();

      // Aktualisiert den sichtbaren DB-Wert (zieht den aktuellen, GEGLÄTTETEN DB-Wert)
      setCurrentDb(currentSmoothedDb.current);

      for (let i = 0; i < refs.current.length; i++) {
        if (refs.current[i]) {
          const barVolume = volumeRefs.current[i];
          const isBarLoud = volumeToDb(barVolume) >= getThresholdDb();

          refs.current[i].style.transform = `scaleY(${
            barVolume / MAX_ANALYZER_VALUE
          })`;

          refs.current[i].style.background = isBarLoud
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

    if (isNaN(db) || db < 30 || db > MAX_DB) {
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
            min="30"
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
