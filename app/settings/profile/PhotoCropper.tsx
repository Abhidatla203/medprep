"use client";

// =============================================================================
// app/settings/profile/PhotoCropper.tsx
// -----------------------------------------------------------------------------
// Drag-and-zoom circular crop, exported as a JPEG data URL.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ WHY FileReader AND NOT URL.createObjectURL — THE BLACK CIRCLE BUG
// ═════════════════════════════════════════════════════════════════════════════
// The obvious implementation is an object URL created once at mount:
//
//     const [url] = useState(() => URL.createObjectURL(file));
//     useEffect(() => () => URL.revokeObjectURL(url), [url]);
//
// It produces a permanently black circle in development, and the reason is
// worth knowing because it will bite again:
//
//   1. StrictMode mounts the component, runs effects, then UNMOUNTS and
//      REMOUNTS it — deliberately, to surface exactly this class of bug.
//   2. The simulated unmount runs the cleanup, which REVOKES the URL.
//   3. The remount preserves state, so `url` is the same string — but it now
//      points at nothing. The browser cannot load it.
//   4. onLoad never fires, dims stays null, ready stays false: black circle,
//      dead zoom slider, and no error in the console.
//
// A data URL cannot be revoked, so the whole failure mode disappears.
//
// ⚠ AND THE setState RULE IS STILL HONOURED. react-hooks/set-state-in-effect
//   forbids setState in an effect BODY. Calling it from an asynchronous
//   CALLBACK of an external system is the documented, correct use of an
//   effect — which is exactly what reader.onload is.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ REMOUNT, DON'T RESET.
// ═════════════════════════════════════════════════════════════════════════════
// The parent mounts this ONLY while cropping, keyed on the file. A new file
// means a new key means a genuinely new component, so zoom and offset start
// fresh with no reset logic at all. `file` is therefore never null here.
//
// ═════════════════════════════════════════════════════════════════════════════
//  ⚠ IMAGE SIZE COMES FROM STATE, NOT FROM THE REF.
// ═════════════════════════════════════════════════════════════════════════════
// size() used to read imgRef.current.naturalWidth during render. Refs are not
// render inputs: changing one re-renders nothing, so the layout could be built
// from dimensions React had never seen. Dimensions now arrive via onLoad into
// state, which is a real render input.
// =============================================================================

import { useEffect, useRef, useState } from "react";

/** On-screen crop circle, in CSS pixels. */
const VIEW = 280;

/** Exported image, square. 512 survives a retina avatar without bloating. */
const OUT = 512;

/**
 * Data-URL size ceiling.
 *
 * ⚠ NOT cosmetic. The photo is written to BOTH localStorage keys, so it costs
 *   twice this. localStorage caps at roughly 5 MB, and when it overflows
 *   persist() swallows the error and EVERY setting silently stops saving.
 *   (SM-8)
 */
const MAX_BYTES = 350_000;

type Props = {
  /** Never null — the parent only mounts this while cropping. */
  file: File;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
};

export default function PhotoCropper({ file, onCancel, onConfirm }: Props) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // ★ Natural dimensions, from onLoad. State, not a ref.
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  /**
   * ✅ A legitimate effect: it drives an external system (FileReader) and only
   *    calls setState from its CALLBACKS, never from the body.
   *
   *    `cancelled` guards the case where the component unmounts mid-read —
   *    without it, a late callback would setState on a dead component.
   */
  useEffect(() => {
    let cancelled = false;
    const reader = new FileReader();

    reader.onload = () => {
      if (cancelled) return;
      setUrl(typeof reader.result === "string" ? reader.result : null);
    };

    reader.onerror = () => {
      if (!cancelled) setFailed(true);
    };

    reader.readAsDataURL(file);

    return () => {
      cancelled = true;
      reader.abort();
    };
  }, [file]);

  // ---- Derived geometry. Pure, correct on the first paint. ----
  const ready = url !== null && dims !== null;
  const imgW = dims?.w ?? 1;
  const imgH = dims?.h ?? 1;

  // "Cover": the smallest scale that still fills the circle in both axes, so
  // there is never a gap at the edge.
  const baseScale = Math.max(VIEW / imgW, VIEW / imgH);
  const scale = baseScale * zoom;

  /**
   * Keep the image covering the circle — no empty corners.
   *
   * ⚠ Takes the scale explicitly. An earlier version closed over `zoom`, so
   *   the slider clamped against the PREVIOUS zoom and a fast drag could leave
   *   a sliver of background showing.
   */
  function clampAt(next: { x: number; y: number }, s: number) {
    const maxX = Math.max(0, (imgW * s - VIEW) / 2);
    const maxY = Math.max(0, (imgH * s - VIEW) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!ready) return;
    // Pointer capture keeps the drag alive when the finger leaves the circle.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    setOffset(
      clampAt({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }, scale),
    );
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function onZoom(nextZoom: number) {
    const nextScale = baseScale * nextZoom;
    setZoom(nextZoom);
    // Re-clamp against the NEW scale — zooming out can strand the image
    // off-centre otherwise.
    setOffset((prev) => clampAt(prev, nextScale));
  }

  /**
   * Draw the visible circle to a canvas and hand back a JPEG data URL.
   *
   * Reading imgRef here is correct: this is an event handler, not render.
   */
  async function confirm() {
    const img = imgRef.current;
    if (!img || !ready) return;

    setBusy(true);

    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }

    // Slate backdrop behind any transparency — a PNG with a clear background
    // would otherwise export as black.
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, OUT, OUT);

    // Convert on-screen placement back into source-image coordinates.
    const left = (VIEW - imgW * scale) / 2 + offset.x;
    const top = (VIEW - imgH * scale) / 2 + offset.y;
    ctx.drawImage(img, -left / scale, -top / scale, VIEW / scale, VIEW / scale, 0, 0, OUT, OUT);

    // Step quality down until it fits. Quality first, because a slightly soft
    // avatar beats a hard failure.
    let quality = 0.82;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > MAX_BYTES && quality > 0.45) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }

    // Still too big at minimum quality — shrink the pixels instead.
    if (dataUrl.length > MAX_BYTES) {
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

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Align photo"
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-semibold text-slate-200">Align photo</h3>

        <div
          className="relative mx-auto mt-4 overflow-hidden rounded-full border border-slate-700 bg-slate-950"
          // touchAction none stops the phone scrolling the page mid-drag.
          style={{
            width: VIEW,
            height: VIEW,
            touchAction: "none",
            cursor: ready ? "grab" : "default",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              onLoad={(e) =>
                setDims({
                  w: e.currentTarget.naturalWidth || 1,
                  h: e.currentTarget.naturalHeight || 1,
                })
              }
              onError={() => setFailed(true)}
              className="absolute max-w-none select-none"
              // Unsized until the dimensions land, so there is no flash of a
              // wrongly scaled image.
              style={{
                width: ready ? imgW * scale : undefined,
                height: ready ? imgH * scale : undefined,
                left: ready ? (VIEW - imgW * scale) / 2 + offset.x : 0,
                top: ready ? (VIEW - imgH * scale) / 2 + offset.y : 0,
                visibility: ready ? "visible" : "hidden",
              }}
            />
          )}

          {/* Something to look at while the file is being read, and an honest
              message if it cannot be. A silent black circle is the worst of
              both — see the header note. */}
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-slate-500">
              {failed ? "That file could not be read as an image." : "Loading…"}
            </div>
          )}
        </div>

        <label className="mt-4 block">
          <span className="text-xs font-semibold text-slate-300">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            disabled={!ready}
            onChange={(e) => onZoom(Number(e.target.value))}
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
