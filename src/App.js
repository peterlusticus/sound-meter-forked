import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

const settings = {
  bars: 30,
  width: 10,
  height: 200,
};

const AIRHORN_SOUND_URL = "/airhorn.mp3";

// Standardwerte (0-255 vom Analyser)
const MAX_ANALYZER_VALUE = 255;
const INITIAL_WARNING_THRESHOLD = 150; // Höherer Standardwert für 0-255-Bereich
const MAX_THRESHOLD = MAX_ANALYZER_VALUE;
const MIN_THRESHOLD = 1;

// Konstante für die dB-Berechnung (Annahme: Max. 0 dB bei MAX_ANALYZER_VALUE)
// Die genaue dB-Skala ist komplex, dies ist eine Annäherung für die Visualisierung.
// Wir nehmen den MAX_DB-Wert an, um eine Skala zu haben.
const MAX_DB = 100;

const Meter = () => {
  const [warningThreshold, setWarningThreshold] = useState(
    INITIAL_WARNING_THRESHOLD
  );
  const [isLoud, setIsLoud] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0); // NEU: Aktueller Volumen-Wert (0-255)
  const [currentDb, setCurrentDb] = useState(-Infinity); // NEU: Aktueller Dezibel-Wert

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

          // dB-Berechnung (approximiert)
          // dBFS (Dezibel Full Scale): Bezugspunkt ist der maximale digitale Wert
          // Hier eine Log-Skalierung, um den Lautstärkeeindruck besser abzubilden.
          let db = 20 * Math.log10(avgVolume / MAX_ANALYZER_VALUE) + MAX_DB;
          if (db < 0) db = 0; // Negative Werte auf 0 begrenzen

          setCurrentVolume(avgVolume);
          setCurrentDb(db); // Aktualisiert den DB-Wert

          // Lautstärke-Warnlogik
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
      // Aktualisiert die Balken
      volumeRefs.current.unshift(volume.current);
      volumeRefs.current.pop();

      for (let i = 0; i < refs.current.length; i++) {
        if (refs.current[i]) {
          const barVolume = volumeRefs.current[i];
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

            // Entfernt die Sinus-Höhen-Berechnung für einheitlichere Balken
            // height: Math.sin((i / settings.bars) * 4) * settings.height + "px",
            height: settings.height + "px",

            transformOrigin: "bottom",
            margin: "0 1px", // Schmalere Ränder zwischen den Balken
            alignSelf: "flex-end",

            // Modernes, klares Design: keine abgerundeten Ecken
            borderRadius: "0",
          }}
        />
      );
    }
    return elements;
  };

  // Hilfsfunktion zur Umrechnung des Schwellenwerts in einen approximierten DB-Wert
  const thresholdToDb = (threshold) => {
    let db = 20 * Math.log10(threshold / MAX_ANALYZER_VALUE) + MAX_DB;
    return Math.max(0, db).toFixed(1);
  };

  return (
    <div className="meter-container-wrapper">
      <div className="control-panel">
        <h3>Volume Control 📊</h3>
        <p className="db-display">
          **Aktuelle DB:** **{currentDb.toFixed(1)}** dB (Max:{" "}
          {MAX_DB.toFixed(0)} dB)
        </p>

        <label htmlFor="threshold-slider">
          Auslöser-Schwelle: **{thresholdToDb(warningThreshold)}** dB
          <span className="volume-val"> (Vol: {warningThreshold})</span>
        </label>
        <input
          id="threshold-slider"
          type="range"
          min={MIN_THRESHOLD}
          max={MAX_THRESHOLD}
          value={warningThreshold}
          onChange={(e) => setWarningThreshold(Number(e.target.value))}
          className="threshold-slider"
        />
        <p className="threshold-info">
          **Warnung ab:** Vol: {warningThreshold} (DB:{" "}
          {thresholdToDb(warningThreshold)})
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
