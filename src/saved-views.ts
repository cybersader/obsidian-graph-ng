import { validatePredicate, type Predicate } from './core/declaration';
import { emptyView, type SavedView } from './core/explore';

/** Shared with the existing folder filter builder; no source enumeration or new schema. */
export function folderPredicate(text: string): Extract<Predicate, { kind: 'folder' }> {
  const predicate = { kind: 'folder' as const, prefix: text.trim().replace(/^\/+|\/+$/g, '').split('/').filter(Boolean) };
  validatePredicate(predicate); return predicate;
}
export function folderView(folder: string, name: string): SavedView {
  const predicate = folderPredicate(folder);
  if (!predicate.prefix.length) throw new Error('Choose a vault-relative folder');
  return { name, view: { ...emptyView(), filters: [predicate], group: { from: 'folder', depth: 1, prefix: predicate.prefix } }, camera: null };
}
