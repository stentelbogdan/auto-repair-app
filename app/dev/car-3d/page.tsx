import Car3DViewer from "@/app/components/car-3d/Car3DViewer";

export default function Page() {
  return (
    <main className="p-10">
      <Car3DViewer mode="selection" />
    </main>
  );
}