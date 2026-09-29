use crate::model::Report;
use crate::BenchmarkResult;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub struct ReportPaths {
    pub json: PathBuf,
    pub html: PathBuf,
}

pub fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub fn write_reports(report: &Report, output_directory: &Path) -> BenchmarkResult<ReportPaths> {
    fs::create_dir_all(output_directory)?;
    let json = output_directory.join("benchmark-results.json");
    let html = output_directory.join("benchmark-report.html");
    fs::write(
        &json,
        format!("{}\n", serde_json::to_string_pretty(report)?),
    )?;
    fs::write(&html, html_report(report))?;
    Ok(ReportPaths { json, html })
}

fn html_report(report: &Report) -> String {
    let sections = report
        .suites
        .iter()
        .map(render_suite)
        .collect::<Vec<_>>()
        .join("");
    format!(
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>command-stream Rust benchmark report</title>\n<style>body{{font:15px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#172033}}h1,h2{{color:#0d4a6b}}section{{margin:2rem 0}}details{{margin:1rem 0}}summary{{font-weight:700;cursor:pointer}}table{{border-collapse:collapse;width:100%;margin:.8rem 0}}th,td{{text-align:left;padding:.55rem;border-bottom:1px solid #d8dee8}}.bar{{display:block;background:#28a3d7;height:.8rem;max-width:100%}}.meta{{color:#52606d}}</style></head>\n<body><h1>command-stream Rust benchmark report</h1><p class=\"meta\">Generated {} with {} on {} {}. Lower latency is better.</p>{sections}</body></html>",
        escape_html(&report.generated_at),
        escape_html(&report.environment.runtime),
        escape_html(&report.environment.platform),
        escape_html(&report.environment.arch),
    )
}

fn render_suite(suite: &Value) -> String {
    let name = string(suite, "name");
    let body = match string(suite, "kind").as_str() {
        "performance" | "real-world" => performance_section(suite),
        "features" => feature_section(suite),
        "crate-size" => size_section(suite),
        _ => format!("<pre>{}</pre>", escape_html(&suite.to_string())),
    };
    format!("<section><h2>{}</h2>{body}</section>", escape_html(&name))
}

fn performance_section(suite: &Value) -> String {
    suite["scenarios"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|scenario| {
            let rows = scenario["ranking"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|entry| {
                    let median = number(&entry["medianMs"], 2);
                    let relative = number(&entry["relativeToFastest"], 2);
                    let width = entry["relativeToFastest"]
                        .as_f64()
                        .map_or(2.0, |value| (100.0 / value).max(2.0));
                    format!(
                        "<tr><td>{}</td><td>{median} ms</td><td>{relative}x</td><td><span class=\"bar\" style=\"width:{width:.2}%\"></span></td></tr>",
                        escape_html(&string(entry, "name"))
                    )
                })
                .collect::<String>();
            format!(
                "<details open><summary>{}</summary><table><thead><tr><th>API</th><th>Median</th><th>vs fastest</th><th>Relative speed</th></tr></thead><tbody>{rows}</tbody></table></details>",
                escape_html(&string(scenario, "name"))
            )
        })
        .collect()
}

fn feature_section(suite: &Value) -> String {
    let rows = suite["competitors"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|entry| {
            format!(
                "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}%</td></tr>",
                escape_html(&string(entry, "name")),
                entry["supported"],
                entry["gaps"],
                number(&entry["coveragePercent"], 1)
            )
        })
        .collect::<String>();
    format!("<table><thead><tr><th>Upstream corpus</th><th>Ported behaviors</th><th>Known gaps</th><th>Coverage</th></tr></thead><tbody>{rows}</tbody></table>")
}

fn size_section(suite: &Value) -> String {
    let rows = suite["crates"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|entry| {
            format!(
                "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
                escape_html(&string(entry, "name")),
                escape_html(&string(entry, "version")),
                entry["sourceBytes"],
                entry["dependencyClosureBytes"]
            )
        })
        .collect::<String>();
    format!("<table><thead><tr><th>Crate/API</th><th>Version</th><th>Source bytes</th><th>Dependency closure bytes</th></tr></thead><tbody>{rows}</tbody></table>")
}

fn string(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().to_string()
}

fn number(value: &Value, digits: usize) -> String {
    value
        .as_f64()
        .map_or_else(|| "n/a".to_string(), |number| format!("{number:.digits$}"))
}
