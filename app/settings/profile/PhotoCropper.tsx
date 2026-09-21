"use client";

import { useEffect, useRef, useState } from "react";

const VIEW = 280;
const OUT = 512;

type Props = {
  file: File | null;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
};

export default function PhotoCropper({ file, onCancel, onConfirm }: Props) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [url, setUrl] = useState("");
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    setReady(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(next);
  }, [file]);

  function size() {
    const img = imgRef.current;
    if (!img) return { imgW: 1, imgH: 1, scale: 1 };
    const imgW = img.naturalWidth || 1;
    const imgH = img.naturalHeight || 1;
    const base = Math.max(VIEW / imgW, VIEW / imgH);
    return { imgW, imgH, scale: base * zoom };
  }

  function clamp(next: { x: number; y: number }) {
    const { imgW, imgH, scale } = size();
    const maxX = Math.max(0, (imgW * scale - VIEW) / 2);
    const maxY = Math.max(0, (imgH * scale - VIEW) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    setOffset(
      clamp({
        x: dragRef.current.ox + (e.clientX - dragRef.current.x),
        y: dragRef.current.oy + (e.clientY - dragRef.current.y),
      })
    );
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  async function confirm() {
    const img = imgRef.current;
    if (!img) return;
    setBusy(true);
    const { scale } = size();
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, OUT, OUT);
    const left = (VIEW - img.naturalWidth * scale) / 2 + offset.x;
    const top = (VIEW - img.naturalHeight * scale) / 2 + offset.y;
    const sx = -left / scale;
    const sy = -top / scale;
    const sw = VIEW / scale;
    const sh = VIEW / scale;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT, OUT);

    let quality = 0.82;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > 350000 && quality > 0.45) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > 350000) {
      const small = document.createElement("canvas");
      small.width = 320;
      small.height = 320;
      const sctx = small.getContext("2d");
      if (sctx) {
        sctx.drawImage(canvas, 0, 0, 320, 320);
        dataUrl = small.toDataURL("image/jpeg", 0.7);
      }
    }
    setBusy(false);
    onConfirm(dataUrl);
  }

  if (!file) return null;

  const { imgW, imgH, scale } = size();

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-semibold text-slate-200">Align photo</h3>
        <div
          className="relative mx-auto mt-4 overflow-hidden rounded-full border border-slate-700 bg-slate-950"
          style={{ width: VIEW, height: VIEW, touchAction: "none", cursor: "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              onLoad={() => setReady(true)}
              className="absolute max-w-none select-none"
              style={{
                width: ready ? imgW * scale : undefined,
                height: ready ? imgH * scale : undefined,
                left: ready ? (VIEW - imgW * scale) / 2 + offset.x : 0,
                top: ready ? (VIEW - imgH * scale) / 2 + offset.y : 0,
              }}
            />
          ) : null}
        </div>
        <label className="mt-4 block">
          <span className="text-xs font-semibold text-slate-300">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => {
              const next = Number(e.target.value);
              setZoom(next);
              setOffset((prev) => clamp(prev));
            }}
            className="mt-2 w-full"
          />
        </label>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!ready || busy}
            className="flex-1 rounded-xl bg-teal-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
          >
            {busy ? "Saving" : "Use photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
