#!/usr/bin/env bash
# Reference probe: record how GNU tee behaves for the cases the virtual
# implementation has to reproduce (issue #14).
set -u

workdir="$(mktemp -d)"
trap 'rm -rf "${workdir}"' EXIT
cd "${workdir}" || exit 1

echo "--- tee --version"
tee --version 2>/dev/null | head -1

echo "--- basic: stdout passthrough + file"
printf 'a\nb\n' | tee f1.txt | cat
echo "exit=$?"
echo "file: $(cat f1.txt)"

echo "--- no file operands: stdout only"
printf 'x\n' | tee
echo "exit=$?"

echo "--- append (-a)"
printf 'c\n' | tee -a f1.txt >/dev/null
echo "exit=$? file=$(tr '\n' ' ' < f1.txt)"

echo "--- truncate (default) on existing file"
printf 'new\n' | tee f1.txt >/dev/null
echo "exit=$? file=$(tr '\n' ' ' < f1.txt)"

echo "--- unwritable file only"
printf 'z\n' | tee /invalid/path/x.txt
echo "exit=$?"

echo "--- unwritable file plus writable file"
printf 'z\n' | tee /invalid/path/x.txt f2.txt >/dev/null
echo "exit=$? f2=$(cat f2.txt 2>/dev/null)"

echo "--- unknown option"
printf 'q\n' | tee --bogus f3.txt
echo "exit=$? f3-exists=$([ -e f3.txt ] && echo yes || echo no)"

echo "--- '-' operand is a file named '-'"
printf 'd\n' | tee - >/dev/null
echo "exit=$? dash-exists=$([ -e ./- ] && echo yes || echo no)"

echo "--- '--' end of options"
printf 'e\n' | tee -- -a >/dev/null
echo "exit=$? file-named-a-exists=$([ -e ./-a ] && echo yes || echo no)"

echo "--- empty input still creates/truncates the file"
printf '' | tee f4.txt >/dev/null
echo "exit=$? f4-exists=$([ -e f4.txt ] && echo yes || echo no) size=$(wc -c < f4.txt)"

echo "--- binary-ish input passthrough byte count"
head -c 1000 /dev/urandom | tee f5.txt | wc -c
echo "f5 size=$(wc -c < f5.txt)"

echo "--- clustered short options (-ai)"
printf 'g\n' | tee -ai f6.txt >/dev/null
printf 'h\n' | tee -ai f6.txt >/dev/null
echo "exit=$? f6=$(tr '\n' ' ' < f6.txt)"

echo "--- invalid short option"
printf 'q\n' | tee -x f7.txt
echo "exit=$? f7-exists=$([ -e f7.txt ] && echo yes || echo no)"

echo "--- directory as target"
mkdir -p adir
printf 'q\n' | tee adir >/dev/null
echo "exit=$?"

echo "--- same file twice"
printf 'dup\n' | tee f8.txt f8.txt >/dev/null
echo "exit=$? f8=$(tr '\n' ' ' < f8.txt) size=$(wc -c < f8.txt)"
