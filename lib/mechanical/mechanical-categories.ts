export type MechanicalCategoryId =
  | "engine"
  | "gearbox"
  | "brakes"
  | "suspension"
  | "steering"
  | "electrical"
  | "ac"
  | "diagnostic"
  | "service"
  | "other";

export type MechanicalSymptom = {
  id: string;
  label: string;
};

export type MechanicalCategory = {
  id: MechanicalCategoryId;
  label: string;
  description: string;
  order: number;
  icon: string;
  symptoms: MechanicalSymptom[];
};

export const MECHANICAL_CATEGORIES: readonly MechanicalCategory[] = [
  {
    id: "engine",
    label: "Motor",
    description: "Pornire, fum, consum ulei",
    order: 1,
    icon: "🚗",
    symptoms: [
      { id: "hard_start", label: "Pornește greu" },
      { id: "no_start", label: "Nu pornește" },
      { id: "power_loss", label: "Pierdere de putere" },
      { id: "rough_idle", label: "Ralanti instabil" },
      { id: "engine_noise", label: "Zgomot motor" },
      { id: "smoke", label: "Fum excesiv" },
      { id: "overheating", label: "Supraîncălzire" },
      { id: "oil_loss", label: "Pierde/consumă ulei" },
      { id: "check_engine", label: "Martor motor" },
      { id: "unsure", label: "Nu sunt sigur" },
    ],
  },
  {
    id: "gearbox",
    label: "Cutie viteze",
    description: "Manuală sau automată",
    order: 2,
    icon: "⚙️",
    symptoms: [
      { id: "hard_shifting", label: "Schimbă greu" },
      { id: "slipping", label: "Patinează" },
      { id: "jerking", label: "Smucește" },
      { id: "delayed_engagement", label: "Cuplare întârziată" },
      { id: "stuck_gear", label: "Rămâne într-o treaptă" },
      { id: "gearbox_noise", label: "Zgomote" },
      { id: "oil_leak", label: "Pierdere ulei" },
      { id: "clutch_issue", label: "Problemă ambreiaj" },
      { id: "warning_light", label: "Martor cutie" },
      { id: "unsure", label: "Nu sunt sigur" },
    ],
  },
  {
    id: "brakes",
    label: "Frâne",
    description: "Plăcuțe, discuri, vibrații",
    order: 3,
    icon: "🛑",
    symptoms: [
      { id: "weak_braking", label: "Frânează slab" },
      { id: "soft_pedal", label: "Pedală moale" },
      { id: "hard_pedal", label: "Pedală tare" },
      { id: "squeal_or_grinding", label: "Scârțâit/frecare" },
      { id: "braking_vibration", label: "Vibrații" },
      { id: "pulls_when_braking", label: "Trage lateral" },
      { id: "warning_light", label: "Martor frâne" },
      { id: "fluid_leak", label: "Pierdere lichid" },
      { id: "parking_brake", label: "Frână de mână" },
      { id: "unsure", label: "Nu sunt sigur" },
    ],
  },
  {
    id: "suspension",
    label: "Suspensie",
    description: "Amortizoare și brațe",
    order: 4,
    icon: "🔩",
    symptoms: [
      { id: "knocking_bumps", label: "Bătăi la denivelări" },
      { id: "excessive_bounce", label: "Mașina oscilează" },
      { id: "uneven_height", label: "Stă înclinată" },
      { id: "instability", label: "Instabilitate" },
      { id: "uneven_tire_wear", label: "Uzură inegală" },
      { id: "pulls_side", label: "Trage lateral" },
      { id: "vibration", label: "Vibrații" },
      { id: "shock_leak", label: "Amortizor cu pierderi" },
      { id: "unsure", label: "Nu sunt sigur" },
    ],
  },
  {
    id: "steering",
    label: "Direcție",
    description: "Casetă și articulații",
    order: 5,
    icon: "🛞",
    symptoms: [
      { id: "heavy_steering", label: "Volan greu" },
      { id: "steering_play", label: "Joc în volan" },
      { id: "steering_noise", label: "Zgomot la virare" },
      { id: "wheel_vibration", label: "Vibrații în volan" },
      { id: "pulls_side", label: "Trage lateral" },
      { id: "wheel_off_center", label: "Volan necentrat" },
      { id: "assist_warning", label: "Martor servodirecție" },
      { id: "fluid_leak", label: "Pierdere lichid" },
      { id: "unsure", label: "Nu sunt sigur" },
    ],
  },
  {
    id: "electrical",
    label: "Electrică",
    description: "Baterie, alternator, senzori",
    order: 6,
    icon: "🔋",
    symptoms: [
      { id: "battery_drain", label: "Bateria se descarcă" },
      { id: "charging_issue", label: "Nu încarcă" },
      { id: "no_start_click", label: "Se aude doar un click" },
      { id: "lights_flicker", label: "Lumini instabile" },
      { id: "component_not_working", label: "Consumator nefuncțional" },
      { id: "fuse_blows", label: "Arde siguranțe" },
      { id: "sensor_warning", label: "Eroare senzor" },
      { id: "central_lock", label: "Închidere centralizată" },
      { id: "windows", label: "Geamuri electrice" },
      { id: "unsure", label: "Nu sunt sigur" },
    ],
  },
  {
    id: "ac",
    label: "Aer condiționat",
    description: "Freon și compresor",
    order: 7,
    icon: "❄️",
    symptoms: [
      { id: "not_cooling", label: "Nu răcește" },
      { id: "weak_airflow", label: "Debit slab" },
      { id: "intermittent", label: "Funcționează intermitent" },
      { id: "bad_smell", label: "Miros neplăcut" },
      { id: "ac_noise", label: "Zgomote" },
      { id: "water_leak", label: "Apă în habitaclu" },
      { id: "compressor_not_starting", label: "Compresorul nu pornește" },
      { id: "windows_fog", label: "Geamurile se aburesc" },
      { id: "unsure", label: "Nu sunt sigur" },
    ],
  },
  {
    id: "diagnostic",
    label: "Diagnoză",
    description: "Martori bord",
    order: 8,
    icon: "💻",
    symptoms: [
      { id: "check_engine", label: "Martor motor" },
      { id: "abs_warning", label: "Martor ABS" },
      { id: "airbag_warning", label: "Martor airbag" },
      { id: "emissions_warning", label: "Eroare emisii" },
      { id: "multiple_warnings", label: "Mai mulți martori" },
      { id: "limp_mode", label: "Mod avarie" },
      { id: "known_obd_code", label: "Cod OBD cunoscut" },
      { id: "intermittent_fault", label: "Eroare intermitentă" },
      { id: "unsure", label: "Nu sunt sigur" },
    ],
  },
  {
    id: "service",
    label: "Revizie",
    description: "Ulei și filtre",
    order: 9,
    icon: "🛠️",
    symptoms: [
      { id: "oil_filters", label: "Ulei și filtre" },
      { id: "full_service", label: "Revizie completă" },
      {
        id: "manufacturer_schedule",
        label: "Revizie conform producătorului",
      },
      { id: "timing_service", label: "Distribuție" },
      { id: "spark_plugs", label: "Bujii" },
      { id: "fluids", label: "Lichide" },
      { id: "brake_maintenance", label: "Întreținere frâne" },
      { id: "pre_trip_check", label: "Verificare înainte de drum" },
      { id: "unsure", label: "Nu sunt sigur" },
    ],
  },
  {
    id: "other",
    label: "Altă problemă",
    description: "Descrie problema",
    order: 10,
    icon: "❓",
    symptoms: [
      { id: "unknown_noise", label: "Zgomot necunoscut" },
      { id: "unknown_vibration", label: "Vibrație" },
      { id: "fluid_leak", label: "Scurgere" },
      { id: "strange_smell", label: "Miros neobișnuit" },
      { id: "smoke", label: "Fum" },
      { id: "performance_change", label: "Comportament schimbat" },
      { id: "intermittent_issue", label: "Problemă intermitentă" },
      { id: "safety_concern", label: "Problemă de siguranță" },
      { id: "not_drivable", label: "Mașina nu poate circula" },
      { id: "unsure", label: "Nu sunt sigur" },
    ],
  },
];

const categoriesById = new Map(
  MECHANICAL_CATEGORIES.map((category) => [category.id, category]),
);

export function isMechanicalCategoryId(
  value: string | null | undefined,
): value is MechanicalCategoryId {
  return Boolean(value && categoriesById.has(value as MechanicalCategoryId));
}

export function getMechanicalCategory(
  value: string | null | undefined,
): MechanicalCategory | null {
  return isMechanicalCategoryId(value) ? categoriesById.get(value) ?? null : null;
}
