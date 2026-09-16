export interface HistoricalStage {
  id: string;
  name: string;
  order: number;
  description: string;
  color: string;
}

export interface GlyphVariant {
  stageId: string;
  svgPath: string;
  note?: string;
}

export interface Radical {
  id: string;
  name: string;
  meaning: string;
  pronunciation: string;
  category: RadicalCategory;
  baseShape: string;
  variants: GlyphVariant[];
  createdAt: number;
  updatedAt: number;
}

export type RadicalCategory = '象形' | '指事' | '会意' | '形声' | '假借' | '转注';

export type CompositionLayout = 'horizontal' | 'vertical' | 'surround' | 'overlay';

export interface Lexeme {
  id: string;
  radicalIds: string[];
  layout: CompositionLayout;
  pronunciation: string;
  meaning: string;
  example?: string;
  note?: string;
  writingRule?: string;
  createdAt: number;
}

/**
 * 某字根在某阶段（或基础形状）的手工笔顺覆盖。
 * order 是 0..n-1 的一个排列，元素是笔画在原始路径中的子路径序号
 * （sourceIndex）——只能重排，不能增删笔画或改变形状。
 */
export interface StrokeOrderOverride {
  order: number[];
  /** 保存时的复核指纹（规则版本 + 形状指纹） */
  fingerprint: string;
  savedAt: number;
}

/** 笔顺覆盖表：键为 `${radicalId}:${stageId | BASE_SHAPE_KEY}` */
export type StrokeOrderMap = Record<string, StrokeOrderOverride>;

export interface WritingSystemState {
  stages: HistoricalStage[];
  radicals: Radical[];
  lexemes: Lexeme[];
  strokeOrders: StrokeOrderMap;
  selectedRadicalId: string | null;
  selectedStageId: string | null;
  composingRadicalIds: string[];
  composingLayout: CompositionLayout;
}

export interface WritingSystemActions {
  addStage: (s: Omit<HistoricalStage, 'id'>) => void;
  updateStage: (id: string, patch: Partial<HistoricalStage>) => void;
  removeStage: (id: string) => void;

  addRadical: (r: Omit<Radical, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateRadical: (id: string, patch: Partial<Radical>) => void;
  removeRadical: (id: string) => void;

  addLexeme: (l: Omit<Lexeme, 'id' | 'createdAt'>) => string;
  updateLexeme: (id: string, patch: Partial<Lexeme>) => void;
  removeLexeme: (id: string) => void;

  selectRadical: (id: string | null) => void;
  selectStage: (id: string | null) => void;

  addToComposer: (radicalId: string) => void;
  removeFromComposer: (index: number) => void;
  clearComposer: () => void;
  moveInComposer: (fromIndex: number, toIndex: number) => void;
  setComposingLayout: (layout: CompositionLayout) => void;

  /** 保存某字根某阶段的手工笔顺（仅接受合法排列）。 */
  saveStrokeOrder: (radicalId: string, stageId: string | null, order: number[], fingerprint: string) => void;
  /** 清除手工顺序，回到规则顺序。 */
  clearStrokeOrder: (radicalId: string, stageId: string | null) => void;

  exportData: () => string;
  importData: (json: string) => void;
  resetAll: () => void;
}

export type WritingSystemStore = WritingSystemState & WritingSystemActions;
