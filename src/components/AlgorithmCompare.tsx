import { ALGORITHM_INFO } from "../tl/tlRotation";
import type { TLSnapshot } from "../tl/tlTypes";

export function AlgorithmCompare({ snapshot }: { snapshot: TLSnapshot | null }) {
  const rows = snapshot?.algorithmsLive ?? [];
  return (
    <section className="algo-compare">
      <p className="kicker">{snapshot?.romTestMode ? "ROM algorithm test mode" : "Rotation algorithm comparison"}</p>
      <table>
        <thead>
          <tr>
            <th>Algorithm</th>
            <th>Current</th>
            <th>Left peak</th>
            <th>Right peak</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={snapshot?.algorithm === row.id ? "selected" : ""}>
              <th>{ALGORITHM_INFO[row.id].label}</th>
              <td>{deg(row.current)}</td>
              <td>{deg(row.leftPeak)}</td>
              <td>{deg(row.rightPeak)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="algo-note">
        Positive current is your right. Peaks stay blank until ROTATE. Image width {deg(snapshot?.imageWidthDeg)}. Shoulder width ratio{" "}
        {snapshot?.shoulderSpanRatio == null ? "—" : snapshot.shoulderSpanRatio.toFixed(2)}.
      </p>
    </section>
  );
}

function deg(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}°`;
}
