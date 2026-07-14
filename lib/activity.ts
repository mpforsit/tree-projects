/** Event → German activity line (task view "Aktivität", handover §4). */
import { formatMinutes } from "./time.ts";
import { strings } from "./strings.ts";

export interface ActivityEvent {
  type: string;
  payload: Record<string, unknown>;
}

const a = strings.activity;

function statusLabel(value: unknown): string {
  return strings.status[String(value)] ?? String(value);
}

export function activityLine(
  event: ActivityEvent,
  memberName: (id: string | null | undefined) => string,
): string {
  const p = event.payload;
  switch (event.type) {
    case "node.created":
      return a.created;
    case "node.updated":
      return a.updated;
    case "node.moved":
      return a.moved;
    case "node.archived":
      return a.archived;
    case "node.unarchived":
      return a.unarchived;
    case "task.status_changed":
      return a.statusChanged(statusLabel(p.old), statusLabel(p.new));
    case "task.percent_changed":
      return a.percentChanged(Number(p.old), Number(p.new));
    case "task.responsible_changed":
      return a.responsibleChanged(memberName(String(p.old)), memberName(String(p.new)));
    case "timelog.added":
      return a.timeLogged(formatMinutes(Number(p.minutes)));
    case "timelog.corrected":
      return a.timeCorrected;
    case "info.added":
      return a.infoAdded;
    case "info.hidden":
      return a.infoHidden;
    case "comment.added":
      return a.commentAdded;
    case "alarm.raised":
      return a.alarmRaised(strings.alarm[String(p.kind)] ?? String(p.kind));
    case "alarm.cleared":
      return a.alarmCleared(strings.alarm[String(p.kind)] ?? String(p.kind));
    default:
      return a.fallback;
  }
}
