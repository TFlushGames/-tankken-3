// Bryły pancerza z przekrojów: każdy przekrój to trapez (dół/góra o różnej szerokości) w danym X.
// Pozwala budować skośne płyty czołowe, pochylone burty i zwężające się wieże jak w prawdziwych czołgach.
import * as THREE from 'three';

export interface Section {
  /** Położenie wzdłuż osi czołgu (m, + = przód). */
  x: number;
  /** Dolna i górna krawędź (m). */
  y0: number;
  y1: number;
  /** Połowa szerokości na dole i na górze (m). */
  w0: number;
  w1: number;
}

/** Bryła z kolejnych przekrojów; ściany płaskie (cieniowanie „fasetkowe”), UV planarne. */
export function loft(sections: Section[]): THREE.BufferGeometry {
  const rings = sections.map((s) => [
    new THREE.Vector3(s.x, s.y0, -s.w0),
    new THREE.Vector3(s.x, s.y0, s.w0),
    new THREE.Vector3(s.x, s.y1, s.w1),
    new THREE.Vector3(s.x, s.y1, -s.w1),
  ]);
  const tris: THREE.Vector3[][] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      tris.push([a[k]!, b[k]!, b[k2]!], [a[k]!, b[k2]!, a[k2]!]);
    }
  }
  const first = rings[0]!;
  const last = rings[rings.length - 1]!;
  tris.push([first[0]!, first[1]!, first[2]!], [first[0]!, first[2]!, first[3]!]);
  tris.push([last[0]!, last[1]!, last[2]!], [last[0]!, last[2]!, last[3]!]);
  // Środek bryły – do ustawienia ścian na zewnątrz.
  const c = new THREE.Vector3();
  let n = 0;
  for (const r of rings) for (const v of r) {
    c.add(v);
    n++;
  }
  c.divideScalar(n);
  const pos: number[] = [];
  const uv: number[] = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const mid = new THREE.Vector3();
  for (const t of tris) {
    let [p0, p1, p2] = t as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    e1.subVectors(p1, p0);
    e2.subVectors(p2, p0);
    nrm.crossVectors(e1, e2);
    if (nrm.lengthSq() < 1e-10) continue;
    mid.copy(p0).add(p1).add(p2).divideScalar(3).sub(c);
    if (nrm.dot(mid) < 0) [p1, p2] = [p2, p1];
    for (const p of [p0, p1, p2]) {
      pos.push(p.x, p.y, p.z);
      uv.push(p.x * 0.35 + p.z * 0.2, p.y * 0.35 + p.z * 0.25);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Skrót: prostopadłościan o skośnym przodzie/tyle (przekroje w x0, x0+tył, x1-przód, x1). */
export function box(x0: number, x1: number, y0: number, y1: number, w: number): THREE.BufferGeometry {
  return loft([
    { x: x0, y0, y1, w0: w, w1: w },
    { x: x1, y0, y1, w0: w, w1: w },
  ]);
}
