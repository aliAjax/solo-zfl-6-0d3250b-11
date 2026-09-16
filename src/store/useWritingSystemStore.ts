import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WritingSystemStore, Radical, Lexeme, CompositionLayout, StrokeOrderMap } from '@/types';
import { generateId } from '@/utils/glyphUtils';
import { MOCK_STAGES, MOCK_RADICALS, MOCK_LEXEMES } from '@/utils/mockData';
import { parseStrokeSet, isValidOrderPermutation, reviewFingerprint } from '@/utils/strokeOrder';
import { strokeOrderKey, shapePathForRef } from '@/utils/strokeOrderReview';

const STORAGE_KEY = 'fictional-writing-system-v1';

const getInitialState = () => ({
  stages: MOCK_STAGES,
  radicals: MOCK_RADICALS,
  lexemes: MOCK_LEXEMES,
  strokeOrders: {} as StrokeOrderMap,
  selectedRadicalId: null as string | null,
  selectedStageId: MOCK_STAGES[MOCK_STAGES.length - 1]?.id || null,
  composingRadicalIds: [] as string[],
  composingLayout: 'horizontal' as CompositionLayout,
});

export const useWritingSystemStore = create<WritingSystemStore>()(
  persist(
    (set, get) => ({
      ...getInitialState(),

      addStage: (s) =>
        set((state) => ({
          stages: [...state.stages, { ...s, id: generateId() }].sort((a, b) => a.order - b.order),
        })),

      updateStage: (id, patch) =>
        set((state) => ({
          stages: state.stages.map((st) => (st.id === id ? { ...st, ...patch } : st)),
        })),

      removeStage: (id) =>
        set((state) => {
          const strokeOrders = Object.fromEntries(
            Object.entries(state.strokeOrders).filter(
              ([key]) => key.slice(key.indexOf(':') + 1) !== id
            )
          );
          return {
            stages: state.stages.filter((st) => st.id !== id),
            radicals: state.radicals.map((r) => ({
              ...r,
              variants: r.variants.filter((v) => v.stageId !== id),
            })),
            strokeOrders,
            selectedStageId: state.selectedStageId === id ? null : state.selectedStageId,
          };
        }),

      addRadical: (r) => {
        const id = generateId();
        const now = Date.now();
        const newRadical: Radical = {
          ...r,
          id,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          radicals: [...state.radicals, newRadical],
        }));
        return id;
      },

      updateRadical: (id, patch) =>
        set((state) => ({
          radicals: state.radicals.map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r
          ),
        })),

      removeRadical: (id) =>
        set((state) => ({
          radicals: state.radicals.filter((r) => r.id !== id),
          lexemes: state.lexemes.map((l) => ({
            ...l,
            radicalIds: l.radicalIds.filter((rid) => rid !== id),
          })),
          strokeOrders: Object.fromEntries(
            Object.entries(state.strokeOrders).filter(([key]) => !key.startsWith(`${id}:`))
          ),
          selectedRadicalId: state.selectedRadicalId === id ? null : state.selectedRadicalId,
          composingRadicalIds: state.composingRadicalIds.filter((rid) => rid !== id),
        })),

      addLexeme: (l) => {
        const id = generateId();
        const newLexeme: Lexeme = {
          ...l,
          id,
          createdAt: Date.now(),
        };
        set((state) => ({
          lexemes: [...state.lexemes, newLexeme],
        }));
        return id;
      },

      updateLexeme: (id, patch) =>
        set((state) => ({
          lexemes: state.lexemes.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        })),

      removeLexeme: (id) =>
        set((state) => ({
          lexemes: state.lexemes.filter((l) => l.id !== id),
        })),

      selectRadical: (id) => set({ selectedRadicalId: id }),
      selectStage: (id) => set({ selectedStageId: id }),

      addToComposer: (radicalId) =>
        set((state) => ({
          composingRadicalIds: [...state.composingRadicalIds, radicalId],
        })),

      removeFromComposer: (index) =>
        set((state) => ({
          composingRadicalIds: state.composingRadicalIds.filter((_, i) => i !== index),
        })),

      clearComposer: () => set({ composingRadicalIds: [] }),

      moveInComposer: (fromIndex, toIndex) =>
        set((state) => {
          const arr = [...state.composingRadicalIds];
          if (fromIndex < 0 || fromIndex >= arr.length) return state;
          if (toIndex < 0 || toIndex >= arr.length) return state;
          const [moved] = arr.splice(fromIndex, 1);
          arr.splice(toIndex, 0, moved);
          return { composingRadicalIds: arr };
        }),

      setComposingLayout: (layout) => set({ composingLayout: layout }),

      saveStrokeOrder: (radicalId, stageId, order, fingerprint) => {
        const state = get();
        const radical = state.radicals.find((r) => r.id === radicalId);
        if (!radical) return;
        // 以当前真实形状重新解析、校验：只接受笔画数一致的合法排列，
        // 指纹必须与当前形状相符 —— 形状、笔画数、闭合状态都不会被此操作改变。
        const parsed = parseStrokeSet(shapePathForRef(radical, stageId));
        if (parsed.isEmpty || !isValidOrderPermutation(order, parsed.strokes.length)) return;
        if (fingerprint !== reviewFingerprint(parsed)) return;
        const key = strokeOrderKey(radicalId, stageId);
        set((s) => ({
          strokeOrders: {
            ...s.strokeOrders,
            [key]: { order: [...order], fingerprint, savedAt: Date.now() },
          },
        }));
      },

      clearStrokeOrder: (radicalId, stageId) =>
        set((state) => {
          const key = strokeOrderKey(radicalId, stageId);
          if (!(key in state.strokeOrders)) return state;
          const strokeOrders = { ...state.strokeOrders };
          delete strokeOrders[key];
          return { strokeOrders };
        }),

      exportData: () => {
        const state = get();
        return JSON.stringify(
          {
            stages: state.stages,
            radicals: state.radicals,
            lexemes: state.lexemes,
            strokeOrders: state.strokeOrders,
            exportedAt: new Date().toISOString(),
          },
          null,
          2
        );
      },

      importData: (json) => {
        try {
          const parsed = JSON.parse(json);
          if (!parsed.stages || !parsed.radicals || !parsed.lexemes) {
            throw new Error('Invalid data format');
          }
          set({
            stages: parsed.stages,
            radicals: parsed.radicals,
            lexemes: parsed.lexemes,
            strokeOrders: sanitizeStrokeOrders(parsed.strokeOrders),
            selectedRadicalId: null,
            selectedStageId: parsed.stages[parsed.stages.length - 1]?.id || null,
            composingRadicalIds: [],
          });
        } catch (e) {
          console.error('Import failed:', e);
          throw e;
        }
      },

      resetAll: () => set(getInitialState()),
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        stages: state.stages,
        radicals: state.radicals,
        lexemes: state.lexemes,
        strokeOrders: state.strokeOrders,
      }),
      // 兼容旧存档：没有 strokeOrders 字段时补空表
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WritingSystemStore>;
        return {
          ...current,
          ...p,
          strokeOrders: sanitizeStrokeOrders(p.strokeOrders),
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (!state.selectedStageId && state.stages.length > 0) {
            state.selectedStageId = state.stages[state.stages.length - 1].id;
          }
        }
      },
    }
  )
);

function sanitizeStrokeOrders(raw: unknown): StrokeOrderMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: StrokeOrderMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = value as { order?: unknown; fingerprint?: unknown; savedAt?: unknown };
    if (
      typeof key === 'string' &&
      Array.isArray(v?.order) &&
      v.order.every((n) => Number.isInteger(n) as boolean) &&
      typeof v.fingerprint === 'string'
    ) {
      out[key] = {
        order: v.order as number[],
        fingerprint: v.fingerprint,
        savedAt: typeof v.savedAt === 'number' ? v.savedAt : 0,
      };
    }
  }
  return out;
}
