//! The directory walker (Bun's `src/glob/GlobWalker.rs`).

use super::*;

/// Options of [`walk`] (Bun's `ScanOpts`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WalkOptions {
    /// Directory to walk from; `""` means the process's current directory.
    /// A relative `cwd` is normalised (and made absolute when `absolute`).
    pub(crate) cwd: String,
    /// Let wildcards match names starting with `.` (default `false`).
    pub(crate) dot: bool,
    /// Return absolute paths (default `false`).
    pub(crate) absolute: bool,
    /// Descend into symlinked directories (default `false`).
    pub(crate) follow_symlinks: bool,
    /// Fail on broken symlinks while following (`throwErrorOnBrokenSymlink`).
    pub(crate) error_on_broken_symlinks: bool,
    /// Only return files, not directories or links (default `true`).
    pub(crate) only_files: bool,
}

impl Default for WalkOptions {
    fn default() -> Self {
        Self {
            cwd: String::new(),
            dot: false,
            absolute: false,
            follow_symlinks: false,
            error_on_broken_symlinks: false,
            only_files: true,
        }
    }
}

/// An open directory. The first entry is read eagerly because Bun's glob
/// walker reports read errors (e.g. `EACCES`) from `open`.
struct DirHandle {
    rd: fs::ReadDir,
    peeked: Option<Option<fs::DirEntry>>,
}

impl DirHandle {
    fn open(os_path: &str) -> io::Result<Self> {
        let mut rd = fs::read_dir(os_path)?;
        let first = rd.next().transpose()?;
        Ok(Self {
            rd,
            peeked: Some(first),
        })
    }

    fn next_entry(&mut self) -> io::Result<Option<fs::DirEntry>> {
        if let Some(peeked) = self.peeked.take() {
            if peeked.is_none() {
                self.peeked = Some(None);
            }
            return Ok(peeked);
        }
        self.rd.next().transpose()
    }
}

/// Identity of a directory, to detect symlink cycles.
#[cfg(unix)]
type FileId = (u64, u64);
#[cfg(not(unix))]
type FileId = std::path::PathBuf;

#[cfg(unix)]
fn stat_target(os_path: &str) -> Option<FileId> {
    use std::os::unix::fs::MetadataExt;
    let st = fs::metadata(os_path).ok()?;
    Some((st.dev(), st.ino()))
}

#[cfg(not(unix))]
fn stat_target(os_path: &str) -> Option<FileId> {
    fs::canonicalize(os_path).ok()
}

enum FollowedLink {
    /// The first followed link: stat'ed lazily, only when a nested link is
    /// followed.
    Pending(String),
    Resolved(FileId),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ItemKind {
    Directory,
    Symlink,
}

struct WorkItem {
    path: String,
    active: Vec<usize>,
    kind: ItemKind,
    /// Byte offset of the entry name in `path` (symlinks).
    entry_start: usize,
    /// A directory already opened while resolving a symlink.
    dir: Option<(DirHandle, String)>,
    followed_len: usize,
    followed_link: Option<FollowedLink>,
}

impl WorkItem {
    fn new(path: String, active: Vec<usize>, kind: ItemKind) -> Self {
        Self {
            path,
            active,
            kind,
            entry_start: 0,
            dir: None,
            followed_len: 0,
            followed_link: None,
        }
    }
}

/// A directory being iterated.
struct DirIter {
    dir: DirHandle,
    dir_path: String,
    active: Vec<usize>,
}

struct EvalDirResult {
    add: bool,
    child: Vec<usize>,
}

struct Walker<'p> {
    cwd: String,
    dot: bool,
    absolute: bool,
    follow_symlinks: bool,
    error_on_broken_symlinks: bool,
    only_files: bool,
    pattern: &'p str,
    comps: Vec<Component>,
    end_byte: usize,
    base_idx: usize,
    root_os: String,
    root_dir: Option<DirHandle>,
    matched: Vec<String>,
    matched_set: HashSet<String>,
    work: Vec<WorkItem>,
    followed: Vec<FollowedLink>,
}

impl Walker<'_> {
    fn join_path(&self, dir: &str, name: &str) -> String {
        if self.absolute {
            posix_join(&[dir, name])
        } else {
            join_sep(dir, name)
        }
    }

    fn to_os_path(&self, p: &str) -> String {
        if is_absolute(p) {
            return p.to_string();
        }
        if p.is_empty() {
            return self.root_os.clone();
        }
        if self.root_os.ends_with('/') {
            format!("{}{p}", self.root_os)
        } else {
            format!("{}/{p}", self.root_os)
        }
    }

    fn add_match(&mut self, p: String) {
        if self.matched_set.insert(p.clone()) {
            self.matched.push(p);
        }
    }

    fn match_pattern_impl(&self, comp: &Component, name: &str) -> bool {
        if !self.dot && name.starts_with('.') && !comp.slice.starts_with('.') {
            return false;
        }
        match comp.hint {
            Hint::Double | Hint::Single => true,
            Hint::WildcardFilepath => name.ends_with(&comp.slice[1..]),
            Hint::Literal => name == comp.slice,
            _ => match_bytes(comp.slice.as_bytes(), name.as_bytes()).matches,
        }
    }

    /// `match_pattern_dir`: the index bump, or `None` for "don't recurse".
    fn match_pattern_dir(
        &self,
        idx: usize,
        name: &str,
        hidden: bool,
        res: &mut EvalDirResult,
    ) -> Option<usize> {
        let comps = &self.comps;
        let is_last = idx == comps.len() - 1;
        if comps[idx].hint == Hint::Double {
            if !is_last && self.match_pattern_impl(&comps[idx + 1], name) {
                if idx + 1 == comps.len() - 1 {
                    res.add = true;
                    return if hidden { None } else { Some(0) };
                }
                return Some(2);
            }
            if hidden {
                return None;
            }
            if is_last {
                res.add = true;
            }
            return Some(0);
        }
        if self.match_pattern_impl(&comps[idx], name) {
            if is_last {
                res.add = true;
                return None;
            }
            return Some(1);
        }
        None
    }

    fn match_pattern_file(&self, idx: usize, name: &str) -> bool {
        let comps = &self.comps;
        let comp = &comps[idx];
        if comp.trailing_sep {
            return false;
        }
        if idx != comps.len() - 1 {
            return comp.hint == Hint::Double
                && idx + 1 == comps.len() - 1
                && comps[idx + 1].hint != Hint::Double
                && self.match_pattern_impl(&comps[idx + 1], name);
        }
        self.match_pattern_impl(comp, name)
    }

    fn normalize_idx(&self, idx: usize) -> usize {
        let mut i = idx;
        if i < self.comps.len() && self.comps[i].hint == Hint::Double {
            while i + 1 < self.comps.len() && self.comps[i + 1].hint == Hint::Double {
                i += 1;
            }
        }
        i
    }

    fn eval_dir(&self, active: &[usize], name: &str) -> EvalDirResult {
        let mut res = EvalDirResult {
            add: false,
            child: Vec::new(),
        };
        let hidden = !self.dot && name.starts_with('.');
        let mut picked = Vec::new();
        for &idx in active {
            let Some(bump) = self.match_pattern_dir(idx, name, hidden, &mut res) else {
                continue;
            };
            picked.push(self.normalize_idx(idx + bump));
            if bump == 2 && !hidden && self.comps[idx + 2].hint != Hint::Double {
                picked.push(idx);
            }
        }
        picked.sort_unstable();
        picked.dedup();
        res.child = picked;
        res
    }

    fn eval_file(&self, active: &[usize], name: &str) -> bool {
        active.iter().any(|&idx| self.match_pattern_file(idx, name))
    }

    fn eval_impl(&self, active: &[usize], name: &str) -> bool {
        let comps = &self.comps;
        active.iter().any(|&idx| {
            self.match_pattern_impl(&comps[idx], name)
                || (comps[idx].hint == Hint::Double
                    && idx + 1 < comps.len()
                    && self.match_pattern_impl(&comps[idx + 1], name))
        })
    }

    fn eval_literal_subset(&self, active: &[usize], name: &str) -> Vec<usize> {
        active
            .iter()
            .copied()
            .filter(|&idx| {
                self.comps[idx].hint == Hint::Literal
                    && self.match_pattern_impl(&self.comps[idx], name)
            })
            .collect()
    }

    /// `skip_special_components`: appends `.`/`..` to `dir_path` and
    /// collapses `**`. Returns `(idx, dir_path, had_dot_dot)`.
    fn skip_special_components(
        &self,
        idx: usize,
        dir_path: String,
    ) -> Result<(usize, String, bool), GlobError> {
        let mut i = idx;
        let mut p = dir_path;
        let mut had_dot_dot = false;
        while i < self.comps.len() {
            let hint = self.comps[i].hint;
            if hint != Hint::Dot && hint != Hint::DotBack {
                break;
            }
            let (extra, seg) = if hint == Hint::Dot {
                (2, ".")
            } else {
                (3, "..")
            };
            if p.len() + extra >= MAX_PATH_BYTES {
                return Err(GlobError::sys("ENAMETOOLONG", "open", &p));
            }
            had_dot_dot = had_dot_dot || hint == Hint::DotBack;
            if p.is_empty() {
                p = seg.to_string();
            } else {
                p.push('/');
                p.push_str(seg);
            }
            i += 1;
        }
        Ok((self.normalize_idx(i), p, had_dot_dot))
    }

    fn push_work_item(&mut self, mut item: WorkItem, followed_link: Option<FollowedLink>) {
        item.followed_len = self.followed.len();
        item.followed_link = followed_link;
        self.work.push(item);
    }

    /// Literal-tail optimization of `transition_to_dir_iter_state`.
    fn stat_literal_tail(
        &mut self,
        fd_os: &str,
        dir_path: &str,
        comp_idx: usize,
    ) -> Result<(), GlobError> {
        let slice = self.comps[comp_idx].slice.clone();
        if slice.is_empty() {
            // fstatat(fd, "") fails with ENOENT, which Bun skips.
            return Ok(());
        }
        let st = match fs::metadata(format!("{fd_os}/{slice}")) {
            Ok(st) => st,
            Err(e) => {
                let err = rethrow(&e, "fstatat", &slice);
                if err.is("ENOENT") {
                    return Ok(());
                }
                return Err(err);
            }
        };
        if st.is_file() || !self.only_files {
            let p = self.join_path(dir_path, &slice);
            self.add_match(p);
        }
        Ok(())
    }

    /// `transition_to_dir_iter_state`: a directory to iterate, or `None`.
    fn transition(&mut self, item: WorkItem, root: bool) -> Result<Option<DirIter>, GlobError> {
        let mut dir_path = String::new();
        if !(root && !self.absolute) {
            if item.path.len() >= MAX_PATH_BYTES {
                return Err(GlobError::sys("ENAMETOOLONG", "open", &item.path));
            }
            dir_path = item.path.clone();
        }
        let mut active = item.active;
        let mut had_dot_dot = false;
        if active.len() == 1 {
            let (idx, p, dd) = self.skip_special_components(active[0], dir_path)?;
            if idx >= self.comps.len() {
                return Ok(None);
            }
            dir_path = p;
            had_dot_dot = dd;
            active = vec![idx];
        }
        let (dir, fd_os) = match item.dir {
            Some(opened) => opened,
            None => {
                let root_dir = if root && !had_dot_dot {
                    self.root_dir.take()
                } else {
                    None
                };
                match root_dir {
                    Some(d) => (d, self.root_os.clone()),
                    None => {
                        let fd_os = self.to_os_path(&dir_path);
                        let d =
                            DirHandle::open(&fd_os).map_err(|e| rethrow(&e, "open", &dir_path))?;
                        (d, fd_os)
                    }
                }
            }
        };
        let last_idx = self.comps.len() - 1;
        if active.len() == 1 && active[0] == last_idx && self.comps[last_idx].hint == Hint::Literal
        {
            drop(dir);
            self.stat_literal_tail(&fd_os, &dir_path, last_idx)?;
            return Ok(None);
        }
        Ok(Some(DirIter {
            dir,
            dir_path,
            active,
        }))
    }

    fn follow_active_for(
        &self,
        active: &[usize],
        name: &str,
        prefiltered: bool,
    ) -> Option<Vec<usize>> {
        if self.follow_symlinks {
            return (prefiltered || self.eval_impl(active, name)).then(|| active.to_vec());
        }
        let subset = self.eval_literal_subset(active, name);
        (!subset.is_empty()).then_some(subset)
    }

    fn handle_dir_entry(&mut self, d: &DirIter, name: &str) {
        let EvalDirResult { add, child } = self.eval_dir(&d.active, name);
        if !child.is_empty() {
            let path = self.join_path(&d.dir_path, name);
            self.push_work_item(WorkItem::new(path, child, ItemKind::Directory), None);
        }
        if add && !self.only_files {
            let p = self.join_path(&d.dir_path, name);
            self.add_match(p);
        }
    }

    fn handle_symlink_entry(&mut self, d: &DirIter, name: &str, prefiltered: bool) {
        if let Some(follow) = self.follow_active_for(&d.active, name, prefiltered) {
            let p = self.join_path(&d.dir_path, name);
            let entry_start = p.len().saturating_sub(name.len());
            let mut item = WorkItem::new(p, follow, ItemKind::Symlink);
            item.entry_start = entry_start;
            self.push_work_item(item, None);
            return;
        }
        if !self.only_files && self.eval_file(&d.active, name) {
            let p = self.join_path(&d.dir_path, name);
            self.add_match(p);
        }
    }

    fn handle_file_entry(&mut self, d: &DirIter, name: &str) {
        if self.eval_file(&d.active, name) {
            let p = self.join_path(&d.dir_path, name);
            self.add_match(p);
        }
    }

    /// Dispatches one directory entry on its type. `DirEntry::file_type`
    /// falls back to `lstat` when the OS does not report a type, which is
    /// equivalent to the JS port's `handleUnknownEntry` (every handler only
    /// acts when `eval_impl` holds).
    fn process_entry(&mut self, d: &DirIter, ent: &fs::DirEntry) {
        let name = ent.file_name().to_string_lossy().into_owned();
        let Ok(ft) = ent.file_type() else {
            return;
        };
        if ft.is_file() {
            self.handle_file_entry(d, &name);
        } else if ft.is_dir() {
            self.handle_dir_entry(d, &name);
        } else if ft.is_symlink() {
            self.handle_symlink_entry(d, &name, false);
        }
    }

    fn iterate_dir(&mut self, mut d: DirIter) -> Result<(), GlobError> {
        loop {
            let ent = d
                .dir
                .next_entry()
                .map_err(|e| rethrow(&e, "getdents64", &d.dir_path))?;
            let Some(ent) = ent else {
                return Ok(());
            };
            self.process_entry(&d, &ent);
        }
    }

    fn resolve_pending_followed_links(&mut self) {
        for i in 0..self.followed.len() {
            if let FollowedLink::Pending(p) = &self.followed[i] {
                if let Some(target) = stat_target(&self.to_os_path(p)) {
                    self.followed[i] = FollowedLink::Resolved(target);
                }
            }
        }
    }

    fn is_followed_link_cycle(&self, target: &FileId) -> bool {
        self.followed
            .iter()
            .any(|l| matches!(l, FollowedLink::Resolved(id) if id == target))
    }

    /// Decides whether to descend into a followed symlinked directory.
    fn followed_link_for(
        &mut self,
        full_path: &str,
        os_path: &str,
    ) -> (bool, Option<FollowedLink>) {
        if self.followed.is_empty() {
            return (true, Some(FollowedLink::Pending(full_path.to_string())));
        }
        let Some(target) = stat_target(os_path) else {
            return (true, None);
        };
        self.resolve_pending_followed_links();
        if self.is_followed_link_cycle(&target) {
            return (false, None);
        }
        (true, Some(FollowedLink::Resolved(target)))
    }

    fn open_symlink_target(
        &mut self,
        full_path: &str,
        active: &[usize],
        entry_name: &str,
    ) -> Result<Option<(DirHandle, String)>, GlobError> {
        let os_path = self.to_os_path(full_path);
        match DirHandle::open(&os_path) {
            Ok(dir) => Ok(Some((dir, os_path))),
            Err(e) => {
                if io_error_code(&e) == Some("ENOTDIR") {
                    if self.eval_file(active, entry_name) {
                        self.add_match(full_path.to_string());
                    }
                    return Ok(None);
                }
                if self.error_on_broken_symlinks {
                    return Err(rethrow(&e, "open", full_path));
                }
                if !self.only_files && self.eval_file(active, entry_name) {
                    self.add_match(full_path.to_string());
                }
                Ok(None)
            }
        }
    }

    /// The Symlink arm of `Iterator::next`.
    fn process_symlink_item(&mut self, item: WorkItem) -> Result<(), GlobError> {
        if item.path.len() >= MAX_PATH_BYTES {
            return Err(GlobError::sys("ENAMETOOLONG", "open", &item.path));
        }
        let mut full_path = item.path.clone();
        let mut active = item.active;
        if active.len() == 1 {
            let (idx, p, _) = self.skip_special_components(active[0], full_path)?;
            if idx >= self.comps.len() {
                return Ok(());
            }
            full_path = p;
            active = vec![idx];
        }
        let entry_name = full_path
            .get(item.entry_start..)
            .unwrap_or_default()
            .to_string();
        let Some((dir, os_path)) = self.open_symlink_target(&full_path, &active, &entry_name)?
        else {
            return Ok(());
        };
        let EvalDirResult { add, child } = self.eval_dir(&active, &entry_name);
        let (descend, link) = if child.is_empty() {
            (false, None)
        } else {
            self.followed_link_for(&full_path, &os_path)
        };
        if descend {
            let mut next = WorkItem::new(item.path, child, ItemKind::Directory);
            next.dir = Some((dir, os_path));
            self.push_work_item(next, link);
        }
        if add && !self.only_files {
            self.add_match(full_path);
        }
        Ok(())
    }

    /// `Iterator::init`: opens the root; returns the first directory.
    fn init_walk(&mut self) -> Result<Option<DirIter>, GlobError> {
        let mut root_path = self.cwd.clone();
        let mut start_idx = 0;
        let pattern_is_absolute = is_absolute(self.pattern);
        if pattern_is_absolute {
            root_path =
                String::from_utf8_lossy(&self.pattern.as_bytes()[..self.end_byte]).into_owned();
            start_idx = self.base_idx;
            if root_path.is_empty() {
                root_path = "/".to_string();
            } else {
                start_idx += 1;
                if start_idx >= self.comps.len() {
                    // A pattern without glob syntax: Bun only probes the
                    // path and does not add it to the results.
                    probe_literal_path(&root_path)?;
                    return Ok(None);
                }
            }
        }
        if root_path.len() >= MAX_PATH_BYTES {
            return Err(GlobError::sys("ENAMETOOLONG", "open", &root_path));
        }
        let dir = DirHandle::open(&root_path).map_err(|e| rethrow(&e, "open", &root_path))?;
        self.root_dir = Some(dir);
        self.root_os = root_path.clone();
        let root = WorkItem::new(root_path, vec![start_idx], ItemKind::Directory);
        self.transition(root, !pattern_is_absolute)
    }

    fn run(&mut self) -> Result<(), GlobError> {
        let mut dir = self.init_walk()?;
        loop {
            if let Some(d) = dir.take() {
                self.iterate_dir(d)?;
            }
            let Some(mut item) = self.work.pop() else {
                return Ok(());
            };
            self.followed.truncate(item.followed_len);
            if let Some(link) = item.followed_link.take() {
                self.followed.push(link);
            }
            match item.kind {
                ItemKind::Directory => dir = self.transition(item, false)?,
                ItemKind::Symlink => self.process_symlink_item(item)?,
            }
        }
    }
}

fn probe_literal_path(p: &str) -> Result<(), GlobError> {
    match DirHandle::open(p) {
        Ok(_) => Ok(()),
        Err(e) => {
            let err = rethrow(&e, "open", p);
            if err.is("ENOTDIR") || err.is("ENOENT") {
                Ok(())
            } else {
                Err(err)
            }
        }
    }
}

fn parse_cwd(cwd: &str, absolute: bool) -> Result<String, GlobError> {
    let too_long = || {
        GlobError::other(format!(
            "globWalkSync: invalid `cwd`, longer than {MAX_PATH_BYTES} bytes"
        ))
    };
    if cwd.len() > MAX_PATH_BYTES {
        return Err(too_long());
    }
    if is_absolute(cwd) {
        return Ok(cwd.to_string());
    }
    let result = if absolute {
        posix_join(&[&current_dir_string(), cwd])
    } else {
        posix_join(&[cwd])
    };
    if result.len() > MAX_PATH_BYTES {
        return Err(too_long());
    }
    Ok(result)
}

/// Walks the file system and returns the paths matching `pattern`, in the
/// same order and form as `new Bun.Glob(pattern).scanSync(options)` (and the
/// JS port's `globWalkSync`).
///
/// Relative patterns yield paths relative to `cwd` joined with `/`
/// (`./*` yields `./a`, `a/../*` yields `a/../b`, `*/` yields `a`); with
/// `absolute` they are `cwd`-joined and normalised. An absolute pattern walks
/// from its literal prefix and yields absolute paths. Symlinks are only
/// descended into when `follow_symlinks` is set (a literal component such as
/// `link/*` is always followed), with cycle detection. A pattern without
/// components (`""`) yields nothing.
///
/// Errors: an unopenable root (`cwd` or the literal prefix of an absolute
/// pattern) or subdirectory is reported as a [`GlobError`] with syscall
/// `open` (`ENOENT`, `ENOTDIR`, `EACCES`, ...); a failing literal last
/// component other than `ENOENT` (e.g. `ELOOP`) as `fstatat`; read errors
/// as `getdents64`. The shell ignores `ENOENT`/`ENOTDIR` and reports
/// "no matches found" itself.
pub(crate) fn walk(pattern: &str, options: &WalkOptions) -> Result<Vec<String>, GlobError> {
    let cwd = if options.cwd.is_empty() {
        String::new()
    } else {
        parse_cwd(&options.cwd, options.absolute)?
    };
    let PatternComponents {
        comps,
        end_byte,
        base_idx,
    } = build_pattern_components(pattern.as_bytes());
    if comps.is_empty() {
        return Ok(Vec::new());
    }
    let mut w = Walker {
        cwd: if cwd.is_empty() {
            current_dir_string()
        } else {
            cwd
        },
        dot: options.dot,
        absolute: options.absolute,
        follow_symlinks: options.follow_symlinks,
        error_on_broken_symlinks: options.error_on_broken_symlinks,
        only_files: options.only_files,
        pattern,
        comps,
        end_byte,
        base_idx,
        root_os: String::new(),
        root_dir: None,
        matched: Vec::new(),
        matched_set: HashSet::new(),
        work: Vec::new(),
        followed: Vec::new(),
    };
    w.run()?;
    Ok(w.matched)
}
