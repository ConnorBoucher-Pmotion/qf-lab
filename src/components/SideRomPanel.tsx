import type { SRSnapshot } from "../sr/srTypes";

export function SideRomPanel({ snapshot }: { snapshot: SRSnapshot | null }) {
  const left = snapshot?.left;
  const right = snapshot?.right;
  return (
    <section className="algo-compare">
      <p className="kicker">Left / Right shoulder rotation</p>
      <table>
        <thead>
          <tr>
            <th>Side</th>
            <th>IR</th>
            <th>ER</th>
            <th>Total Arc</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>LEFT</th>
            <td>{deg(left?.validIr ?? left?.rawIr)}</td>
            <td>{deg(left?.validEr ?? left?.rawEr)}</td>
            <td>{deg(left?.validArc ?? left?.rawArc)}</td>
          </tr>
          <tr>
            <th>RIGHT</th>
            <td>{deg(right?.validIr ?? right?.rawIr)}</td>
            <td>{deg(right?.validEr ?? right?.rawEr)}</td>
            <td>{deg(right?.validArc ?? right?.rawArc)}</td>
          </tr>
        </tbody>
      </table>
      <p className="algo-note">
        Live L {deg(left?.currentSigned)} · R {deg(right?.currentSigned)}. Difference {deg(snapshot?.asymmetryDeg)}. Validated peaks stay blank until the capture window starts. Raw and validated values are both kept.
      </p>
    </section>
  );
}

function deg(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}°`;
}
