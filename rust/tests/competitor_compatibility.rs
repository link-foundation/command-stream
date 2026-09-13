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
    assert_eq!(COMPETITORS.len(), 10);
    assert_eq!(
        COMPETITORS
            .iter()
            .map(|item| item.source_files)
            .sum::<u32>(),
        81
    );
    assert_eq!(
        COMPETITORS
            .iter()
            .map(|item| item.registration_sites)
            .sum::<u32>(),
        485
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
    assert_eq!(MISSING_FEATURES.len(), 10);
    assert_eq!(EXCLUDED_TEST_CLASSES.len(), 5);
    for class in EXCLUDED_TEST_CLASSES {
        assert!(!class.id.is_empty());
        assert!(!class.reason.is_empty());
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
