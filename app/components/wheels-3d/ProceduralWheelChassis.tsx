import { useEffect, useMemo } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import type { WheelPositionId } from "@/lib/wheels/wheels-service-details";

const UNIT_BOX_GEOMETRY = new BoxGeometry(1, 1, 1);
const UNIT_BEAM_GEOMETRY = new CylinderGeometry(1, 1, 1, 8, 1);
const TIRE_GEOMETRY = new TorusGeometry(0.53, 0.23, 10, 28);
const RIM_RING_GEOMETRY = new TorusGeometry(0.43, 0.065, 7, 24);
const BRAKE_DISC_GEOMETRY = new CylinderGeometry(0.35, 0.35, 0.045, 20, 1);
const HUB_GEOMETRY = new CylinderGeometry(0.14, 0.14, 0.26, 12, 1);
const DIFFERENTIAL_GEOMETRY = new SphereGeometry(0.31, 12, 8);

const springPoints = Array.from({ length: 49 }, (_, index) => {
  const progress = index / 48;
  const angle = progress * Math.PI * 10;

  return new Vector3(
    Math.cos(angle) * 0.16,
    progress * 0.64 - 0.32,
    Math.sin(angle) * 0.16,
  );
});

const SPRING_GEOMETRY = new TubeGeometry(
  new CatmullRomCurve3(springPoints),
  48,
  0.027,
  5,
  false,
);

const Y_AXIS = new Vector3(0, 1, 0);
const DRAG_CLICK_THRESHOLD = 5;
const FRONT_AXLE_X = 2.18;
const REAR_AXLE_X = -2.18;
const WHEEL_Z = 1.5;

type Point3D = [number, number, number];

type ProceduralWheelChassisProps = {
  selectedWheels: WheelPositionId[];
  onToggleWheel: (wheelId: WheelPositionId) => void;
};

type ChassisMaterials = {
  frame: MeshStandardMaterial;
  suspension: MeshStandardMaterial;
  brushedMetal: MeshStandardMaterial;
  damper: MeshStandardMaterial;
  spring: MeshStandardMaterial;
  tire: MeshStandardMaterial;
  rim: MeshStandardMaterial;
  brakeDisc: MeshStandardMaterial;
  caliper: MeshStandardMaterial;
  selectedTire: MeshStandardMaterial;
  selectedMetal: MeshStandardMaterial;
};

type BeamProps = {
  start: Point3D;
  end: Point3D;
  radius: number;
  material: MeshStandardMaterial;
};

function Beam({ start, end, radius, material }: BeamProps) {
  const transform = useMemo(() => {
    const startPoint = new Vector3(...start);
    const endPoint = new Vector3(...end);
    const direction = endPoint.clone().sub(startPoint);

    return {
      position: startPoint.clone().add(endPoint).multiplyScalar(0.5),
      quaternion: new Quaternion().setFromUnitVectors(
        Y_AXIS,
        direction.clone().normalize(),
      ),
      length: direction.length(),
    };
  }, [end, start]);

  return (
    <mesh
      geometry={UNIT_BEAM_GEOMETRY}
      material={material}
      position={transform.position}
      quaternion={transform.quaternion}
      scale={[radius, transform.length, radius]}
    />
  );
}

type SelectableWheelProps = {
  id: WheelPositionId;
  position: Point3D;
  selected: boolean;
  materials: ChassisMaterials;
  onToggle: (wheelId: WheelPositionId) => void;
};

function SelectableWheel({
  id,
  position,
  selected,
  materials,
  onToggle,
}: SelectableWheelProps) {
  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();

    if (event.delta > DRAG_CLICK_THRESHOLD) return;

    onToggle(id);
  }

  function handlePointerOver(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    document.body.style.cursor = "pointer";
  }

  function handlePointerOut(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    document.body.style.cursor = "default";
  }

  return (
    <group
      name={id}
      position={position}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <mesh
        geometry={TIRE_GEOMETRY}
        material={selected ? materials.selectedTire : materials.tire}
      />
      <mesh
        geometry={RIM_RING_GEOMETRY}
        material={selected ? materials.selectedMetal : materials.rim}
        scale={[1, 1, 1.12]}
      />

      {Array.from({ length: 7 }, (_, index) => {
        const angle = (index / 7) * Math.PI * 2;

        return (
          <mesh
            key={angle}
            geometry={UNIT_BOX_GEOMETRY}
            material={selected ? materials.selectedMetal : materials.rim}
            position={[Math.cos(angle) * 0.21, Math.sin(angle) * 0.21, 0.04]}
            rotation={[0, 0, angle]}
            scale={[0.4, 0.055, 0.075]}
          />
        );
      })}

      <mesh
        geometry={BRAKE_DISC_GEOMETRY}
        material={materials.brakeDisc}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <mesh
        geometry={HUB_GEOMETRY}
        material={selected ? materials.selectedMetal : materials.brushedMetal}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <mesh
        geometry={UNIT_BOX_GEOMETRY}
        material={materials.caliper}
        position={[0.29, 0.07, 0.09]}
        rotation={[0, 0, 0.2]}
        scale={[0.14, 0.28, 0.13]}
      />
    </group>
  );
}

type SuspensionCornerProps = {
  x: number;
  side: -1 | 1;
  materials: ChassisMaterials;
};

function SuspensionCorner({ x, side, materials }: SuspensionCornerProps) {
  const outerLower: Point3D = [x, -0.1, side * 1.28];
  const outerUpper: Point3D = [x, 0.34, side * 1.27];
  const innerFront: Point3D = [x - 0.38, -0.14, side * 0.7];
  const innerRear: Point3D = [x + 0.38, -0.14, side * 0.7];
  const upperInner: Point3D = [x - 0.1, 0.48, side * 0.73];
  const damperMiddle: Point3D = [x, 0.5, side * 1.02];
  const damperTop: Point3D = [x, 1.02, side * 0.74];
  const halfShaftInner: Point3D = [x, 0.03, side * 0.24];
  const halfShaftOuter: Point3D = [x, 0.01, side * 1.31];

  return (
    <group>
      <mesh
        geometry={UNIT_BOX_GEOMETRY}
        material={materials.suspension}
        position={[x, 0.08, side * 1.27]}
        scale={[0.19, 0.58, 0.17]}
      />
      <Beam
        start={innerFront}
        end={outerLower}
        radius={0.052}
        material={materials.suspension}
      />
      <Beam
        start={innerRear}
        end={outerLower}
        radius={0.052}
        material={materials.suspension}
      />
      <Beam
        start={upperInner}
        end={outerUpper}
        radius={0.043}
        material={materials.suspension}
      />
      <Beam
        start={outerUpper}
        end={damperMiddle}
        radius={0.09}
        material={materials.damper}
      />
      <Beam
        start={damperMiddle}
        end={damperTop}
        radius={0.043}
        material={materials.brushedMetal}
      />
      <Beam
        start={halfShaftInner}
        end={halfShaftOuter}
        radius={0.05}
        material={materials.brushedMetal}
      />
      <mesh
        geometry={SPRING_GEOMETRY}
        material={materials.spring}
        position={[x, 0.68, side * 0.88]}
      />

      {x > 0 && (
        <Beam
          start={[x - 0.62, 0.14, side * 0.54]}
          end={[x, 0.13, side * 1.23]}
          radius={0.035}
          material={materials.brushedMetal}
        />
      )}
    </group>
  );
}

function createMaterials(): ChassisMaterials {
  return {
    frame: new MeshStandardMaterial({
      color: "#11151a",
      metalness: 0.78,
      roughness: 0.3,
    }),
    suspension: new MeshStandardMaterial({
      color: "#343b44",
      metalness: 0.82,
      roughness: 0.27,
    }),
    brushedMetal: new MeshStandardMaterial({
      color: "#77808a",
      metalness: 0.92,
      roughness: 0.18,
    }),
    damper: new MeshStandardMaterial({
      color: "#20252b",
      metalness: 0.7,
      roughness: 0.3,
    }),
    spring: new MeshStandardMaterial({
      color: "#5e6670",
      metalness: 0.9,
      roughness: 0.2,
    }),
    tire: new MeshStandardMaterial({
      color: "#07080a",
      metalness: 0.02,
      roughness: 0.82,
    }),
    rim: new MeshStandardMaterial({
      color: "#59616b",
      metalness: 0.94,
      roughness: 0.16,
    }),
    brakeDisc: new MeshStandardMaterial({
      color: "#9ca3aa",
      metalness: 0.96,
      roughness: 0.24,
    }),
    caliper: new MeshStandardMaterial({
      color: "#24282d",
      metalness: 0.72,
      roughness: 0.34,
    }),
    selectedTire: new MeshStandardMaterial({
      color: "#1c0c07",
      emissive: "#f97316",
      emissiveIntensity: 0.42,
      metalness: 0.04,
      roughness: 0.72,
    }),
    selectedMetal: new MeshStandardMaterial({
      color: "#c65d12",
      emissive: "#f97316",
      emissiveIntensity: 0.62,
      metalness: 0.78,
      roughness: 0.2,
    }),
  };
}

export default function ProceduralWheelChassis({
  selectedWheels,
  onToggleWheel,
}: ProceduralWheelChassisProps) {
  const invalidate = useThree((state) => state.invalidate);
  const materials = useMemo(() => createMaterials(), []);
  const selectedWheelIds = new Set(selectedWheels);

  useEffect(() => {
    invalidate();
  }, [invalidate, selectedWheels]);

  useEffect(() => {
    return () => {
      Object.values(materials).forEach((material) => material.dispose());
      document.body.style.cursor = "default";
    };
  }, [materials]);

  return (
    <group dispose={null} position={[0, -0.04, 0]}>
      {[-0.68, 0.68].map((z) => (
        <mesh
          key={`rail-${z}`}
          geometry={UNIT_BOX_GEOMETRY}
          material={materials.frame}
          position={[0, 0.38, z]}
          scale={[4.55, 0.16, 0.2]}
        />
      ))}
      <mesh
        geometry={UNIT_BOX_GEOMETRY}
        material={materials.frame}
        position={[0, 0.24, 0]}
        scale={[3.2, 0.18, 0.48]}
      />

      {[-1.9, 0, 1.9].map((x) => (
        <mesh
          key={`crossmember-${x}`}
          geometry={UNIT_BOX_GEOMETRY}
          material={materials.suspension}
          position={[x, 0.34, 0]}
          scale={[0.18, 0.14, 1.58]}
        />
      ))}

      {[
        [[2.28, 0.35, -0.68], [2.08, 0.22, -1.02]],
        [[2.28, 0.35, 0.68], [2.08, 0.22, 1.02]],
        [[-2.28, 0.35, -0.68], [-2.08, 0.22, -1.02]],
        [[-2.28, 0.35, 0.68], [-2.08, 0.22, 1.02]],
      ].map(([start, end], index) => (
        <Beam
          key={index}
          start={start as Point3D}
          end={end as Point3D}
          radius={0.09}
          material={materials.frame}
        />
      ))}

      <Beam
        start={[REAR_AXLE_X, 0.1, 0]}
        end={[FRONT_AXLE_X, 0.1, 0]}
        radius={0.075}
        material={materials.brushedMetal}
      />

      {[REAR_AXLE_X, FRONT_AXLE_X].map((x) => (
        <mesh
          key={`differential-${x}`}
          geometry={DIFFERENTIAL_GEOMETRY}
          material={materials.damper}
          position={[x, 0.1, 0]}
          scale={[1.18, 0.82, 0.94]}
        />
      ))}

      <mesh
        geometry={UNIT_BOX_GEOMETRY}
        material={materials.frame}
        position={[1.13, 0.61, 0]}
        scale={[1.18, 0.56, 1.02]}
      />
      <mesh
        geometry={UNIT_BOX_GEOMETRY}
        material={materials.damper}
        position={[0.2, 0.46, 0]}
        scale={[0.92, 0.42, 0.62]}
      />

      <SuspensionCorner x={FRONT_AXLE_X} side={1} materials={materials} />
      <SuspensionCorner x={FRONT_AXLE_X} side={-1} materials={materials} />
      <SuspensionCorner x={REAR_AXLE_X} side={1} materials={materials} />
      <SuspensionCorner x={REAR_AXLE_X} side={-1} materials={materials} />

      <SelectableWheel
        id="front_left"
        position={[FRONT_AXLE_X, 0, WHEEL_Z]}
        selected={selectedWheelIds.has("front_left")}
        materials={materials}
        onToggle={onToggleWheel}
      />
      <SelectableWheel
        id="front_right"
        position={[FRONT_AXLE_X, 0, -WHEEL_Z]}
        selected={selectedWheelIds.has("front_right")}
        materials={materials}
        onToggle={onToggleWheel}
      />
      <SelectableWheel
        id="rear_left"
        position={[REAR_AXLE_X, 0, WHEEL_Z]}
        selected={selectedWheelIds.has("rear_left")}
        materials={materials}
        onToggle={onToggleWheel}
      />
      <SelectableWheel
        id="rear_right"
        position={[REAR_AXLE_X, 0, -WHEEL_Z]}
        selected={selectedWheelIds.has("rear_right")}
        materials={materials}
        onToggle={onToggleWheel}
      />
    </group>
  );
}
