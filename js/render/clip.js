// Отсечение полигона по ближней плоскости камеры (z = near).
// Без этого грани, пересекающие плоскость экрана, «улетают» в бесконечность
// при делении на z, и модель разваливается при пролёте вплотную.
// Алгоритм Сазерленда–Ходжмана по одной плоскости.

export const clipNear = (poly, near) => {
  const n = poly.length;
  if (n < 3) return null;

  let allIn = true, allOut = true;
  for (let i = 0; i < n; i++) {
    if (poly[i].z >= near) allOut = false; else allIn = false;
  }
  if (allIn) return poly;
  if (allOut) return null;

  const out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ain = a.z >= near;
    const bin = b.z >= near;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (near - a.z) / (b.z - a.z);
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: near,
      });
    }
  }
  return out.length >= 3 ? out : null;
};

// Отсечение отрезка (для линий сканера, трасс, каркасных подсказок).
export const clipSegmentNear = (a, b, near) => {
  const ain = a.z >= near, bin = b.z >= near;
  if (ain && bin) return [a, b];
  if (!ain && !bin) return null;
  const t = (near - a.z) / (b.z - a.z);
  const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near };
  return ain ? [a, p] : [p, b];
};
