import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { CatalogCategoryPresetsState } from './catalogCategoryPresets';
import type { CatalogSkillPresetsState } from './catalogSkillPresetsState';
import { normalizeCatalogCategoryPresets } from './catalogCategoryPresets';
import { normalizeCatalogSkillPresets } from './catalogSkillPresetsState';
import { saveCatalogCategoryPresets } from './catalogCategoryPresetsFirestore';
import { saveCatalogSkillPresets } from './catalogSkillPresetsFirestore';

export const CATALOG_TAXONOMY_PROPOSALS_COLLECTION = 'catalogTaxonomyProposals';

export type TaxonomyProposalKind = 'category' | 'skill';

export type TaxonomyProposalStatus = 'pending' | 'approved' | 'rejected';

export type CatalogTaxonomyProposal = {
  id: string;
  kind: TaxonomyProposalKind;
  label: string;
  status: TaxonomyProposalStatus;
  createdBy: string;
  createdAt?: unknown;
  reviewedBy?: string;
  reviewedAt?: unknown;
};

function coerceProposal(id: string, data: Record<string, unknown>): CatalogTaxonomyProposal | null {
  const kind = data.kind;
  const label = data.label;
  const status = data.status;
  const createdBy = data.createdBy;
  if (kind !== 'category' && kind !== 'skill') return null;
  if (typeof label !== 'string' || !label.trim()) return null;
  if (status !== 'pending' && status !== 'approved' && status !== 'rejected') return null;
  if (typeof createdBy !== 'string' || !createdBy) return null;
  return {
    id,
    kind,
    label: label.trim(),
    status,
    createdBy,
    createdAt: data.createdAt,
    reviewedBy: typeof data.reviewedBy === 'string' ? data.reviewedBy : undefined,
    reviewedAt: data.reviewedAt,
  };
}

/** Admin: all pending proposals (newest first). */
export function subscribePendingTaxonomyProposals(
  onNext: (rows: CatalogTaxonomyProposal[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, CATALOG_TAXONOMY_PROPOSALS_COLLECTION),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows: CatalogTaxonomyProposal[] = [];
      for (const d of snap.docs) {
        const row = coerceProposal(d.id, d.data() as Record<string, unknown>);
        if (row) rows.push(row);
      }
      onNext(rows);
    },
    (e) => {
      handleFirestoreError(e, OperationType.LIST, CATALOG_TAXONOMY_PROPOSALS_COLLECTION);
      onError?.(e as Error);
    }
  );
}

/** Creator: own pending proposals. */
export function subscribeMyPendingTaxonomyProposals(
  uid: string,
  onNext: (rows: CatalogTaxonomyProposal[]) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, CATALOG_TAXONOMY_PROPOSALS_COLLECTION),
    where('createdBy', '==', uid),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows: CatalogTaxonomyProposal[] = [];
      for (const d of snap.docs) {
        const row = coerceProposal(d.id, d.data() as Record<string, unknown>);
        if (row) rows.push(row);
      }
      onNext(rows);
    },
    (e) => {
      handleFirestoreError(e, OperationType.LIST, CATALOG_TAXONOMY_PROPOSALS_COLLECTION);
      onError?.(e as Error);
    }
  );
}

export async function createTaxonomyProposal(
  kind: TaxonomyProposalKind,
  label: string,
  uid: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const t = label.trim();
  if (!t) return { ok: false, error: 'Label is empty.' };
  if (t.length > 80) return { ok: false, error: 'Label is too long (max 80 characters).' };
  try {
    const ref = await addDoc(collection(db, CATALOG_TAXONOMY_PROPOSALS_COLLECTION), {
      kind,
      label: t,
      status: 'pending' as const,
      createdBy: uid,
      createdAt: serverTimestamp(),
    });
    return { ok: true, id: ref.id };
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, CATALOG_TAXONOMY_PROPOSALS_COLLECTION);
    return { ok: false, error: 'Could not submit proposal. Check permissions or try again.' };
  }
}

export async function setTaxonomyProposalRejected(
  proposalId: string,
  adminUid: string
): Promise<boolean> {
  try {
    await updateDoc(doc(db, CATALOG_TAXONOMY_PROPOSALS_COLLECTION, proposalId), {
      status: 'rejected',
      reviewedBy: adminUid,
      reviewedAt: serverTimestamp(),
    });
    return true;
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `${CATALOG_TAXONOMY_PROPOSALS_COLLECTION}/${proposalId}`);
    return false;
  }
}

/**
 * Approve: append label to global moreTopics / moreSkills (if not already present), persist presets,
 * then mark proposal approved.
 */
export async function approveTaxonomyProposalAndMerge(
  proposal: CatalogTaxonomyProposal,
  categoryPresets: CatalogCategoryPresetsState,
  skillPresets: CatalogSkillPresetsState,
  adminUid: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const k = proposal.label.trim().toLowerCase();
  if (proposal.kind === 'category') {
    const more = categoryPresets.moreTopics;
    if (more.some((x) => x.trim().toLowerCase() === k)) {
      await updateDoc(doc(db, CATALOG_TAXONOMY_PROPOSALS_COLLECTION, proposal.id), {
        status: 'approved',
        reviewedBy: adminUid,
        reviewedAt: serverTimestamp(),
      });
      return { ok: true };
    }
    const next = normalizeCatalogCategoryPresets({
      mainPills: categoryPresets.mainPills,
      moreTopics: [...categoryPresets.moreTopics, proposal.label.trim()],
    });
    const ok = await saveCatalogCategoryPresets(next);
    if (!ok) return { ok: false, error: 'Could not save category presets.' };
  } else {
    const more = skillPresets.moreSkills;
    if (more.some((x) => x.trim().toLowerCase() === k)) {
      await updateDoc(doc(db, CATALOG_TAXONOMY_PROPOSALS_COLLECTION, proposal.id), {
        status: 'approved',
        reviewedBy: adminUid,
        reviewedAt: serverTimestamp(),
      });
      return { ok: true };
    }
    const next = normalizeCatalogSkillPresets({
      mainPills: skillPresets.mainPills,
      moreSkills: [...skillPresets.moreSkills, proposal.label.trim()],
    });
    const ok = await saveCatalogSkillPresets(next);
    if (!ok) return { ok: false, error: 'Could not save skill presets.' };
  }
  try {
    await updateDoc(doc(db, CATALOG_TAXONOMY_PROPOSALS_COLLECTION, proposal.id), {
      status: 'approved',
      reviewedBy: adminUid,
      reviewedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, `${CATALOG_TAXONOMY_PROPOSALS_COLLECTION}/${proposal.id}`);
    return { ok: false, error: 'Presets saved but could not update proposal status.' };
  }
}
