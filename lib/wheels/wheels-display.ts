import {
  isWheelsServiceDetailsV2,
  RIM_SERVICES,
  TIRE_SERVICES,
  WHEEL_POSITIONS,
} from "@/lib/wheels/wheels-service-details";

export type WheelsDisplaySummary = {
  groups: Array<{
    key: string;
    title: string;
    serviceLabels: string[];
    supplyLabel?: string;
  }>;
  wheelSizeLabel: string;
};

export function getWheelsDisplaySummary(
  value: unknown,
): WheelsDisplaySummary | undefined {
  if (!isWheelsServiceDetailsV2(value)) return undefined;

  const wheelLabels = new Map(
    WHEEL_POSITIONS.map((position) => [position.id, position.label]),
  );
  const tireLabels = new Map(
    TIRE_SERVICES.map((service) => [service.id, service.label]),
  );
  const rimLabels = new Map(
    RIM_SERVICES.map((service) => [service.id, service.label]),
  );
  const groups = value.selections.flatMap((selection) =>
    selection.components.map((component) => {
      const isTire = component.component === "tire";
      let serviceLabels: string[];
      let supplyLabel: string | undefined;

      if (component.component === "tire") {
        serviceLabels = component.services.map(
          (serviceId) => tireLabels.get(serviceId) ?? serviceId,
        );
        supplyLabel = component.services.includes("replace_tire")
          ? getSupplyLabel("tire", value.partsSupply.tire)
          : undefined;
      } else {
        serviceLabels = component.services.map(
          (serviceId) => rimLabels.get(serviceId) ?? serviceId,
        );
        supplyLabel = component.services.includes("replace_rim")
          ? getSupplyLabel("rim", value.partsSupply.rim)
          : undefined;
      }

      return {
        key: `${selection.wheel}-${component.component}`,
        title: `${wheelLabels.get(selection.wheel) ?? selection.wheel} · ${
          isTire ? "Cauciuc" : "Jantă"
        }`,
        serviceLabels,
        supplyLabel,
      };
    }),
  );

  if (groups.length === 0) return undefined;

  const wheelSizeLabel = value.wheelSize.known
    ? `${value.wheelSize.width}/${value.wheelSize.profile} R${value.wheelSize.rimDiameter}`
    : "Dimensiune necunoscută";

  return { groups, wheelSizeLabel };
}

function getSupplyLabel(
  component: "tire" | "rim",
  supply: "customer" | "workshop" | null,
) {
  if (!supply) return undefined;

  if (component === "tire") {
    return supply === "customer"
      ? "Clientul are anvelopa"
      : "Service-ul furnizează anvelopa";
  }

  return supply === "customer"
    ? "Clientul are janta"
    : "Service-ul furnizează janta";
}
