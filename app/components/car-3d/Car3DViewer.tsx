"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import { PerspectiveCamera } from "three";
import type { Mesh } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { Model } from "./CarModel";
import { CAR_PARTS } from "./carParts";
import { useOutlineSelection } from "./useOutlineSelection";

type Car3DViewerProps = {
  mode?: "preview" | "selection";
  heightClassName?: string;
};

type PreviewCameraIntroProps = {
  active: boolean;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  onComplete: () => void;
};

function PreviewCameraIntro({
  active,
  controlsRef,
  onComplete,
}: PreviewCameraIntroProps) {
  const elapsedRef = useRef(0);
  const completedRef = useRef(false);

  // Poziția inițială:
  // camera este mai aproape, iar botul mașinii este mai jos.
  const startPosition: [number, number, number] = [0.35, 2.2, 4.8];

  // Poziția finală:
  // camera se ridică și se retrage discret.
  const endPosition: [number, number, number] = [0.35, 1.65, 5.25];

  const startFov = 39;
  const endFov = 40;

  const delay = 0.8;

  // Mișcarea principală
  const moveDuration = 0.85;

  // Inerția finală
  const settleDuration = 0.24;

  useFrame(({ camera, invalidate }, delta) => {
    if (!active || completedRef.current) return;

    invalidate();

    elapsedRef.current += delta;

    // Menținem camera în poziția inițială în timpul pauzei.
    if (elapsedRef.current < delay) {
      camera.position.set(...startPosition);

      if (camera instanceof PerspectiveCamera) {
        camera.fov = startFov;
        camera.updateProjectionMatrix();
      }

      controlsRef.current?.update();
      return;
    }

    const totalDuration = moveDuration + settleDuration;

    const progress = Math.min((elapsedRef.current - delay) / totalDuration, 1);

    let animationProgress: number;

    const mainMovementEnd = moveDuration / totalDuration;

    if (progress <= mainMovementEnd) {
      // Etapa 1: mișcarea principală
      const p = progress / mainMovementEnd;

      animationProgress =
        p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    } else {
      // Etapa 2: inerția finală
      const settleProgress =
        (progress - mainMovementEnd) / (settleDuration / totalDuration);

      const overshoot = 1.025;

      animationProgress =
        overshoot -
        ((overshoot - 1) * (1 - Math.cos(settleProgress * Math.PI))) / 2;
    }

    // Aplicăm progresul asupra poziției camerei.
    const currentX =
      startPosition[0] +
      (endPosition[0] - startPosition[0]) * animationProgress;

    const currentY =
      startPosition[1] +
      (endPosition[1] - startPosition[1]) * animationProgress;

    const currentZ =
      startPosition[2] +
      (endPosition[2] - startPosition[2]) * animationProgress;

    camera.position.set(currentX, currentY, currentZ);

    // Aplicăm și efectul discret de FOV.
    if (camera instanceof PerspectiveCamera) {
      const baseFov = startFov + (endFov - startFov) * animationProgress;

      const normalizedProgress = Math.min(animationProgress, 1);

      const fovPulse = Math.sin(normalizedProgress * Math.PI);

      camera.fov = baseFov + fovPulse;
      camera.updateProjectionMatrix();
    }

    controlsRef.current?.update();

    // La final fixăm exact poziția finală.
    if (progress >= 1) {
      camera.position.set(...endPosition);

      if (camera instanceof PerspectiveCamera) {
        camera.fov = endFov;
        camera.updateProjectionMatrix();
      }

      controlsRef.current?.update();

      completedRef.current = true;
      onComplete();
    }
  });

  return null;
}

export default function Car3DViewer({
  mode = "selection",
  heightClassName = "h-[490px]",
}: Car3DViewerProps) {
  const isSelectionMode = mode === "selection";

  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const [isPreviewIntroComplete, setIsPreviewIntroComplete] =
    useState(isSelectionMode);

  const handlePreviewIntroComplete = useCallback(() => {
    setIsPreviewIntroComplete(true);
  }, []);

  const cameraPosition: [number, number, number] = isSelectionMode
    ? [7.4, 2.55, 4.15]
    : [0.35, 2.2, 5.05];

  const cameraTarget: [number, number, number] = isSelectionMode
    ? [0.35, 0.3, 0]
    : [0.35, 0.18, 0];

  const cameraFov = isSelectionMode ? 53 : 40;

  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);

  const [partMeshes, setPartMeshes] = useState<Map<string, Mesh[]>>(new Map());

  const handlePartMeshesReady = useCallback(
    (nextPartMeshes: Map<string, Mesh[]>) => {
      setPartMeshes(nextPartMeshes);
    },
    [],
  );

  useOutlineSelection({
    partMeshes,
    selectedPartIds,
  });

  function handleTogglePart(partId: string) {
    setSelectedPartIds((currentPartIds) =>
      currentPartIds.includes(partId)
        ? currentPartIds.filter((id) => id !== partId)
        : [...currentPartIds, partId],
    );
  }

  function handleRemovePart(partId: string) {
    setSelectedPartIds((currentPartIds) =>
      currentPartIds.filter((id) => id !== partId),
    );
  }

  return (
    <div className="w-full">
      <div
        className={`${heightClassName} w-full touch-none overflow-hidden ${
          isSelectionMode ? "rounded-2xl bg-neutral-900" : "bg-transparent"
        }`}
      >
        <Canvas
          frameloop="demand"
          dpr={1}
          camera={{
            position: cameraPosition,
            fov: cameraFov,
            near: 0.1,
            far: 100,
          }}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = 1.18;
          }}
        >
          {isSelectionMode && <color attach="background" args={["#171717"]} />}

          <ambientLight intensity={0.22} />

          <hemisphereLight args={["#e8edf5", "#111318", 0.38]} />

          <directionalLight position={[6, 8, 5]} intensity={2.35} />

          <directionalLight position={[-6, 4, 4]} intensity={1.35} />

          <directionalLight position={[-2, 5, -7]} intensity={1.25} />

          <Suspense fallback={null}>
            <Model
              mode={mode}
              position={[0.35, 0, 0]}
              selectedPartIds={selectedPartIds}
              onTogglePart={handleTogglePart}
              onPartMeshesReady={handlePartMeshesReady}
            />

            <Environment preset="city" environmentIntensity={0.85} />

            <ContactShadows
              position={[0, -0.75, 0]}
              opacity={0.55}
              scale={10}
              blur={3}
              far={4}
              resolution={128}
            />
          </Suspense>

          {!isSelectionMode && (
            <PreviewCameraIntro
              active={!isPreviewIntroComplete}
              controlsRef={controlsRef}
              onComplete={handlePreviewIntroComplete}
            />
          )}

          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableRotate={isSelectionMode || isPreviewIntroComplete}
            enableZoom={isSelectionMode}
            enablePan={false}
            enableDamping
            rotateSpeed={isSelectionMode ? 1 : 0.35}
            dampingFactor={isSelectionMode ? 0.08 : 0.14}
            minDistance={isSelectionMode ? 4.5 : 3.6}
            maxDistance={isSelectionMode ? 8.3 : 5.8}
            minPolarAngle={isSelectionMode ? Math.PI / 3.2 : Math.PI / 2.65}
            maxPolarAngle={isSelectionMode ? Math.PI / 2.05 : Math.PI / 2.4}
            target={cameraTarget}
          />
        </Canvas>
      </div>

      {isSelectionMode && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-neutral-900 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-white">
                Piese selectate
              </p>

              <p className="mt-1 text-xs text-neutral-400">
                Selectează elementele avariate direct pe modelul 3D.
              </p>
            </div>

            <div className="flex h-8 min-w-8 items-center justify-center rounded-full bg-orange-500 px-2 text-sm font-semibold text-white">
              {selectedPartIds.length}
            </div>
          </div>

          {selectedPartIds.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-5 text-center">
              <p className="text-sm text-neutral-400">
                Nu ai selectat încă nicio piesă.
              </p>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedPartIds.map((partId) => {
                const part = CAR_PARTS[partId as keyof typeof CAR_PARTS];

                return (
                  <div
                    key={partId}
                    className="flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 py-2 pl-3 pr-2"
                  >
                    <span className="text-sm font-medium text-orange-100">
                      {part?.label ?? partId}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleRemovePart(partId)}
                      aria-label={`Elimină ${part?.label ?? partId}`}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-orange-200 transition hover:bg-orange-500/20 hover:text-white"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
