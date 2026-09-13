#[path = "competitor_compatibility/behavior.rs"]
mod behavior;
#[path = "competitor_compatibility/corpus.rs"]
mod corpus;
#[path = "competitor_compatibility/support.rs"]
mod support;

use behavior::BEHAVIOR_CASE_IDS;
use corpus::{
    pinned_source_url, COMPETITORS, EXCLUDED_TEST_CLASSES, MISSING_FEATURES, PORTED_CASES,
    SNAPSHOT_DATE,
};
use std::collections::HashSet;

#[test]
fn inventory_is_unique_and_pinned_to_immutable_commits() {
    assert_eq!(SNAPSHOT_DATE.len(), 10);
    assert_eq!(COMPETITORS.len(), 14);
    assert_eq!(
        COMPETITORS
            .iter()
            .map(|item| item.source_files)
            .sum::<u32>(),
        99
    );
    assert_eq!(
        COMPETITORS
            .iter()
            .map(|item| item.registration_sites)
            .sum::<u32>(),
        731
    );

    let mut ids = HashSet::new();
    for competitor in COMPETITORS {
        assert!(ids.insert(competitor.id), "duplicate id: {}", competitor.id);
        assert_eq!(competitor.commit.len(), 40);
        assert!(competitor
            .commit
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit()));
        assert!(competitor.repository.contains('/'));
        assert!(!competitor.project.is_empty());
        assert!(!competitor.license.is_empty());
        assert!(competitor.stars >= 100 || competitor.id == "rust-std-process");
        assert!(competitor.source_files > 0);
        assert!(competitor.registration_sites > 0);
        assert!(!competitor.scope.is_empty());
        assert!(pinned_source_url(competitor, competitor.scope[0]).contains(competitor.commit));
    }
}

#[test]
fn every_pinned_upstream_unit_has_exactly_one_disposition() {
    let records = include_str!("competitor_dispositions.jsonl")
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("valid JSONL record"))
        .collect::<Vec<_>>();
    let metadata = records.first().expect("manifest metadata");
    assert_eq!(records.len(), 785);
    assert_eq!(metadata["record"], "manifest");
    assert_eq!(metadata["schemaVersion"], 1);
    assert_eq!(metadata["snapshotDate"], SNAPSHOT_DATE);
    assert_eq!(metadata["language"], "rust");

    let known = COMPETITORS
        .iter()
        .map(|competitor| (competitor.id, competitor))
        .collect::<std::collections::HashMap<_, _>>();
    let dispositions = PORTED_CASES
        .iter()
        .map(|entry| format!("ported:{}", entry.id))
        .chain(
            MISSING_FEATURES
                .iter()
                .map(|entry| format!("missing:{}", entry.id)),
        )
        .chain(
            EXCLUDED_TEST_CLASSES
                .iter()
                .map(|entry| format!("inapplicable:{}", entry.id)),
        )
        .collect::<HashSet<_>>();
    let sources = records
        .iter()
        .filter(|record| record["record"] == "source")
        .collect::<Vec<_>>();
    assert_eq!(sources.len(), COMPETITORS.len());
    for source in sources {
        let id = source["id"].as_str().expect("source id");
        let competitor = known.get(id).expect("known source");
        assert_eq!(source["repository"], competitor.repository);
        assert_eq!(source["commit"], competitor.commit);
        assert_eq!(source["sourceFiles"], competitor.source_files);
        assert_eq!(source["registrationSites"], competitor.registration_sites);
        let source_units = records
            .iter()
            .filter(|record| record["record"] == "unit")
            .filter(|unit| unit["source"] == id)
            .collect::<Vec<_>>();
        assert_eq!(
            source_units
                .iter()
                .map(|unit| unit["path"].as_str().expect("unit path"))
                .collect::<HashSet<_>>()
                .len(),
            competitor.source_files as usize
        );
        assert_eq!(
            source_units
                .iter()
                .filter(|unit| unit["unit"] == "registration")
                .count(),
            competitor.registration_sites as usize
        );
    }

    let units = records
        .iter()
        .filter(|record| record["record"] == "unit")
        .collect::<Vec<_>>();
    assert_eq!(units.len(), 770);
    let mut unit_ids = HashSet::new();
    for unit in &units {
        let id = unit["id"].as_str().expect("unit id");
        assert!(unit_ids.insert(id), "duplicate unit: {id}");
        let source = unit["source"].as_str().expect("unit source");
        let competitor = known.get(source).expect("known unit source");
        let path = unit["path"].as_str().expect("unit path");
        let line = unit["line"].as_u64().expect("unit line");
        let column = unit["column"].as_u64().expect("unit column");
        let unit_kind = unit["unit"].as_str().expect("unit kind");
        assert_eq!(
            id,
            format!("{source}:{path}:{line}:{column}:{unit_kind}"),
            "unstable unit id"
        );
        assert_eq!(
            unit["disposition"]
                .as_object()
                .expect("disposition object")
                .len(),
            2,
            "each unit must have exactly one disposition"
        );
        let disposition = format!(
            "{}:{}",
            unit["disposition"]["kind"]
                .as_str()
                .expect("disposition kind"),
            unit["disposition"]["id"].as_str().expect("disposition id")
        );
        assert!(
            dispositions.contains(&disposition),
            "unknown disposition: {disposition}"
        );
        assert_eq!(
            unit["url"],
            format!("{}#L{line}", pinned_source_url(competitor, path))
        );
    }
}

#[test]
fn every_selected_project_and_case_is_accounted_for() {
    let known = COMPETITORS
        .iter()
        .map(|competitor| competitor.id)
        .collect::<HashSet<_>>();
    let mut referenced = HashSet::new();
    let mut case_ids = HashSet::new();

    for entry in PORTED_CASES.iter().chain(MISSING_FEATURES) {
        assert!(case_ids.insert(entry.id), "duplicate case: {}", entry.id);
        assert!(!entry.competitors.is_empty(), "unowned case: {}", entry.id);
        assert!(!entry.upstream.is_empty(), "untraced case: {}", entry.id);
        for competitor in entry.competitors {
            assert!(
                known.contains(competitor),
                "unknown competitor: {competitor}"
            );
            referenced.insert(*competitor);
        }
    }

    assert_eq!(referenced, known);
    assert_eq!(PORTED_CASES.len(), 18);
    assert_eq!(
        PORTED_CASES
            .iter()
            .map(|entry| entry.id)
            .collect::<HashSet<_>>(),
        BEHAVIOR_CASE_IDS.iter().copied().collect::<HashSet<_>>()
    );
    assert_eq!(MISSING_FEATURES.len(), 12);
    assert_eq!(EXCLUDED_TEST_CLASSES.len(), 5);
    for class in EXCLUDED_TEST_CLASSES {
        assert!(!class.id.is_empty());
        assert!(!class.reason.is_empty());
    }
}

#[test]
fn exact_discovery_inputs_and_every_candidate_disposition_are_committed() {
    let discovery: serde_json::Value =
        serde_json::from_str(include_str!("../../docs/COMPETITOR_DISCOVERY.json"))
            .expect("valid discovery snapshot");
    assert_eq!(discovery["snapshotDate"], SNAPSHOT_DATE);
    assert_eq!(discovery["queries"].as_array().expect("queries").len(), 6);

    let candidates = discovery["candidates"].as_array().expect("candidates");
    assert_eq!(
        candidates
            .iter()
            .map(|candidate| format!(
                "{}:{}",
                candidate["language"].as_str().expect("language"),
                candidate["repository"].as_str().expect("repository")
            ))
            .collect::<HashSet<_>>()
            .len(),
        candidates.len()
    );
    let included = candidates
        .iter()
        .filter(|candidate| candidate["language"] == "rust")
        .filter_map(|candidate| {
            let status = candidate["status"].as_str().expect("candidate status");
            assert!(status == "included" || status == "excluded");
            if status == "excluded" {
                assert!(!candidate["reason"]
                    .as_str()
                    .expect("rejection reason")
                    .is_empty());
                None
            } else {
                Some(candidate["repository"].as_str().expect("repository"))
            }
        })
        .collect::<HashSet<_>>();
    assert_eq!(
        included,
        COMPETITORS
            .iter()
            .map(|competitor| competitor.repository)
            .collect::<HashSet<_>>()
    );
    for competitor in COMPETITORS {
        let candidate = candidates
            .iter()
            .find(|candidate| candidate["repository"] == competitor.repository)
            .expect("selected project in discovery snapshot");
        assert_eq!(candidate["stars"], competitor.stars);
    }
}

#[test]
fn human_audit_matches_the_machine_readable_ledger() {
    let audit = include_str!("../docs/COMPETITOR_TEST_AUDIT.md");

    for competitor in COMPETITORS {
        assert!(
            audit.contains(competitor.commit),
            "audit is missing pinned commit for {}",
            competitor.id
        );
    }
    for feature in MISSING_FEATURES {
        assert!(
            audit.contains(&format!("### {}", feature.id)),
            "audit is missing feature heading for {}",
            feature.id
        );
    }
}
