"use client";

import { Suspense, useCallback, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import type { Mesh } from "three";

import { Model } from "./CarModel";
import { CAR_PARTS } from "./carParts";
import { useOutlineSelection } from "./useOutlineSelection";

type Car3DViewerProps = {
  mode?: "preview" | "selection";
  heightClassName?: string;
};

export default function Car3DViewer({
  mode = "selection",
  heightClassName = "h-[490px]",
}: Car3DViewerProps) {
  const isSelectionMode = mode === "selection";

  const cameraPosition: [number, number, number] = isSelectionMode
    ? [7.4, 2.55, 4.15]
    : [4.6, 1.65, 2.7];

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
        className={`${heightClassName} w-full touch-none overflow-hidden rounded-2xl bg-neutral-900`}
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
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = 1.12;
          }}
        >
          <color attach="background" args={["#171717"]} />

          <ambientLight intensity={0.22} />

          <hemisphereLight args={["#e8edf5", "#111318", 0.38]} />

          <directionalLight position={[6, 8, 5]} intensity={2.15} />

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

            <Environment preset="city" environmentIntensity={0.7} />

            <ContactShadows
              position={[0, -0.75, 0]}
              opacity={0.45}
              scale={12}
              blur={2.5}
              far={5}
            />
          </Suspense>

          <OrbitControls
            makeDefault
            enableRotate
            enableZoom={isSelectionMode}
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            minDistance={isSelectionMode ? 4.5 : 3.6}
            maxDistance={isSelectionMode ? 8.3 : 5.8}
            minPolarAngle={Math.PI / 3.2}
            maxPolarAngle={Math.PI / 2.05}
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
