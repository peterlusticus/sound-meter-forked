import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

const settings = {
  bars: 30,
  width: 10,
  height: 200,
};

const AIRHORN_SOUND_URL = "/airhorn.mp3";
const ALARM_DELAY_MS = 100; // Alarm erst nach 200ms Überschreitung

// ... (Rest der Konstanten und Hilfsfunktionen bleibt unverändert)

const MAX_ANALYZER_VALUE = 255;
const MIN_THRESHOLD = 1;
const MAX_DB = 90;
const INITIAL_WARNING_DB = 75;

const volumeToDb = (volume) => {
  const normalizedVolume = volume / MAX_ANALYZER_VALUE;
  if (normalizedVolume < 0.001) {
    return 30;
  }
  let db = 20 * Math.log10(normalizedVolume) + MAX_DB;
  return Math.min(MAX_DB, Math.max(30, db));
};

const dbToVolume = (db) => {
  if (db <= 30) return MIN_THRESHOLD;
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

  const currentSmoothedDb = useRef(0.0);
  const loudnessDuration = useRef(0);
  const lastTimeCheck = useRef(performance.now());

  const airhorn = useRef(null);
  const alarmTriggered = useRef(false);

  useEffect(() => {
    airhorn.current = new Audio(AIRHORN_SOUND_URL);
    // 💡 NEU: Stellt sicher, dass der Ton immer wieder abgespielt werden kann
    airhorn.current.loop = false;
  }, []);

  // 🚨 KORRIGIERTE setWarning Funktion für Ton- und UI-Steuerung
  const setWarning = (loud) => {
    // 1. UI-Update: State für die Sichtbarkeit der Warnmeldung
    if (loud !== isLoud) {
      setIsLoud(loud);
    }

    // 2. Ton-Steuerung
    if (loud) {
      if (!alarmTriggered.current && airhorn.current) {
        airhorn.current.currentTime = 0;
        airhorn.current
          .play()
          .catch((e) => console.error("Fehler beim Abspielen des Tons:", e));

        // 🚨 Wichtig: Hier setzen wir den Trigger, solange der Ton läuft
        alarmTriggered.current = true;
      }
    } else {
      // Wenn nicht mehr laut: Ton stoppen und Trigger zurücksetzen
      if (airhorn.current) {
        airhorn.current.pause();
        airhorn.current.currentTime = 0;
      }
      // 🚨 Wichtig: Alarm-Trigger zurücksetzen, damit der Ton erneut ausgelöst werden kann
      alarmTriggered.current = false;
    }
  };

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
          currentSmoothedDb.current = db;

          const thresholdDb = getThresholdDb();
          const now = performance.now();
          const delta = now - lastTimeCheck.current;
          lastTimeCheck.current = now;

          // Alarm-Logik mit Verzögerung
          if (db >= thresholdDb) {
            loudnessDuration.current += delta;

            if (loudnessDuration.current >= ALARM_DELAY_MS) {
              // 💡 Aktualisierter Aufruf: löst Ton und UI aus
              setWarning(true);
            }
          } else {
            loudnessDuration.current = 0;
            // 💡 Aktualisierter Aufruf: stoppt Ton und entfernt UI
            setWarning(false);
          }
        };
      })
      .catch(function (err) {
        console.error("Fehler beim Zugriff auf das Mikrofon:", err);
      });
  }, [getThresholdDb]);

  // ... (Rest der Funktionen bleibt unverändert)

  useEffect(() => {
    getMedia();
  }, [getMedia]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      volumeRefs.current.unshift(volume.current);
      volumeRefs.current.pop();

      setCurrentDb(currentSmoothedDb.current);

      const thresholdDb = getThresholdDb();
      for (let i = 0; i < refs.current.length; i++) {
        if (refs.current[i]) {
          const barVolume = volumeRefs.current[i];
          const isBarLoud = volumeToDb(barVolume) >= thresholdDb;

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
