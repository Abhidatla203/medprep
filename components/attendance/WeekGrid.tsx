"use client";

import { useMemo } from "react";
import {
  DAYS,
  subjectName,
  typeMeta,
  type ClassType,
} from "@/lib/attendance/curriculum";

export type ClassBlock = {
  id: string;
  day: number;
  subjectId: string;
  type: ClassType;
  start: string;
  end: string;
  weight?: number;
};

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

const fmt = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hh} ${ampm}` : `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
};

const LANE_H = 56;

export default function WeekGrid({
  blocks,
  onAdd,
  onRemove,
  onEdit,
  showSunday = false,
}: {
  blocks: ClassBlock[];
  onAdd?: (day: number) => void;
  onRemove?: (id: string) => void;
  onEdit?: (block: ClassBlock) => void;
  showSunday?: boolean;
}) {
  const days = useMemo(
    () =>
      showSunday || blocks.some((b) => b.day === 0)
        ? DAYS
        : DAYS.filter((d) => d.index !== 0),
    [blocks, showSunday]
  );

  // Axis hugs the real data. No padding hours before the first class.
  const { startMin, endMin } = useMemo(() => {
    if (blocks.length === 0) return { startMin: 9 * 60, endMin: 17 * 60 };
    const lo = Math.min(...blocks.map((b) => toMin(b.start)));
    const hi = Math.max(...blocks.map((b) => toMin(b.end)));
    const floorLo = Math.floor(lo / 60) * 60;
    const ceilHi = Math.ceil(hi / 60) * 60;
    return {
      startMin: floorLo,
      endMin: Math.max(ceilHi, floorLo + 4 * 60), // keep a 4-hour minimum span
    };
  }, [blocks]);

  const span = endMin - startMin;
  const hours = Array.from(
    { length: Math.ceil(span / 60) + 1 },
    (_, i) => startMin + i * 60
  );
  const pct = (m: number) => ((m - startMin) / span) * 100;

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950">
      <div className="min-w-[980px]">

        {/* Hour ruler */}
        <div className="flex border-b border-neutral-800">
          <div className="w-36 shrink-0 px-3 py-2 text-xs font-medium text-neutral-500">
            Day
          </div>
          <div className="relative h-9 flex-1">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute top-0 h-full border-l border-neutral-800/70 pl-1 text-[11px] text-neutral-500"
                style={{ left: `${pct(h)}%` }}
              >
                {fmt(`${String(Math.floor(h / 60)).padStart(2, "0")}:00`)}
              </div>
            ))}
          </div>
        </div>

        {/* One row per day */}
        {days.map((day) => {
          const dayBlocks = blocks
            .filter((b) => b.day === day.index)
            .sort((a, b) => toMin(a.start) - toMin(b.start));

          const laneEnds: number[] = [];
          const placed = dayBlocks.map((b) => {
            const s = toMin(b.start);
            const e = toMin(b.end);
            let lane = laneEnds.findIndex((end) => end <= s);
            if (lane === -1) lane = laneEnds.length;
            laneEnds[lane] = e;
            return { b, s, e, lane };
          });

          const rowH = Math.max(1, laneEnds.length) * LANE_H + 16;

          return (
            <div
              key={day.index}
              className="flex border-b border-neutral-800 last:border-b-0"
            >
              <div className="w-36 shrink-0 px-3 py-4">
                <div className="text-sm font-semibold text-neutral-100">
                  {day.label}
                </div>
                <div className="text-[11px] text-neutral-500">
                  {dayBlocks.length === 0
                    ? "Free"
                    : `${dayBlocks.length} class${dayBlocks.length > 1 ? "es" : ""}`}
                </div>
                {onAdd && (
                  <button
                    onClick={() => onAdd(day.index)}
                    className="mt-2 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                  >
                    + Add class
                  </button>
                )}
              </div>

              <div className="relative flex-1" style={{ height: rowH }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute bottom-0 top-0 border-l border-neutral-800/50"
                    style={{ left: `${pct(h)}%` }}
                  />
                ))}

                {placed.map(({ b, s, e, lane }) => {
                  const meta = typeMeta(b.type);
                  const width = ((e - s) / span) * 100;
                  return (
                    <div
                      key={b.id}
                      onClick={() => onEdit?.(b)}
                      className={`absolute flex cursor-pointer flex-col justify-center overflow-hidden rounded-md border-l-4 px-2 ${meta.tile} ${meta.border}`}
                      style={{
                        top: 8 + lane * LANE_H,
                        height: LANE_H - 8,
                        left: `${pct(s)}%`,
                        width: `${Math.max(width, 8)}%`,
                      }}
                      title={`${subjectName(b.subjectId)} · ${meta.label} · ${fmt(b.start)}–${fmt(b.end)}`}
                    >
                      <div className="truncate pr-4 text-sm font-bold text-neutral-50">
                        {subjectName(b.subjectId)}
                      </div>
                      <div
                        className={`flex items-center gap-1 truncate text-[10px] ${meta.text}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                        {width > 14 ? meta.label : meta.badge} · {fmt(b.start)}–{fmt(b.end)}
                      </div>
                      {onRemove && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onRemove(b.id);
                          }}
                          className="absolute right-1 top-1 text-neutral-500 hover:text-white"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
