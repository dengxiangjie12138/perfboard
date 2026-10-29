//! Fixed public providers. A preference selects a provider, never an arbitrary URL.
use crate::repository::AppResult;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub(super) const GITHUB_REPOSITORY: &str = "dengxiangjie12138/perfboard";
pub(super) const GITEE_REPOSITORY: &str = "deng-xiangjie/perfboard";
const GITEE_INDEX: &str = "https://gitee.com/deng-xiangjie/perfboard/raw/gitee-updates";

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateSource {
    #[default]
    Github,
    Gitee,
}

pub(super) fn loopback(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && matches!(
            url.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
        )
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

impl UpdateSource {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Github => "GitHub",
            Self::Gitee => "Gitee",
        }
    }

    pub(super) fn latest(self) -> AppResult<Url> {
        let endpoint = match self {
            Self::Github => "https://github.com/dengxiangjie12138/perfboard/releases/latest/download/latest.json".to_string(),
            Self::Gitee => format!("{GITEE_INDEX}/latest.json"),
        };
        self.endpoint(endpoint, "UPDATE_ENDPOINT")
    }

    pub(super) fn index(self) -> AppResult<Url> {
        self.endpoint(format!("{GITEE_INDEX}/versions.json"), "INDEX_ENDPOINT")
    }

    pub(super) fn manifest(self, tag: &str) -> AppResult<Url> {
        super::catalog::stable_tag(tag)?;
        let mut endpoint = self.index()?;
        endpoint.set_path(&format!(
            "{}/releases/{tag}.json",
            endpoint.path().trim_end_matches("/versions.json")
        ));
        Ok(endpoint)
    }

    fn endpoint(self, value: String, suffix: &str) -> AppResult<Url> {
        #[cfg(debug_assertions)]
        {
            let key = match self {
                Self::Github => format!("PERFBOARD_TEST_{suffix}"),
                Self::Gitee => format!("PERFBOARD_TEST_GITEE_{suffix}"),
            };
            if let Ok(value) = std::env::var(key) {
                let url = Url::parse(&value).map_err(|_| "隔离测试更新地址无效")?;
                if !loopback(&url) || url.query().is_some() {
                    return Err("隔离测试更新地址必须使用无查询参数的本机地址".into());
                }
                return Ok(url);
            }
        }
        #[cfg(not(debug_assertions))]
        let _ = suffix;
        Url::parse(&value).map_err(|_| "更新地址无效".into())
    }

    pub(super) fn page(self, tag: &str) -> AppResult<String> {
        super::catalog::stable_tag(tag)?;
        Ok(match self {
            Self::Github => format!("https://github.com/{GITHUB_REPOSITORY}/releases/tag/{tag}"),
            Self::Gitee => format!("https://gitee.com/{GITEE_REPOSITORY}/releases/tag/{tag}"),
        })
    }

    // Only stable project URLs may enter the updater. Short-lived CDN locations
    // are followed by the HTTP policy, never cached as installation authority.
    pub(super) fn installer(self, tag: &str, version: &str, value: &str) -> AppResult<()> {
        let parsed = super::catalog::stable_tag(tag)?;
        if parsed.to_string() != version {
            return Err("更新清单版本与所选版本不符".into());
        }
        let url = Url::parse(value).map_err(|_| "更新安装包地址无效")?;
        #[cfg(debug_assertions)]
        if loopback(&url) {
            return Ok(());
        }
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("更新安装包必须使用本项目的公开 HTTPS 地址".into());
        }
        let filename = format!("Perfboard_{version}_x64-setup.exe");
        let valid = match self {
            Self::Github => {
                value
                    == format!(
                        "https://github.com/{GITHUB_REPOSITORY}/releases/download/{tag}/{filename}"
                    )
            }
            Self::Gitee => {
                let prefix = format!("/{GITEE_REPOSITORY}/attach_files/");
                let suffix = format!("/download/{filename}");
                let attachment = url
                    .path()
                    .strip_prefix(&prefix)
                    .and_then(|path| path.strip_suffix(&suffix))
                    .is_some_and(|id| {
                        !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit())
                    });
                url.host_str() == Some("gitee.com")
                    && (attachment
                        || url.path()
                            == format!("/{GITEE_REPOSITORY}/releases/download/{tag}/{filename}"))
            }
        };
        if valid {
            Ok(())
        } else {
            Err("更新安装包地址不属于所选来源的本项目，已取消下载".into())
        }
    }

    fn permits_redirect(self, url: &Url) -> bool {
        #[cfg(debug_assertions)]
        if loopback(url) {
            return true;
        }
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
            || url.fragment().is_some()
        {
            return false;
        }
        match self {
            Self::Github => matches!(
                url.host_str(),
                Some(
                    "github.com"
                        | "objects.githubusercontent.com"
                        | "release-assets.githubusercontent.com"
                        | "github-releases.githubusercontent.com"
                )
            ),
            Self::Gitee => matches!(
                url.host_str(),
                Some("gitee.com" | "raw.giteeusercontent.com" | "foruda.gitee.com")
            ),
        }
    }

    pub(super) fn redirects(self) -> reqwest::redirect::Policy {
        reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 8 || !self.permits_redirect(attempt.url()) {
                attempt.error("更新来源跳转到未经允许的地址")
            } else {
                attempt.follow()
            }
        })
    }

    pub(super) fn configure_client(
        self,
        client: reqwest::ClientBuilder,
        timeout: Duration,
    ) -> reqwest::ClientBuilder {
        // The updater plugin does not currently copy UpdaterBuilder.timeout to
        // Update.timeout. Configure both manifest and package HTTP clients here.
        client.timeout(timeout).redirect(self.redirects())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_this_project_and_stable_asset_names_are_allowed() {
        let source = UpdateSource::Gitee;
        for url in [
            "https://gitee.com/deng-xiangjie/perfboard/attach_files/3534686/download/Perfboard_0.1.2_x64-setup.exe",
            "https://gitee.com/deng-xiangjie/perfboard/releases/download/v0.1.2/Perfboard_0.1.2_x64-setup.exe",
        ] { assert!(source.installer("v0.1.2", "0.1.2", url).is_ok()); }
        for url in [
            "https://gitee.com/other/perfboard/attach_files/1/download/Perfboard_0.1.2_x64-setup.exe",
            "https://gitee.com/deng-xiangjie/perfboard/attach_files/abc/download/Perfboard_0.1.2_x64-setup.exe",
            "https://gitee.com/deng-xiangjie/perfboard/attach_files/1/download/Perfboard_0.1.1_x64-setup.exe",
            "https://gitee.com/deng-xiangjie/perfboard/releases/download/v0.1.2/Perfboard_0.1.2_x64-setup.exe?token=x",
            "https://foruda.gitee.com/temporary.exe",
            "https://user@gitee.com/deng-xiangjie/perfboard/releases/download/v0.1.2/Perfboard_0.1.2_x64-setup.exe",
            "http://gitee.com/deng-xiangjie/perfboard/releases/download/v0.1.2/Perfboard_0.1.2_x64-setup.exe",
        ] { assert!(source.installer("v0.1.2", "0.1.2", url).is_err(), "{url}"); }
        assert!(source
            .installer("v0.1.1", "0.1.2", "https://gitee.com/any")
            .is_err());
        assert!(UpdateSource::Github.installer("v0.1.2", "0.1.2", "https://github.com/dengxiangjie12138/perfboard/releases/download/v0.1.2/Perfboard_0.1.2_x64-setup.exe").is_ok());
    }

    #[test]
    fn redirects_are_https_and_provider_scoped() {
        for url in [
            "https://foruda.gitee.com/asset?token=transient",
            "https://raw.giteeusercontent.com/path?token=transient",
        ] {
            assert!(UpdateSource::Gitee.permits_redirect(&Url::parse(url).unwrap()));
        }
        for url in [
            "https://gitee.com.attacker.example/asset",
            "http://foruda.gitee.com/asset",
            "https://user:secret@foruda.gitee.com/asset",
            "https://github.com/asset",
            "https://foruda.gitee.com:444/asset",
        ] {
            assert!(!UpdateSource::Gitee.permits_redirect(&Url::parse(url).unwrap()));
        }
        assert!(!UpdateSource::Github
            .permits_redirect(&Url::parse("https://foruda.gitee.com/asset").unwrap()));
    }

    #[test]
    fn package_http_client_has_a_total_request_timeout() {
        use std::io::{Read, Write};
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            stream.read(&mut request).unwrap();
            std::thread::sleep(Duration::from_millis(400));
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
        });
        let client = UpdateSource::Gitee
            .configure_client(
                reqwest::Client::builder().no_proxy(),
                Duration::from_millis(100),
            )
            .build()
            .unwrap();
        let error = tauri::async_runtime::block_on(async {
            client
                .get(format!("http://{address}/slow-package.exe"))
                .send()
                .await
        })
        .unwrap_err();
        assert!(error.is_timeout());
        server.join().unwrap();
    }
}
