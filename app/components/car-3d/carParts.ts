export const CAR_PARTS = {
  hood: {
    label: "Capotă",
  },

  trunk: {
    label: "Portbagaj",
  },

  front_bumper: {
    label: "Bară față",
  },

  rear_bumper: {
    label: "Bară spate",
  },

  front_grille: {
    label: "Grilă față",
  },

  left_front_fender: {
    label: "Aripă față stânga",
  },

  right_front_fender: {
    label: "Aripă față dreapta",
  },

  left_rear_fender: {
    label: "Aripă spate stânga",
  },

  right_rear_fender: {
    label: "Aripă spate dreapta",
  },

  left_front_door: {
    label: "Ușă față stânga",
  },

  right_front_door: {
    label: "Ușă față dreapta",
  },

  left_rear_door: {
    label: "Ușă spate stânga",
  },

  right_rear_door: {
    label: "Ușă spate dreapta",
  },

  left_side_skirt: {
    label: "Prag stânga",
  },

  right_side_skirt: {
    label: "Prag dreapta",
  },

  left_mirror: {
    label: "Oglindă stânga",
  },

  right_mirror: {
    label: "Oglindă dreapta",
  },

  windshield: {
    label: "Parbriz",
  },

  rear_window: {
    label: "Lunetă",
  },

  panoramic_roof: {
    label: "Plafon panoramic",
  },

  roof: {
    label: "Plafon",
  },

  rear_lights: {
    label: "Stopuri spate",
  },

  front_light_left: {
    label: "Far față stânga",
  },

  front_light_right: {
    label: "Far față dreapta",
  },

  front_position: {
    label: "Lumini de zi față",
  },

  left_front_window: {
    label: "Geam față stânga",
  },

  right_front_window: {
    label: "Geam față dreapta",
  },

  left_rear_window: {
    label: "Geam spate stânga",
  },

  right_rear_window: {
    label: "Geam spate dreapta",
  },

  front_left_wheel: {
    label: "Roată față stânga",
  },

  front_right_wheel: {
    label: "Roată față dreapta",
  },

  rear_left_wheel: {
    label: "Roată spate stânga",
  },

  rear_right_wheel: {
    label: "Roată spate dreapta",
  },
} as const;

export type CarPartId = keyof typeof CAR_PARTS;

export const SELECTABLE_CAR_PART_IDS = Object.keys(CAR_PARTS) as CarPartId[];

export function isSelectableCarPart(value: string): value is CarPartId {
  return value in CAR_PARTS;
}
