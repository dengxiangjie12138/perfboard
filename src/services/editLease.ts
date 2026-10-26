import { invoke, isTauri } from '@tauri-apps/api/core';

export interface EditLeaseStatus {
  resource: string;
  ownerLabel: string | null;
  owned: boolean;
}

// Native ownership always comes from the command's WebviewWindow sender.
// The preview fallback deliberately stays in this browser realm: previews have
// no repository connection and do not launch native child windows.
const previewOwner = 'browser-preview';
const previewLeases = new Map<string, string>();

function validateResource(resource: string): void {
  const hasControl = [...resource].some(character => {
    const code = character.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159);
  });
  if (!/^(note|log):[^:\s]+$/.test(resource) || resource.length > 256 || hasControl) {
    throw new Error('Invalid editor resource');
  }
}

function previewStatus(resource: string): EditLeaseStatus {
  const ownerLabel = previewLeases.get(resource) ?? null;
  return { resource, ownerLabel, owned: ownerLabel === previewOwner };
}

export async function acquireEditLease(resource: string): Promise<EditLeaseStatus> {
  validateResource(resource);
  if (isTauri()) return invoke<EditLeaseStatus>('edit_lease_acquire', { resource });
  if (!previewLeases.has(resource)) previewLeases.set(resource, previewOwner);
  return previewStatus(resource);
}

export async function editLeaseStatus(resource: string): Promise<EditLeaseStatus> {
  validateResource(resource);
  if (isTauri()) return invoke<EditLeaseStatus>('edit_lease_status', { resource });
  return previewStatus(resource);
}

export async function releaseEditLease(resource: string): Promise<void> {
  validateResource(resource);
  if (isTauri()) return invoke<void>('edit_lease_release', { resource });
  if (previewLeases.get(resource) === previewOwner) previewLeases.delete(resource);
}