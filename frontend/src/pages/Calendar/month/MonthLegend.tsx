import { KIND, meetingChip } from "@/pages/Calendar/calendar";
import { Dot } from "@/pages/Calendar/Dot";
import { Legend } from "@/pages/Calendar/Legend";

export function MonthLegend() {
  return (
    <Legend>
      <span className="inline-flex items-center gap-1.5"><span className={meetingChip(false, false)}>10:00</span> interview</span>
      <span className="inline-flex items-center gap-1.5"><span className={meetingChip(true, false)}>10:00</span> scheduled</span>
      {Object.values(KIND).map((k) => <span key={k.label} className="inline-flex items-center gap-1.5"><Dot className={k.dot} />{k.label}</span>)}
    </Legend>
  );
}
