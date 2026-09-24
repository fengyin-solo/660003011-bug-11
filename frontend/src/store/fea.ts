import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { FEAModel, FEAResult } from '../types';
import {
  solve as feaSolve,
  presetCantileverBeam,
  presetBridgeTruss,
  presetSimpleFrame,
  jetColormap,
} from '../utils/fea-solver';

export const useFEAStore = defineStore('fea', () => {
  const model = ref<FEAModel>({ nodes: [], elements: [], loads: [] });
  const result = ref<FEAResult | null>(null);
  const selectedPreset = ref<string>('cantilever');
  const showDeformed = ref(false);
  const deformationScale = ref(10);
  const selectedElement = ref<number | null>(null);
  const heatmapMode = ref<'stress' | 'strain' | 'force'>('stress');

  // ─── Actions ──────────────────────────────────────────────────────────────
  function loadPreset(name: string) {
    selectedPreset.value = name;
    result.value = null;
    selectedElement.value = null;
    switch (name) {
      case 'cantilever':
        model.value = presetCantileverBeam();
        break;
      case 'bridge':
        model.value = presetBridgeTruss();
        break;
      case 'frame':
        model.value = presetSimpleFrame();
        break;
      default:
        model.value = presetCantileverBeam();
    }
  }

  function solve() {
    result.value = feaSolve(model.value);
  }

  function toggleDeformed() {
    showDeformed.value = !showDeformed.value;
  }

  function selectElement(id: number | null) {
    selectedElement.value = id;
  }

  function setHeatmapMode(mode: 'stress' | 'strain' | 'force') {
    heatmapMode.value = mode;
  }

  function addLoad(nodeId: number, fx: number, fy: number) {
    model.value.loads.push({ nodeId, fx, fy });
  }

  function toggleFixed(nodeId: number) {
    const node = model.value.nodes.find((n) => n.id === nodeId);
    if (node) node.fixed = !node.fixed;
  }

  // ─── Heatmap display convention ───────────────────────────────────────────
  // Single source of truth: raw solver values (Pa / unitless / N) are
  // converted to display units (MPa / % / kN) exactly once, here. Legend
  // ticks, element colors and stats all derive from the same extraction.
  const HEATMAP_DISPLAY = {
    stress: { unit: 'MPa', toDisplay: (v: number) => v / 1e6 },
    strain: { unit: '%', toDisplay: (v: number) => v * 100 },
    force: { unit: 'kN', toDisplay: (v: number) => v / 1000 },
  } as const;

  const heatmapUnit = computed(() => HEATMAP_DISPLAY[heatmapMode.value].unit);

  // Per-element |values| of the current mode, in display units
  const heatmapValues = computed<number[]>(() => {
    const { toDisplay } = HEATMAP_DISPLAY[heatmapMode.value];
    if (!result.value) return model.value.elements.map(() => 0);
    switch (heatmapMode.value) {
      case 'stress':
        return result.value.stresses.map((v) => toDisplay(Math.abs(v)));
      case 'strain':
        return result.value.strains.map((v) => toDisplay(Math.abs(v)));
      case 'force':
        return model.value.elements.map((e) => toDisplay(Math.abs(e.force)));
    }
  });

  // Color-scale endpoints and legend ticks come from this same range
  const heatmapRange = computed(() => {
    const values = heatmapValues.value;
    if (values.length === 0) return { min: 0, max: 0 };
    return { min: Math.min(...values), max: Math.max(...values) };
  });

  // ─── Computed ─────────────────────────────────────────────────────────────
  const maxStress = computed(() => {
    if (!result.value) return 0;
    return result.value.maxStress;
  });

  const maxDisplacement = computed(() => {
    if (!result.value) return 0;
    return result.value.maxDisplacement;
  });

  const elementColors = computed(() => {
    const colors = new Map<number, string>();
    if (!result.value || model.value.elements.length === 0) {
      for (const el of model.value.elements) {
        colors.set(el.id, '#6b7280');
      }
      return colors;
    }

    const values = heatmapValues.value;
    const { min, max } = heatmapRange.value;

    for (let i = 0; i < model.value.elements.length; i++) {
      colors.set(
        model.value.elements[i].id,
        jetColormap(values[i], min, max)
      );
    }
    return colors;
  });

  return {
    model,
    result,
    selectedPreset,
    showDeformed,
    deformationScale,
    selectedElement,
    heatmapMode,
    maxStress,
    maxDisplacement,
    elementColors,
    heatmapUnit,
    heatmapValues,
    heatmapRange,
    loadPreset,
    solve,
    toggleDeformed,
    selectElement,
    setHeatmapMode,
    addLoad,
    toggleFixed,
  };
});
