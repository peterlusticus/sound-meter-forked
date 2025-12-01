import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

const settings = {
  bars: 30,
  width: 10,
  height: 200,
};

const AIRHORN_SOUND_URL = "/airhorn.mp3";

// Neuer Standardwert für den Schwellenwert (z.B. 100, nun die Mitte des Bereichs 0-200)
const INITIAL_WARNING_THRESHOLD = 50; 
const MAX_THRESHOLD = 200; // Angepasster Maximalwert
const MIN_THRESHOLD = 1; // Minimaler Wert bleibt 1

const Meter = () => {
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
        // Wichtig: Die getByteFrequencyData liefert Werte von 0-255.
        // Die Berechnung des Durchschnitts (volume.current) kann theoretisch bis zu 255 gehen.
        // Daher ist MAX_THRESHOLD = 200 (oder 255) sinnvoll.

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

          // Lautstärke-Warnlogik verwendet jetzt den State warningThreshold
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

  // Startet das Audio-Processing neu, wenn sich der Schwellenwert ändert,
  // damit die onaudioprocess-Funktion den neuen Wert verwenden kann.
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
          const isBarLoud = volumeRefs.current[i] > warningThreshold;

          // HINWEIS: Die Skalierung (volumeRefs.current[i] / 100) funktioniert
          // besser mit einer Skalierung auf 200, d.h. (volumeRefs.current[i] / 200).
          // Da der Balken nur bis zur Größe des Containers wachsen soll,
          // behalten wir 100 bei, oder verwenden `volumeRefs.current[i] / MAX_THRESHOLD`.
          // Für diesen Fall verwenden wir MAX_THRESHOLD als Skalierungsbasis
          // um die Balkenhöhe relativ zum max. Wert zu halten.
          refs.current[i].style.transform = `scaleY(${
            volumeRefs.current[i] / MAX_THRESHOLD
          })`;
          
          refs.current[i].style.background = isBarLoud ? "red" : "#7ED321";
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
            background: "#7ED321",
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
      {/* Regler-Element (Slider) mit aktualisierten Werten */}
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
          // Max auf 200 gesetzt
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