import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BODY_DIAGRAM_REGIONS, BodyDiagramRegion } from '../lib/bodyDiagram';

interface BodyDiagramProps {
  /** Readiness 0-100 per region (0 = just trained, 100 = fully recovered), or null for "no data" (rendered neutral grey). */
  regionScores: Record<BodyDiagramRegion, number | null>;
}

const NEUTRAL = new THREE.Color(0x9ca3af); // zinc-400, "no data"
const SKIN = new THREE.Color(0xe4e4e7); // zinc-200, light grey

// Hevy-style graduated blue scale: pale/light blue = fully rested, deep
// saturated blue = just worked / least recovered.
function scoreToColor(score: number | null): THREE.Color {
  if (score === null) return NEUTRAL.clone();
  const t = Math.max(0, Math.min(100, score)) / 100;
  const worked = new THREE.Color(0x1e3a8a); // blue-900
  const rested = new THREE.Color(0xbfdbfe); // blue-200
  return worked.clone().lerp(rested, t);
}

export const BodyDiagram: React.FC<BodyDiagramProps> = ({ regionScores }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const boxRef = useRef<{ center: THREE.Vector3; maxDim: number } | null>(null);
  const [view, setView] = useState<'front' | 'back'>('front');
  const [ready, setReady] = useState(false);

  const render = () => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!renderer || !camera || !scene) return;
    renderer.render(scene, camera);
  };

  const frameCamera = (sign: 1 | -1) => {
    const camera = cameraRef.current;
    const box = boxRef.current;
    if (!camera || !box) return;
    const { center, maxDim } = box;
    camera.position.set(center.x, center.y, center.z + sign * maxDim * 2.6);
    camera.up.set(0, 1, 0);
    camera.lookAt(center);
    camera.near = maxDim * 0.01;
    camera.far = maxDim * 20;
    camera.updateProjectionMatrix();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = null;
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(30, width / height, 1, 100000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(200, 400, 600);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.3);
    fill.position.set(-300, 100, -200);
    scene.add(fill);

    const loader = new GLTFLoader();
    let disposed = false;
    loader.load('/body-diagram.glb', (gltf) => {
      if (disposed) return;
      const group = new THREE.Group();
      gltf.scene.children.slice().forEach((c) => group.add(c));
      scene.add(group);
      group.rotation.x = -Math.PI / 2;

      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      boxRef.current = {
        center: box.getCenter(new THREE.Vector3()),
        maxDim: Math.max(size.x, size.y, size.z),
      };
      groupRef.current = group;
      frameCamera(1);
      render();
      setReady(true);
    });

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      render();
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply view visibility + region coloring whenever inputs change.
  useEffect(() => {
    const group = groupRef.current;
    if (!group || !ready) return;
    group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const region = obj.userData.region as BodyDiagramRegion | 'skin' | undefined;
      const objView = obj.userData.view as 'front' | 'back' | 'both' | undefined;
      obj.visible = objView === view || objView === 'both';

      if (region === 'skin' && obj.material instanceof THREE.MeshStandardMaterial) {
        obj.material.color.copy(SKIN);
        obj.material.transparent = true;
        obj.material.opacity = 0.12;
        obj.material.depthWrite = false;
      } else if (region && obj.material instanceof THREE.MeshStandardMaterial) {
        const score = BODY_DIAGRAM_REGIONS.includes(region as BodyDiagramRegion)
          ? regionScores[region as BodyDiagramRegion]
          : null;
        obj.material.color.copy(scoreToColor(score));
      }
    });
    frameCamera(view === 'front' ? 1 : -1);
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, regionScores, ready]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-end mb-2">
        <div className="inline-flex rounded-full bg-zinc-100 dark:bg-zinc-800 p-0.5 text-xs font-medium">
          <button
            className={`px-3 py-1 rounded-full transition-colors ${view === 'front' ? 'bg-white dark:bg-zinc-700 shadow-sm' : 'text-zinc-500'}`}
            onClick={() => setView('front')}
          >
            Front
          </button>
          <button
            className={`px-3 py-1 rounded-full transition-colors ${view === 'back' ? 'bg-white dark:bg-zinc-700 shadow-sm' : 'text-zinc-500'}`}
            onClick={() => setView('back')}
          >
            Back
          </button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-h-[320px] w-full" />
      {!ready && (
        <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm -mt-8">
          Loading…
        </div>
      )}
    </div>
  );
};
