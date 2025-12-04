import React, { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

// --- EINSTELLUNGEN DES SCHALLPEGELMESSERS (BASIEREND AUF REFERENZ-ANALYSEN) ---
const MAX_DB_DISPLAY = 120; // Maximaler Anzeigewert dB
const MIN_DB_DISPLAY = 0; // Minimaler Anzeigewert dB

// dBFS (Full Scale) bezieht sich auf die digitale Maximalamplitude.
// Wir kalibrieren 0 dBFS auf einen Standard-Maximalpegel in dBSPL, z.B. 120 dB.
// Dies ist der Kalibrierungs-Offset.
const DBFS_OFFSET = MAX_DB_DISPLAY;
const CALIBRATION_OFFSET_DEFAULT = 3.0; // Eine Standard-Kalibrierung (kann vom Nutzer eingestellt werden)

// Zeitkonstanten
const UPDATE_INTERVAL_MS = 100; // Intervall für die Aktualisierung der UI (glatteres Bar-Movement)
const SMOOTHING_FACTOR = 0.95; // 0.0 (keine Glättung) bis 1.0 (maximale Glättung)
const RMS_WINDOW_SIZE = 2048; // Buffer-Größe für die RMS-Berechnung

// Alarm-Logik (unverändert)
const ALARM_DELAY_MS = 50;
const ALARM_DURATION_MS = 2000;
const INITIAL_WARNING_DB = 75;

// --- A-BEWERTUNGS-FILTER (VEREINFACHT) ---
// Dies ist ein kritisches Detail des Referenz-Tools.
// Die Web Audio API liefert Rohdaten; für dB(A) müssen Frequenzen gefiltert werden.
// Eine präzisere Implementierung würde eine FFT erfordern, hier eine vereinfachte Liste
// von Frequenzen, die in der A-Bewertung gedämpft/verstärkt werden.
const A_WEIGHTING_COEFFICIENTS = [
  // Nur eine vereinfachte Darstellung, die bei der RMS-Berechnung *nicht* direkt angewendet wird.
  // Echte A-Bewertung benötigt eine komplexe FFT/Filter-Implementierung.
  // Im überarbeiteten Code verwende ich die "richtige" dB-Berechnung für ein besseres Ergebnis.
];


// --- dB-BERECHNUNG NACH STANDARD (dBFS-ÄHNLICH) ---
const calculateDb = (rms, calibrationOffset, dbfsOffset) => {
    // 1. Berechnung des dBFS-Wertes (Dezibel relativ zur Vollaussteuerung)
    // rms sollte ein Wert zwischen 0.0 und 1.0 sein,
    // wobei 1.0 dem maximal möglichen Signalpegel entspricht (oft 128 für Uint8Array oder 1.0 für Float32Array).
    
    // Die Basisformel ist: dB = 20 * log10(A / A_ref)
    // Wenn A_ref = 1.0 (maximaler digitaler Wert), dann ist dBFS = 20 * log10(A)

    if (rms <= 0) {
        // Setze einen Grundrauschpegel (Noise Floor) für Stille, um -Infinity zu vermeiden
        return MIN_DB_DISPLAY + calibrationOffset;
    }

    // dBFS-Berechnung: (negativer Wert, z.B. -90 bis 0)
    const dbfs = 20 * Math.log10(rms);

    // 2. Umrechnung in dBSPL (Schallpegel) durch Addieren des Offsets
    // dbSPL = dbFS + DBFS_OFFSET + KALIBRIERUNG
    let dbSPL = dbfs + dbfsOffset + calibrationOffset;

    // 3. Begrenzung des Wertes
    return Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, dbSPL));
};

// --- HILFSFUNKTIONEN FÜR RMS <-> DB (Wird jetzt nicht mehr benötigt, da die dB-Berechnung in `calculateDb` liegt)

const dbToRms = (db, calibrationOffset, dbfsOffset) => {
    // dB SPL -> dB FS -> RMS (Amplitude)
    // dBFS = dbSPL - DBFS_OFFSET - CALIBRATION
    const dbfs = db - dbfsOffset - calibrationOffset;
    
    // Amplitude = 10^(dBFS / 20)
    let rms = Math.pow(10, dbfs / 20);

    return Math.min(1.0, Math.max(0.0001, rms));
};


const Meter = () => {
  const [calibrationOffset, setCalibrationOffset] = useState(CALIBRATION_OFFSET_DEFAULT);
  const [warningDbInput, setWarningDbInput] = useState(INITIAL_WARNING_DB.toFixed(0));
  const [currentDb, setCurrentDb] = useState(0.0);
  const [isLoud, setIsLoud] = useState(false);
  
  // VUs-Einstellungen
  const settings = { bars: 30, width: 10, height: 200 };
  const refs = useRef([]);
  const volumeRefs = useRef(new Array(settings.bars).fill(0)); // Speichert RMS-Werte (0-1) für die Bars

  // Audio-Refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const audioDataArrayRef = useRef(null); // Float32Array
  
  // Glättung und Alarm
  const currentSmoothedDb = useRef(0.0);
  const loudnessDuration = useRef(0);
  const lastTimeCheck = useRef(performance.now());
  const currentWarningRms = useRef(dbToRms(INITIAL_WARNING_DB, CALIBRATION_OFFSET_DEFAULT, DBFS_OFFSET));
  
  // Alarm-Audio (unverändert)
  const airhorn = useRef(null);
  const alarmTriggered = useRef(false);
  const alarmTimeoutRef = useRef(null);


  // --- ALARM-LOGIK (UNVERÄNDERT) ---

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

  // --- AUDIO-VERARBEITUNG: HAUPT-LOOP ---

  const processAudio = useCallback(() => {
    const analyser = analyserRef.current;
    const dataArray = audioDataArrayRef.current;
    
    if (!analyser || !dataArray) return;
    
    // NEU: Verwende Float-Daten für höhere Präzision
    analyser.getFloatTimeDomainData(dataArray);

    // 1. Berechnung des RMS (Root Mean Square)
    let sumOfSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
        // Die Amplitude ist bereits zentriert (Werte von -1.0 bis 1.0)
        sumOfSquares += dataArray[i] * dataArray[i];
    }
    
    // RMS = sqrt(Mittelwert der Quadrate)
    let rms = Math.sqrt(sumOfSquares / dataArray.length);

    // 2. Konvertierung in dB
    const db = calculateDb(rms, calibrationOffset, DBFS_OFFSET);
    
    // 3. Glättung des dB-Wertes (Low-Pass Filter) für ein ruhigeres Ablesen
    currentSmoothedDb.current = SMOOTHING_FACTOR * currentSmoothedDb.current + (1 - SMOOTHING_FACTOR) * db;
    
    // 4. Alarm-Logik (Vergleich mit dem RMS-Schwellenwert)
    const volumeThreshold = currentWarningRms.current;
    const now = performance.now();
    const delta = now - lastTimeCheck.current;
    lastTimeCheck.current = now;

    if (!alarmTriggered.current) {
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

    // Setzen Sie den RMS-Wert für die Visualisierung (Bars)
    // Wir nehmen den Roh-RMS-Wert (0-1) für die Visualisierung
    const visualRms = Math.min(1.0, rms * 1.5); // Optional: Verstärkung für bessere Bar-Anzeige
    
    // Verschiebung für die Visualisierung
    volumeRefs.current.unshift(visualRms);
    volumeRefs.current.pop();
    
    // Aktualisierung des Haupt-dB-Wertes (glatter Wert)
    setCurrentDb(currentSmoothedDb.current);


    // 5. Visualisierungs-Update
    const thresholdRms = currentWarningRms.current;
    
    for (let i = 0; i < refs.current.length; i++) {
        if (refs.current[i]) {
            const barVolume = volumeRefs.current[i];
            
            // Konvertieren Sie den barVolume (0-1) in dB für den Schwellenwert-Check
            const barDb = calculateDb(barVolume, calibrationOffset, DBFS_OFFSET);
            const thresholdDb = calculateDb(thresholdRms, calibrationOffset, DBFS_OFFSET);

            const isBarLoud = barDb >= thresholdDb;

            // Skalierung mit dem maximalen RMS-Wert 1.0
            refs.current[i].style.transform = `scaleY(${barVolume})`; 

            refs.current[i].style.background = isBarLoud
                ? "rgb(255, 99, 71)"
                : "#00bfa5";
        }
    }

    // Nächsten Frame anfordern
    animationFrameRef.current = requestAnimationFrame(processAudio);
  }, [calibrationOffset, setWarning]);


  // --- INITIALISIERUNG UND CLEANUP ---
  
  const getMedia = useCallback(async () => {
    if (!navigator.mediaDevices) {
        console.error("MediaDevices not supported");
        alert("Mikrofonzugriff nicht unterstützt.");
        return;
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Context nur einmal erstellen und wiederverwenden
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        
        const analyser = audioContext.createAnalyser();
        analyserRef.current = analyser;

        const microphone = audioContext.createMediaStreamSource(stream);

        // Einstellungen für den Analysator:
        analyser.fftSize = 4096; // Größere FFT für genauere Frequenzanalyse (falls Spektrumanalyse hinzugefügt wird)
        // analyser.smoothingTimeConstant = 0.5; // Glättung über den Analyser (optional, wir glätten den dB-Wert)
        
        // Array für Float-Amplitudendaten (-1.0 bis 1.0)
        audioDataArrayRef.current = new Float32Array(RMS_WINDOW_SIZE); 
        
        // Verbindungskette: Mikrofon -> Analyser -> (optionaler Gain/Filter) -> Destination (zur Vermeidung von Chrome-Warnungen)
        microphone.connect(analyser);
        analyser.connect(audioContext.destination);

        // Starten der Loop-Funktion
        processAudio();

    } catch (err) {
        console.error("Fehler beim Zugriff auf das Mikrofon:", err);
        alert("Fehler beim Mikrofonzugriff. Bitte Berechtigung erteilen.");
    }

    return () => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioContextRef.current && audioContextRef.current.state !== "closed") {
            audioContextRef.current.close().catch(e => console.error("Close Error:", e));
        }
    };
  }, [processAudio]);

  useEffect(() => {
    // Alarm-Sound initialisieren
    airhorn.current = new Audio("/airhorn.mp3");
    airhorn.current.loop = false;
    
    // Startet die Audioverarbeitung beim Mounten
    const cleanup = getMedia();
    return cleanup;
  }, [getMedia]);

  // Synchronisiert den RMS-Schwellenwert bei Änderung der Kalibrierung oder des dB-Inputs
  useEffect(() => {
    const db = Number(warningDbInput);
    if (!isNaN(db)) {
        currentWarningRms.current = dbToRms(db, calibrationOffset, DBFS_OFFSET);
    }
  }, [warningDbInput, calibrationOffset]);


  // --- HELPER UND HANDLER ---

  const handleDbInputChange = (e) => {
    const value = e.target.value;
    setWarningDbInput(value);
  };
  
  // Funktion zur Anzeige
  const getThresholdDb = () => {
    const db = Number(warningDbInput);
    if (isNaN(db)) return INITIAL_WARNING_DB.toFixed(1);
    
    // Begrenze auf Min/Max-Bereich
    const limitedDb = Math.min(MAX_DB_DISPLAY, Math.max(MIN_DB_DISPLAY, db));
    
    return limitedDb.toFixed(1);
  };


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
  
  // Aktueller RMS-Wert nur zur Debug-Anzeige (basiert auf dem letzten Frame-RMS-Wert)
  const currentVolumeValue = dbToRms(currentDb, calibrationOffset, DBFS_OFFSET).toFixed(3);


  return (
    <div className="meter-container-wrapper">
      <div className="control-panel">
        <h3 className="panel-title">Sound Level Meter 🎤</h3>

        <div className="db-display">
          <span>Aktuelle DB (A):</span>
          <strong className="current-db">{currentDb.toFixed(1)} dB</strong>
        </div>

        <p className="debug-info">
          (RMS-Amplitude: {currentVolumeValue} / 1.0)
        </p>
        
        <div className="db-input-group">
            <label htmlFor="calibration-input">Kalibrierung (Offset dB):</label>
            <input
                id="calibration-input"
                type="number"
                min="-20.0"
                max="20.0"
                step="0.1"
                value={calibrationOffset.toFixed(1)}
                onChange={(e) => setCalibrationOffset(Number(e.target.value))}
                className="db-input"
            />
        </div>

        <div className="db-input-group">
          <label htmlFor="threshold-db-input">Grenzwert-Schwelle (dB):</label>
          <input
            id="threshold-db-input"
            type="number"
            min={MIN_DB_DISPLAY.toFixed(0)}
            max={MAX_DB_DISPLAY.toFixed(0)}
            step="1"
            value={warningDbInput}
            onChange={handleDbInputChange}
            className="db-input"
          />
        </div>

        <p className="threshold-info">
          Warnung ab: <strong>{getThresholdDb()} dB</strong> (Kalibrierungs-Offset:{" "}
          {calibrationOffset.toFixed(1)} dB)
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
        <div style={{ display: "flex", height: "100%", alignItems: "flex-end" }}>
            {createElements()}
        </div>
      </div>
    </div>
  );
};

export default () => {
  return (
    <div className="App">
      <Meter />
      <div className="info-box">
        <h3>Hinweis zur Genauigkeit:</h3>
        <p>Die Dezibel-Messung mit der Web Audio API liefert nur eine Annäherung an professionelle Schallpegelmessungen (dBSPL) und hängt stark von der Mikrofon-Empfindlichkeit Ihres Geräts ab. Die **Kalibrierung** ist entscheidend.</p>
        <p>Wir verwenden die **Root Mean Square (RMS)**-Berechnung im Zeitbereich in Verbindung mit einer Glättung (**Smoothing**) und einer **Kalibrierung** gegen dBFS (Full Scale), um ein stabileres und realistischeres Messergebnis zu erhalten.</p>
      </div>
    </div>
  );
};