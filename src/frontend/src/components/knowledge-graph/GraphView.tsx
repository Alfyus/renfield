/**
 * GraphView — Wissensgraph 3D (variant A-3D).
 *
 * Three.js scene rendering the connected-component clusters returned
 * by /api/wissensbasis/graph as translucent spheres with hub entities
 * orbiting each. Cross-cluster bridges drawn as bezier arcs. Camera
 * orbits via OrbitControls (drag to rotate, scroll to zoom, right-drag
 * to pan).
 *
 * Replaces the prior react-force-graph-2d view per the approved
 * A-LANDING+A-3D design (designs/wissensgraph-20260509/approved.json).
 * Cluster grouping is dynamic (connected components) so new
 * integrations surface naturally as new clusters without code changes.
 *
 * Hub click → navigate to /wissensbasis?focus=<atom_id>, ties into
 * the T24 UUID-based focus chain.
 *
 * Render budget: ~16 entities + ~10 relations in current prod (target
 * 60fps trivially). The scene uses StandardMaterial only on hubs +
 * cluster cores; everything else is BasicMaterial / wireframe to keep
 * the scene cheap on the GPU.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import apiClient from '../../utils/axios';

interface Hub {
  entity_id: string;
  name: string;
  entity_type: string;
  mention_count: number;
}

interface Cluster {
  id: string;
  label: string;
  sub_label: string;
  entity_count: number;
  hubs: Hub[];
  color_seed: number;
}

interface Bridge {
  from_cluster: string;
  to_cluster: string;
  weight: number;
}

interface GraphResponse {
  clusters: Cluster[];
  bridges: Bridge[];
  total_entities: number;
  total_relations: number;
  truncated: boolean;
}

// Color palette — matches variant-A-3d.html. Each entry is the cluster
// theme color; the renderer derives sphere atmosphere, shell, and core
// from the same hex.
const PALETTE: number[] = [
  0xe63e54, // primary red (Reva brand)
  0x06b6d4, // accent cyan
  0xa78bfa, // violet
  0xeab308, // amber
  0xf97316, // orange
  0x22c55e, // green
];

function pickColor(seed: number): number {
  return PALETTE[seed % PALETTE.length];
}

// 5-color palette for hub status. The mock used these to color the
// per-release hubs; for now we color hubs by their cluster's seed,
// adding the status colors as a future hook when wb_field_provenance
// status is wired in.
const _STATUS_COLORS = [0x22c55e, 0xef4444, 0xeab308, 0x64748b];
void _STATUS_COLORS;

export default function GraphView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch clusters from the Reva-side /api/wissensbasis/graph endpoint.
  useEffect(() => {
    let cancelled = false;
    apiClient.get<GraphResponse>('/api/wissensbasis/graph')
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(err => {
        if (!cancelled) setLoadError(err?.message || String(err));
      });
    return () => { cancelled = true; };
  }, []);

  // Three.js scene lifecycle. Re-runs only when `data` changes.
  useEffect(() => {
    const root = rootRef.current;
    const labelsLayer: HTMLDivElement | null = labelsRef.current;
    if (!root || !labelsLayer || !data) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0f1c, 0.018);

    const W = () => root.clientWidth;
    const H = () => root.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, W() / H(), 0.1, 1000);
    camera.position.set(0, 14, 36);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(W(), H());
    renderer.setClearColor(0x0a0f1c, 1);
    root.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 8;
    controls.maxDistance = 80;

    scene.add(new THREE.AmbientLight(0x6080a0, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(8, 20, 14);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xe63e54, 0.18);
    rim.position.set(-12, -8, -16);
    scene.add(rim);

    // Wireframe ground plane — depth reference, mostly subliminal.
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0x1a2540, wireframe: true, transparent: true, opacity: 0.18 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -10;
    scene.add(plane);

    // Lay out clusters on a circle in the XZ plane. Radius scales with
    // cluster count so a 1-cluster scene doesn't hover way off-center.
    const N = data.clusters.length;
    const ringRadius = N <= 1 ? 0 : Math.min(14, 6 + N * 1.5);
    const clusterMeshes: { group: THREE.Group; cluster: Cluster; pos: THREE.Vector3 }[] = [];

    data.clusters.forEach((c, i) => {
      const angle = (i / Math.max(N, 1)) * Math.PI * 2;
      const pos = new THREE.Vector3(
        Math.cos(angle) * ringRadius,
        // small vertical variation makes 3D feel more 3D
        (i % 2 === 0 ? 1 : -1) * (i % 3) * 0.8,
        Math.sin(angle) * ringRadius,
      );
      const color = pickColor(c.color_seed);
      const radius = Math.max(2.0, Math.min(5.0, 1.4 + Math.sqrt(c.entity_count)));

      const group = new THREE.Group();
      group.position.copy(pos);
      group.userData = { cluster: c };

      // 3 nested spheres for that "atmospheric" feel from the mock.
      group.add(new THREE.Mesh(
        new THREE.SphereGeometry(radius, 32, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, depthWrite: false }),
      ));
      group.add(new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.02, 24, 16),
        new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.32 }),
      ));
      group.add(new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 16),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.4 }),
      ));

      // Hubs orbit on the cluster's surface.
      c.hubs.forEach((hub, hi) => {
        const theta = (hi / Math.max(c.hubs.length, 1)) * Math.PI * 2;
        const phi = Math.PI / 2 + ((hi % 2 === 0 ? 1 : -1) * 0.3);
        const r = radius * 0.75;
        const hubMesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.35 + (hi === 0 ? 0.18 : 0), 12, 12),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.35 }),
        );
        hubMesh.position.set(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(theta),
        );
        hubMesh.userData = { hub, cluster: c };
        group.add(hubMesh);
      });

      scene.add(group);
      clusterMeshes.push({ group, cluster: c, pos });
    });

    // Bridges between clusters (currently always empty from connected
    // components, but the renderer is ready for the day we switch to
    // Louvain / modularity-based clustering).
    data.bridges.forEach(b => {
      const from = clusterMeshes.find(m => m.cluster.id === b.from_cluster);
      const to = clusterMeshes.find(m => m.cluster.id === b.to_cluster);
      if (!from || !to) return;
      const mid = from.pos.clone().add(to.pos).multiplyScalar(0.5);
      mid.y += 4;
      const curve = new THREE.QuadraticBezierCurve3(from.pos.clone(), mid, to.pos.clone());
      const geom = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
      scene.add(new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35 }),
      ));
    });

    // Project cluster positions into screen space for the DOM labels.
    function updateLabels() {
      if (!labelsLayer) return;
      while (labelsLayer.firstChild) labelsLayer.removeChild(labelsLayer.firstChild);
      clusterMeshes.forEach(({ group, cluster }) => {
        const v = group.position.clone();
        v.y += 5; // float label above sphere
        v.project(camera);
        if (v.z > 1) return; // behind camera
        const x = (v.x + 1) * 0.5 * W();
        const y = (1 - (v.y + 1) * 0.5) * H();
        const div = document.createElement('div');
        div.className = 'pointer-events-none absolute font-semibold text-white text-xs whitespace-nowrap';
        div.style.left = `${x}px`;
        div.style.top = `${y}px`;
        div.style.transform = 'translate(-50%, -100%)';
        div.style.textShadow = '0 1px 2px rgba(0,0,0,0.8)';
        const name = document.createElement('div');
        name.className = 'text-sm';
        name.style.fontFamily = 'Cormorant, Georgia, serif';
        name.textContent = cluster.label;
        const sub = document.createElement('div');
        sub.className = 'text-[10px] font-normal text-gray-400';
        sub.textContent = cluster.sub_label;
        div.appendChild(name);
        div.appendChild(sub);
        labelsLayer.appendChild(div);
      });
    }

    // Hover + click raycasting. Only fires on hub meshes (their userData
    // has a `hub` key); cluster spheres are ignored for click intent.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function onMove(e: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }
    function onClick() {
      raycaster.setFromCamera(pointer, camera);
      // Recurse so we hit hubs nested inside cluster groups.
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const h of hits) {
        const hub = (h.object.userData as { hub?: Hub }).hub;
        if (hub?.entity_id) {
          navigate(`/wissensbasis?focus=${encodeURIComponent(hub.entity_id)}`);
          return;
        }
      }
    }
    renderer.domElement.addEventListener('mousemove', onMove);
    renderer.domElement.addEventListener('click', onClick);

    function onResize() {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(W(), H());
    }
    window.addEventListener('resize', onResize);

    let rafId = 0;
    function loop() {
      controls.update();
      // gentle orbit on hubs — picks up the "alive" feel from the mock
      clusterMeshes.forEach(({ group }) => {
        group.children.forEach(child => {
          if ((child.userData as { hub?: Hub }).hub) {
            child.rotation.y += 0.003;
          }
        });
      });
      renderer.render(scene, camera);
      updateLabels();
      rafId = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('mousemove', onMove);
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      renderer.dispose();
      if (root.contains(renderer.domElement)) root.removeChild(renderer.domElement);
    };
  }, [data, navigate]);

  if (loadError) {
    return (
      <div role="alert" className="text-xs text-red-700 dark:text-red-300 px-3 py-2 bg-red-50 dark:bg-red-900/20 rounded">
        {t('knowledgeGraph.graph.loadError', 'Could not load graph: {{err}}', { err: loadError })}
      </div>
    );
  }

  if (data && data.clusters.length === 0) {
    return (
      <div className="text-xs text-gray-500 dark:text-gray-400 italic px-3 py-12 text-center">
        {t(
          'knowledgeGraph.graph.empty',
          'No entities in the knowledge graph yet. Start a conversation to populate it.',
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ height: '70vh', minHeight: 480 }}>
      <div ref={rootRef} className="absolute inset-0 rounded-lg overflow-hidden bg-[#0a0f1c]" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute left-3 bottom-3 text-[10px] text-gray-500 bg-black/40 px-2 py-1 rounded">
        {t('knowledgeGraph.graph.hint', 'Drag to orbit · scroll to zoom · click a hub to focus')}
      </div>
      {data && (
        <div className="pointer-events-none absolute right-3 bottom-3 text-[10px] text-gray-500 bg-black/40 px-2 py-1 rounded">
          {data.total_entities} entities · {data.clusters.length} clusters
          {data.truncated && ' · truncated'}
        </div>
      )}
    </div>
  );
}
