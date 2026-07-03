export function formatPostedTime(value?: string | null) {
  if (!value) return "";

  const match = value.match(/^(\d+)\s*(.+)$/);

  if (!match) return value;

  const count = Number(match[1]);
  const unit = match[2].trim().toLowerCase();

  if (unit.startsWith("z")) {
    return `${count} ${count === 1 ? "zi" : "zile"}`;
  }

  if (unit.startsWith("or")) {
    return `${count} ${count === 1 ? "oră" : "ore"}`;
  }

  if (unit.startsWith("min")) {
    return `${count} ${count === 1 ? "minut" : "minute"}`;
  }

  return `${count} ${unit}`;
}