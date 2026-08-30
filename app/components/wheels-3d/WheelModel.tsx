import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import {
  Box3,
  Color,
  Material,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Group,
} from "three";
import type {
  WheelComponentSelection,
  WheelPositionId,
} from "@/lib/wheels/wheels-service-details";
import {
  findWheelComponentSelection,
  findWheelPositionId,
} from "./wheelParts";

const MODEL_PATH = "/models/autorepair-chassis.glb";
const SELECTED_COLOR = new Color("#f97316");
const DRAG_CLICK_THRESHOLD = 5;

export type WheelModelBounds = {
  center: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
};

export type WheelComponentAnchors = Record<
  string,
  [number, number, number]
>;

type WheelModelProps = {
  selectedWheels: WheelPositionId[];
  onToggleWheel: (wheelId: WheelPositionId) => void;
  selectedComponents?: WheelComponentSelection[];
  onToggleComponent?: (selection: WheelComponentSelection) => void;
  onComponentAnchorsChange?: (anchors: WheelComponentAnchors) => void;
  onBoundsChange?: (bounds: WheelModelBounds) => void;
  position?: [number, number, number];
  scale?: number;
};

type OriginalWheelMaterialState = {
  color: Color;
  emissive: Color;
  emissiveIntensity: number;
};

function getMeshMaterials(mesh: Mesh): Material[] {
  if (Array.isArray(mesh.material)) {
    return mesh.material;
  }

  return mesh.material ? [mesh.material] : [];
}

function cloneMeshMaterials(mesh: Mesh) {
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((material) => material.clone());
    return;
  }

  if (mesh.material) {
    mesh.material = mesh.material.clone();
  }
}

function storeOriginalWheelMaterial(material: MeshStandardMaterial) {
  const originalState: OriginalWheelMaterialState = {
    color: material.color.clone(),
    emissive: material.emissive.clone(),
    emissiveIntensity: material.emissiveIntensity,
  };

  material.userData.wheelSelectorOriginalState = originalState;
}

function getOriginalWheelMaterial(
  material: MeshStandardMaterial,
): OriginalWheelMaterialState | null {
  const value = material.userData.wheelSelectorOriginalState as
    | OriginalWheelMaterialState
    | undefined;

  return value ?? null;
}

export default function WheelModel({
  selectedWheels,
  onToggleWheel,
  selectedComponents,
  onToggleComponent,
  onComponentAnchorsChange,
  onBoundsChange,
  position = [0.62, 0, 0],
  scale = 0.05,
}: WheelModelProps) {
  const { scene } = useGLTF(MODEL_PATH);
  const invalidate = useThree((state) => state.invalidate);
  const [positionX, positionY, positionZ] = position;

  const {
    boundingBox,
    clonedScene,
    componentCenters,
    componentMeshes,
    modelCenter,
    wheelMeshes,
  } = useMemo(() => {
    const nextScene = scene.clone(true) as Group;
    const nextWheelMeshes = new Map<WheelPositionId, Mesh[]>();
    const nextComponentMeshes = new Map<string, Mesh[]>();

    nextScene.traverse((object) => {
      if (!(object instanceof Mesh)) return;

      cloneMeshMaterials(object);

      const wheelPosition = findWheelPositionId(object);
      const componentSelection = findWheelComponentSelection(object);

      if (!wheelPosition) return;

      object.userData.wheelPositionId = wheelPosition;

      if (componentSelection) {
        const componentKey = getComponentSelectionKey(componentSelection);
        object.userData.wheelComponentSelection = componentSelection;
        const meshesForComponent = nextComponentMeshes.get(componentKey) ?? [];
        meshesForComponent.push(object);
        nextComponentMeshes.set(componentKey, meshesForComponent);
      }

      getMeshMaterials(object).forEach((material) => {
        if (material instanceof MeshStandardMaterial) {
          storeOriginalWheelMaterial(material);
        }
      });

      const meshesForWheel = nextWheelMeshes.get(wheelPosition) ?? [];
      meshesForWheel.push(object);
      nextWheelMeshes.set(wheelPosition, meshesForWheel);
    });

    nextScene.updateMatrixWorld(true);

    const nextBoundingBox = new Box3().setFromObject(nextScene);
    const nextComponentCenters = new Map<string, Vector3>();

    nextComponentMeshes.forEach((meshes, componentKey) => {
      const componentBounds = new Box3();
      meshes.forEach((mesh) => componentBounds.expandByObject(mesh));
      nextComponentCenters.set(
        componentKey,
        componentBounds.getCenter(new Vector3()),
      );
    });

    return {
      boundingBox: nextBoundingBox,
      clonedScene: nextScene,
      componentCenters: nextComponentCenters,
      componentMeshes: nextComponentMeshes,
      modelCenter: nextBoundingBox.getCenter(new Vector3()),
      wheelMeshes: nextWheelMeshes,
    };
  }, [scene]);

  const pivotPosition = useMemo<[number, number, number]>(
    () => [
      positionX + modelCenter.x * scale,
      positionY + modelCenter.y * scale,
      positionZ + modelCenter.z * scale,
    ],
    [modelCenter, positionX, positionY, positionZ, scale],
  );

  const scaledBounds = useMemo<WheelModelBounds>(
    () => ({
      center: pivotPosition,
      min: [
        pivotPosition[0] + (boundingBox.min.x - modelCenter.x) * scale,
        pivotPosition[1] + (boundingBox.min.y - modelCenter.y) * scale,
        pivotPosition[2] + (boundingBox.min.z - modelCenter.z) * scale,
      ],
      max: [
        pivotPosition[0] + (boundingBox.max.x - modelCenter.x) * scale,
        pivotPosition[1] + (boundingBox.max.y - modelCenter.y) * scale,
        pivotPosition[2] + (boundingBox.max.z - modelCenter.z) * scale,
      ],
    }),
    [boundingBox, modelCenter, pivotPosition, scale],
  );

  const componentAnchors = useMemo<WheelComponentAnchors>(() => {
    const anchors: WheelComponentAnchors = {};

    componentCenters.forEach((center, componentKey) => {
      anchors[componentKey] = [
        pivotPosition[0] + (center.x - modelCenter.x) * scale,
        pivotPosition[1] + (center.y - modelCenter.y) * scale,
        pivotPosition[2] + (center.z - modelCenter.z) * scale,
      ];
    });

    return anchors;
  }, [componentCenters, modelCenter, pivotPosition, scale]);

  useEffect(() => {
    onBoundsChange?.(scaledBounds);
  }, [onBoundsChange, scaledBounds]);

  useEffect(() => {
    onComponentAnchorsChange?.(componentAnchors);
  }, [componentAnchors, onComponentAnchorsChange]);

  useEffect(() => {
    const selectedWheelIds = new Set(selectedWheels);
    const selectedComponentKeys = new Set(
      selectedComponents?.map(getComponentSelectionKey) ?? [],
    );
    const usesComponentSelection = Boolean(onToggleComponent);

    wheelMeshes.forEach((meshes, wheelId) => {
      const isSelected = !usesComponentSelection && selectedWheelIds.has(wheelId);

      meshes.forEach((mesh) => {
        getMeshMaterials(mesh).forEach((material) => {
          if (!(material instanceof MeshStandardMaterial)) return;

          const originalState = getOriginalWheelMaterial(material);

          if (!originalState) return;

          material.color.copy(originalState.color);
          material.emissive.copy(originalState.emissive);
          material.emissiveIntensity = originalState.emissiveIntensity;

          if (isSelected) {
            material.color.lerp(SELECTED_COLOR, 0.5);
            material.emissive.copy(SELECTED_COLOR);
            material.emissiveIntensity = Math.max(
              originalState.emissiveIntensity,
              0.8,
            );
          }

          material.needsUpdate = true;
        });
      });
    });

    if (usesComponentSelection) {
      componentMeshes.forEach((meshes, componentKey) => {
        if (!selectedComponentKeys.has(componentKey)) return;

        meshes.forEach((mesh) => {
          getMeshMaterials(mesh).forEach((material) => {
            if (!(material instanceof MeshStandardMaterial)) return;

            material.color.lerp(SELECTED_COLOR, 0.5);
            material.emissive.copy(SELECTED_COLOR);
            material.emissiveIntensity = Math.max(
              material.emissiveIntensity,
              0.8,
            );
            material.needsUpdate = true;
          });
        });
      });
    }

    invalidate();
  }, [
    componentMeshes,
    invalidate,
    onToggleComponent,
    selectedComponents,
    selectedWheels,
    wheelMeshes,
  ]);

  useEffect(() => {
    return () => {
      clonedScene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        getMeshMaterials(object).forEach((material) => material.dispose());
      });

      document.body.style.cursor = "default";
    };
  }, [clonedScene]);

  function handlePointerOver(event: ThreeEvent<PointerEvent>) {
    const wheelId = event.object.userData.wheelPositionId as
      | WheelPositionId
      | undefined;

    const componentSelection = event.object.userData.wheelComponentSelection as
      | WheelComponentSelection
      | undefined;

    if (!wheelId || (onToggleComponent && !componentSelection)) return;

    event.stopPropagation();
    document.body.style.cursor = "pointer";
  }

  function handlePointerOut(event: ThreeEvent<PointerEvent>) {
    const wheelId = event.object.userData.wheelPositionId as
      | WheelPositionId
      | undefined;

    const componentSelection = event.object.userData.wheelComponentSelection as
      | WheelComponentSelection
      | undefined;

    if (!wheelId || (onToggleComponent && !componentSelection)) return;

    event.stopPropagation();
    document.body.style.cursor = "default";
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    const wheelId = event.object.userData.wheelPositionId as
      | WheelPositionId
      | undefined;

    if (!wheelId) return;

    event.stopPropagation();

    if (event.delta > DRAG_CLICK_THRESHOLD) return;

    const componentSelection = event.object.userData.wheelComponentSelection as
      | WheelComponentSelection
      | undefined;

    if (onToggleComponent) {
      if (componentSelection) {
        onToggleComponent(componentSelection);
      }
      return;
    }

    onToggleWheel(wheelId);
  }

  return (
    <group
      position={pivotPosition}
      scale={scale}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      <primitive
        object={clonedScene}
        position={[-modelCenter.x, -modelCenter.y, -modelCenter.z]}
      />
    </group>
  );
}

useGLTF.preload(MODEL_PATH);

function getComponentSelectionKey(selection: WheelComponentSelection) {
  return `${selection.wheel}:${selection.component}`;
}
