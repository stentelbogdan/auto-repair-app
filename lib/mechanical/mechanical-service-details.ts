import {
  MECHANICAL_CATEGORIES,
  isMechanicalCategoryId,
  type MechanicalCategoryId,
} from "@/lib/mechanical/mechanical-categories";

export type MechanicalCategorySelection = {
  category: MechanicalCategoryId;
  symptomIds: string[];
};

export type LegacyMechanicalServiceDetails = {
  version: 1;
  kind: "mechanical";
  category: MechanicalCategoryId;
  symptomIds: string[];
};

export type MechanicalServiceDetails = {
  version: 2;
  kind: "mechanical";
  selections: MechanicalCategorySelection[];
};

export type SupportedMechanicalServiceDetails =
  | LegacyMechanicalServiceDetails
  | MechanicalServiceDetails;

export type MechanicalServiceDetailGroup = {
  category: MechanicalCategoryId;
  categoryLabel: string;
  symptomLabels: string[];
};

export type MechanicalSymptomIdsByCategory = Partial<
  Record<MechanicalCategoryId, string[]>
>;

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  );
}

function isMechanicalCategorySelection(
  value: unknown,
): value is MechanicalCategorySelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const selection = value as Record<string, unknown>;

  return (
    typeof selection.category === "string" &&
    isMechanicalCategoryId(selection.category) &&
    isStringArray(selection.symptomIds)
  );
}

export function isMechanicalServiceDetails(
  value: unknown,
): value is SupportedMechanicalServiceDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const details = value as Record<string, unknown>;

  if (details.kind !== "mechanical") {
    return false;
  }

  if (details.version === 1) {
    return (
      typeof details.category === "string" &&
      isMechanicalCategoryId(details.category) &&
      isStringArray(details.symptomIds)
    );
  }

  return (
    details.version === 2 &&
    Array.isArray(details.selections) &&
    details.selections.every(isMechanicalCategorySelection)
  );
}

export function normalizeMechanicalServiceDetails(
  value: unknown,
): MechanicalServiceDetails | null {
  if (!isMechanicalServiceDetails(value)) {
    return null;
  }

  if (value.version === 2) {
    return value;
  }

  return {
    version: 2,
    kind: "mechanical",
    selections: [
      {
        category: value.category,
        symptomIds: value.symptomIds,
      },
    ],
  };
}

export function getMechanicalSymptomIdsByCategory(
  value: unknown,
): MechanicalSymptomIdsByCategory {
  const normalized = normalizeMechanicalServiceDetails(value);

  if (!normalized) {
    return {};
  }

  const selectedSymptomsByCategory = new Map<
    MechanicalCategoryId,
    Set<string>
  >();

  for (const selection of normalized.selections) {
    const selectedSymptoms =
      selectedSymptomsByCategory.get(selection.category) ?? new Set<string>();

    selection.symptomIds.forEach((symptomId) => {
      selectedSymptoms.add(symptomId);
    });
    selectedSymptomsByCategory.set(selection.category, selectedSymptoms);
  }

  const result: MechanicalSymptomIdsByCategory = {};

  for (const category of MECHANICAL_CATEGORIES) {
    const selectedSymptoms = selectedSymptomsByCategory.get(category.id);

    if (!selectedSymptoms) {
      continue;
    }

    result[category.id] = category.symptoms
      .filter((symptom) => selectedSymptoms.has(symptom.id))
      .map((symptom) => symptom.id);
  }

  return result;
}

export function buildMechanicalServiceDetails(
  symptomIdsByCategory: MechanicalSymptomIdsByCategory,
): MechanicalServiceDetails {
  const selections: MechanicalCategorySelection[] = [];

  for (const category of MECHANICAL_CATEGORIES) {
    const selectedSymptoms = new Set(
      symptomIdsByCategory[category.id] ?? [],
    );
    const validSymptomIds = category.symptoms
      .filter((symptom) => selectedSymptoms.has(symptom.id))
      .map((symptom) => symptom.id);

    if (validSymptomIds.length > 0) {
      selections.push({
        category: category.id,
        symptomIds: validSymptomIds,
      });
    }
  }

  return {
    version: 2,
    kind: "mechanical",
    selections,
  };
}

export function getMechanicalServiceDetailGroups(
  value: unknown,
): MechanicalServiceDetailGroup[] {
  const symptomIdsByCategory = getMechanicalSymptomIdsByCategory(value);

  return MECHANICAL_CATEGORIES.flatMap((category) => {
    const selectedSymptoms = symptomIdsByCategory[category.id];

    if (!selectedSymptoms) {
      return [];
    }

    const selectedSymptomIds = new Set(selectedSymptoms);

    return [
      {
        category: category.id,
        categoryLabel: category.label,
        symptomLabels: category.symptoms
          .filter((symptom) => selectedSymptomIds.has(symptom.id))
          .map((symptom) => symptom.label),
      },
    ];
  });
}
