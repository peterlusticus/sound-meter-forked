import React, { useEffect, useRef, useState } from "react";
import "./styles.css";

const settings = {
  bars: 30,
  width: 10, // Die Breite wird jetzt als Mindestgröße betrachtet, aber Flexbox übernimmt die Verteilung
  height: 200,
};

const AIRHORN_SOUND_URL = "/airhorn.mp3";

const WARNING_THRESHOLD = 50;

const Meter = () => {
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
      // Spiele den Ton nur ab, wenn er noch nicht ausgelöst wurde
      if (!alarmTriggered.current && airhorn.current) {
        airhorn.current.currentTime = 0; // Stellt sicher, dass der Ton von vorne beginnt
        airhorn.current
          .play()
          .catch((e) => console.error("Fehler beim Abspielen des Tons:", e));
        alarmTriggered.current = true; // Markieren, dass der Ton gespielt wurde
      }
    } else {
      // Setzt den Trigger zurück, wenn die Lautstärke wieder unter dem Schwellenwert liegt
      alarmTriggered.current = false;
    }
  };

  const getMedia = () => {
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

          // Lautstärke-Warnlogik
          if (volume.current > WARNING_THRESHOLD) {
            setWarning(true);
          } else {
            setWarning(false);
          }
        };
      })
      .catch(function (err) {
        console.error("Fehler beim Zugriff auf das Mikrofon:", err);
      });
  };

  useEffect(getMedia, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      // Aktualisiert die Balken
      volumeRefs.current.unshift(volume.current);
      volumeRefs.current.pop();
      for (let i = 0; i < refs.current.length; i++) {
        if (refs.current[i]) {
          refs.current[i].style.transform = `scaleY(${
            volumeRefs.current[i] / 100
          })`;
        }
      }
    }, 20);
    return () => {
      clearInterval(intervalId);
    };
  }, []);

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
            // NEU: Gedämpftes Grün für die normalen Balken
            background: isLoud ? "red" : "#7ED321", // Hellgrün für normalen Betrieb
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
        height: settings.height + 40 + "px", // Platz für Balken + Warnung
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        // NEU: Hintergrund für den Meterbereich selbst, z.B. dunkler als das Panel
        background: "#1a2024" /* Sehr dunkles Grau */,
        padding: "10px" /* Etwas inneres Padding für den Meter-Bereich */,
        borderRadius: "5px" /* Leichte Rundung für den Meter-Bereich */,
        boxShadow:
          "inset 0 0 5px rgba(0,0,0,0.8)" /* Leichter innerer Schatten */,
      }}
    >
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
            fontFamily: "arial", // Beibehalten oder anpassen
            fontSize: "20px",
            background: "red",
            padding: "5px",
            // NEU: Leichte Text-Schatten, um es "leuchtend" zu machen
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
