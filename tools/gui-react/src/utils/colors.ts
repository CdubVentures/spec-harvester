export function trafficColor(color: string): string {
  switch (color) {
    case 'green': return 'bg-green-500';
    case 'yellow': return 'bg-yellow-400';
    case 'red': return 'bg-red-500';
    case 'purple': return 'bg-purple-500';
    case 'teal': return 'bg-teal-500';
    default: return 'bg-gray-400';
  }
}

export function trafficTextColor(color: string): string {
  switch (color) {
    case 'green': return 'text-green-600 dark:text-green-400';
    case 'yellow': return 'text-yellow-600 dark:text-yellow-300';
    case 'red': return 'text-red-600 dark:text-red-400';
    case 'purple': return 'text-purple-600 dark:text-purple-300';
    case 'teal': return 'text-teal-600 dark:text-teal-400';
    default: return 'text-gray-500 dark:text-gray-400';
  }
}

// ── Source badge color maps ─────────────────────────────────────
// Shared across DrawerShell, EnumSubTab, ComponentReviewDrawer, etc.

/** Light-theme source badge (used in drawers, tables, badges) */
export const sourceBadgeClass: Record<string, string> = {
  reference: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300',
  override: 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300',
  pipeline: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300',
  manual:   'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300',
  user:     'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300',
  pending_ai: 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300',
  pending_ai_primary: 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300',
  pending_ai_shared: 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300',
};

/** Dark-background source badge (used in tooltips which have a dark bg) */
export const sourceBadgeDarkClass: Record<string, string> = {
  reference: 'bg-blue-700/60 text-blue-200',
  override: 'bg-orange-700/60 text-orange-200',
  pipeline: 'bg-amber-700/60 text-amber-200',
  manual:   'bg-green-700/60 text-green-200',
  user:     'bg-purple-700/60 text-purple-200',
  pending_ai: 'bg-purple-700/60 text-purple-200',
  pending_ai_primary: 'bg-teal-700/60 text-teal-200',
  pending_ai_shared: 'bg-purple-700/60 text-purple-200',
};

export const SOURCE_BADGE_FALLBACK = 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
export const SOURCE_BADGE_DARK_FALLBACK = 'bg-gray-700 text-gray-300';

export function statusBg(status: string): string {
  switch (status) {
    case 'complete': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'running': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'pending': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    case 'exhausted': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
    case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'needs_manual': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  }
}
