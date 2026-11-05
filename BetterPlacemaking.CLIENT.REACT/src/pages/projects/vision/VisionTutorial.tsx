import { useEffect, useRef, useState } from "react";

/**
 * Ported from the Angular vision-tutorial/{vision-tutorial.ts,.html}. Purely
 * client-side: a spotlight walkthrough over DOM elements identified by id
 * (see the `id="tutorial-*"` anchors in Vision.tsx). No backend involved.
 */

interface TutorialStep {
  title: string;
  description: string;
  targetElementId: string | null;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const STEPS: TutorialStep[] = [
  {
    title: "Welcome to the Vision Dashboard",
    description:
      "This is your calibration control center. Let's walk through each section so you know exactly what to do to get your cameras ready for people tracking.",
    targetElementId: null,
  },
  {
    title: "Calibration Snapshot",
    description:
      "These cards show real-time progress across all cameras: how many have intrinsics calibrated, homographies computed, and ArUco lock complete. Green means done, red means action needed.",
    targetElementId: "tutorial-stat-bar",
  },
  {
    title: "Cameras",
    description:
      "Each card represents one camera. Click it to open per-camera calibration. The I / H / A badges show Intrinsics, Homography, and ArUco lock status. Green is complete, grey is not yet done.",
    targetElementId: "tutorial-cameras-panel",
  },
  {
    title: "Board Library",
    description:
      "Generate and save printable ChArUco or ArUco calibration boards here. During intrinsics and homography calibration you'll need a ChArUco board in front of each camera. During ArUco lock, you'll need multiple ArUco markers placed in overlapping views between cameras.",
    targetElementId: "tutorial-board-library",
  },
  {
    title: "Devices",
    description:
      "Jetson devices host your cameras. Open a device to trigger the ArUco lock scan. This requires placing physical ArUco markers in overlapping camera views to align cameras into a shared coordinate space.",
    targetElementId: "tutorial-devices-panel",
  },
  {
    title: "Floorplan Library",
    description:
      "Upload your environment's floor plan image here. Select one to use as the background in the Puzzle workspace where you'll align camera views to real-world coordinates.",
    targetElementId: "tutorial-floorplan-library",
  },
  {
    title: "Top-Down Map View",
    description:
      "Once all cameras have homography scans, open the Puzzle Workspace to drag camera layers onto the floor plan. This produces global homographies used by the Fusion pipeline to track people across cameras.",
    targetElementId: "tutorial-topdown-map",
  },
];

interface VisionTutorialProps {
  onDone: () => void;
}

export function VisionTutorial({ onDone }: VisionTutorialProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<Record<string, string>>({});
  const positionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentStep = STEPS[currentIndex];

  function computeTooltipStyle(rect: DOMRect): Record<string, string> {
    const TH = 210;
    const TW = 380;
    const M = 16;
    const vH = window.innerHeight;
    const vW = window.innerWidth;

    let top: number;
    if (vH - rect.bottom >= TH + M) {
      top = rect.bottom + M + 8;
    } else if (rect.top >= TH + M) {
      top = rect.top - M - TH - 8;
    } else {
      top = (vH - TH) / 2;
    }

    const left = Math.min(Math.max(rect.left, M), vW - TW - M);
    return { top: `${top}px`, left: `${left}px`, width: `${TW}px` };
  }

  function positionSpotlight() {
    const step = STEPS[currentIndex];
    if (!step.targetElementId) {
      setSpotlight(null);
      setTooltipStyle({});
      return;
    }

    const el = document.getElementById(step.targetElementId);
    if (!el) {
      setSpotlight(null);
      return;
    }

    el.scrollIntoView({ behavior: "smooth", block: "nearest" });

    if (positionTimeoutRef.current) clearTimeout(positionTimeoutRef.current);
    positionTimeoutRef.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      const P = 8;
      setSpotlight({
        top: rect.top - P,
        left: rect.left - P,
        width: rect.width + P * 2,
        height: rect.height + P * 2,
      });
      setTooltipStyle(computeTooltipStyle(rect));
    }, 300);
  }

  useEffect(() => {
    const t = setTimeout(positionSpotlight, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  useEffect(() => {
    const onResize = () => positionSpotlight();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (positionTimeoutRef.current) clearTimeout(positionTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") onDone();
      if (e.key === "ArrowRight" && currentIndex < STEPS.length - 1) setCurrentIndex((i) => i + 1);
      if (e.key === "ArrowLeft" && currentIndex > 0) setCurrentIndex((i) => i - 1);
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [currentIndex, onDone]);

  function next() {
    if (currentIndex < STEPS.length - 1) setCurrentIndex((i) => i + 1);
  }

  function prev() {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  }

  return (
    <>
      {/* Backdrop: transparent when spotlight provides the dim; opaque on welcome step */}
      <div
        className="fixed inset-0 z-[9999]"
        style={{ background: spotlight ? "transparent" : "rgba(0,0,0,0.72)" }}
        onClick={onDone}
      />

      {/* Spotlight cutout */}
      {spotlight && (
        <div
          className="pointer-events-none fixed z-[10000] rounded-lg"
          style={{
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
            transition: "top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease",
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      )}

      {/* Tooltip card (steps 2-7, when a spotlight is active) */}
      {spotlight && (
        <div
          className="fixed z-[10001] rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
          style={tooltipStyle}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-ink-muted">
              {currentIndex + 1} of {STEPS.length}
            </span>
            <button
              type="button"
              className="border-0 bg-transparent p-0 text-xs text-ink-muted hover:underline"
              onClick={onDone}
            >
              Skip tour
            </button>
          </div>
          <h3 className="m-0 mb-2 text-base font-semibold text-ink">{currentStep.title}</h3>
          <p className="m-0 mb-4 text-sm leading-relaxed text-ink-muted">{currentStep.description}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={currentIndex === 0}
              onClick={prev}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-ink hover:bg-slate-100 disabled:opacity-50"
            >
              ← Prev
            </button>
            {currentIndex < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={next}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={onDone}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
              >
                ✓ Finish
              </button>
            )}
          </div>
        </div>
      )}

      {/* Welcome card (step 1, no spotlight) */}
      {!spotlight && (
        <div
          className="fixed z-[10001] rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl"
          style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "min(480px, 90vw)" }}
        >
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-lg text-brand-600">
              🎥
            </span>
            <h2 className="m-0 text-xl font-semibold text-ink">{currentStep.title}</h2>
          </div>
          <p className="m-0 mb-6 text-sm leading-relaxed text-ink-muted">{currentStep.description}</p>
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-muted">{STEPS.length - 1} sections to explore</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onDone}
                className="rounded-md px-3 py-1.5 text-sm text-ink hover:bg-slate-100"
              >
                Skip Tour
              </button>
              <button
                type="button"
                onClick={next}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85"
              >
                Let's Go →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
