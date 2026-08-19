"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  MECHANICAL_CATEGORIES,
  isMechanicalCategoryId,
  type MechanicalCategoryId,
} from "@/lib/mechanical/mechanical-categories";

const DRAFT_STORAGE_KEY = "postMechanicalDraft:v1";

export type SymptomIdsByCategory = Partial<
  Record<MechanicalCategoryId, string[]>
>;

export type MechanicalDraft = {
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  licensePlate: string;
  category: MechanicalCategoryId | null;
  symptomIdsByCategory: SymptomIdsByCategory;
  description: string;
  targetWorkshopId: string | null;
};

type MechanicalDraftContextValue = {
  draft: MechanicalDraft;
  files: File[];
  isHydrated: boolean;
  updateDraft: (updates: Partial<MechanicalDraft>) => void;
  setFiles: Dispatch<SetStateAction<File[]>>;
  setSymptomsForCategory: (
    category: MechanicalCategoryId,
    symptomIds: string[],
  ) => void;
  toggleSymptom: (category: MechanicalCategoryId, symptomId: string) => void;
  clearDraft: () => void;
};

const MechanicalDraftContext = createContext<MechanicalDraftContextValue | null>(
  null,
);

function createInitialDraft(): MechanicalDraft {
  return {
    carBrand: "",
    carModel: "",
    carYear: "",
    city: "",
    licensePlate: "",
    category: null,
    symptomIdsByCategory: {},
    description: "",
    targetWorkshopId: null,
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function readSymptoms(value: unknown): SymptomIdsByCategory {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const rawSymptoms = value as Record<string, unknown>;
  const symptomsByCategory: SymptomIdsByCategory = {};

  for (const category of MECHANICAL_CATEGORIES) {
    const symptomIds = rawSymptoms[category.id];
    if (!Array.isArray(symptomIds)) continue;

    const allowedIds = new Set(category.symptoms.map((symptom) => symptom.id));
    const validIds = Array.from(
      new Set(
        symptomIds.filter(
          (symptomId): symptomId is string =>
            typeof symptomId === "string" && allowedIds.has(symptomId),
        ),
      ),
    );

    if (validIds.length) {
      symptomsByCategory[category.id] = validIds;
    }
  }

  return symptomsByCategory;
}

function parseStoredDraft(value: string): MechanicalDraft | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const storedCategory = readString(parsed.category);

    return {
      carBrand: readString(parsed.carBrand),
      carModel: readString(parsed.carModel),
      carYear: readString(parsed.carYear),
      city: readString(parsed.city),
      licensePlate: readString(parsed.licensePlate),
      category: isMechanicalCategoryId(storedCategory) ? storedCategory : null,
      symptomIdsByCategory: readSymptoms(parsed.symptomIdsByCategory),
      description: readString(parsed.description),
      targetWorkshopId: readNullableString(parsed.targetWorkshopId),
    };
  } catch {
    return null;
  }
}

function mergeStoredDraft(
  current: MechanicalDraft,
  stored: MechanicalDraft,
): MechanicalDraft {
  return {
    carBrand: current.carBrand || stored.carBrand,
    carModel: current.carModel || stored.carModel,
    carYear: current.carYear || stored.carYear,
    city: current.city || stored.city,
    licensePlate: current.licensePlate || stored.licensePlate,
    category: current.category ?? stored.category,
    symptomIdsByCategory: {
      ...stored.symptomIdsByCategory,
      ...current.symptomIdsByCategory,
    },
    description: current.description || stored.description,
    targetWorkshopId: current.targetWorkshopId ?? stored.targetWorkshopId,
  };
}

export default function MechanicalDraftProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<MechanicalDraft>(createInitialDraft);
  const [files, setFiles] = useState<File[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const storedValue = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      const storedDraft = storedValue ? parseStoredDraft(storedValue) : null;

      if (storedDraft) {
        setDraft((current) => mergeStoredDraft(current, storedDraft));
      }
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("Failed to hydrate mechanical post draft:", error);
      }
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    try {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("Failed to persist mechanical post draft:", error);
      }
    }
  }, [draft, isHydrated]);

  const updateDraft = useCallback((updates: Partial<MechanicalDraft>) => {
    setDraft((current) => ({ ...current, ...updates }));
  }, []);

  const setSymptomsForCategory = (
    category: MechanicalCategoryId,
    symptomIds: string[],
  ) => {
    setDraft((current) => ({
      ...current,
      symptomIdsByCategory: {
        ...current.symptomIdsByCategory,
        [category]: symptomIds,
      },
    }));
  };

  const toggleSymptom = (
    category: MechanicalCategoryId,
    symptomId: string,
  ) => {
    const categoryConfig = MECHANICAL_CATEGORIES.find(
      (item) => item.id === category,
    );

    if (!categoryConfig?.symptoms.some((symptom) => symptom.id === symptomId)) {
      return;
    }

    setDraft((current) => {
      const currentSymptoms = current.symptomIdsByCategory[category] ?? [];
      const nextSymptoms = currentSymptoms.includes(symptomId)
        ? currentSymptoms.filter((id) => id !== symptomId)
        : [...currentSymptoms, symptomId];

      return {
        ...current,
        symptomIdsByCategory: {
          ...current.symptomIdsByCategory,
          [category]: nextSymptoms,
        },
      };
    });
  };

  const clearDraft = () => {
    setDraft(createInitialDraft());
    setFiles([]);

    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // The in-memory draft is still cleared when storage is unavailable.
    }
  };

  return (
    <MechanicalDraftContext.Provider
      value={{
        draft,
        files,
        isHydrated,
        updateDraft,
        setFiles,
        setSymptomsForCategory,
        toggleSymptom,
        clearDraft,
      }}
    >
      {children}
    </MechanicalDraftContext.Provider>
  );
}

export function useMechanicalDraft() {
  const context = useContext(MechanicalDraftContext);

  if (!context) {
    throw new Error(
      "useMechanicalDraft must be used inside MechanicalDraftProvider.",
    );
  }

  return context;
}
