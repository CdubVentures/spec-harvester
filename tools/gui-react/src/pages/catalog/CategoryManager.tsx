import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';

const sectionCls = 'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4';
const chipCls = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm';
const btnPrimary = 'px-4 py-2 text-sm bg-accent text-white rounded hover:bg-blue-600 disabled:opacity-50';
const inputCls = 'px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-accent';

interface CreateCategoryResult {
  ok: boolean;
  error?: string;
  slug?: string;
  categories?: string[];
}

export function CategoryManager() {
  const categories = useUiStore((s) => s.categories);
  const setCategories = useUiStore((s) => s.setCategories);
  const activeCategory = useUiStore((s) => s.category);
  const setCategory = useUiStore((s) => s.setCategory);
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState('');

  const addMut = useMutation({
    mutationFn: (name: string) => api.post<CreateCategoryResult>('/categories', { name }),
    onSuccess: (data) => {
      if (data.categories) setCategories(data.categories);
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setNewName('');
    },
  });

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    addMut.mutate(name);
  }

  return (
    <div className="space-y-3">
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Categories</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {categories.length} categor{categories.length !== 1 ? 'ies' : 'y'}. Select one to set it as the active working category.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="New category name"
              className={`${inputCls} w-48`}
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || addMut.isPending}
              className={btnPrimary}
            >
              {addMut.isPending ? 'Adding...' : '+ Add'}
            </button>
          </div>
        </div>

        {addMut.error && (
          <p className="text-xs text-red-600 mb-2">{(addMut.error as Error).message}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`${chipCls} transition-colors ${
                activeCategory === cat
                  ? 'bg-accent text-white border-accent'
                  : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-accent'
              }`}
            >
              <span className="font-medium">{cat}</span>
              {activeCategory === cat && (
                <span className="text-xs opacity-75">(active)</span>
              )}
            </button>
          ))}
        </div>

        {categories.length === 0 && (
          <p className="text-sm text-gray-400 italic mt-2">No categories found. Add one above to get started.</p>
        )}
      </div>
    </div>
  );
}
