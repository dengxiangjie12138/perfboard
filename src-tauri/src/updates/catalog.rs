//! Public release metadata is discovery only. Installation still requires a fresh,
//! signed updater manifest and native-owned verified bytes.
use super::source::UpdateSource;
use crate::repository::AppResult;
use reqwest::{Client, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;

const REPOSITORY: &str = "dengxiangjie12138/perfboard";
const API: &str = "https://api.github.com/repos/dengxiangjie12138/perfboard/releases";
const MAX_RESPONSE: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseVersion {
    pub tag: String,
    pub version: String,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub installable: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct Release {
    pub tag_name: String,
    pub draft: bool,
    pub prerelease: bool,
    pub body: Option<String>,
    pub published_at: Option<String>,
    pub assets: Vec<Asset>,
}

#[derive(Clone, Debug, Deserialize)]
pub(super) struct Asset {
    pub name: String,
    pub browser_download_url: String,
    pub state: Option<String>,
}

pub(super) fn stable_tag(tag: &str) -> AppResult<semver::Version> {
    let text = tag.strip_prefix('v').unwrap_or(tag);
    let version = semver::Version::parse(text).map_err(|_| "请选择有效的正式版本")?;
    if !version.pre.is_empty() || !version.build.is_empty() || version.to_string() != text {
        return Err("仅支持正式稳定版本".into());
    }
    Ok(version)
}

fn loopback(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && matches!(
            url.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
        )
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

fn endpoint() -> AppResult<Url> {
    #[cfg(debug_assertions)]
    if let Ok(value) = std::env::var("PERFBOARD_TEST_RELEASES_ENDPOINT") {
        let url = Url::parse(&value).map_err(|_| "隔离测试版本列表地址无效")?;
        if !loopback(&url) || url.query().is_some() {
            return Err("隔离测试版本列表必须使用本机地址".into());
        }
        return Ok(url);
    }
    Url::parse(API).map_err(|e| e.to_string())
}

fn client(source: UpdateSource) -> AppResult<Client> {
    // The updater installs a provider only when check() runs. The catalog can
    // open first, so initialize the same cached ring provider independently.
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .user_agent(concat!("Perfboard/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .redirect(source.redirects())
        .build()
        .map_err(|e| format!("无法准备版本列表请求：{e}"))
}

async fn request<T: DeserializeOwned>(
    client: &Client,
    source: UpdateSource,
    url: Url,
) -> AppResult<T> {
    let mut request = client.get(url);
    if source == UpdateSource::Github {
        request = request
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2026-03-10");
    }
    let mut response = request
        .send()
        .await
        .map_err(|e| format!("无法读取 {} 版本列表，请检查网络后重试：{e}", source.name()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            403 | 429 => format!("{} 访问频率受限，请稍后重试", source.name()),
            404 => "该正式版本已不存在，请刷新版本列表".into(),
            _ => format!("{} 版本请求失败（HTTP {}）", source.name(), status.as_u16()),
        });
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE as u64)
    {
        return Err(format!("{} 版本信息过大", source.name()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE {
            return Err(format!("{} 版本信息过大", source.name()));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| format!("{} 版本信息格式无效", source.name()))
}

fn asset<'a>(release: &'a Release, name: &str) -> Option<&'a Asset> {
    release.assets.iter().find(|item| {
        item.name == name
            && item
                .state
                .as_deref()
                .is_none_or(|state| state == "uploaded")
    })
}

pub(super) fn asset_url(tag: &str, name: &str, value: &str) -> AppResult<String> {
    stable_tag(tag)?;
    let expected = format!("https://github.com/{REPOSITORY}/releases/download/{tag}/{name}");
    if value == expected {
        return Ok(expected);
    }
    #[cfg(debug_assertions)]
    if let Ok(url) = Url::parse(value) {
        if loopback(&url) {
            return Ok(value.to_string());
        }
    }
    Err("版本资产地址不属于本项目，已取消下载".into())
}

fn published(release: &Release) -> AppResult<semver::Version> {
    if release.draft || release.prerelease {
        return Err("该版本不是正式发布的稳定版本".into());
    }
    stable_tag(&release.tag_name)
}

pub(super) fn manifest(release: &Release) -> AppResult<(String, semver::Version)> {
    let version = published(release)?;
    let filename = format!("Perfboard_{version}_x64-setup.exe");
    for name in [
        &filename,
        &format!("{filename}.sig"),
        &"latest.json".to_string(),
    ] {
        let item =
            asset(release, name).ok_or("该版本仅支持从 GitHub 手动下载，不能在应用内安装")?;
        asset_url(&release.tag_name, name, &item.browser_download_url)?;
    }
    let item = asset(release, "latest.json").ok_or("缺少该版本的更新清单")?;
    Ok((
        asset_url(&release.tag_name, "latest.json", &item.browser_download_url)?,
        version,
    ))
}

fn versions(releases: Vec<Release>) -> Vec<ReleaseVersion> {
    let mut entries = Vec::new();
    for release in releases {
        let Ok(version) = published(&release) else {
            continue;
        };
        let filename = format!("Perfboard_{version}_x64-setup.exe");
        let Some(installer) = asset(&release, &filename) else {
            continue;
        };
        if asset_url(
            &release.tag_name,
            &filename,
            &installer.browser_download_url,
        )
        .is_err()
        {
            continue;
        }
        let installable = manifest(&release).is_ok();
        entries.push((
            version.clone(),
            ReleaseVersion {
                tag: release.tag_name,
                version: version.to_string(),
                notes: release.body,
                pub_date: release.published_at,
                installable,
            },
        ));
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.tag.cmp(&a.1.tag)));
    entries.dedup_by(|a, b| a.0 == b.0);
    entries.into_iter().map(|(_, entry)| entry).collect()
}

pub(super) async fn list(source: UpdateSource) -> AppResult<Vec<ReleaseVersion>> {
    let client = client(source)?;
    if source == UpdateSource::Gitee {
        return gitee_versions(request(&client, source, source.index()?).await?);
    }
    let mut releases = Vec::new();
    for page in 1..=10 {
        let mut url = endpoint()?;
        url.query_pairs_mut()
            .append_pair("per_page", "100")
            .append_pair("page", &page.to_string());
        let page: Vec<Release> = request(&client, source, url).await?;
        let complete = page.len() < 100;
        releases.extend(page);
        if complete {
            return Ok(versions(releases));
        }
    }
    Err("正式版本数量超过单次读取上限，请在 GitHub 查看全部版本".into())
}

pub(super) async fn get(tag: &str) -> AppResult<Release> {
    stable_tag(tag)?;
    let mut url = endpoint()?;
    url.set_path(&format!("{}/tags/{tag}", url.path().trim_end_matches('/')));
    let release: Release =
        request(&client(UpdateSource::Github)?, UpdateSource::Github, url).await?;
    published(&release)?;
    if release.tag_name != tag {
        return Err("GitHub 返回的版本与所选版本不符".into());
    }
    Ok(release)
}

fn gitee_versions(releases: Vec<ReleaseVersion>) -> AppResult<Vec<ReleaseVersion>> {
    let mut entries = Vec::new();
    for release in releases {
        let version = stable_tag(&release.tag)?;
        if release.version != version.to_string() || release.tag != format!("v{version}") {
            return Err("Gitee 版本列表的版本号与标签不符".into());
        }
        entries.push((version, release));
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    if entries.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return Err("Gitee 版本列表存在重复版本，请稍后重试".into());
    }
    Ok(entries.into_iter().map(|(_, release)| release).collect())
}

pub(super) async fn resolve(
    source: UpdateSource,
    tag: &str,
) -> AppResult<(String, semver::Version)> {
    let version = stable_tag(tag)?;
    match source {
        UpdateSource::Github => manifest(&get(tag).await?),
        UpdateSource::Gitee => {
            let release = list(source)
                .await?
                .into_iter()
                .find(|release| release.tag == tag)
                .ok_or("该 Gitee 正式版本已不存在，请刷新版本列表")?;
            if !release.installable {
                return Err("该版本仅支持从 Gitee 手动下载，不能在应用内安装".into());
            }
            Ok((source.manifest(tag)?.to_string(), version))
        }
    }
}

pub(super) async fn exists(source: UpdateSource, tag: &str) -> AppResult<()> {
    stable_tag(tag)?;
    match source {
        UpdateSource::Github => {
            get(tag).await?;
        }
        UpdateSource::Gitee => {
            if !list(source).await?.iter().any(|release| release.tag == tag) {
                return Err("该 Gitee 正式版本已不存在，请刷新版本列表".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release(tag: &str, signed: bool) -> Release {
        let version = stable_tag(tag).unwrap();
        let filename = format!("Perfboard_{version}_x64-setup.exe");
        let mut names = vec![filename.clone()];
        if signed {
            names.extend([format!("{filename}.sig"), "latest.json".into()]);
        }
        Release {
            tag_name: tag.into(),
            draft: false,
            prerelease: false,
            body: None,
            published_at: None,
            assets: names
                .into_iter()
                .map(|name| Asset {
                    browser_download_url: format!(
                        "https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"
                    ),
                    name,
                    state: Some("uploaded".into()),
                })
                .collect(),
        }
    }
    #[test]
    fn catalog_uses_semver_and_keeps_unsigned_legacy_versions_manual_only() {
        let mut draft = release("v4.0.0", true);
        draft.draft = true;
        let mut pre = release("v3.0.0", true);
        pre.prerelease = true;
        let result = versions(vec![
            release("v0.1.2", true),
            release("v0.1.0", false),
            release("v0.1.10", true),
            draft,
            pre,
        ]);
        assert_eq!(
            result
                .iter()
                .map(|item| item.version.as_str())
                .collect::<Vec<_>>(),
            ["0.1.10", "0.1.2", "0.1.0"]
        );
        assert!(result[0].installable);
        assert!(!result[2].installable);
    }
    #[test]
    fn reject_untrusted_assets_and_unsafe_or_prerelease_tags() {
        let mut item = release("v0.1.1", true);
        item.assets[0].browser_download_url = "https://example.com/installer.exe".into();
        assert!(manifest(&item).is_err());
        assert!(versions(vec![item]).is_empty());
        for tag in [
            "../v0.1.1",
            "v0.1.1?token=x",
            "v0.1.1-beta.1",
            "vv0.1.1",
            "0.1.1+local",
        ] {
            assert!(stable_tag(tag).is_err());
        }
        assert!(UpdateSource::Github
            .page("v0.1.0")
            .unwrap()
            .ends_with("/releases/tag/v0.1.0"));
    }
    #[test]
    fn missing_one_signature_asset_never_becomes_installable() {
        let mut item = release("v0.1.1", true);
        item.assets.retain(|asset| !asset.name.ends_with(".sig"));
        assert!(manifest(&item).is_err());
        assert!(!versions(vec![item])[0].installable);
    }
    fn gitee_release(version: &str) -> ReleaseVersion {
        ReleaseVersion {
            tag: format!("v{version}"),
            version: version.into(),
            notes: None,
            pub_date: None,
            installable: true,
        }
    }
    #[test]
    fn gitee_index_is_sorted_semantically_and_rejects_ambiguous_entries() {
        let versions = gitee_versions(vec![
            gitee_release("0.1.2"),
            gitee_release("0.1.10"),
            gitee_release("0.1.1"),
        ])
        .unwrap();
        assert_eq!(
            versions
                .iter()
                .map(|item| item.version.as_str())
                .collect::<Vec<_>>(),
            ["0.1.10", "0.1.2", "0.1.1"]
        );
        let mut bad = gitee_release("0.1.1");
        bad.tag = "v0.1.2".into();
        assert!(gitee_versions(vec![bad]).is_err());
        assert!(gitee_versions(vec![gitee_release("0.1.1"), gitee_release("0.1.1")]).is_err());
        let mut pre = gitee_release("0.1.2-beta.1");
        assert!(gitee_versions(vec![pre.clone()]).is_err());
        pre.tag = "../latest".into();
        assert!(gitee_versions(vec![pre]).is_err());
    }

    #[test]
    fn gitee_selection_is_resolved_from_a_fresh_public_index() {
        use std::io::{Read, Write};
        struct Restore(Option<std::ffi::OsString>);
        impl Drop for Restore {
            fn drop(&mut self) {
                if let Some(value) = &self.0 {
                    std::env::set_var("PERFBOARD_TEST_GITEE_INDEX_ENDPOINT", value);
                } else {
                    std::env::remove_var("PERFBOARD_TEST_GITEE_INDEX_ENDPOINT");
                }
            }
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for index in 0..3 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut bytes = [0; 8192];
                let count = stream.read(&mut bytes).unwrap();
                let request = String::from_utf8_lossy(&bytes[..count]).to_ascii_lowercase();
                assert!(request.starts_with("get /updates/versions.json "));
                assert!(!request.contains("authorization:"));
                let releases = if index == 0 {
                    vec![gitee_release("0.1.1"), gitee_release("0.1.2")]
                } else {
                    vec![gitee_release("0.1.1")]
                };
                let body = serde_json::to_vec(&releases).unwrap();
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        let _restore = Restore(std::env::var_os("PERFBOARD_TEST_GITEE_INDEX_ENDPOINT"));
        std::env::set_var(
            "PERFBOARD_TEST_GITEE_INDEX_ENDPOINT",
            format!("http://{address}/updates/versions.json"),
        );
        tauri::async_runtime::block_on(async {
            assert_eq!(list(UpdateSource::Gitee).await.unwrap()[0].version, "0.1.2");
            assert!(resolve(UpdateSource::Gitee, "v0.1.2")
                .await
                .unwrap_err()
                .contains("不存在"));
            let (manifest, version) = resolve(UpdateSource::Gitee, "v0.1.1").await.unwrap();
            assert_eq!(
                manifest,
                format!("http://{address}/updates/releases/v0.1.1.json")
            );
            assert_eq!(version, semver::Version::new(0, 1, 1));
        });
        server.join().unwrap();
    }
    #[test]
    fn catalog_client_initializes_tls_before_any_updater_check() {
        assert!(client(UpdateSource::Github).is_ok());
        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
    }
    #[test]
    fn public_metadata_is_requested_without_a_token_and_rate_limit_errors_are_explicit() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = [0; 8192];
            let count = stream.read(&mut bytes).unwrap();
            let request = String::from_utf8_lossy(&bytes[..count]).to_ascii_lowercase();
            assert!(request.contains("user-agent: perfboard/"));
            assert!(!request.contains("authorization:"));
            stream
                .write_all(
                    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                )
                .unwrap();
        });
        let error = tauri::async_runtime::block_on(request::<Vec<Release>>(
            &client(UpdateSource::Github).unwrap(),
            UpdateSource::Github,
            Url::parse(&format!("http://{address}/releases")).unwrap(),
        ))
        .unwrap_err();
        assert!(error.contains("访问频率受限"));
        server.join().unwrap();
    }

    #[test]
    fn catalog_follows_pages_and_resolves_selected_tags_again_instead_of_trusting_a_cached_list() {
        use std::io::{Read, Write};
        struct Restore(Option<std::ffi::OsString>);
        impl Drop for Restore {
            fn drop(&mut self) {
                if let Some(value) = &self.0 {
                    std::env::set_var("PERFBOARD_TEST_RELEASES_ENDPOINT", value);
                } else {
                    std::env::remove_var("PERFBOARD_TEST_RELEASES_ENDPOINT");
                }
            }
        }
        fn metadata(tag: &str) -> serde_json::Value {
            let version = stable_tag(tag).unwrap();
            let filename = format!("Perfboard_{version}_x64-setup.exe");
            let assets = [filename.clone(),format!("{filename}.sig"),"latest.json".into()].into_iter().map(|name| {
                    serde_json::json!({"browser_download_url":format!("https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"),"name":name})
                }).collect::<Vec<_>>();
            serde_json::json!({"tag_name":tag,"draft":false,"prerelease":false,"body":null,"published_at":null,"assets":assets})
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for _ in 0..4 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0; 8192];
                let count = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..count]);
                let value = if request.contains("/tags/") {
                    // Both tag requests deliberately receive 0.1.1; the second
                    // request must reject this response as a mismatched tag.
                    metadata("v0.1.1")
                } else if request.contains("page=2") {
                    serde_json::json!([metadata("v0.2.0")])
                } else {
                    serde_json::Value::Array(
                        (0..100)
                            .map(|index| metadata(&format!("v0.1.{index}")))
                            .collect(),
                    )
                };
                let body = serde_json::to_vec(&value).unwrap();
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        let _restore = Restore(std::env::var_os("PERFBOARD_TEST_RELEASES_ENDPOINT"));
        std::env::set_var(
            "PERFBOARD_TEST_RELEASES_ENDPOINT",
            format!("http://{address}/releases"),
        );
        tauri::async_runtime::block_on(async {
            let versions = list(UpdateSource::Github).await.unwrap();
            assert_eq!(versions.len(), 101);
            assert_eq!(versions[0].version, "0.2.0");
            assert_eq!(get("v0.1.1").await.unwrap().tag_name, "v0.1.1");
            assert!(get("v0.1.2").await.unwrap_err().contains("所选版本不符"));
        });
        server.join().unwrap();
    }
}
