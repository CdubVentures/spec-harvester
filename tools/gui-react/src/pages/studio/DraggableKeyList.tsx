import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { validateNewGroupTs } from './keyUtils';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface DraggableKeyListProps {
  fieldOrder: string[];
  selectedKey: string;
  editedRules: Record<string, Record<string, unknown>>;
  rules: Record<string, Record<string, unknown>>;
  displayLabel: (key: string, rule: Record<string, unknown>) => string;
  onSelectKey: (key: string) => void;
  onReorder: (activeItem: string, overItem: string) => void;
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
  onDeleteGroup: (group: string) => void;
  onRenameGroup: (oldName: string, newName: string) => void;
  existingGroups: string[];
}

function SortableGroupHeader({
  group, id, isSelected, onSelect, onDelete, onRename, existingGroups, isFirst,
}: {
  group: string; id: string;
  isSelected: boolean;
  isFirst: boolean;
  onSelect: (group: string) => void;
  onDelete: (group: string) => void;
  onRename: (oldName: string, newName: string) => void;
  existingGroups: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(group);
  const cancelledRef = useRef(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  useEffect(() => { setEditValue(group); }, [group]);

  const otherGroups = existingGroups.filter(g => g.toLowerCase() !== group.toLowerCase());
  const renameError = editing && editValue.trim() && editValue.trim() !== group
    ? validateNewGroupTs(editValue, otherGroups)
    : null;

  const commitRename = () => {
    if (cancelledRef.current) { cancelledRef.current = false; return; }
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === group || renameError) {
      setEditValue(group);
      setEditing(false);
      return;
    }
    onRename(group, trimmed);
    setEditing(false);
  };

  const cancelRename = () => {
    cancelledRef.current = true;
    setEditValue(group);
    setEditing(false);
  };

  return (
    <div
      ref={setNodeRef} style={style}
      className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors ${!isFirst ? 'mt-3' : ''} ${
        isSelected
          ? 'bg-accent/10 border border-accent/25'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent'
      }`}
      onClick={() => { if (!editing) onSelect(group); }}
    >
      <span className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 select-none text-[10px]"
        {...attributes} {...listeners}>
        &#x2630;
      </span>
      {editing ? (
        <div className="flex-1 flex flex-col gap-0.5">
          <input
            autoFocus
            className={`w-full text-xs font-semibold uppercase bg-white dark:bg-gray-700 border rounded px-1.5 py-0.5 outline-none ${
              renameError
                ? 'border-red-400 focus:border-red-400 focus:ring-1 focus:ring-red-300'
                : 'border-gray-300 dark:border-gray-600 focus:border-accent focus:ring-1 focus:ring-accent/30'
            }`}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !renameError) commitRename();
              if (e.key === 'Escape') cancelRename();
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
          />
          {renameError && <span className="text-[9px] text-red-500 leading-tight">{renameError}</span>}
        </div>
      ) : (
        <h4
          className={`text-xs font-semibold uppercase flex-1 ${
            isSelected ? 'text-accent' : 'text-gray-400'
          }`}
          onDoubleClick={(e) => { e.stopPropagation(); setEditValue(group); setEditing(true); }}
        >{group}</h4>
      )}
      {isSelected && !editing && (
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); setEditValue(group); setEditing(true); }}
            className="text-gray-400 hover:text-accent text-[10px] px-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Rename group"
          >&#9998;</button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(group); }}
            className="text-gray-400 hover:text-red-500 text-[10px] px-1 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
            title={`Delete group "${group}"`}
          >&#x2715;</button>
        </div>
      )}
    </div>
  );
}

function SortableKeyItem({
  keyName,
  id,
  isSelected,
  isEdited,
  label,
  onSelectKey,
}: {
  keyName: string;
  id: string;
  isSelected: boolean;
  isEdited: boolean;
  label: string;
  onSelectKey: (key: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1">
      <span
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 select-none text-[10px]"
        {...attributes}
        {...listeners}
      >
        &#x2630;
      </span>
      <button
        onClick={() => onSelectKey(keyName)}
        className={`block flex-1 text-left px-2 py-1 text-sm rounded ${
          isSelected
            ? 'bg-accent/10 text-accent font-medium'
            : 'hover:bg-gray-100 dark:hover:bg-gray-700'
        }${isEdited ? ' border-l-2 border-amber-400' : ''}`}
      >
        {label}
      </button>
    </div>
  );
}

export default function DraggableKeyList({
  fieldOrder,
  selectedKey,
  editedRules,
  rules,
  displayLabel,
  onSelectKey,
  onReorder,
  selectedGroup,
  onSelectGroup,
  onDeleteGroup,
  onRenameGroup,
  existingGroups,
}: DraggableKeyListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  }, [onReorder]);

  const firstGroupIdx = useMemo(
    () => fieldOrder.findIndex(item => item.startsWith('__grp::')),
    [fieldOrder],
  );

  const overlayLabel = useMemo(() => {
    if (!activeId) return '';
    if (activeId.startsWith('__grp::')) return activeId.slice(7);
    return displayLabel(activeId, editedRules[activeId] || rules[activeId]);
  }, [activeId, displayLabel, editedRules, rules]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={fieldOrder} strategy={verticalListSortingStrategy}>
        {fieldOrder.map((item, idx) => {
          if (item.startsWith('__grp::')) {
            const group = item.slice(7);
            return (
              <SortableGroupHeader
                key={item}
                group={group}
                id={item}
                isFirst={idx === firstGroupIdx}
                isSelected={selectedGroup === group}
                onSelect={onSelectGroup}
                onDelete={onDeleteGroup}
                onRename={onRenameGroup}
                existingGroups={existingGroups}
              />
            );
          }
          return (
            <SortableKeyItem
              key={item}
              keyName={item}
              id={item}
              isSelected={selectedKey === item}
              isEdited={!!editedRules[item]?._edited}
              label={displayLabel(item, editedRules[item] || rules[item])}
              onSelectKey={onSelectKey}
            />
          );
        })}
      </SortableContext>
      <DragOverlay>
        {activeId ? (
          <div className="bg-white dark:bg-gray-800 shadow-lg rounded px-3 py-1.5 text-sm font-medium border border-accent/30">
            {activeId.startsWith('__grp::') ? (
              <span className="text-xs font-semibold uppercase text-gray-400">{overlayLabel}</span>
            ) : (
              overlayLabel
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
