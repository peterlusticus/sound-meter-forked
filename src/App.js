import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

const settings = {
  bars: 30,
  width: 10,
  height: 200,
};

const AIRHORN_SOUND_URL = "/airhorn.mp3";

// Verzögerung: Mindestdauer der Lautstärkeüberschreitung, bevor der Alarm ausgelöst wird (gegen "Klakser")
const ALARM_DELAY_MS = 50;
// Feste Dauer des Alarms (2000ms = 2 Sekunden)
const ALARM_DURATION_MS = 2000;

// Konstanten für die Lautstärkeskala
const MAX_ANALYZER_VALUE = 255;
const MIN_THRESHOLD = 1;

// Konstanten für die dB-Skala
// AUF 90 dB gesetzt, um genügend Headroom für laute Geräusche zu haben
const MAX_DB = 90;
const MIN_DB_FLOOR = 30; // Realistischer Grundrauschpegel (z.B. ruhiger Raum)
const INITIAL_WARNING_DB = 75;

// Hilfsfunktion: Konvertiert Volumen (0-255) zu dB (0-MAX_DB)
const volumeToDb = (volume) => {
  const normalizedVolume = volume / MAX_ANALYZER_VALUE;

  // Setzt einen realistischen Grundrauschpegel für absolute Stille
  if (volume <= MIN_THRESHOLD) {
    return MIN_DB_FLOOR;
  }

  // Logarithmische Berechnung der Dezibel (20 * log10(A/A_ref) + dB_ref)
  // 20*log10 wird für Amplitudenwerte verwendet.
  let db = 20 * Math.log10(normalizedVolume) + MAX_DB;

  // Max-Wert ist MAX_DB, Minimum wird auf den Grundrauschpegel gesetzt.
  return Math.min(MAX_DB, Math.max(MIN_DB_FLOOR, db));
};

// Hilfsfunktion: Konvertiert dB (MIN_DB_FLOOR-MAX_DB) zu Volumen (0-255)
const dbToVolume = (db) => {
  // Stellt sicher, dass dB nicht unter dem Grundrauschpegel liegt
  if (db <= MIN_DB_FLOOR) return MIN_THRESHOLD;

  // Reziproke exponentielle Formel zur Umwandlung von dB in Volumen
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
  // alarmTriggered.current: Steuert, ob gerade ein Alarmzyklus (2s) aktiv ist
  const alarmTriggered = useRef(false);
  // Ref für den 2-Sekunden-Timer
  const alarmTimeoutRef = useRef(null);

  // Ref, um den aktuellen Lautstärke-Grenzwert an die Audio-Schleife zu übergeben.
  const currentVolumeThresholdRef = useRef(dbToVolume(INITIAL_WARNING_DB));

  // Synchronisiert den State mit dem Ref, wann immer der State sich ändert
  useEffect(() => {
    currentVolumeThresholdRef.current = warningThreshold;
  }, [warningThreshold]);

  useEffect(() => {
    // Stellen Sie sicher, dass Sie eine lokale oder im Browser verfügbare Audioquelle verwenden.
    // Dieser Ton wird beim Start geladen.
    airhorn.current = new Audio(AIRHORN_SOUND_URL);
    airhorn.current.loop = false;
  }, []);

  // Funktion zum Beenden des Alarms nach der festgelegten Dauer
  const resetAlarm = useCallback(() => {
    // 1. UI zurücksetzen
    setIsLoud(false);
    // 2. Ton stoppen
    if (airhorn.current) {
      airhorn.current.pause();
      airhorn.current.currentTime = 0;
    }
    // 3. Alarm-Zyklus freigeben, damit ein neuer ausgelöst werden kann
    alarmTriggered.current = false;

    // Timer aufräumen
    if (alarmTimeoutRef.current) {
      clearTimeout(alarmTimeoutRef.current);
      alarmTimeoutRef.current = null;
    }
  }, []);

  // setWarning startet jetzt NUR den 2-Sekunden-Zyklus
  const setWarning = useCallback(() => {
    // Wenn der Alarm bereits läuft, beenden wir hier
    if (alarmTriggered.current) return;

    // 1. Alarm-Zyklus starten
    alarmTriggered.current = true;

    // 2. UI und Ton starten
    setIsLoud(true);
    if (airhorn.current) {
      airhorn.current.currentTime = 0;
      airhorn.current
        .play()
        .catch((e) => console.error("Fehler beim Abspielen des Tons:", e));
    }

    // 3. Timer setzen, der den Alarm nach ALARM_DURATION_MS beendet
    alarmTimeoutRef.current = setTimeout(() => {
      resetAlarm();
    }, ALARM_DURATION_MS);
  }, [resetAlarm]);

  const getMedia = useCallback(() => {
    // audioContext muss im Scope von getMedia deklariert werden,
    // damit die Cleanup-Funktion am Ende darauf zugreifen kann.
    let audioContext;

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        audioContext = new AudioContext(); // Zuweisung hier
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
          volume.current = avgVolume; // Der aktuelle Lautstärke-Wert (0-255)

          const db = volumeToDb(avgVolume);
          currentSmoothedDb.current = db;

          // Liest den Grenzwert direkt aus dem Ref, der immer aktuell ist.
          const volumeThreshold = currentVolumeThresholdRef.current;

          const now = performance.now();
          const delta = now - lastTimeCheck.current;
          lastTimeCheck.current = now;

          // WICHTIG: Die Alarm-Logik darf nur ausgeführt werden,
          // wenn KEIN Alarm gerade aktiv ist (2-Sekunden-Timer läuft)
          if (!alarmTriggered.current) {
            // Vergleich mit dem Lautstärke-Wert des Ref (0-255)
            if (avgVolume >= volumeThreshold) {
              // Wenn zu laut: Zeit zur Duration hinzufügen
              loudnessDuration.current += delta;

              if (loudnessDuration.current >= ALARM_DELAY_MS) {
                // Alarm auslösen und 2-Sekunden-Timer starten
                setWarning();
                loudnessDuration.current = 0; // Zähler zurücksetzen
              }
            } else {
              // Nicht laut genug: Zähler zurücksetzen
              loudnessDuration.current = 0;
            }
          }
        };
      })
      .catch(function (err) {
        console.error("Fehler beim Zugriff auf das Mikrofon:", err);
      });

    // Rückgabe einer Funktion, um den AudioContext beim Unmount zu schließen
    return () => {
      // audioContext ist jetzt im Scope definiert
      if (audioContext && audioContext.state !== "closed") {
        audioContext
          .close()
          .catch((e) =>
            console.error("Fehler beim Schließen des AudioContext:", e)
          );
      }
    };
  }, [setWarning]); // Nur setWarning ist jetzt eine Abhängigkeit

  // Ruft getMedia einmal beim Start auf und verwendet die Cleanup-Funktion
  useEffect(() => {
    const cleanup = getMedia();
    return cleanup;
  }, [getMedia]);

  // Wird nur für die Anzeige im UI verwendet
  const getThresholdDb = useCallback(() => {
    return volumeToDb(warningThreshold);
  }, [warningThreshold]);

  useEffect(() => {
    // Intervall (50ms) zur Aktualisierung der ANZEIGE
    const intervalId = setInterval(() => {
      volumeRefs.current.unshift(volume.current);
      volumeRefs.current.pop();

      // Aktualisiert den sichtbaren DB-Wert
      setCurrentDb(currentSmoothedDb.current);

      const thresholdDb = getThresholdDb();
      for (let i = 0; i < refs.current.length; i++) {
        if (refs.current[i]) {
          const barVolume = volumeRefs.current[i];
          // Färbung basiert auf der Lautstärke der einzelnen Balken
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

    // WICHTIG: setWarningThreshold wird auch bei ungültigen Eingaben NICHT aktualisiert
    // Die Max-Grenze ist jetzt 90 dB, Min-Grenze ist 30 dB (Grundrauschpegel).
    if (isNaN(db) || db < MIN_DB_FLOOR || db > MAX_DB) {
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
            // Die Minimum- und Maximum-Werte des Eingabefelds wurden an die neue MAX_DB und den Rauschpegel angepasst.
            min={MIN_DB_FLOOR.toFixed(0)}
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
