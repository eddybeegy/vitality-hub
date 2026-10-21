import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ArrowUpDown, ArrowUp, ArrowDown, Utensils, Search } from 'lucide-react';

interface FrequentMeal {
  name: string;
  log_count: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface FrequentMealsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SortField = 'log_count' | 'name' | 'calories' | 'protein' | 'carbs' | 'fat';
type SortDirection = 'asc' | 'desc';

const NUMERIC_FIELDS: SortField[] = ['log_count', 'calories', 'protein', 'carbs', 'fat'];

export const FrequentMealsModal = ({ isOpen, onClose }: FrequentMealsModalProps) => {
  const [meals, setMeals] = useState<FrequentMeal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sortField, setSortField] = useState<SortField>('log_count');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterText, setFilterText] = useState('');

  useEffect(() => {
    if (isOpen) {
      setFilterText('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const fetchMeals = async () => {
        setIsLoading(true);
        try {
          const res = await fetch('/api/meals/frequent');
          if (res.ok) {
            const data = await res.json();
            setMeals(data);
          }
        } catch (e) {
          console.error("Failed to fetch frequent meals:", e);
        } finally {
          setIsLoading(false);
        }
      };
      fetchMeals();
    }
  }, [isOpen]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const filteredMeals = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return meals;
    return meals.filter(m => m.name.toLowerCase().includes(q));
  }, [meals, filterText]);

  const sortedMeals = useMemo(() => {
    return [...filteredMeals].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (!NUMERIC_FIELDS.includes(sortField)) {
        return sortDirection === 'asc'
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      }

      return sortDirection === 'asc'
        ? Number(aVal) - Number(bVal)
        : Number(bVal) - Number(aVal);
    });
  }, [filteredMeals, sortField, sortDirection]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={14} className="text-zinc-400 opacity-50 ml-1" />;
    return sortDirection === 'asc' 
      ? <ArrowUp size={14} className="text-emerald-500 ml-1" /> 
      : <ArrowDown size={14} className="text-emerald-500 ml-1" />;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden p-6 sm:p-12">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-4xl max-h-full flex flex-col bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl overflow-hidden border border-zinc-200 dark:border-white/10"
          >
            <div className="flex-none flex items-center justify-between p-6 border-b border-black/5 dark:border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center text-orange-600 dark:text-orange-400">
                  <Utensils size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Top Logged Meals</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Your most frequent foods and their average macros</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            {!isLoading && meals.length > 0 && (
              <div className="flex-none flex items-center gap-3 px-6 py-3 border-b border-black/5 dark:border-white/5 bg-white dark:bg-zinc-900">
                <div className="relative flex-1 max-w-xs">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="Filter by food name..."
                    className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-orange-400 focus:outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                  />
                </div>
                <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500 shrink-0">
                  {sortedMeals.length} / {meals.length}
                </span>
              </div>
            )}

            <div className="flex-auto overflow-y-auto min-h-0 bg-white dark:bg-zinc-900">
              {isLoading ? (
                <div className="flex items-center justify-center h-64">
                  <p className="text-zinc-500 font-medium">Loading meal insights...</p>
                </div>
              ) : meals.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center p-6">
                  <Utensils size={48} className="text-zinc-200 dark:text-zinc-800 mb-4" />
                  <p className="text-zinc-500 dark:text-zinc-400 font-medium">No meal data found.</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">Log some meals via Apple Health/Cronometer to see insights here.</p>
                </div>
              ) : sortedMeals.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center p-6">
                  <Search size={48} className="text-zinc-200 dark:text-zinc-800 mb-4" />
                  <p className="text-zinc-500 dark:text-zinc-400 font-medium">No matches.</p>
                </div>
              ) : (
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-zinc-50 dark:bg-zinc-800/50 sticky top-0 z-10 shadow-sm border-b border-black/5 dark:border-white/5">
                    <tr>
                      <th 
                        className="px-6 py-4 font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
                        onClick={() => handleSort('name')}
                      >
                        <div className="flex items-center">Food Item <SortIcon field="name" /></div>
                      </th>
                      <th 
                        className="px-6 py-4 font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
                        onClick={() => handleSort('log_count')}
                      >
                        <div className="flex items-center justify-end">Logs <SortIcon field="log_count" /></div>
                      </th>
                      <th 
                        className="px-6 py-4 font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
                        onClick={() => handleSort('calories')}
                      >
                        <div className="flex items-center justify-end">Calories <SortIcon field="calories" /></div>
                      </th>
                      <th 
                        className="px-6 py-4 font-bold text-emerald-600 dark:text-emerald-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
                        onClick={() => handleSort('protein')}
                      >
                        <div className="flex items-center justify-end">Protein (g) <SortIcon field="protein" /></div>
                      </th>
                      <th 
                        className="px-6 py-4 font-bold text-blue-600 dark:text-blue-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
                        onClick={() => handleSort('carbs')}
                      >
                        <div className="flex items-center justify-end">Carbs (g) <SortIcon field="carbs" /></div>
                      </th>
                      <th 
                        className="px-6 py-4 font-bold text-yellow-600 dark:text-yellow-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
                        onClick={() => handleSort('fat')}
                      >
                        <div className="flex items-center justify-end">Fat (g) <SortIcon field="fat" /></div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/5">
                    {sortedMeals.map((meal, i) => (
                      <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-4 font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[300px]">
                          {meal.name}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="inline-block bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 px-2 py-1 rounded-md font-bold text-xs">
                            {meal.log_count}x
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-zinc-700 dark:text-zinc-300">
                          {Math.round(meal.calories || 0)}
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-emerald-600 dark:text-emerald-400">
                          {Math.round(meal.protein || 0)}
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-blue-600 dark:text-blue-400">
                          {Math.round(meal.carbs || 0)}
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-yellow-600 dark:text-yellow-400">
                          {Math.round(meal.fat || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
