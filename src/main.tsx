import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ObliqueApp } from "./oblique/ObliqueApp";
import { TrialReview } from "./oblique/TrialReview";
import "./styles.css";

type LabId = "chooser" | "frontal" | "oblique" | "oblique-review";

function readLab(): LabId {
  const param = new URLSearchParams(window.location.search).get("lab");
  if (param === "frontal" || param === "oblique" || param === "oblique-review" || param === "chooser") return param;
  return "chooser";
}

function setLabUrl(lab: LabId): void {
  const url = new URL(window.location.href);
  if (lab === "chooser") url.searchParams.delete("lab");
  else url.searchParams.set("lab", lab);
  window.history.replaceState({}, "", url.toString());
}

function LabRoot() {
  const initial = useMemo(() => readLab(), []);
  const [lab, setLab] = useState<LabId>(initial);

  const go = (next: LabId) => {
    setLabUrl(next);
    setLab(next);
    document.title =
      next === "oblique"
        ? "TL Junction – Oblique Camera Test"
        : next === "oblique-review"
          ? "TL Junction – Trial Review"
          : next === "frontal"
            ? "TL Junction Lab"
            : "TL Junction Labs";
  };

  if (lab === "oblique-review") {
    return <TrialReview onBack={() => go("chooser")} />;
  }

  if (lab === "frontal") {
    return (
      <>
        <div className="lab-chip">
          <button type="button" className="ghost" onClick={() => go("chooser")}>
            ← Labs
          </button>
          <span>Frontal TL Junction (production)</span>
        </div>
        <App />
      </>
    );
  }

  if (lab === "oblique") {
    return <ObliqueApp onBack={() => go("chooser")} onOpenReview={() => go("oblique-review")} />;
  }

  return (
    <div className="chooser">
      <p className="eyebrow">Local comparison</p>
      <h1>TL Junction Labs</h1>
      <p className="lede">Keep the frontal assessment intact. Open the oblique experiment separately to compare shoulder occlusion and hybrid ROM stability.</p>
      <div className="chooser-grid">
        <button type="button" className="chooser-card" onClick={() => go("frontal")}>
          <span className="chooser-kicker">Production</span>
          <strong>TL Junction (Frontal)</strong>
          <p>Existing straight-on camera assessment. Unchanged.</p>
        </button>
        <button type="button" className="chooser-card experimental" onClick={() => go("oblique")}>
          <span className="chooser-kicker">Experimental</span>
          <strong>TL Junction – Oblique Camera Test</strong>
          <p>Oblique camera · hybrid raw-max ROM · trial video + review.</p>
        </button>
        <button type="button" className="chooser-card" onClick={() => go("oblique-review")}>
          <span className="chooser-kicker">Developer</span>
          <strong>TL Trial Review</strong>
          <p>Inspect saved videos, raw/filtered ROM graphs, confidence, and frame samples.</p>
        </button>
      </div>
      <p className="muted small">
        Tip: bookmark <code>?lab=oblique</code>, <code>?lab=oblique-review</code>, or <code>?lab=frontal</code>.
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<LabRoot />);
