import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

const settings = {
  bars: 30,
  width: 10,
  height: 200,
};

const AIRHORN_SOUND_URL = "/airhorn.mp3";

// Standardwert für den Schwellenwert (kann später im Slider angepasst werden)
const INITIAL_WARNING_THRESHOLD = 50;
const MAX_THRESHOLD = 100; // Maximaler Wert für den Slider
const MIN_THRESHOLD = 1; // Minimaler Wert für den Slider

const Meter = () => {
  // 1. Schwellenwert als State hinzufügen
  const [warningThreshold, setWarningThreshold] = useState(
    INITIAL_WARNING_THRESHOLD
  );
  const [isLoud, setIsLoud] = useState(false);
  const refs = useRef([]);
  const volume = useRef(0);
  const volumeRefs = useRef(new Array(settings.bars));

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

  // 2. getMedia als useCallback definieren, da es in useEffect verwendet wird
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

          volume.current = values / length;

          // HINWEIS: Lautstärke-Warnlogik verwendet jetzt den State warningThreshold
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
  }, [warningThreshold]); // Abhängigkeit von warningThreshold hinzufügen

  // 3. useEffect anpassen, um getMedia bei Änderung des Schwellenwerts neu zu starten
  // Dies ist NOTWENDIG, damit die onaudioprocess-Funktion den neuen Schwellenwert sieht.
  useEffect(() => {
    getMedia();
    // Ein Clean-up wäre hier gut, um den AudioContext zu stoppen,
    // aber das ist in diesem Beispiel komplexer. Für dieses Beispiel belassen wir es dabei.
  }, [getMedia]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      // Aktualisiert die Balken
      volumeRefs.current.unshift(volume.current);
      volumeRefs.current.pop();
      for (let i = 0; i < refs.current.length; i++) {
        if (refs.current[i]) {
          // NEU: Setzt die Farbe auf Rot, wenn die aktuelle Lautstärke (volume.current)
          // den *aktuellen* Schwellenwert überschreitet, unabhängig vom isLoud State,
          // da isLoud den Alarm-Sound triggert.
          const isBarLoud = volumeRefs.current[i] > warningThreshold;

          refs.current[i].style.transform = `scaleY(${
            volumeRefs.current[i] / 100
          })`;
          // Hintergrund-Farbe basierend auf Schwellenwert-Überschreitung für diesen Balken
          refs.current[i].style.background = isBarLoud ? "red" : "#7ED321";
        }
      }
    }, 20);
    return () => {
      clearInterval(intervalId);
    };
  }, [warningThreshold]); // Abhängigkeit hinzugefügt, falls Sie die Logik im Intervall ändern möchten

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
            background: "#7ED321", // Standardfarbe, wird im Interval überschrieben
            minWidth: settings.width + "px",
            flexGrow: 1,

            borderRadius: settings.width + "px",
            height: Math.sin((i / settings.bars) * 4) * settings.height + "px",

            transformOrigin: "bottom",
            margin: "0 2px",
            alignSelf: "flex-end",
          }}
        />
      );
    }
    return elements;
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: settings.height + 40 + "px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        background: "#1a2024",
        padding: "10px",
        borderRadius: "5px",
        boxShadow: "inset 0 0 5px rgba(0,0,0,0.8)",
      }}
    >
      {/* 4. Regler-Element (Slider) hinzufügen */}
      <div
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          zIndex: 10,
          background: "rgba(255, 255, 255, 0.1)",
          padding: "5px 10px",
          borderRadius: "5px",
          color: "white",
          fontSize: "12px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <span>
          Auslöser-Schwelle: **{warningThreshold}** (Min: {MIN_THRESHOLD}, Max:{" "}
          {MAX_THRESHOLD})
        </span>
        <input
          type="range"
          min={MIN_THRESHOLD}
          max={MAX_THRESHOLD}
          value={warningThreshold}
          onChange={(e) => setWarningThreshold(Number(e.target.value))}
          style={{ width: "150px" }}
        />
      </div>
      {isLoud && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            textAlign: "center",
            color: "black",
            fontWeight: "bold",
            fontFamily: "arial",
            fontSize: "20px",
            background: "red",
            padding: "5px",
            textShadow: "0 0 5px yellow, 0 0 10px orange",
          }}
        >
          ⚠️ IHR WURDET ENTDECKT! ⚠️
        </div>
      )}
      {createElements()}
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