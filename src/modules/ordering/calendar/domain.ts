import type { Principal } from "@/modules/identity";
import { AuthorizationError } from "@/modules/identity";

export const isoWeekdays = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoWeekday = (typeof isoWeekdays)[number];

export type PurchaseCalendar = {
  timezone: string;
  cutoffTime: string;
  enabledIsoWeekdays: IsoWeekday[];
  version: number;
  updatedAt: string;
};

export type PurchaseCycle = {
  localDate: string;
  cycleDate: string;
  cutoffAt: Date;
  afterCutoff: boolean;
};

export class PurchaseCalendarValidationError extends Error {
  override name = "PurchaseCalendarValidationError";
}

export class PurchaseCalendarConflictError extends Error {
  constructor(public readonly current: PurchaseCalendar) {
    super("O calendário foi atualizado em outra sessão.");
    this.name = "PurchaseCalendarConflictError";
  }
}

export function authorizePurchaseCalendarManagement(principal: Principal) {
  if (principal.role !== "GESTOR")
    throw new AuthorizationError("Acesso restrito ao Gestor");
}

export function validatePurchaseCalendarVersion(version: number) {
  if (!Number.isInteger(version) || version <= 0)
    throw new PurchaseCalendarValidationError("Versão do calendário inválida.");
  return version;
}

function validTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function validatePurchaseCalendar(input: {
  timezone: string;
  cutoffTime: string;
  enabledIsoWeekdays: readonly number[];
}) {
  const timezone = input.timezone.trim();
  if (!timezone || !validTimeZone(timezone))
    throw new PurchaseCalendarValidationError("Informe um timezone válido.");
  const cutoffMatch = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(input.cutoffTime.trim());
  if (!cutoffMatch)
    throw new PurchaseCalendarValidationError("Informe um horário de corte válido.");
  const enabledIsoWeekdays = [...new Set(input.enabledIsoWeekdays)].sort((a, b) => a - b);
  if (!enabledIsoWeekdays.length)
    throw new PurchaseCalendarValidationError("Habilite pelo menos um dia de compra.");
  if (enabledIsoWeekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7))
    throw new PurchaseCalendarValidationError("Os dias de compra são inválidos.");
  return {
    timezone,
    cutoffTime: cutoffMatch[0],
    enabledIsoWeekdays: enabledIsoWeekdays as IsoWeekday[],
  };
}

function dateParts(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new PurchaseCalendarValidationError("Data operacional inválida.");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function addCivilDays(date: string, days: number) {
  const { year, month, day } = dateParts(date);
  const value = new Date(Date.UTC(year, month - 1, day + days, 12));
  return value.toISOString().slice(0, 10);
}

function isoWeekday(date: string): IsoWeekday {
  const { year, month, day } = dateParts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return (weekday === 0 ? 7 : weekday) as IsoWeekday;
}

type LocalParts = ReturnType<typeof localParts>;

function localParts(now: Date, timezone: string) {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(formatted.find((part) => part.type === type)?.value ?? Number.NaN);
  const parts = {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
  if (Object.values(parts).some((part) => !Number.isFinite(part)))
    throw new PurchaseCalendarValidationError("Não foi possível determinar a data operacional.");
  return parts;
}

function localDate(parts: LocalParts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localDateTimeToInstant(date: string, time: string, timezone: string) {
  const { year, month, day } = dateParts(date);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(new Date(candidate), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const adjustment = desired - actualAsUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  const result = new Date(candidate);
  const verified = localParts(result, timezone);
  if (
    localDate(verified) !== date ||
    verified.hour !== hour ||
    verified.minute !== minute ||
    verified.second !== 0
  ) throw new PurchaseCalendarValidationError("O horário de corte não existe nesse timezone e data.");
  return result;
}

export function calculatePurchaseCycle(
  now: Date,
  calendar: Pick<PurchaseCalendar, "timezone" | "cutoffTime" | "enabledIsoWeekdays">,
): PurchaseCycle {
  if (!Number.isFinite(now.getTime()))
    throw new PurchaseCalendarValidationError("Instante operacional inválido.");
  const validated = validatePurchaseCalendar(calendar);
  const local = localParts(now, validated.timezone);
  const orderDate = localDate(local);
  const [cutoffHour, cutoffMinute] = validated.cutoffTime.split(":").map(Number);
  const localSeconds = local.hour * 3600 + local.minute * 60 + local.second;
  const cutoffSeconds = cutoffHour * 3600 + cutoffMinute * 60;
  const afterCutoff = localSeconds >= cutoffSeconds;
  const targetEnabledPosition = afterCutoff ? 2 : 1;
  let enabledPosition = 0;
  let cycleDate: string | null = null;
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addCivilDays(orderDate, offset);
    if (!validated.enabledIsoWeekdays.includes(isoWeekday(candidate))) continue;
    enabledPosition += 1;
    if (enabledPosition === targetEnabledPosition) {
      cycleDate = candidate;
      break;
    }
  }
  if (!cycleDate)
    throw new PurchaseCalendarValidationError("Não foi possível determinar o próximo ciclo de compra.");
  const cutoffDate = afterCutoff ? addCivilDays(orderDate, 1) : orderDate;
  return {
    localDate: orderDate,
    cycleDate,
    cutoffAt: localDateTimeToInstant(cutoffDate, validated.cutoffTime, validated.timezone),
    afterCutoff,
  };
}
