"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  MECHANICAL_CATEGORIES,
  type MechanicalCategoryId,
} from "@/lib/mechanical/mechanical-categories";

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
  resetDraft: () => void;
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

export default function MechanicalDraftProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<MechanicalDraft>(createInitialDraft);
  const [files, setFiles] = useState<File[]>([]);

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

  const resetDraft = useCallback(() => {
    setDraft(createInitialDraft());
    setFiles([]);
  }, []);

  return (
    <MechanicalDraftContext.Provider
      value={{
        draft,
        files,
        isHydrated: true,
        updateDraft,
        setFiles,
        setSymptomsForCategory,
        toggleSymptom,
        resetDraft,
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
