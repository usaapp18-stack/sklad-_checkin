import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, X, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (warehouseCode: string, secretToken?: string) => void;
  expectedWarehouseCode?: string;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [detectedCode, setDetectedCode] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const animationFrameId = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setDetectedCode(null);
      setErrorMsg(null);
      return;
    }

    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    setErrorMsg(null);
    setIsScanning(true);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Камера не поддерживается вашим браузером');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        scanFrame();
      }
    } catch (err: any) {
      console.warn('Camera access failed:', err);
      let msg = 'Не удалось получить доступ к камере';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Разрешите доступ к камере в настройках браузера для сканирования QR-кода склада';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'Камера на устройстве не обнаружена';
      }
      setErrorMsg(msg);
      setIsScanning(false);
    }
  };

  const stopCamera = () => {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsScanning(false);
  };

  const scanFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animationFrameId.current = requestAnimationFrame(scanFrame);
      return;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });

    if (code && code.data) {
      handleCodeFound(code.data);
      return;
    }

    animationFrameId.current = requestAnimationFrame(scanFrame);
  };

  const handleCodeFound = (rawData: string) => {
    stopCamera();

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(80);
      } catch {
        // ignore
      }
    }

    let warehouseCode = '';
    let secretToken = '';

    try {
      if (rawData.includes('checkin_warehouse=')) {
        const parsed = new URL(rawData);
        warehouseCode = parsed.searchParams.get('checkin_warehouse') || '';
        secretToken = parsed.searchParams.get('token') || '';
      } else if (rawData.startsWith('SKLADIN:WAREHOUSE:') || rawData.startsWith('SKLADSHIFT:WAREHOUSE:')) {
        const parts = rawData.split(':');
        warehouseCode = parts[3] || parts[2] || '';
        secretToken = parts[4] || '';
      } else if (rawData.includes(':')) {
        const parts = rawData.split(':');
        warehouseCode = parts[0];
        secretToken = parts[1] || '';
      } else {
        warehouseCode = rawData.trim();
      }
    } catch {
      warehouseCode = rawData.trim();
    }

    setDetectedCode(warehouseCode);

    setTimeout(() => {
      onScanSuccess(warehouseCode, secretToken);
      onClose();
    }, 600);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    onScanSuccess(manualCode.trim());
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto"
    >
      <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-sm overflow-hidden my-auto text-[#111111] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between p-3.5 border-b border-[#e5e7eb] bg-[#f7f9ff] shrink-0">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-[#2f63ff]" />
            <span className="text-sm font-semibold text-[#111111]">Сканирование QR склада</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera Viewfinder */}
        <div className="p-4 space-y-4 flex flex-col items-center">
          
          <div className="relative w-64 h-64 sm:w-72 sm:h-72 rounded-md overflow-hidden bg-[#111111] border border-[#d9dbe0] flex items-center justify-center">
            {/* Live Video Feed */}
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
            />

            {/* Hidden Processing Canvas */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Target Reticle / Scanner Overlay */}
            {isScanning && !detectedCode && (
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                <div className="w-48 h-48 border-2 border-[#a9bcff]/80 rounded-md relative">
                  <span className="absolute -top-1 -left-1 w-4 h-4 border-t-3 border-l-3 border-[#2f63ff]" />
                  <span className="absolute -top-1 -right-1 w-4 h-4 border-t-3 border-r-3 border-[#2f63ff]" />
                  <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-3 border-l-3 border-[#2f63ff]" />
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-3 border-r-3 border-[#2f63ff]" />
                  <div className="w-full h-0.5 bg-[#2f63ff] opacity-90 absolute top-1/2 -translate-y-1/2" />
                </div>
                <span className="text-[11px] text-white font-medium bg-[#111111]/90 px-3 py-1 rounded mt-3 border border-[#5d6270]">
                  Наведите на QR на проходной
                </span>
              </div>
            )}

            {/* Success Confirmation */}
            {detectedCode && (
              <div className="absolute inset-0 bg-[#111111]/95 flex flex-col items-center justify-center p-4 text-center animate-fade-in border border-[#2f63ff]">
                <CheckCircle2 className="w-10 h-10 text-[#a9bcff] mb-2" />
                <span className="text-white font-bold text-sm">QR распознан</span>
                <span className="text-[#a9bcff] font-mono text-xs mt-1">Склад: {detectedCode}</span>
              </div>
            )}

            {/* Error state */}
            {errorMsg && (
              <div className="absolute inset-0 bg-[#f7f9ff] p-4 flex flex-col items-center justify-center text-center space-y-2">
                <AlertCircle className="w-8 h-8 text-rose-600" />
                <span className="text-xs text-rose-800 font-medium leading-snug">{errorMsg}</span>
                <button
                  onClick={startCamera}
                  className="mt-2 px-3 py-1.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white text-xs font-semibold rounded flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Повторить</span>
                </button>
              </div>
            )}
          </div>

          {/* Fallback Manual Code Entry Toggle */}
          <div className="w-full text-center space-y-2">
            {!showManualInput ? (
              <button
                type="button"
                onClick={() => setShowManualInput(true)}
                className="text-xs text-[#2f63ff] hover:text-[#1f4fe0] font-medium underline transition-colors cursor-pointer"
              >
                Камера не работает? Ввести код склада вручную
              </button>
            ) : (
              <form onSubmit={handleManualSubmit} className="space-y-2 text-left w-full pt-2 border-t border-[#e5e7eb]">
                <label className="block text-[11px] text-[#2d313b] font-semibold">Код склада на проходной:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Например: СК-1"
                    value={manualCode}
                    onChange={e => setManualCode(e.target.value.toUpperCase())}
                    className="flex-1 px-3 py-1.5 bg-white border border-[#d9dbe0] rounded text-[#111111] font-mono text-xs uppercase focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold text-xs rounded cursor-pointer transition-colors"
                  >
                    Готово
                  </button>
                </div>
              </form>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};
