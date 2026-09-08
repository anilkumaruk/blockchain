import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
// qr-scanner (1.4.x) resolves its worker script via its own internal
// `import()`, which Vite/Rollup bundles automatically — no manual
// WORKER_PATH wiring needed (that option is a deprecated no-op in this
// version and would just log a console warning if set).
import QrScanner from 'qr-scanner';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Search,
  RotateCcw,
  UserSearch,
} from 'lucide-react';
import { parseChainOfRecordQr } from '../lib/qr';

const CAMERA_SUPPORTED =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia;

/**
 * A real, camera-based QR scanner (via the qr-scanner library — decoding
 * happens locally in a Web Worker, nothing is ever uploaded). Recognizes
 * this app's two existing QR formats — a profile URL or a raw credential
 * ID — and nothing else; anything unrecognized is reported, never
 * navigated to. See lib/qr.js for the validation itself.
 */
export default function QrScanTab({ onFallback }) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const navigate = useNavigate();

  const [phase, setPhase] = useState(CAMERA_SUPPORTED ? 'starting' : 'unsupported');
  const [error, setError] = useState(null);
  const [detected, setDetected] = useState(null); // { raw, parsed }
  const [cameras, setCameras] = useState([]);

  useEffect(() => {
    if (!CAMERA_SUPPORTED) return undefined;

    let cancelled = false;

    (async () => {
      const hasCamera = await QrScanner.hasCamera();
      if (cancelled) return;
      if (!hasCamera) {
        setPhase('error');
        setError({ message: 'No camera was detected on this device.' });
        return;
      }

      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          const raw = typeof result === 'string' ? result : result.data;
          scanner.stop();
          setDetected({ raw, parsed: parseChainOfRecordQr(raw) });
          setPhase('detected');
        },
        {
          preferredCamera: 'environment',
          highlightScanRegion: true,
          highlightCodeOutline: true,
          maxScansPerSecond: 10,
        }
      );
      scannerRef.current = scanner;

      try {
        await scanner.start();
        if (cancelled) {
          scanner.destroy();
          return;
        }
        setPhase('scanning');
        QrScanner.listCameras(true).then((list) => {
          if (!cancelled) setCameras(list);
        });
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setError(mapCameraError(err));
      }
    })();

    return () => {
      cancelled = true;
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, []);

  const handleStop = () => {
    scannerRef.current?.stop();
    setPhase('stopped');
  };

  const handleScanAgain = () => {
    setDetected(null);
    setError(null);
    if (scannerRef.current) {
      setPhase('scanning');
      scannerRef.current.start().catch((err) => {
        setPhase('error');
        setError(mapCameraError(err));
      });
    } else {
      // Scanner was torn down (e.g. after a hard error) — remount the tab.
      setPhase('starting');
    }
  };

  const handleCameraChange = (e) => {
    scannerRef.current?.setCamera(e.target.value);
  };

  const handleOpen = () => {
    if (!detected?.parsed) return;
    if (detected.parsed.type === 'profile') {
      navigate(`/profile/${encodeURIComponent(detected.parsed.studentId)}`);
    } else {
      navigate(`/verify?credentialId=${encodeURIComponent(detected.parsed.credentialId)}`);
    }
  };

  if (phase === 'unsupported') {
    return (
      <ScannerMessage
        tone="warn"
        title="QR scanning is not supported in this browser."
        body="Your browser doesn't expose camera access (getUserMedia). Try a recent version of Chrome, Edge, Firefox, or Safari."
        onFallback={onFallback}
      />
    );
  }

  if (phase === 'error') {
    return (
      <ScannerMessage
        tone="warn"
        title={error?.message || 'Unable to start the camera.'}
        body={error?.detail}
        onRetry={handleScanAgain}
        onFallback={onFallback}
      />
    );
  }

  if (phase === 'detected') {
    if (!detected.parsed) {
      return (
        <ScannerMessage
          tone="invalid"
          title="Unsupported QR code"
          body="Please scan a Chain of Record candidate profile QR."
          onRetry={handleScanAgain}
          onFallback={onFallback}
        />
      );
    }
    return (
      <div className="text-center py-2">
        <div className="w-11 h-11 rounded-full bg-valid-soft flex items-center justify-center mx-auto mb-3">
          <CheckCircle2 size={22} className="text-valid" aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold mb-1">QR code detected</p>
        <p className="text-xs text-ink-soft mb-4">
          {detected.parsed.type === 'profile' ? 'Detected profile' : 'Detected credential'}
          :{' '}
          <span className="font-mono text-ink break-all">
            {detected.parsed.type === 'profile' ? detected.parsed.studentId : detected.parsed.credentialId}
          </span>
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            onClick={handleOpen}
            className="flex items-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90"
          >
            {detected.parsed.type === 'profile' ? (
              <>
                <ExternalLink size={15} aria-hidden="true" />
                Open Candidate Profile
              </>
            ) : (
              <>
                <Search size={15} aria-hidden="true" />
                View Verification Result
              </>
            )}
          </button>
          <button
            onClick={handleScanAgain}
            className="flex items-center gap-1.5 border border-border text-sm font-medium rounded-md px-4 py-2.5 hover:bg-bg"
          >
            <RotateCcw size={14} aria-hidden="true" />
            Scan again
          </button>
        </div>
      </div>
    );
  }

  // 'starting' | 'scanning' | 'stopped'
  return (
    <div>
      <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-1">
        Scan candidate QR
      </p>
      <p className="text-sm text-ink-soft mb-4">
        Point your camera at the candidate's Chain of Record QR code.
      </p>

      <div className="relative rounded-lg overflow-hidden bg-ink max-w-sm mx-auto aspect-square">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
          aria-label="Live camera preview for QR scanning"
        />
        {phase === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/70 text-white text-xs gap-2">
            <Camera size={16} className="animate-pulse" aria-hidden="true" />
            Requesting camera access…
          </div>
        )}
        {phase === 'stopped' && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/80 text-white text-xs gap-2">
            <CameraOff size={16} aria-hidden="true" />
            Camera stopped
          </div>
        )}
      </div>

      <div role="status" className="sr-only">
        {phase === 'starting' && 'Requesting camera access.'}
        {phase === 'scanning' && 'Camera active. Point it at a QR code.'}
        {phase === 'stopped' && 'Camera stopped.'}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
        {phase === 'scanning' ? (
          <button
            onClick={handleStop}
            className="flex items-center gap-1.5 border border-border text-sm font-medium rounded-md px-4 py-2.5 hover:bg-bg"
          >
            <CameraOff size={14} aria-hidden="true" />
            Stop Camera
          </button>
        ) : phase === 'stopped' ? (
          <button
            onClick={handleScanAgain}
            className="flex items-center gap-1.5 bg-teal text-white text-sm font-medium rounded-md px-4 py-2.5 hover:bg-teal/90"
          >
            <Camera size={14} aria-hidden="true" />
            Restart Camera
          </button>
        ) : null}

        {cameras.length > 1 && (
          <select
            onChange={handleCameraChange}
            aria-label="Choose camera"
            className="text-xs rounded-md border border-border bg-white px-2.5 py-2 outline-none focus:ring-2 focus:ring-teal/30"
          >
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label || 'Camera'}
              </option>
            ))}
          </select>
        )}
      </div>

      <FallbackLink onFallback={onFallback} />
    </div>
  );
}

function mapCameraError(err) {
  const name = err?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      message: 'Camera access was denied.',
      detail: 'Allow camera access in your browser settings, or use another verification method.',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { message: 'No camera was detected on this device.' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return { message: 'Unable to start the camera.', detail: 'It may be in use by another application.' };
  }
  return { message: 'Unable to start the camera.' };
}

function ScannerMessage({ tone, title, body, onRetry, onFallback }) {
  const toneClass = tone === 'invalid' ? 'bg-invalid-soft text-invalid' : 'bg-revoked-soft text-revoked';
  return (
    <div className="text-center py-4">
      <div className={`w-11 h-11 rounded-full flex items-center justify-center mx-auto mb-3 ${toneClass}`}>
        <AlertTriangle size={20} aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold mb-1">{title}</p>
      {body && <p className="text-xs text-ink-soft mb-4 max-w-sm mx-auto">{body}</p>}
      <div className="flex flex-wrap justify-center gap-2 mb-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 text-sm font-medium border border-border rounded-md px-4 py-2 hover:bg-bg"
          >
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
      <FallbackLink onFallback={onFallback} />
    </div>
  );
}

function FallbackLink({ onFallback }) {
  if (!onFallback) return null;
  return (
    <div className="mt-4 pt-4 border-t border-border">
      <p className="text-xs text-ink-soft mb-2">Having trouble scanning?</p>
      <button
        onClick={onFallback}
        className="flex items-center gap-1.5 text-xs font-medium text-teal hover:underline mx-auto"
      >
        <UserSearch size={13} aria-hidden="true" />
        Enter profile link or student ID instead
      </button>
    </div>
  );
}
