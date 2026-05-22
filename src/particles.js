// Subtle yellow particle drift on the hero. Three.js r128 via CDN.
// Auto-disables for prefers-reduced-motion and on small viewports.

export function startHeroParticles(canvasEl) {
  if (!canvasEl) return null;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  if (window.innerWidth < 880) return null;
  if (typeof THREE === "undefined") return null;
  if (!(window.AI_PLAYBOOK_CONFIG || {}).ENABLE_PARTICLES) return null;

  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, alpha: true, antialias: true });
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 18;

  function resize() {
    const w = canvasEl.clientWidth;
    const h = canvasEl.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  // Particle field — yellow, subtle, drift mostly upward + sideways.
  const COUNT = 220;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * 36;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 22;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
    velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.004;
    velocities[i * 3 + 1] = Math.random() * 0.006 + 0.001; // mostly upward
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.003;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  // Build a soft circular sprite so dots don't look like squares.
  const sprite = (function () {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(0,0,0,0.95)");
    g.addColorStop(0.4, "rgba(0,0,0,0.65)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  const material = new THREE.PointsMaterial({
    size: 0.42,
    map: sprite,
    transparent: true,
    depthWrite: false,
    color: 0x101010,
    opacity: 0.55,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  let raf = 0;
  let running = true;
  function tick() {
    if (!running) return;
    const arr = geometry.attributes.position.array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 0] += velocities[i * 3 + 0];
      arr[i * 3 + 1] += velocities[i * 3 + 1];
      arr[i * 3 + 2] += velocities[i * 3 + 2];
      // Wrap around bounds so the field never empties.
      if (arr[i * 3 + 1] > 12) arr[i * 3 + 1] = -12;
      if (arr[i * 3 + 0] > 20) arr[i * 3 + 0] = -20;
      if (arr[i * 3 + 0] < -20) arr[i * 3 + 0] = 20;
      if (arr[i * 3 + 2] > 6)  arr[i * 3 + 2] = -6;
      if (arr[i * 3 + 2] < -6) arr[i * 3 + 2] = 6;
    }
    geometry.attributes.position.needsUpdate = true;
    points.rotation.y += 0.0006;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  tick();

  // Pause when tab hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; tick(); }
  });

  return {
    stop() { running = false; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); },
  };
}
