use crate::repository::AppResult;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditLeaseStatus {
    pub resource: String,
    pub owner_label: Option<String>,
    pub owned: bool,
}

/// A lease has no clock-based expiration. A suspended WebView must not lose its
/// ability to save a draft; only its owner or native destruction releases it.
#[derive(Default)]
pub struct EditLeases {
    owners: Mutex<HashMap<String, String>>,
}

/// Keep this guard alive through the repository mutation, so checking ownership
/// and writing cannot race with release, acquire, or repository switching.
pub struct EditLeaseWriteGuard<'a> {
    _owners: MutexGuard<'a, HashMap<String, String>>,
}

pub fn validate_resource(resource: &str) -> AppResult<()> {
    let (namespace, id) = resource.split_once(':').ok_or("Invalid editor resource")?;
    if !matches!(namespace, "note" | "log")
        || id.is_empty()
        || resource.len() > 256
        || id.chars().any(|character| {
            character == ':' || character.is_whitespace() || character.is_control()
        })
    {
        return Err("Invalid editor resource".into());
    }
    Ok(())
}

impl EditLeases {
    fn lock(&self) -> AppResult<MutexGuard<'_, HashMap<String, String>>> {
        self.owners
            .lock()
            .map_err(|_| "Editor lease lock is unavailable".into())
    }

    pub fn acquire(&self, resource: &str, label: &str) -> AppResult<EditLeaseStatus> {
        validate_resource(resource)?;
        let mut owners = self.lock()?;
        owners
            .entry(resource.to_owned())
            .or_insert_with(|| label.to_owned());
        Ok(Self::describe(&owners, resource, label))
    }

    pub fn status(&self, resource: &str, label: &str) -> AppResult<EditLeaseStatus> {
        validate_resource(resource)?;
        let owners = self.lock()?;
        Ok(Self::describe(&owners, resource, label))
    }

    pub fn release(&self, resource: &str, label: &str) -> AppResult<()> {
        validate_resource(resource)?;
        let mut owners = self.lock()?;
        match owners.get(resource) {
            Some(owner) if owner != label => Err("This editor belongs to another window".into()),
            Some(_) => {
                owners.remove(resource);
                Ok(())
            }
            None => Ok(()),
        }
    }

    pub fn release_window(&self, label: &str) -> AppResult<()> {
        self.lock()?.retain(|_, owner| owner != label);
        Ok(())
    }

    /// Only use after every editor successfully flushes during repository switch.
    pub fn release_all(&self) -> AppResult<()> {
        self.lock()?.clear();
        Ok(())
    }

    pub fn assert_can_write<'a>(
        &'a self,
        resource: &str,
        label: &str,
    ) -> AppResult<EditLeaseWriteGuard<'a>> {
        validate_resource(resource)?;
        let owners = self.lock()?;
        match owners.get(resource) {
            Some(owner) if owner == label => Ok(EditLeaseWriteGuard { _owners: owners }),
            Some(_) => {
                Err("该文档正在另一个窗口编辑，请先在原窗口保存并切换或关闭，再重试。".into())
            }
            None => Err("请先取得文档编辑权限，再保存。".into()),
        }
    }

    /// Destructive operations may affect an unclaimed document, but never one
    /// being edited by another native window.
    pub fn assert_available<'a>(
        &'a self,
        resource: &str,
        label: &str,
    ) -> AppResult<EditLeaseWriteGuard<'a>> {
        validate_resource(resource)?;
        let owners = self.lock()?;
        match owners.get(resource) {
            Some(owner) if owner != label => {
                Err("该文档正在另一个窗口编辑，请先在原窗口保存并切换或关闭，再重试。".into())
            }
            _ => Ok(EditLeaseWriteGuard { _owners: owners }),
        }
    }

    /// Batch checks use one lock: nesting separate write guards would deadlock.
    pub fn assert_resources_available<'a>(
        &'a self,
        resources: &[String],
        label: &str,
    ) -> AppResult<EditLeaseWriteGuard<'a>> {
        let guard = EditLeaseWriteGuard {
            _owners: self.lock()?,
        };
        guard.assert_resources_available(resources, label)?;
        Ok(guard)
    }

    /// Take this guard before the repository mutex when affected IDs need a DB
    /// query. For repository switching, first flush every editor and clear
    /// ownership only after the new repository opens successfully.
    pub fn lock_for_repository_switch(&self) -> AppResult<EditLeaseWriteGuard<'_>> {
        Ok(EditLeaseWriteGuard {
            _owners: self.lock()?,
        })
    }

    fn describe(owners: &HashMap<String, String>, resource: &str, label: &str) -> EditLeaseStatus {
        let owner_label = owners.get(resource).cloned();
        EditLeaseStatus {
            resource: resource.to_owned(),
            owned: owner_label.as_deref() == Some(label),
            owner_label,
        }
    }
}
impl EditLeaseWriteGuard<'_> {
    /// Inspect the IDs obtained under the repository lock without reacquiring
    /// the already-held lease mutex. Keep both guards through the mutation.
    pub fn assert_resources_available(&self, resources: &[String], label: &str) -> AppResult<()> {
        for resource in resources {
            validate_resource(resource)?;
        }
        if resources.iter().any(|resource| {
            self._owners
                .get(resource)
                .is_some_and(|owner| owner != label)
        }) {
            return Err("该文档正在另一个窗口编辑，请先在原窗口保存并切换或关闭，再重试。".into());
        }
        Ok(())
    }

    pub fn clear_all(&mut self) {
        self._owners.clear();
    }
}
