//! Registry-backed package discovery, with an injectable asynchronous transport.
use crate::CommandBuilder;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::future::Future;
use tokio::sync::watch;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct PackageMetadata {
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone)]
pub struct SearchOptions {
    pub registry: String,
    pub size: usize,
    /// Sending true aborts an outstanding request; dropping the sender does not.
    pub cancel: Option<watch::Receiver<bool>>,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            registry: "https://registry.npmjs.org".into(),
            size: 20,
            cancel: None,
        }
    }
}

pub struct Marketplace;

impl Marketplace {
    /// Query npm's real registry. Requires curl on PATH; never invokes a shell.
    /// The request future owns its child process, so cancellation stops curl.
    pub async fn search(
        query: &str,
        options: SearchOptions,
    ) -> Result<Vec<PackageMetadata>, String> {
        Self::search_with(query, options, |url| async move {
            let result = CommandBuilder::new("curl")
                .args([
                    "--fail-with-body",
                    "--silent",
                    "--show-error",
                    "--url",
                    &url,
                ])
                .run()
                .await
                .map_err(|error| error.to_string())?;
            if result.code != 0 {
                return Err(format!("Marketplace search failed: {}", result.stderr));
            }
            serde_json::from_str(&result.stdout).map_err(|error| error.to_string())
        })
        .await
    }

    /// Supply an HTTP transport returning decoded registry JSON for tests or
    /// applications using their own HTTP client. Transport errors propagate.
    pub async fn search_with<F, Fut>(
        query: &str,
        mut options: SearchOptions,
        request: F,
    ) -> Result<Vec<PackageMetadata>, String>
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = Result<Value, String>>,
    {
        let registry = options.registry.trim_end_matches('/');
        let authority = registry
            .strip_prefix("https://")
            .or_else(|| registry.strip_prefix("http://"))
            .ok_or("Marketplace registry must use HTTP or HTTPS")?;
        if authority.is_empty() || authority.contains(['/', '?', '#', '@']) {
            return Err("Marketplace registry must be an HTTP origin".into());
        }
        let text = encode(&format!("keywords:command-stream-command {query}"));
        let url = format!(
            "{registry}/-/v1/search?text={text}&size={}",
            options.size.clamp(1, 250)
        );
        let response = if let Some(cancel) = &mut options.cancel {
            if *cancel.borrow() {
                return Err("Marketplace search cancelled".into());
            }
            tokio::select! {
                response = request(url) => response?,
                () = cancelled(cancel) => return Err("Marketplace search cancelled".into()),
            }
        } else {
            request(url).await?
        };
        #[derive(Deserialize)]
        struct Entry {
            package: PackageMetadata,
        }
        #[derive(Deserialize)]
        struct Response {
            objects: Vec<Entry>,
        }
        let response: Response =
            serde_json::from_value(response).map_err(|error| error.to_string())?;
        Ok(response
            .objects
            .into_iter()
            .map(|entry| entry.package)
            .collect())
    }
}

async fn cancelled(receiver: &mut watch::Receiver<bool>) {
    while receiver.changed().await.is_ok() {
        if *receiver.borrow() {
            return;
        }
    }
    std::future::pending::<()>().await;
}

fn encode(value: &str) -> String {
    use std::fmt::Write;
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            write!(encoded, "%{byte:02X}").expect("writing to a string");
        }
    }
    encoded
}
