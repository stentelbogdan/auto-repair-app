import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Color } from "three";
import { isSelectableCarPart } from "./carParts";

useGLTF.preload("/models/autorepair-car.glb");

const MODEL_PATH = "/models/autorepair-car.glb";

const HOVER_COLOR = new Color("#fb923c");
const SELECTED_COLOR = new Color("#f97316");

/*
 * Aspectul normal al caroseriei.
 * Gri satinat: nici complet mat, nici foarte lucios.
 */
const BODY_COLOR = new Color("#0d0e10");
const BODY_ROUGHNESS = 0.22;
const BODY_METALNESS = 0.12;

const HOVER_TINT_STRENGTH = 0.04;
const SELECTED_TINT_STRENGTH = 0.09;

const HOVER_EMISSIVE_INTENSITY = 0.01;
const SELECTED_EMISSIVE_INTENSITY = 0.025;

const HEADLIGHT_COLOR = new Color("#fff4dc");
const DRL_COLOR = new Color("#ffffff");

const HEADLIGHT_HOVER_BOOST = 0.8;
const HEADLIGHT_SELECTED_BOOST = 3.2;

const DRL_HOVER_BOOST = 0.35;
const DRL_SELECTED_BOOST = 2.2;

/*
 * Farurile sunt aprinse permanent în modul preview.
 * Nu afectează modul de selecție.
 */
const PREVIEW_HEADLIGHT_INTENSITY = 12;

const REAR_LIGHT_HOVER_COLOR = new Color("#b91c1c");
const REAR_LIGHT_SELECTED_COLOR = new Color("#c40000");

const HEADLIGHT_SELECTED_TINT = new Color("#ff7a00");
const DRL_SELECTED_TINT = new Color("#ff7a00");

const HEADLIGHT_SELECTED_TINT_STRENGTH = 0.24;
const DRL_SELECTED_TINT_STRENGTH = 0.6;

const HEADLIGHT_SELECTED_EMISSIVE_BLEND = 0.4;
const DRL_SELECTED_EMISSIVE_BLEND = 1.0;

const WINDSHIELD_OPACITY = 0.48;
const OTHER_WINDOWS_OPACITY = 0.82;

const WINDOW_ROUGHNESS = 0.18;
const WINDOW_METALNESS = 0;
const WINDOW_ENV_MAP_INTENSITY = 0.16;

const WINDSHIELD_COLOR = new Color("#1b252e");
const OTHER_WINDOWS_COLOR = new Color("#090e13");

const WINDSHIELD_SELECTED_TINT_STRENGTH = 0.72;
const OTHER_WINDOWS_SELECTED_TINT_STRENGTH = 0.82;

const WINDSHIELD_HOVER_TINT_STRENGTH = 0.32;
const OTHER_WINDOWS_HOVER_TINT_STRENGTH = 0.38;

const WINDSHIELD_SELECTED_EMISSIVE = 0.2;
const OTHER_WINDOWS_SELECTED_EMISSIVE = 0.26;

const WINDSHIELD_HOVER_EMISSIVE = 0.09;
const OTHER_WINDOWS_HOVER_EMISSIVE = 0.12;

const WINDSHIELD_SELECTED_EMISSIVE_BLEND = 0.42;
const OTHER_WINDOWS_SELECTED_EMISSIVE_BLEND = 0.52;

const WINDSHIELD_HOVER_EMISSIVE_BLEND = 0.22;
const OTHER_WINDOWS_HOVER_EMISSIVE_BLEND = 0.28;

/*
 * Cu cât valoarea este mai mare,
 * cu atât tranziția este mai rapidă.
 */
const COLOR_TRANSITION_SPEED = 10;
const EMISSIVE_TRANSITION_SPEED = 10;

/*
 * Puls discret pentru piesele selectate.
 * Intensitatea variază lent între 100% și 106%.
 */
const SELECTED_PULSE_SPEED = 2.2;
const SELECTED_PULSE_AMOUNT = 0.06;

const HEADLIGHT_PART_IDS = new Set(["front_light_left", "front_light_right"]);

const DRL_PART_IDS = new Set(["front_position"]);

const REAR_LIGHT_PART_IDS = new Set(["rear_lights"]);

const BODY_PART_IDS = new Set([
  "hood",
  "front_bumper",
  "rear_bumper",

  "left_front_fender",
  "right_front_fender",

  "left_front_door",
  "right_front_door",

  "left_rear_door",
  "right_rear_door",

  "left_rear_fender",
  "right_rear_fender",

  "left_side_skirt",
  "right_side_skirt",

  "trunk",
  "trunk_lid",

  "left_mirror",
  "right_mirror",
  "mirrors",
]);

const WINDOW_PART_IDS = new Set([
  "windshield",
  "rear_window",
  "panoramic_roof",
]);

const SIDE_WINDOW_OBJECT_IDS = new Set([
  "left_front_window",
  "left_rear_window",
  "right_front_window",
  "right_rear_window",
]);

function findCarPartId(object) {
  let currentObject = object;

  while (currentObject) {
    if (currentObject.name && isSelectableCarPart(currentObject.name)) {
      return currentObject.name;
    }

    currentObject = currentObject.parent;
  }

  return null;
}

function findSideWindowId(object) {
  let currentObject = object;

  while (currentObject) {
    if (currentObject.name && SIDE_WINDOW_OBJECT_IDS.has(currentObject.name)) {
      return currentObject.name;
    }

    currentObject = currentObject.parent;
  }

  return null;
}

function cloneMeshMaterials(mesh) {
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((material) => material.clone());

    return;
  }

  if (mesh.material) {
    mesh.material = mesh.material.clone();
  }
}

function getMaterials(mesh) {
  if (!mesh.material) return [];

  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function applyBodyMaterial(material) {
  if (!material.color) return;

  material.color.copy(BODY_COLOR);

  if (typeof material.roughness === "number") {
    material.roughness = BODY_ROUGHNESS;
  }

  if (typeof material.metalness === "number") {
    material.metalness = BODY_METALNESS;
  }

  /*
   * Actualizăm starea de bază folosită de hover,
   * selectare și revenirea la culoarea normală.
   */
  material.userData.originalColor = BODY_COLOR.clone();
  material.userData.originalRoughness = BODY_ROUGHNESS;
  material.userData.originalMetalness = BODY_METALNESS;

  material.needsUpdate = true;
}

function isWindowMaterial(material, carPartId, sideWindowId) {
  /*
   * Geamurile laterale sunt obiecte separate
   * în modelul GLB.
   */
  if (sideWindowId) {
    return true;
  }

  /*
   * Parbrizul, luneta și plafonul panoramic
   * sunt obiecte dedicate.
   */
  if (WINDOW_PART_IDS.has(carPartId)) {
    return true;
  }

  return false;
}

function storeOriginalMaterialState(mesh) {
  getMaterials(mesh).forEach((material) => {
    material.userData.originalColor = material.color?.clone?.() ?? null;

    material.userData.originalEmissive = material.emissive?.clone?.() ?? null;

    material.userData.originalEmissiveIntensity =
      material.emissiveIntensity ?? 0;

    material.userData.originalRoughness =
      typeof material.roughness === "number" ? material.roughness : null;

    material.userData.originalMetalness =
      typeof material.metalness === "number" ? material.metalness : null;
  });
}

export function Model({
  mode = "selection",
  selectedPartIds,
  onTogglePart,
  onPartMeshesReady,
  ...props
}) {
  const { scene } = useGLTF(MODEL_PATH);

  const [hoveredPartId, setHoveredPartId] = useState(null);

  const invalidate = useThree((state) => state.invalidate);

  const transitionFramesRemaining = useRef(0);

  const isSelectionMode = mode === "selection";

  const pointerDownPosition = useRef({
    x: 0,
    y: 0,
  });

  const hasDragged = useRef(false);
  const isPointerDown = useRef(false);

  /*
   * Folosim și un ref pentru ca animația din useFrame
   * să aibă permanent lista actualizată.
   */
  const selectedPartIdsRef = useRef(selectedPartIds);
  const hoveredPartIdRef = useRef(hoveredPartId);

  useEffect(() => {
    selectedPartIdsRef.current = selectedPartIds;
  }, [selectedPartIds]);

  useEffect(() => {
    transitionFramesRemaining.current = 45;
    invalidate();
  }, [selectedPartIds, invalidate]);

  useEffect(() => {
    hoveredPartIdRef.current = hoveredPartId;
  }, [hoveredPartId]);

  useEffect(() => {
    transitionFramesRemaining.current = 30;
    invalidate();
  }, [hoveredPartId, invalidate]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "default";
    };
  }, []);

  useEffect(() => {
    if (isSelectionMode) return;

    setHoveredPartId(null);
    document.body.style.cursor = "default";

    isPointerDown.current = false;
    hasDragged.current = false;
  }, [isSelectionMode]);

  const { clonedScene, partMeshes } = useMemo(() => {
    const nextScene = scene.clone(true);
    const nextPartMeshes = new Map();

    nextScene.traverse((object) => {
      if (!object.isMesh) return;

      object.castShadow = true;
      object.receiveShadow = true;

      cloneMeshMaterials(object);
      storeOriginalMaterialState(object);

      const carPartId = findCarPartId(object);
      const sideWindowId = findSideWindowId(object);

      const windowMaterialIndexes = [];

      const isFrontWindshield = carPartId === "windshield";

      const windowOpacity = isFrontWindshield
        ? WINDSHIELD_OPACITY
        : OTHER_WINDOWS_OPACITY;

      const windowColor = isFrontWindshield
        ? WINDSHIELD_COLOR
        : OTHER_WINDOWS_COLOR;

      getMaterials(object).forEach((material, materialIndex) => {
        const windowMaterial = isWindowMaterial(
          material,
          carPartId,
          sideWindowId,
        );

        if (!windowMaterial) return;

        windowMaterialIndexes.push(materialIndex);

        if (material.emissive) {
          material.emissive.set("#000000");
          material.emissiveIntensity = 0;
        }

        material.userData.windowOpacity = windowOpacity;
        material.userData.windowColor = windowColor.clone();

        material.transparent = true;
        material.opacity = windowOpacity;

        material.depthWrite = false;
        material.depthTest = true;

        material.metalness = WINDOW_METALNESS;
        material.roughness = WINDOW_ROUGHNESS;

        if (typeof material.envMapIntensity === "number") {
          material.envMapIntensity = WINDOW_ENV_MAP_INTENSITY;
        }

        if (material.color) {
          material.color.copy(windowColor);
        }

        material.needsUpdate = true;
      });

      object.userData.windowMaterialIndexes = windowMaterialIndexes;

      if (windowMaterialIndexes.length > 0) {
        object.renderOrder = 2;
      }

      /*
       * Schimbăm numai piesele definite ca elemente de caroserie.
       * Materialele de geam sunt excluse explicit.
       */
      if (BODY_PART_IDS.has(carPartId)) {
        getMaterials(object).forEach((material, materialIndex) => {
          const isWindow = windowMaterialIndexes.includes(materialIndex);

          if (isWindow) return;

          applyBodyMaterial(material);
        });
      }

      /*
       * Geamurile laterale pot să nu fie piese
       * selectabile. Le configurăm înainte să ieșim.
       */
      if (!carPartId) return;

      object.userData.carPartId = carPartId;

      const meshesForPart = nextPartMeshes.get(carPartId) ?? [];

      meshesForPart.push(object);

      nextPartMeshes.set(carPartId, meshesForPart);
    });

    return {
      clonedScene: nextScene,
      partMeshes: nextPartMeshes,
    };
  }, [scene]);

  useEffect(() => {
    onPartMeshesReady?.(partMeshes);
  }, [onPartMeshesReady, partMeshes]);

  useFrame((state, delta) => {
    if (transitionFramesRemaining.current > 0) {
      transitionFramesRemaining.current -= 1;
      state.invalidate();
    }

    const colorAlpha = 1 - Math.exp(-COLOR_TRANSITION_SPEED * delta);

    const emissiveAlpha = 1 - Math.exp(-EMISSIVE_TRANSITION_SPEED * delta);

    const selectedPulse =
      1 +
      ((Math.sin(state.clock.elapsedTime * SELECTED_PULSE_SPEED) + 1) / 2) *
        SELECTED_PULSE_AMOUNT;

    partMeshes.forEach((meshes, partId) => {
      const isSelected = selectedPartIdsRef.current.includes(partId);

      const isHovered = hoveredPartIdRef.current === partId;

      const isHeadlightPart = HEADLIGHT_PART_IDS.has(partId);

      const isDrlPart = DRL_PART_IDS.has(partId);

      const isRearLightPart = REAR_LIGHT_PART_IDS.has(partId);

      const isLightPart = isHeadlightPart || isDrlPart || isRearLightPart;

      meshes.forEach((mesh) => {
        const windowMaterialIndexes = mesh.userData.windowMaterialIndexes ?? [];

        getMaterials(mesh).forEach((material, materialIndex) => {
          const isWindow = windowMaterialIndexes.includes(materialIndex);
          const originalColor = material.userData.originalColor;

          const originalEmissive = material.userData.originalEmissive;

          const originalEmissiveIntensity =
            material.userData.originalEmissiveIntensity ?? 0;

          const originalRoughness = material.userData.originalRoughness;

          const originalMetalness = material.userData.originalMetalness;

          let targetColor = originalColor;
          let targetEmissive = originalEmissive;
          let targetEmissiveIntensity = originalEmissiveIntensity;
          let targetRoughness = originalRoughness;
          let targetMetalness = originalMetalness;

          if (isWindow) {
            const windowOpacity =
              material.userData.windowOpacity ?? OTHER_WINDOWS_OPACITY;

            const windowColor =
              material.userData.windowColor ?? OTHER_WINDOWS_COLOR;

            targetColor = windowColor;
            targetEmissive = originalEmissive;
            targetEmissiveIntensity = originalEmissiveIntensity;

            targetRoughness = WINDOW_ROUGHNESS;
            targetMetalness = WINDOW_METALNESS;

            material.transparent = true;
            material.opacity = windowOpacity;
            material.depthWrite = false;
            material.depthTest = true;

            if (typeof material.envMapIntensity === "number") {
              material.envMapIntensity = WINDOW_ENV_MAP_INTENSITY;
            }
          }

          if (isWindow) {
            const windowColor =
              material.userData.windowColor ?? OTHER_WINDOWS_COLOR;

            const isFrontWindshield = partId === "windshield";

            const selectedTintStrength = isFrontWindshield
              ? WINDSHIELD_SELECTED_TINT_STRENGTH
              : OTHER_WINDOWS_SELECTED_TINT_STRENGTH;

            const hoverTintStrength = isFrontWindshield
              ? WINDSHIELD_HOVER_TINT_STRENGTH
              : OTHER_WINDOWS_HOVER_TINT_STRENGTH;

            const selectedEmissive = isFrontWindshield
              ? WINDSHIELD_SELECTED_EMISSIVE
              : OTHER_WINDOWS_SELECTED_EMISSIVE;

            const hoverEmissive = isFrontWindshield
              ? WINDSHIELD_HOVER_EMISSIVE
              : OTHER_WINDOWS_HOVER_EMISSIVE;

            const selectedEmissiveBlend = isFrontWindshield
              ? WINDSHIELD_SELECTED_EMISSIVE_BLEND
              : OTHER_WINDOWS_SELECTED_EMISSIVE_BLEND;

            const hoverEmissiveBlend = isFrontWindshield
              ? WINDSHIELD_HOVER_EMISSIVE_BLEND
              : OTHER_WINDOWS_HOVER_EMISSIVE_BLEND;

            targetColor = windowColor;
            targetEmissive = originalEmissive;
            targetEmissiveIntensity = originalEmissiveIntensity;

            if (isSelected) {
              targetColor = windowColor
                .clone()
                .lerp(SELECTED_COLOR, selectedTintStrength);

              if (material.emissive) {
                targetEmissive = originalEmissive
                  ? originalEmissive
                      .clone()
                      .lerp(SELECTED_COLOR, selectedEmissiveBlend)
                  : SELECTED_COLOR;
              }

              targetEmissiveIntensity =
                originalEmissiveIntensity + selectedEmissive * selectedPulse;
            } else if (isHovered) {
              targetColor = windowColor
                .clone()
                .lerp(HOVER_COLOR, hoverTintStrength);

              if (material.emissive) {
                targetEmissive = originalEmissive
                  ? originalEmissive
                      .clone()
                      .lerp(HOVER_COLOR, hoverEmissiveBlend)
                  : HOVER_COLOR;
              }

              targetEmissiveIntensity =
                originalEmissiveIntensity + hoverEmissive;
            }
          } else if (isLightPart) {
            /*
             * În Dashboard, farurile și luminile de zi
             * rămân aprinse permanent.
             */
            if (!isSelectionMode && isHeadlightPart) {
              targetColor = originalColor
                ? originalColor.clone().lerp(HEADLIGHT_COLOR, 0.7)
                : HEADLIGHT_COLOR;

              if (material.emissive) {
                targetEmissive = HEADLIGHT_COLOR;
                targetEmissiveIntensity =
                  originalEmissiveIntensity + PREVIEW_HEADLIGHT_INTENSITY;
              }

              targetRoughness = 0.16;
              targetMetalness = 0;
            } else if (isRearLightPart) {
              /*
               * Lentila își păstrează culoarea originală.
               * Diferența dintre stări vine doar din emissive.
               */
              targetColor = originalColor;

              targetRoughness = 0.82;
              targetMetalness = 0;

              if (material.emissive) {
                if (isSelected) {
                  targetEmissive = REAR_LIGHT_SELECTED_COLOR;
                  targetEmissiveIntensity =
                    originalEmissiveIntensity + 2.2 * selectedPulse;
                } else if (isHovered) {
                  targetEmissive = REAR_LIGHT_HOVER_COLOR;
                  targetEmissiveIntensity = originalEmissiveIntensity + 0.55;
                } else {
                  targetEmissive = originalEmissive;
                  targetEmissiveIntensity = Math.min(
                    originalEmissiveIntensity,
                    0.12,
                  );
                }
              }
            } else {
              /*
               * Farurile și luminile de zi rămân
               * momentan la comportamentul actual.
               */
              let lightColor = DRL_COLOR;
              let hoverBoost = DRL_HOVER_BOOST;
              let selectedBoost = DRL_SELECTED_BOOST;

              if (isHeadlightPart) {
                lightColor = HEADLIGHT_COLOR;
                hoverBoost = HEADLIGHT_HOVER_BOOST;
                selectedBoost = HEADLIGHT_SELECTED_BOOST;
              }

              targetColor = originalColor;

              if (isSelected && originalColor) {
                const selectedTint = isHeadlightPart
                  ? HEADLIGHT_SELECTED_TINT
                  : DRL_SELECTED_TINT;

                const selectedTintStrength = isHeadlightPart
                  ? HEADLIGHT_SELECTED_TINT_STRENGTH
                  : DRL_SELECTED_TINT_STRENGTH;

                targetColor = originalColor
                  .clone()
                  .lerp(selectedTint, selectedTintStrength);
              }

              if (isSelected) {
                if (material.emissive) {
                  const selectedEmissiveColor = isHeadlightPart
                    ? HEADLIGHT_SELECTED_TINT
                    : DRL_SELECTED_TINT;

                  targetEmissive = originalEmissive
                    ? originalEmissive
                        .clone()
                        .lerp(
                          selectedEmissiveColor,
                          isHeadlightPart
                            ? HEADLIGHT_SELECTED_EMISSIVE_BLEND
                            : DRL_SELECTED_EMISSIVE_BLEND,
                        )
                    : selectedEmissiveColor;
                }

                targetEmissiveIntensity =
                  originalEmissiveIntensity + selectedBoost * selectedPulse;
              } else if (isHovered) {
                if (material.emissive) {
                  targetEmissive = originalEmissive
                    ? originalEmissive.clone().lerp(lightColor, 0.55)
                    : lightColor;
                }

                targetEmissiveIntensity =
                  originalEmissiveIntensity + hoverBoost;
              }
            }
          } else {
            if (isSelected && originalColor) {
              targetColor = originalColor
                .clone()
                .lerp(SELECTED_COLOR, SELECTED_TINT_STRENGTH);

              if (originalEmissive) {
                targetEmissive = originalEmissive
                  .clone()
                  .lerp(SELECTED_COLOR, 0.08);
              }

              targetEmissiveIntensity =
                originalEmissiveIntensity +
                SELECTED_EMISSIVE_INTENSITY * selectedPulse;
            } else if (isHovered && originalColor) {
              targetColor = originalColor
                .clone()
                .lerp(HOVER_COLOR, HOVER_TINT_STRENGTH);

              if (originalEmissive) {
                targetEmissive = originalEmissive
                  .clone()
                  .lerp(HOVER_COLOR, 0.04);
              }

              targetEmissiveIntensity =
                originalEmissiveIntensity + HOVER_EMISSIVE_INTENSITY;
            }
          }

          if (material.color && targetColor) {
            material.color.lerp(targetColor, colorAlpha);
          }

          if (material.emissive && targetEmissive) {
            material.emissive.lerp(targetEmissive, colorAlpha);
          }

          if (typeof material.emissiveIntensity === "number") {
            material.emissiveIntensity +=
              (targetEmissiveIntensity - material.emissiveIntensity) *
              emissiveAlpha;
          }

          if (
            typeof material.roughness === "number" &&
            typeof targetRoughness === "number"
          ) {
            material.roughness +=
              (targetRoughness - material.roughness) * colorAlpha;
          }

          if (
            typeof material.metalness === "number" &&
            typeof targetMetalness === "number"
          ) {
            material.metalness +=
              (targetMetalness - material.metalness) * colorAlpha;
          }
        });
      });
    });
  });

  function handlePointerOver(event) {
    event.stopPropagation();

    const carPartId = event.object.userData.carPartId;

    if (!carPartId) return;

    setHoveredPartId(carPartId);
    document.body.style.cursor = "pointer";
  }

  function handlePointerOut(event) {
    event.stopPropagation();

    setHoveredPartId(null);
    document.body.style.cursor = "default";
  }

  function handlePointerDown(event) {
    isPointerDown.current = true;
    hasDragged.current = false;

    pointerDownPosition.current = {
      x: event.clientX,
      y: event.clientY,
    };
  }

  function handlePointerMove(event) {
    if (!isPointerDown.current) return;

    const deltaX = event.clientX - pointerDownPosition.current.x;

    const deltaY = event.clientY - pointerDownPosition.current.y;

    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (distance > 5) {
      hasDragged.current = true;
    }
  }

  function handlePointerUp() {
    isPointerDown.current = false;
  }

  function handlePointerCancel() {
    isPointerDown.current = false;
    hasDragged.current = false;
  }

  function handleClick(event) {
    event.stopPropagation();

    if (hasDragged.current) {
      hasDragged.current = false;
      return;
    }

    const carPartId = event.object.userData.carPartId;

    if (!carPartId) return;

    onTogglePart(carPartId);
  }

  return (
    <primitive
      object={clonedScene}
      onPointerDown={isSelectionMode ? handlePointerDown : undefined}
      onPointerMove={isSelectionMode ? handlePointerMove : undefined}
      onPointerUp={isSelectionMode ? handlePointerUp : undefined}
      onPointerCancel={isSelectionMode ? handlePointerCancel : undefined}
      onPointerOver={isSelectionMode ? handlePointerOver : undefined}
      onPointerOut={isSelectionMode ? handlePointerOut : undefined}
      onClick={isSelectionMode ? handleClick : undefined}
      {...props}
    />
  );
}

useGLTF.preload(MODEL_PATH);
