export type TowingRoutePoint = [number, number];
export type TowingRoutePath = TowingRoutePoint[];
export type TowingRoutePaths = TowingRoutePath[];

export function isValidTowingRoutePaths(
  value: unknown,
): value is TowingRoutePaths {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (path) =>
        Array.isArray(path) &&
        path.length >= 2 &&
        path.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            typeof point[0] === "number" &&
            Number.isFinite(point[0]) &&
            point[0] >= -90 &&
            point[0] <= 90 &&
            typeof point[1] === "number" &&
            Number.isFinite(point[1]) &&
            point[1] >= -180 &&
            point[1] <= 180,
        ),
    )
  );
}
