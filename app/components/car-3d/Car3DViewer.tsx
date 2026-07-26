"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import type { Mesh } from "three";

import { Model } from "./CarModel";
import { CAR_PARTS } from "./carParts";
import { useOutlineSelection } from "./useOutlineSelection";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

type Car3DViewerProps = {
  mode?: "preview" | "selection";
  heightClassName?: string;
};

export default function Car3DViewer({
  mode = "selection",
  heightClassName = "h-[490px]",
}: Car3DViewerProps) {
  const isSelectionMode = mode === "selection";

  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const cameraPosition: [number, number, number] = isSelectionMode
    ? [7.4, 2.55, 4.15]
    : [4.6, 1.65, 2.7];

  const cameraTarget: [number, number, number] = isSelectionMode
    ? [0.35, 0.3, 0]
    : [0.35, 0.18, 0];

  const cameraFov = isSelectionMode ? 53 : 40;

  const handleControlsReady = useCallback(
  (controls: OrbitControlsImpl | null) => {
    controlsRef.current = controls;

    if (!controls || isSelectionMode) return;

    const savedRotation = sessionStorage.getItem(
      "dashboard-car-preview-rotation",
    );

    if (!savedRotation) return;

    try {
      const parsedRotation = JSON.parse(savedRotation) as {
        azimuthalAngle: number;
        polarAngle: number;
      };

      controls.setAzimuthalAngle(parsedRotation.azimuthalAngle);
      controls.setPolarAngle(parsedRotation.polarAngle);
      controls.update();
    } catch {
      sessionStorage.removeItem("dashboard-car-preview-rotation");
    }
  },
  [isSelectionMode],
);

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

  function handlePreviewRotationEnd() {
    if (isSelectionMode) return;

    const controls = controlsRef.current;

    if (!controls) return;

    sessionStorage.setItem(
      "dashboard-car-preview-rotation",
      JSON.stringify({
        azimuthalAngle: controls.getAzimuthalAngle(),
        polarAngle: controls.getPolarAngle(),
      }),
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
          dpr={[1, 1.5]}
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
              opacity={0.6}
              scale={14}
              blur={3.5}
              far={6}
            />
          </Suspense>

          <OrbitControls
            ref={handleControlsReady}
            makeDefault
            enableRotate
            enableZoom={isSelectionMode}
            enablePan={false}
            enableDamping
            rotateSpeed={isSelectionMode ? 1 : 0.35}
            dampingFactor={isSelectionMode ? 0.08 : 0.14}
            minDistance={isSelectionMode ? 4.5 : 3.6}
            maxDistance={isSelectionMode ? 8.3 : 5.8}
            minPolarAngle={isSelectionMode ? Math.PI / 3.2 : Math.PI / 2.75}
            maxPolarAngle={isSelectionMode ? Math.PI / 2.05 : Math.PI / 2.25}
            target={cameraTarget}
            onEnd={handlePreviewRotationEnd}
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
