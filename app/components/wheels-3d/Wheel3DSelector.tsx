"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import {
  MathUtils,
  PerspectiveCamera,
  Vector3,
  type Camera,
  type Object3D,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type {
  WheelComponentId,
  WheelComponentSelection,
  WheelComponentServiceSelection,
  WheelPositionId,
} from "@/lib/wheels/wheels-service-details";
import WheelModel, {
  type WheelComponentAnchors,
  type WheelModelBounds,
} from "./WheelModel";
import ProceduralWheelChassis from "./ProceduralWheelChassis";
import {
  ALL_WHEEL_POSITION_IDS,
  WHEEL_COMPONENT_SERVICES,
  WHEEL_SELECTOR_PARTS,
} from "./wheelParts";

type Wheel3DSelectorProps = {
  selectedWheels: WheelPositionId[];
  onChange: (next: WheelPositionId[]) => void;
  selectedComponents?: WheelComponentSelection[];
  onComponentChange?: (next: WheelComponentSelection[]) => void;
  selectedServices?: WheelComponentServiceSelection[];
  onServiceChange?: (next: WheelComponentServiceSelection[]) => void;
  heightClassName?: string;
  model?: "glb" | "procedural";
};

const CAMERA_FIT_SAFETY_MARGIN = 1.05;
const CONTEXT_MENU_WIDTH = 208;
const CONTEXT_MENU_HEIGHT = 236;
const CONTEXT_MENU_EDGE_GAP = 10;
const CONTEXT_MENU_HORIZONTAL_OFFSET = 126;

function getBoundingBoxCorners(bounds: WheelModelBounds) {
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;

  return [
    new Vector3(minX, minY, minZ),
    new Vector3(minX, minY, maxZ),
    new Vector3(minX, maxY, minZ),
    new Vector3(minX, maxY, maxZ),
    new Vector3(maxX, minY, minZ),
    new Vector3(maxX, minY, maxZ),
    new Vector3(maxX, maxY, minZ),
    new Vector3(maxX, maxY, maxZ),
  ];
}

type AutoFitCameraProps = {
  bounds: WheelModelBounds | null;
  controlsRef: RefObject<OrbitControlsImpl | null>;
};

function AutoFitCamera({ bounds, controlsRef }: AutoFitCameraProps) {
  const getThreeState = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);

  useEffect(() => {
    if (!bounds || size.width <= 0 || size.height <= 0) return;

    const currentBounds = bounds;
    const controls = controlsRef.current;

    function fitCamera() {
      const camera = getThreeState().camera;

      if (!(camera instanceof PerspectiveCamera)) return;

      const center = new Vector3(...currentBounds.center);
      const backward = camera.position.clone().sub(center);

      if (backward.lengthSq() === 0) {
        backward.set(1, 0.35, 0.7);
      }

      backward.normalize();

      const right = new Vector3()
        .crossVectors(camera.up, backward)
        .normalize();
      const up = new Vector3().crossVectors(backward, right).normalize();
      const verticalHalfFov = MathUtils.degToRad(camera.fov) / 2;
      const horizontalHalfFov = Math.atan(
        Math.tan(verticalHalfFov) * (size.width / size.height),
      );
      const verticalTangent = Math.tan(verticalHalfFov);
      const horizontalTangent = Math.tan(horizontalHalfFov);

      let requiredDistance = 0;

      for (const corner of getBoundingBoxCorners(currentBounds)) {
        const relativeCorner = corner.sub(center);
        const depthOffset = relativeCorner.dot(backward);
        const horizontalDistance =
          depthOffset + Math.abs(relativeCorner.dot(right)) / horizontalTangent;
        const verticalDistance =
          depthOffset + Math.abs(relativeCorner.dot(up)) / verticalTangent;

        requiredDistance = Math.max(
          requiredDistance,
          horizontalDistance,
          verticalDistance,
        );
      }

      camera.position
        .copy(center)
        .addScaledVector(
          backward,
          requiredDistance * CAMERA_FIT_SAFETY_MARGIN,
        );
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      invalidate();
    }

    fitCamera();
    controls?.addEventListener("change", fitCamera);

    return () => {
      controls?.removeEventListener("change", fitCamera);
    };
  }, [
    bounds,
    controlsRef,
    getThreeState,
    invalidate,
    size.height,
    size.width,
  ]);

  return null;
}

function calculateContextMenuPosition(
  object: Object3D,
  camera: Camera,
  size: { width: number; height: number },
) {
  const worldPosition = new Vector3();
  object.getWorldPosition(worldPosition);
  worldPosition.project(camera);

  const anchorX = (worldPosition.x * 0.5 + 0.5) * size.width;
  const anchorY = (-worldPosition.y * 0.5 + 0.5) * size.height;
  const horizontalDirection = anchorX > size.width * 0.58 ? -1 : 1;
  const desiredX =
    anchorX + horizontalDirection * CONTEXT_MENU_HORIZONTAL_OFFSET;
  const desiredY =
    anchorY > size.height * 0.58
      ? anchorY - CONTEXT_MENU_HEIGHT * 0.34
      : anchorY + CONTEXT_MENU_HEIGHT * 0.12;
  const halfWidth = Math.min(CONTEXT_MENU_WIDTH, size.width - 20) / 2;
  const halfHeight = Math.min(CONTEXT_MENU_HEIGHT, size.height - 20) / 2;

  return [
    MathUtils.clamp(
      desiredX,
      halfWidth + CONTEXT_MENU_EDGE_GAP,
      size.width - halfWidth - CONTEXT_MENU_EDGE_GAP,
    ),
    MathUtils.clamp(
      desiredY,
      halfHeight + CONTEXT_MENU_EDGE_GAP,
      size.height - halfHeight - CONTEXT_MENU_EDGE_GAP,
    ),
  ];
}

export default function Wheel3DSelector({
  selectedWheels,
  onChange,
  selectedComponents = [],
  onComponentChange,
  selectedServices = [],
  onServiceChange,
  heightClassName = "h-[390px]",
  model = "glb",
}: Wheel3DSelectorProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [glbModelBounds, setGlbModelBounds] =
    useState<WheelModelBounds | null>(null);
  const [componentAnchors, setComponentAnchors] =
    useState<WheelComponentAnchors>({});
  const [activeComponent, setActiveComponent] =
    useState<WheelComponentSelection | null>(null);
  const selectedWheelIds = new Set(selectedWheels);
  const allWheelsSelected = ALL_WHEEL_POSITION_IDS.every((wheelId) =>
    selectedWheelIds.has(wheelId),
  );
  const usesComponentSelection = Boolean(onComponentChange);

  const toggleWheel = useCallback(
    (wheelId: WheelPositionId) => {
      const nextSelectedIds = new Set(selectedWheels);

      if (nextSelectedIds.has(wheelId)) {
        nextSelectedIds.delete(wheelId);
      } else {
        nextSelectedIds.add(wheelId);
      }

      onChange(
        ALL_WHEEL_POSITION_IDS.filter((id) => nextSelectedIds.has(id)),
      );
    },
    [onChange, selectedWheels],
  );

  const toggleAllWheels = useCallback(() => {
    onChange(allWheelsSelected ? [] : [...ALL_WHEEL_POSITION_IDS]);
  }, [allWheelsSelected, onChange]);

  const removeComponentSelection = useCallback(
    (selection: WheelComponentSelection) => {
      if (!onComponentChange) return;

      const selectionKey = getComponentSelectionKey(selection);
      const nextSelections = selectedComponents.filter(
        (item) => getComponentSelectionKey(item) !== selectionKey,
      );

      onComponentChange(nextSelections);
      onServiceChange?.(
        selectedServices.filter(
          (item) => getComponentSelectionKey(item) !== selectionKey,
        ),
      );
      onChange(
        ALL_WHEEL_POSITION_IDS.filter((wheelId) =>
          nextSelections.some((item) => item.wheel === wheelId),
        ),
      );
      setActiveComponent((current) =>
        current && getComponentSelectionKey(current) === selectionKey
          ? null
          : current,
      );
    },
    [
      onChange,
      onComponentChange,
      onServiceChange,
      selectedComponents,
      selectedServices,
    ],
  );

  const toggleComponent = useCallback(
    (selection: WheelComponentSelection) => {
      if (!onComponentChange) return;

      const selectionKey = getComponentSelectionKey(selection);
      const isSelected = selectedComponents.some(
        (item) => getComponentSelectionKey(item) === selectionKey,
      );

      if (isSelected) {
        removeComponentSelection(selection);
        return;
      }

      onComponentChange([...selectedComponents, selection]);
      onChange(
        ALL_WHEEL_POSITION_IDS.filter(
          (wheelId) =>
            wheelId === selection.wheel || selectedWheels.includes(wheelId),
        ),
      );
      setActiveComponent(selection);
    },
    [
      onChange,
      onComponentChange,
      removeComponentSelection,
      selectedComponents,
      selectedWheels,
    ],
  );

  const handle3DComponentClick = useCallback(
    (selection: WheelComponentSelection) => {
      const selectionKey = getComponentSelectionKey(selection);
      const isSelected = selectedComponents.some(
        (item) => getComponentSelectionKey(item) === selectionKey,
      );
      const isActive =
        activeComponent !== null &&
        getComponentSelectionKey(activeComponent) === selectionKey;

      if (!isSelected || isActive) {
        toggleComponent(selection);
        return;
      }

      setActiveComponent(selection);
    },
    [activeComponent, selectedComponents, toggleComponent],
  );

  const toggleService = useCallback(
    (service: WheelComponentServiceSelection["service"]) => {
      if (!activeComponent || !onServiceChange) return;

      const selection = { ...activeComponent, service };
      const selectionKey = getServiceSelectionKey(selection);
      const isSelected = selectedServices.some(
        (item) => getServiceSelectionKey(item) === selectionKey,
      );

      onServiceChange(
        isSelected
          ? selectedServices.filter(
              (item) => getServiceSelectionKey(item) !== selectionKey,
            )
          : [...selectedServices, selection],
      );
    },
    [activeComponent, onServiceChange, selectedServices],
  );

  const activeComponentAnchor = activeComponent
    ? componentAnchors[getComponentSelectionKey(activeComponent)]
    : undefined;

  return (
    <section className="w-full" aria-label="Selector roți">
      <div
        className={`${heightClassName} w-full touch-none overflow-hidden rounded-[32px] bg-neutral-950`}
      >
        <Canvas
          frameloop="demand"
          dpr={1}
          camera={{
            position:
              model === "procedural"
                ? [6.9, 4.25, 6.9]
                : [-4.58, 2.1, -3.07],
            fov: model === "procedural" ? 42 : 53,
            near: 0.1,
            far: 100,
          }}
          gl={{
            antialias: false,
            alpha: true,
            powerPreference: "default",
            preserveDrawingBuffer: false,
          }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = 1.18;
          }}
          onPointerMissed={() => setActiveComponent(null)}
        >
          <ambientLight intensity={0.55} />
          <hemisphereLight args={["#e8edf5", "#111318", 0.65]} />
          <directionalLight position={[6, 8, 5]} intensity={2.1} />
          <directionalLight position={[-6, 4, 4]} intensity={1.15} />
          <directionalLight position={[-2, 5, -7]} intensity={1.05} />

          {model === "procedural" ? (
            <ProceduralWheelChassis
              selectedWheels={selectedWheels}
              onToggleWheel={toggleWheel}
            />
          ) : (
            <Suspense fallback={null}>
              <WheelModel
                selectedWheels={selectedWheels}
                onToggleWheel={toggleWheel}
                selectedComponents={selectedComponents}
                onToggleComponent={
                  usesComponentSelection
                    ? handle3DComponentClick
                    : undefined
                }
                onComponentAnchorsChange={setComponentAnchors}
                onBoundsChange={setGlbModelBounds}
              />
            </Suspense>
          )}

          {model === "glb" && (
            <AutoFitCamera
              bounds={glbModelBounds}
              controlsRef={controlsRef}
            />
          )}

          {model === "glb" &&
            activeComponent &&
            activeComponentAnchor &&
            onServiceChange && (
              <Html
                position={activeComponentAnchor}
                center
                calculatePosition={calculateContextMenuPosition}
                zIndexRange={[40, 20]}
              >
                <div
                  className="w-52 touch-manipulation rounded-2xl border border-white/15 bg-neutral-950/95 p-3 text-white shadow-2xl backdrop-blur-md"
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerMove={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-white/60">
                    {activeComponent.component === "tire"
                      ? "Servicii cauciuc"
                      : "Servicii jantă"}
                  </p>
                  <div className="grid gap-1.5">
                    {WHEEL_COMPONENT_SERVICES[activeComponent.component].map(
                      (service) => {
                        const selection = {
                          ...activeComponent,
                          service: service.id,
                        };
                        const isSelected = selectedServices.some(
                          (item) =>
                            getServiceSelectionKey(item) ===
                            getServiceSelectionKey(selection),
                        );

                        return (
                          <button
                            key={service.id}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => toggleService(service.id)}
                            className={`min-h-11 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition active:scale-[0.98] ${
                              isSelected
                                ? "border-orange-400 bg-orange-500 text-black"
                                : "border-white/10 bg-white/5 text-white hover:border-orange-400/50"
                            }`}
                          >
                            {service.label}
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>
              </Html>
            )}

          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableRotate
            enableZoom={false}
            enablePan={false}
            enableDamping
            rotateSpeed={0.35}
            dampingFactor={0.08}
            minPolarAngle={
              model === "glb" ? Math.PI / 3.1 : Math.PI / 3.2
            }
            maxPolarAngle={
              model === "glb" ? Math.PI / 2.25 : Math.PI / 2.05
            }
            target={
              model === "procedural"
                ? [0, 0.22, 0]
                : (glbModelBounds?.center ?? [0.27, 0.3, 0.13])
            }
          />
        </Canvas>
      </div>

      <div className="mt-4 rounded-3xl border border-white/10 bg-neutral-900 p-3">
        {usesComponentSelection ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {WHEEL_SELECTOR_PARTS.map((wheel) => (
              <div key={wheel.id}>
                <p className="mb-2 text-sm font-bold text-white">
                  {wheel.label}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {WHEEL_COMPONENTS.map((component) => {
                    const selection = {
                      wheel: wheel.id,
                      component: component.id,
                    };
                    const services = WHEEL_COMPONENT_SERVICES[
                      component.id
                    ].filter((service) =>
                      selectedServices.some(
                        (item) =>
                          item.wheel === wheel.id &&
                          item.component === component.id &&
                          item.service === service.id,
                      ),
                    );
                    const isSelected = selectedComponents.some(
                      (item) =>
                        getComponentSelectionKey(item) ===
                        getComponentSelectionKey(selection),
                    );

                    return (
                      <div key={component.id} className="min-w-0">
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => toggleComponent(selection)}
                          className={`min-h-11 w-full rounded-2xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.98] ${
                            isSelected
                              ? "border-orange-400 bg-orange-500 text-black"
                              : "border-white/10 bg-white/5 text-white hover:border-orange-400/50"
                          }`}
                        >
                          {component.label}
                        </button>

                        {services.length > 0 && (
                          <ul className="mt-2 space-y-1 px-1 text-[14px] font-semibold leading-[19px] text-white/75">
                            {services.map((service) => (
                              <li key={service.id} className="break-words">
                                • {service.label}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
          {WHEEL_SELECTOR_PARTS.map((wheel) => {
            const isSelected = selectedWheelIds.has(wheel.id);

            return (
              <button
                key={wheel.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleWheel(wheel.id)}
                className={`min-h-11 rounded-2xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.98] ${
                  isSelected
                    ? "border-orange-400 bg-orange-500 text-black"
                    : "border-white/10 bg-white/5 text-white hover:border-orange-400/50"
                }`}
              >
                {wheel.label}
              </button>
            );
          })}
            </div>

            <button
          type="button"
          aria-pressed={allWheelsSelected}
          onClick={toggleAllWheels}
          className={`mt-2 min-h-11 w-full rounded-2xl border px-4 py-2 text-sm font-bold transition active:scale-[0.99] ${
            allWheelsSelected
              ? "border-orange-400 bg-orange-500 text-black"
              : "border-white/15 bg-black/30 text-white hover:border-orange-400/50"
          }`}
        >
          Toate roțile
            </button>
          </>
        )}
      </div>
    </section>
  );
}

const WHEEL_COMPONENTS: ReadonlyArray<{
  id: WheelComponentId;
  label: string;
}> = [
  { id: "tire", label: "Cauciuc" },
  { id: "rim", label: "Jantă" },
];

function getComponentSelectionKey(selection: WheelComponentSelection) {
  return `${selection.wheel}:${selection.component}`;
}

function getServiceSelectionKey(selection: WheelComponentServiceSelection) {
  return `${getComponentSelectionKey(selection)}:${selection.service}`;
}
