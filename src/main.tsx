import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ObliqueApp } from "./oblique/ObliqueApp";
import "./styles.css";

type LabId = "chooser" | "frontal" | "oblique";

function readLab(): LabId {
  const param = new URLSearchParams(window.location.search).get("lab");
  if (param === "frontal" || param === "oblique" || param === "chooser") return param;
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
      next === "oblique" ? "TL Junction – 45° Camera Test" : next === "frontal" ? "TL Junction Lab" : "TL Junction Labs";
  };

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
    return <ObliqueApp onBack={() => go("chooser")} />;
  }

  return (
    <div className="chooser">
      <p className="eyebrow">Local comparison</p>
      <h1>TL Junction Labs</h1>
      <p className="lede">Keep the frontal assessment intact. Open the 45° experiment separately to compare shoulder occlusion and ROM stability.</p>
      <div className="chooser-grid">
        <button type="button" className="chooser-card" onClick={() => go("frontal")}>
          <span className="chooser-kicker">Production</span>
          <strong>TL Junction (Frontal)</strong>
          <p>Existing straight-on camera assessment. Unchanged.</p>
        </button>
        <button type="button" className="chooser-card experimental" onClick={() => go("oblique")}>
          <span className="chooser-kicker">Experimental</span>
          <strong>TL Junction – 45° Camera Test</strong>
          <p>Oblique camera · world-landmark thoracic ROM vs calibrated neutral · raw + validated.</p>
        </button>
      </div>
      <p className="muted small">Tip: bookmark <code>?lab=oblique</code> or <code>?lab=frontal</code> for direct entry.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<LabRoot />);
