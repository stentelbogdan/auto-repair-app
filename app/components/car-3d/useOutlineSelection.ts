import { useMemo } from "react";
import type { Mesh } from "three";

type UseOutlineSelectionParams = {
  partMeshes: Map<string, Mesh[]>;
  selectedPartIds: string[];
};

export function useOutlineSelection({
  partMeshes,
  selectedPartIds,
}: UseOutlineSelectionParams) {
  const selectedMeshes = useMemo(() => {
    return selectedPartIds.flatMap(
      (partId) => partMeshes.get(partId) ?? [],
    );
  }, [partMeshes, selectedPartIds]);

  return {
    selectedMeshes,
  };
}