<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { useFEAStore } from '../store/fea';
import { jetColormap } from '../utils/fea-solver';

const store = useFEAStore();
const canvas = ref<HTMLCanvasElement>();

let offsetX = 50;
let offsetY = 50;
let scale = 1;
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

function worldToScreen(x: number, y: number): [number, number] {
  return [x * scale + offsetX, y * scale + offsetY];
}

function screenToWorld(sx: number, sy: number): [number, number] {
  return [(sx - offsetX) / scale, (sy - offsetY) / scale];
}

// Legend tick formatting for display-unit values (MPa / % / kN)
function formatTick(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 0.01 && a < 1000) return v.toFixed(2);
  return v.toExponential(1);
}

function draw() {
  const ctx = canvas.value?.getContext('2d');
  if (!ctx) return;

  const W = canvas.value!.width;
  const H = canvas.value!.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  const { nodes, elements, loads } = store.model;
  if (nodes.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('选择一个预设模型开始分析', W / 2, H / 2);
    return;
  }

  // Auto-scale to fit
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  const worldW = maxX - minX || 1;
  const worldH = maxY - minY || 1;
  const margin = 60;
  const fitScale = Math.min((W - margin * 2) / worldW, (H - margin * 2) / worldH);

  // Use auto scale only if no manual zoom
  const drawScale = fitScale * scale;
  const drawOffsetX = margin - minX * drawScale + (W - margin * 2 - worldW * drawScale) / 2;
  const drawOffsetY = margin - minY * drawScale + (H - margin * 2 - worldH * drawScale) / 2;

  function toScreen(x: number, y: number): [number, number] {
    return [x * drawScale + drawOffsetX, y * drawScale + drawOffsetY];
  }

  // Draw elements with heatmap colors
  for (const el of elements) {
    const n1 = nodes.find((n) => n.id === el.nodeIds[0]);
    const n2 = nodes.find((n) => n.id === el.nodeIds[1]);
    if (!n1 || !n2) continue;

    const [x1, y1] = toScreen(n1.x, n1.y);
    const [x2, y2] = toScreen(n2.x, n2.y);
    const color = store.elementColors.get(el.id) || '#6b7280';
    const isSelected = store.selectedElement === el.id;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 4 : 2.5;
    ctx.stroke();

    if (isSelected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Draw deformed mesh
  if (store.showDeformed && store.result) {
    ctx.setLineDash([5, 3]);
    for (const el of elements) {
      const n1 = nodes.find((n) => n.id === el.nodeIds[0]);
      const n2 = nodes.find((n) => n.id === el.nodeIds[1]);
      if (!n1 || !n2) continue;

      const s = store.deformationScale;
      const [x1, y1] = toScreen(n1.x + n1.displacementX * s, n1.y + n1.displacementY * s);
      const [x2, y2] = toScreen(n2.x + n2.displacementX * s, n2.y + n2.displacementY * s);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'rgba(251,191,36,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Draw nodes
  for (const node of nodes) {
    const [x, y] = toScreen(node.x, node.y);

    if (node.fixed) {
      // Draw triangle for fixed nodes
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x - 6, y + 4);
      ctx.lineTo(x + 6, y + 4);
      ctx.closePath();
      ctx.fillStyle = '#f97316';
      ctx.fill();
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Hatching below
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 1;
      for (let i = -8; i <= 8; i += 4) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + 5);
        ctx.lineTo(x + i - 3, y + 10);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Draw load arrows
  for (const load of loads) {
    const node = nodes.find((n) => n.id === load.nodeId);
    if (!node) continue;
    const [x, y] = toScreen(node.x, node.y);

    const mag = Math.sqrt(load.fx ** 2 + load.fy ** 2);
    if (mag === 0) continue;

    const arrowLen = 30;
    const dx = (load.fx / mag) * arrowLen;
    const dy = (load.fy / mag) * arrowLen;

    // Arrow line
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Arrow head
    const headLen = 8;
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLen * Math.cos(angle - 0.4), y - headLen * Math.sin(angle - 0.4));
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLen * Math.cos(angle + 0.4), y - headLen * Math.sin(angle + 0.4));
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    ctx.fillStyle = '#fca5a5';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${(mag / 1000).toFixed(1)}kN`, x - dx / 2, y - dy / 2 - 6);
  }

  // Draw color legend bar
  const legendX = W - 40;
  const legendY = 30;
  const legendH = H - 60;
  const legendW = 15;

  // Sample the same jetColormap the elements use, so the legend scale
  // and the element colors follow the exact same color rule
  const gradient = ctx.createLinearGradient(0, legendY, 0, legendY + legendH);
  const STOPS = 16;
  for (let i = 0; i <= STOPS; i++) {
    // top of the bar = max value (t=1), bottom = min value (t=0)
    gradient.addColorStop(i / STOPS, jetColormap(1 - i / STOPS, 0, 1));
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(legendX, legendY, legendW, legendH);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendX, legendY, legendW, legendH);

  // Legend labels: same extraction and units as the element colors,
  // the footer and the sidebar stats (via store.heatmapRange/heatmapUnit)
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';

  const { min: minVal, max: maxVal } = store.heatmapRange;
  const unit = store.heatmapUnit;

  ctx.textAlign = 'right';
  ctx.fillText(`${formatTick(maxVal)} ${unit}`, legendX - 4, legendY + 8);
  ctx.fillText(`${formatTick(minVal)} ${unit}`, legendX - 4, legendY + legendH);

  // Mode label
  ctx.save();
  ctx.translate(legendX + legendW + 10, legendY + legendH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '11px sans-serif';
  ctx.fillText(store.heatmapMode.toUpperCase(), 0, 0);
  ctx.restore();
}

function handleMouseDown(e: MouseEvent) {
  isDragging = true;
  lastMouse = { x: e.clientX, y: e.clientY };
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging) return;
  offsetX += e.clientX - lastMouse.x;
  offsetY += e.clientY - lastMouse.y;
  lastMouse = { x: e.clientX, y: e.clientY };
  draw();
}

function handleMouseUp() {
  isDragging = false;
}

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  scale *= factor;
  scale = Math.max(0.1, Math.min(10, scale));
  draw();
}

function handleClick(e: MouseEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const { nodes, elements } = store.model;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  const worldW = maxX - minX || 1;
  const worldH = maxY - minY || 1;
  const W = canvas.value!.width;
  const H = canvas.value!.height;
  const margin = 60;
  const fitScale = Math.min((W - margin * 2) / worldW, (H - margin * 2) / worldH);
  const drawScale = fitScale * scale;
  const drawOffsetX = margin - minX * drawScale + (W - margin * 2 - worldW * drawScale) / 2;
  const drawOffsetY = margin - minY * drawScale + (H - margin * 2 - worldH * drawScale) / 2;

  // Find nearest element
  let bestDist = 15;
  let bestId: number | null = null;

  for (const el of elements) {
    const n1 = nodes.find((n) => n.id === el.nodeIds[0]);
    const n2 = nodes.find((n) => n.id === el.nodeIds[1]);
    if (!n1 || !n2) continue;

    const x1 = n1.x * drawScale + drawOffsetX;
    const y1 = n1.y * drawScale + drawOffsetY;
    const x2 = n2.x * drawScale + drawOffsetX;
    const y2 = n2.y * drawScale + drawOffsetY;

    // Point-to-segment distance
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    let t = ((mx - x1) * dx + (my - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);

    if (dist < bestDist) {
      bestDist = dist;
      bestId = el.id;
    }
  }

  store.selectElement(bestId);
  draw();
}

onMounted(() => {
  nextTick(draw);
});

watch(
  () => [
    store.model,
    store.result,
    store.showDeformed,
    store.deformationScale,
    store.selectedElement,
    store.heatmapMode,
    store.elementColors,
  ],
  () => nextTick(draw),
  { deep: true }
);
</script>

<template>
  <canvas
    ref="canvas"
    width="800"
    height="500"
    class="w-full rounded-lg border border-slate-700 cursor-crosshair"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @mouseleave="handleMouseUp"
    @wheel="handleWheel"
    @click="handleClick"
  />
</template>
