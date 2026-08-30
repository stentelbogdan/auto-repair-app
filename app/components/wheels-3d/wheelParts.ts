import type { Object3D } from "three";
import {
  RIM_SERVICES,
  TIRE_SERVICES,
  WHEEL_POSITIONS,
  type WheelComponentId,
  type WheelComponentSelection,
  type WheelComponentServiceId,
  type WheelPositionId,
} from "@/lib/wheels/wheels-service-details";

export const WHEEL_MESH_NAMES: Record<WheelPositionId, string> = {
  front_left: "Wheel_RR",
  front_right: "Wheel_FL",
  rear_left: "Wheel_RL",
  rear_right: "Wheel_FR",
};

export const WHEEL_COMPONENT_MESH_NAMES: Record<
  WheelPositionId,
  Record<WheelComponentId, string>
> = {
  front_left: { tire: "Tire_RR", rim: "Rim_RR" },
  front_right: { tire: "Tire_FL", rim: "Rim_FL" },
  rear_left: { tire: "Tire_RL", rim: "Rim_RL" },
  rear_right: { tire: "Tire_FR", rim: "Rim_FR" },
};

export const WHEEL_COMPONENT_SERVICES: Record<
  WheelComponentId,
  ReadonlyArray<{ id: WheelComponentServiceId; label: string }>
> = {
  tire: TIRE_SERVICES,
  rim: RIM_SERVICES,
};

export const WHEEL_SELECTOR_PARTS = WHEEL_POSITIONS.map((wheel) => ({
  ...wheel,
  meshName: WHEEL_MESH_NAMES[wheel.id],
}));

export const ALL_WHEEL_POSITION_IDS = WHEEL_SELECTOR_PARTS.map(
  ({ id }) => id,
);

const wheelPositionByMeshName = new Map<string, WheelPositionId>(
  WHEEL_SELECTOR_PARTS.map(({ id, meshName }) => [meshName, id]),
);

const wheelComponentByMeshName = new Map<string, WheelComponentSelection>(
  WHEEL_SELECTOR_PARTS.flatMap(({ id }) =>
    (Object.entries(WHEEL_COMPONENT_MESH_NAMES[id]) as [
      WheelComponentId,
      string,
    ][]).map(([component, meshName]) => [
      meshName,
      { wheel: id, component },
    ]),
  ),
);

export function findWheelPositionId(
  object: Object3D | null,
): WheelPositionId | null {
  let currentObject = object;

  while (currentObject) {
    const wheelPosition = wheelPositionByMeshName.get(currentObject.name);

    if (wheelPosition) {
      return wheelPosition;
    }

    currentObject = currentObject.parent;
  }

  return null;
}

export function findWheelComponentSelection(
  object: Object3D | null,
): WheelComponentSelection | null {
  let currentObject = object;

  while (currentObject) {
    const selection = wheelComponentByMeshName.get(currentObject.name);

    if (selection) {
      return selection;
    }

    currentObject = currentObject.parent;
  }

  return null;
}
