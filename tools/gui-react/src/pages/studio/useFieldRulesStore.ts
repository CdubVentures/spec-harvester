import { create } from 'zustand';
import { setNested } from './workbench/workbenchHelpers';
import { reorderFieldOrder } from './keyUtils';

type RuleMap = Record<string, Record<string, unknown>>;

function syncGroupsFromOrder(fieldOrder: string[], rules: RuleMap): RuleMap {
  let currentGroup = 'ungrouped';
  let changed = false;
  const updated = { ...rules };
  for (const item of fieldOrder) {
    if (item.startsWith('__grp::')) {
      currentGroup = item.slice(7);
      continue;
    }
    const rule = updated[item];
    if (!rule) continue;
    const uiObj = (rule.ui || {}) as Record<string, unknown>;
    const existing = uiObj.group ? String(uiObj.group) : String(rule.group || 'ungrouped');
    if (existing !== currentGroup) {
      updated[item] = {
        ...rule,
        ui: { ...uiObj, group: currentGroup },
        group: currentGroup,
      };
      changed = true;
    }
  }
  return changed ? updated : rules;
}

interface FieldRulesState {
  editedRules: RuleMap;
  editedFieldOrder: string[];
  pendingRenames: Record<string, string>;
  initialized: boolean;

  hydrate: (rules: RuleMap, fieldOrder: string[]) => void;
  rehydrate: (rules: RuleMap, fieldOrder: string[]) => void;
  reset: () => void;
  clearRenames: () => void;

  updateField: (key: string, path: string, value: unknown) => void;
  addKey: (key: string, rule: Record<string, unknown>, afterKey?: string) => void;
  removeKey: (key: string) => void;
  renameKey: (oldKey: string, newKey: string, rewriteConstraints: (constraints: string[], oldK: string, newK: string) => string[], constraintRefsKey: (expr: string, k: string) => boolean) => void;
  bulkAddKeys: (entries: Array<{ key: string; rule: Record<string, unknown> }>) => void;

  reorder: (activeItem: string, overItem: string) => void;

  addGroup: (name: string) => void;
  removeGroup: (name: string) => void;
  renameGroup: (oldName: string, newName: string) => void;

  getSnapshot: () => {
    rules: RuleMap;
    fieldOrder: string[];
    renames: Record<string, string>;
  };
}

function applyFieldCoupling(rule: Record<string, unknown>, key: string, path: string, value: unknown): void {
  setNested(rule, path, value);

  if (path === 'contract.type') { rule.type = value; rule.data_type = value; }
  if (path === 'contract.shape') { rule.shape = value; rule.output_shape = value; rule.value_form = value; }
  if (path === 'contract.unit') { rule.unit = value; }
  if (path === 'priority.required_level') rule.required_level = value;
  if (path === 'priority.availability') rule.availability = value;
  if (path === 'priority.difficulty') rule.difficulty = value;
  if (path === 'priority.effort') rule.effort = value;
  if (path === 'priority.publish_gate') rule.publish_gate = value;
  if (path === 'evidence.required') rule.evidence_required = value;
  if (path === 'evidence.min_evidence_refs') rule.min_evidence_refs = value;
  if (path === 'enum.policy') rule.enum_policy = value;
  if (path === 'enum.source') rule.enum_source = value;
  if (path === 'parse.template') rule.parse_template = value;
  if (path === 'ui.group') rule.group = value;
  if (path === 'ui.label') rule.display_name = value;

  if (path === 'parse.template') {
    const tpl = String(value || '');
    if (tpl === 'boolean_yes_no_unk') {
      setNested(rule, 'enum.policy', 'closed');
      setNested(rule, 'enum.source', 'yes_no');
      setNested(rule, 'enum.match.strategy', 'exact');
      rule.enum_policy = 'closed';
      rule.enum_source = 'yes_no';
      setNested(rule, 'ui.input_control', 'text');
    } else if (tpl === 'component_reference') {
      const COMP_MAP: Record<string, string> = { sensor: 'sensor', switch: 'switch', encoder: 'encoder', material: 'material' };
      const compType = COMP_MAP[key] || '';
      if (compType) {
        setNested(rule, 'component.type', compType);
        setNested(rule, 'enum.source', `component_db.${compType}`);
        rule.enum_source = `component_db.${compType}`;
      }
      setNested(rule, 'enum.policy', 'open_prefer_known');
      setNested(rule, 'enum.match.strategy', 'alias');
      rule.enum_policy = 'open_prefer_known';
      setNested(rule, 'ui.input_control', 'component_picker');
    } else if (['number_with_unit', 'list_of_numbers_with_unit', 'list_numbers_or_ranges_with_unit'].includes(tpl)) {
      setNested(rule, 'ui.input_control', 'number');
    } else if (tpl === 'url_field') {
      setNested(rule, 'ui.input_control', 'url');
    } else if (tpl === 'date_field') {
      setNested(rule, 'ui.input_control', 'date');
    } else if (tpl === 'list_of_tokens_delimited' || tpl === 'token_list') {
      setNested(rule, 'ui.input_control', 'multi_select');
    }
  }

  if (path === 'enum.source') {
    const src = String(value || '');
    if (src.startsWith('component_db.')) {
      setNested(rule, 'ui.input_control', 'component_picker');
    } else if (src === 'yes_no') {
      setNested(rule, 'ui.input_control', 'text');
    } else if (src.startsWith('data_lists.')) {
      const pol = String((rule.enum as Record<string, unknown>)?.policy || rule.enum_policy || 'open');
      setNested(rule, 'ui.input_control', pol === 'closed' ? 'select' : 'text');
    }
  }

  if (path === 'enum.policy') {
    const pol = String(value || 'open');
    const src = String((rule.enum as Record<string, unknown>)?.source || rule.enum_source || '');
    if (src.startsWith('data_lists.') && pol === 'closed') {
      setNested(rule, 'ui.input_control', 'select');
    } else if (src.startsWith('component_db.')) {
      setNested(rule, 'ui.input_control', 'component_picker');
    }
  }

  if (['priority.required_level', 'priority.difficulty', 'priority.effort'].includes(path)) {
    const ai = (rule.ai_assist || {}) as Record<string, unknown>;
    const existingNote = String(ai.reasoning_note || '');
    const explicitMode = String(ai.mode || '');
    if (!explicitMode) {
      const rl = String((rule.priority as Record<string, unknown>)?.required_level || rule.required_level || 'expected');
      const diff = String((rule.priority as Record<string, unknown>)?.difficulty || rule.difficulty || 'easy');
      const eff = Number((rule.priority as Record<string, unknown>)?.effort || rule.effort || 3);
      let derivedMode = 'off';
      if (['identity', 'required', 'critical'].includes(rl)) derivedMode = 'judge';
      else if (rl === 'expected' && diff === 'hard') derivedMode = 'planner';
      else if (rl === 'expected') derivedMode = 'advisory';
      const maxCalls = eff <= 3 ? 1 : eff <= 6 ? 2 : 3;
      const note = derivedMode === 'off'
        ? `${rl} field - LLM extraction skipped (deterministic only)`
        : `${rl}/${diff} field (effort ${eff}) - auto: ${derivedMode}, budget ${maxCalls} call${maxCalls > 1 ? 's' : ''}`;
      setNested(rule, 'ai_assist.reasoning_note', note);
    } else if (existingNote && (existingNote.includes(' - auto: ') || existingNote.includes('LLM extraction skipped'))) {
      setNested(rule, 'ai_assist.reasoning_note', '');
    }
  }

  if (path === 'component.type') {
    const ct = String(value || '');
    if (ct) {
      setNested(rule, 'enum.source', `component_db.${ct}`);
      rule.enum_source = `component_db.${ct}`;
    }
  }

  rule._edited = true;
}

export const useFieldRulesStore = create<FieldRulesState>((set, get) => ({
  editedRules: {},
  editedFieldOrder: [],
  pendingRenames: {},
  initialized: false,

  hydrate: (rules, fieldOrder) => {
    const cleaned: RuleMap = JSON.parse(JSON.stringify(rules));
    for (const key of Object.keys(cleaned)) {
      delete cleaned[key]._edited;
    }
    set({
      editedRules: cleaned,
      editedFieldOrder: [...fieldOrder],
      pendingRenames: {},
      initialized: true,
    });
  },

  rehydrate: (rules, fieldOrder) => {
    const cleaned: RuleMap = JSON.parse(JSON.stringify(rules));
    for (const key of Object.keys(cleaned)) {
      delete cleaned[key]._edited;
    }
    set({
      editedRules: cleaned,
      editedFieldOrder: [...fieldOrder],
      pendingRenames: {},
      initialized: true,
    });
  },

  reset: () => {
    set({
      editedRules: {},
      editedFieldOrder: [],
      pendingRenames: {},
      initialized: false,
    });
  },

  clearRenames: () => {
    set({ pendingRenames: {} });
  },

  updateField: (key, path, value) => {
    set((state) => {
      const next = { ...state.editedRules };
      const rule = { ...(next[key] || {}) };
      applyFieldCoupling(rule, key, path, value);
      next[key] = rule;
      return { editedRules: next };
    });
  },

  addKey: (key, rule, afterKey) => {
    set((state) => {
      const nextOrder = [...state.editedFieldOrder];
      if (afterKey) {
        const idx = nextOrder.indexOf(afterKey);
        nextOrder.splice(idx >= 0 ? idx + 1 : nextOrder.length, 0, key);
      } else {
        nextOrder.push(key);
      }
      const nextRules = { ...state.editedRules, [key]: { ...rule, _edited: true } };
      return {
        editedFieldOrder: nextOrder,
        editedRules: syncGroupsFromOrder(nextOrder, nextRules),
      };
    });
  },

  removeKey: (key) => {
    set((state) => {
      const nextOrder = state.editedFieldOrder.filter((k) => k !== key);
      const nextRules: RuleMap = {};
      for (const [k, rule] of Object.entries(state.editedRules)) {
        if (k === key) continue;
        nextRules[k] = rule;
      }
      return { editedFieldOrder: nextOrder, editedRules: nextRules };
    });
  },

  renameKey: (oldKey, newKey, rewriteConstraints, constraintRefsKeyFn) => {
    set((state) => {
      const nextOrder = state.editedFieldOrder.map((k) => (k === oldKey ? newKey : k));
      const nextRules: RuleMap = {};
      for (const [k, rule] of Object.entries(state.editedRules)) {
        const rewritten = Array.isArray(rule.constraints)
          ? rewriteConstraints(rule.constraints as string[], oldKey, newKey)
          : rule.constraints;
        if (k === oldKey) {
          const updated: Record<string, unknown> = { ...rule, constraints: rewritten };
          const newLabel = newKey.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          if (updated.label && (updated.label as string).toLowerCase() === oldKey.toLowerCase()) {
            updated.label = newLabel;
          }
          const uiObj = (updated.ui || {}) as Record<string, unknown>;
          const currentUiLabel = String(uiObj.label || '');
          if (!currentUiLabel || currentUiLabel.toLowerCase() === oldKey.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').toLowerCase()) {
            updated.ui = { ...uiObj, label: newLabel };
            updated.display_name = newLabel;
          }
          nextRules[newKey] = updated;
        } else {
          nextRules[k] = { ...rule, constraints: rewritten };
        }
      }
      return {
        editedFieldOrder: nextOrder,
        editedRules: nextRules,
        pendingRenames: { ...state.pendingRenames, [oldKey]: newKey },
      };
    });
  },

  bulkAddKeys: (entries) => {
    set((state) => {
      const nextOrder = [...state.editedFieldOrder];
      const nextRules = { ...state.editedRules };
      for (const { key, rule } of entries) {
        nextOrder.push(key);
        nextRules[key] = { ...rule, _edited: true };
      }
      return { editedFieldOrder: nextOrder, editedRules: syncGroupsFromOrder(nextOrder, nextRules) };
    });
  },

  reorder: (activeItem, overItem) => {
    set((state) => {
      const nextOrder = reorderFieldOrder(state.editedFieldOrder, activeItem, overItem);
      return {
        editedFieldOrder: nextOrder,
        editedRules: syncGroupsFromOrder(nextOrder, state.editedRules),
      };
    });
  },

  addGroup: (name) => {
    set((state) => {
      const nextOrder = [`__grp::${name}`, ...state.editedFieldOrder];
      return {
        editedFieldOrder: nextOrder,
        editedRules: syncGroupsFromOrder(nextOrder, state.editedRules),
      };
    });
  },

  removeGroup: (name) => {
    set((state) => {
      const marker = `__grp::${name}`;
      const nextOrder = state.editedFieldOrder.filter((k) => k !== marker);
      const updatedRules: RuleMap = {};
      for (const [k, rule] of Object.entries(state.editedRules)) {
        const uiObj = (rule.ui || {}) as Record<string, unknown>;
        const ruleGroup = uiObj.group ? String(uiObj.group) : String(rule.group || 'ungrouped');
        if (ruleGroup.toLowerCase() === name.toLowerCase()) {
          const updatedUi = { ...uiObj, group: 'ungrouped' };
          updatedRules[k] = { ...rule, ui: updatedUi, group: 'ungrouped', _edited: true };
        } else {
          updatedRules[k] = rule;
        }
      }
      return { editedFieldOrder: nextOrder, editedRules: updatedRules };
    });
  },

  renameGroup: (oldName, newName) => {
    set((state) => {
      const oldMarker = `__grp::${oldName}`;
      const newMarker = `__grp::${newName}`;
      const nextOrder = state.editedFieldOrder.map((k) => (k === oldMarker ? newMarker : k));
      const updatedRules: RuleMap = {};
      for (const [k, rule] of Object.entries(state.editedRules)) {
        const uiObj = (rule.ui || {}) as Record<string, unknown>;
        const ruleGroup = uiObj.group ? String(uiObj.group) : String(rule.group || 'ungrouped');
        if (ruleGroup === oldName) {
          const updatedUi = { ...uiObj, group: newName };
          updatedRules[k] = { ...rule, ui: updatedUi, group: newName, _edited: true };
        } else {
          updatedRules[k] = rule;
        }
      }
      return { editedFieldOrder: nextOrder, editedRules: updatedRules };
    });
  },

  getSnapshot: () => {
    const state = get();
    return {
      rules: state.editedRules,
      fieldOrder: state.editedFieldOrder,
      renames: state.pendingRenames,
    };
  },
}));
