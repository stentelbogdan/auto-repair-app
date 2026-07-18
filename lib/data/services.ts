export type ServiceType =
  | "scratch"
  | "detailing_interior"
  | "detailing_exterior"
  | "polish"
  | "ceramic_coating"
  | "ppf"
  | "wrap"
  | "window_tint"
  | "dechroming"
  | "wheel_refurbishment"
  | "smart_repair"
  | "pdr";

export type ServiceDetailOption = {
  value: string;
  label: string;
};

export type ServiceOptionGroupDefinition = {
  title: string;
  description: string;
  options: ServiceDetailOption[];
  display?: "list" | "car-parts";
};

export type ServiceDefinition = {
  value: ServiceType;
  title: string;
  icon: string;
  desc: string;
  groups?: ServiceOptionGroupDefinition[];
};

const carPartDetails: ServiceDetailOption[] = [
  { value: "part:front_bumper", label: "Bară față" },
  { value: "part:rear_bumper", label: "Bară spate" },

  { value: "part:hood", label: "Capotă" },
  { value: "part:roof", label: "Pavilion" },
  { value: "part:trunk", label: "Capac portbagaj / Hayon" },

  { value: "part:left_front_fender", label: "Aripă față stânga" },
  { value: "part:right_front_fender", label: "Aripă față dreapta" },

  { value: "part:left_rear_quarter", label: "Aripă spate stânga" },
  { value: "part:right_rear_quarter", label: "Aripă spate dreapta" },

  { value: "part:left_front_door", label: "Ușă față stânga" },
  { value: "part:left_rear_door", label: "Ușă spate stânga" },

  { value: "part:right_front_door", label: "Ușă față dreapta" },
  { value: "part:right_rear_door", label: "Ușă spate dreapta" },

  { value: "part:left_sill", label: "Prag stânga" },
  { value: "part:right_sill", label: "Prag dreapta" },

  { value: "part:left_mirror", label: "Oglindă stânga" },
  { value: "part:right_mirror", label: "Oglindă dreapta" },

  { value: "part:left_headlight", label: "Far stânga" },
  { value: "part:right_headlight", label: "Far dreapta" },

  { value: "part:left_taillight", label: "Stop spate stânga" },
  { value: "part:right_taillight", label: "Stop spate dreapta" },

  { value: "part:left_front_wheel", label: "Jantă față stânga" },
  { value: "part:right_front_wheel", label: "Jantă față dreapta" },
  { value: "part:left_rear_wheel", label: "Jantă spate stânga" },
  { value: "part:right_rear_wheel", label: "Jantă spate dreapta" },

  { value: "part:windshield", label: "Parbriz / Geam" },
  { value: "part:other", label: "Alt element" },
];

const damageKindDetails: ServiceDetailOption[] = [
  { value: "damage:scratch", label: "Zgârietură" },
  { value: "damage:dent", label: "Îndoitură" },
  { value: "damage:crack", label: "Crăpătură" },
  { value: "damage:broken", label: "Element spart" },
  { value: "damage:deformed", label: "Element deformat" },
  { value: "damage:paint_damage", label: "Vopsea deteriorată" },
  { value: "damage:paint_peeling", label: "Vopsea exfoliată" },
  { value: "damage:rust", label: "Rugină / Coroziune" },
  { value: "damage:stone_chips", label: "Ciobituri de pietre" },
  { value: "damage:replacement", label: "Necesită înlocuire" },
  { value: "damage:painting", label: "Necesită vopsire" },
  { value: "damage:other", label: "Alt tip de daună" },
];

const detailingInteriorDetails: ServiceDetailOption[] = [
  {
    value: "detailing_interior:full",
    label: "Detailing interior complet",
  },
  {
    value: "detailing_interior:seats",
    label: "Curățare scaune",
  },
  {
    value: "detailing_interior:carpets",
    label: "Mochetă și covorașe",
  },
  {
    value: "detailing_interior:headliner",
    label: "Plafon",
  },
  {
    value: "detailing_interior:trunk",
    label: "Portbagaj",
  },
  {
    value: "detailing_interior:dashboard_plastics",
    label: "Bord și elemente din plastic",
  },
  {
    value: "detailing_interior:leather",
    label: "Curățare și hidratare piele",
  },
  {
    value: "detailing_interior:odor_ozone",
    label: "Eliminare mirosuri / Ozonificare",
  },
];

const detailingExteriorDetails: ServiceDetailOption[] = [
  {
    value: "detailing_exterior:full",
    label: "Detailing exterior complet",
  },
  {
    value: "detailing_exterior:prewash",
    label: "Prespălare și spălare manuală",
  },
  {
    value: "detailing_exterior:decontamination",
    label: "Decontaminare chimică și mecanică",
  },
  {
    value: "detailing_exterior:insect_removal",
    label: "Îndepărtare insecte și depuneri",
  },
  {
    value: "detailing_exterior:tar_removal",
    label: "Îndepărtare gudron și rășină",
  },
  {
    value: "detailing_exterior:wheels",
    label: "Curățare detaliată jante",
  },
  {
    value: "detailing_exterior:engine_bay",
    label: "Curățare compartiment motor",
  },
  {
    value: "detailing_exterior:wax_sealant",
    label: "Ceară sau protecție sintetică",
  },
];

export const SERVICES: ServiceDefinition[] = [
  {
    value: "scratch",
    title: "Reparație daună",
    icon: "🚗",
    desc: "Zgârieturi, lovituri, vopsitorie",
    groups: [
      {
        title: "Ce element este afectat?",
        description: "Atinge unul sau mai multe elemente ale mașinii.",
        options: carPartDetails,
        display: "car-parts",
      },
      {
        title: "Ce tip de daună are?",
        description: "Poți selecta unul sau mai multe tipuri de daună.",
        options: damageKindDetails,
      },
    ],
  },
  {
    value: "detailing_interior",
    title: "Detailing interior",
    icon: "✨",
    desc: "Curățare premium interior",
    groups: [
      {
        title: "Ce dorești să cureți?",
        description: "Poți selecta una sau mai multe opțiuni.",
        options: detailingInteriorDetails,
      },
    ],
  },
  {
    value: "detailing_exterior",
    title: "Detailing exterior",
    icon: "🧽",
    desc: "Curățare și protecție exterior",
    groups: [
      {
        title: "Ce serviciu exterior dorești?",
        description: "Poți selecta una sau mai multe opțiuni.",
        options: detailingExteriorDetails,
      },
    ],
  },
  {
    value: "polish",
    title: "Polish profesional",
    icon: "💎",
    desc: "Corecție lac și luciu",
  },
  {
    value: "ceramic_coating",
    title: "Ceramic coating",
    icon: "🛡️",
    desc: "Protecție ceramică vopsea",
  },
  {
    value: "ppf",
    title: "PPF",
    icon: "🧊",
    desc: "Folie protecție vopsea",
  },
  {
    value: "wrap",
    title: "Colantări auto",
    icon: "🎨",
    desc: "Schimbare culoare / design",
  },
  {
    value: "window_tint",
    title: "Folii geamuri",
    icon: "🕶️",
    desc: "Folie solară geamuri",
  },
  {
    value: "dechroming",
    title: "Dechroming",
    icon: "⚫",
    desc: "Elemente cromate transformate negru",
  },
  {
    value: "wheel_refurbishment",
    title: "Recondiționare jante",
    icon: "🛞",
    desc: "Reparație, vopsire, diamond cut",
  },
  {
    value: "smart_repair",
    title: "Smart Repair",
    icon: "🔧",
    desc: "Reparații mici și rapide",
  },
  {
    value: "pdr",
    title: "PDR",
    icon: "🔨",
    desc: "Îndreptare fără vopsire",
  },
];
