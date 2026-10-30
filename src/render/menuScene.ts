// Nastrój menu: odległe słupy dymu nad horyzontem i drobinki kurzu w ciepłym świetle.
// Spokojnie, trochę smętnie – wojna gdzieś daleko za pagórkami.
import * as THREE from 'three';
import { toonMat } from './toon';

interface Column {
  base: THREE.Vector3;
  height: number;
  lean: number;
  phase: number;
}

const PUFFS_PER_COLUMN = 26;

export class MenuAmbience {
  readonly group = new THREE.Group();
  private readonly smoke: THREE.InstancedMesh;
  private readonly motes: THREE.Points;
  private readonly columns: Column[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0.3, 1, 0.2).normalize();

  constructor() {
    // Słupy dymu: bryły toon, które bez końca wznoszą się, puchną i znoszone są wiatrem.
    const cols: [number, number, number, number][] = [
      [-95, -150, 46, 0.32],
      [-38, -175, 34, 0.26],
      [70, -160, 40, 0.3],
    ];
    for (const [x, z, h, lean] of cols) this.columns.push({ base: new THREE.Vector3(x, 0, z), height: h, lean, phase: Math.random() });
    const mat = toonMat({ color: 0xffffff, transparent: true, opacity: 0.92 });
    mat.fog = true;
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, this.columns.length * PUFFS_PER_COLUMN);
    this.smoke.frustumCulled = false;
    const dark = new THREE.Color('#3e3631');
    const light = new THREE.Color('#9a8c80');
    const c = new THREE.Color();
    for (let i = 0; i < this.smoke.count; i++) {
      const k = (i % PUFFS_PER_COLUMN) / PUFFS_PER_COLUMN;
      this.smoke.setColorAt(i, c.copy(dark).lerp(light, k * 0.85 + Math.random() * 0.15));
    }
    this.group.add(this.smoke);

    // Drobinki kurzu/pyłku przy kamerze, połyskujące w słońcu.
    const n = 160;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = Math.random() * 7;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 24;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xffe2b0, size: 0.06, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.group.add(this.motes);
  }

  update(time: number, dt: number): void {
    let idx = 0;
    for (const col of this.columns) {
      for (let j = 0; j < PUFFS_PER_COLUMN; j++) {
        const k = (j / PUFFS_PER_COLUMN + time * 0.018 + col.phase) % 1;
        const y = k * col.height;
        const drift = Math.pow(k, 1.6) * col.height * col.lean;
        this.p.set(col.base.x + drift + Math.sin(j * 2.1 + time * 0.3) * 1.2, y, col.base.z + Math.cos(j * 1.7) * 1.5);
        const size = 2.2 + k * 9 + Math.sin(j * 3.3) * 0.8;
        const fade = Math.min(1, (1 - k) * 4) * Math.min(1, k * 12 + 0.2);
        this.q.setFromAxisAngle(this.axis, j * 1.3 + time * 0.05);
        this.m.compose(this.p, this.q, this.s.set(size * fade, size * 0.8 * fade, size * fade));
        this.smoke.setMatrixAt(idx++, this.m);
      }
    }
    this.smoke.instanceMatrix.needsUpdate = true;
    const a = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      let x = a.getX(i) + dt * (0.35 + Math.sin(i) * 0.1);
      let y = a.getY(i) + Math.sin(time * 0.7 + i) * dt * 0.12;
      if (x > 15) x -= 30;
      if (y > 7) y = 0;
      a.setXY(i, x, y);
    }
    a.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.smoke.geometry.dispose();
    this.motes.geometry.dispose();
  }
}
