#!/usr/bin/env python3
"""Remove duplicate 'qmd' CLI subcommand registration from OpenClaw 2026.3.14 bundle.

Bug: register.subclis-*.js registers 'qmd' twice, causing 'cannot add command qmd'
error on any CLI invocation. This script removes the second (duplicate) entry.

Safe to run on builds without the bug (exits cleanly if only 1 entry found).
"""
import glob
import sys

# Find the register.subclis file
matches = glob.glob('/opt/openclaw/dist/register.subclis-*.js')
if not matches:
    print('patch-qmd: No register.subclis file found, skipping')
    sys.exit(0)

path = matches[0]
with open(path) as f:
    lines = f.readlines()

qmd_indices = [i for i, l in enumerate(lines) if 'name: "qmd"' in l]

if len(qmd_indices) < 2:
    print(f'patch-qmd: Only {len(qmd_indices)} qmd entry found, no patch needed')
    sys.exit(0)

if len(qmd_indices) > 2:
    print(f'patch-qmd: Found {len(qmd_indices)} qmd entries (unexpected), skipping')
    sys.exit(1)

# Find the opening { of the second qmd block
second = qmd_indices[1]
start = second - 1
while start > 0 and '{' not in lines[start]:
    start -= 1

# Find closing } by brace counting
brace_count = 0
end = start
while end < len(lines):
    brace_count += lines[end].count('{') - lines[end].count('}')
    if brace_count == 0:
        break
    end += 1

# Remove the block
new_lines = lines[:start] + lines[end + 1:]

# Fix trailing comma if this was the last entry before ];
prev_idx = start - 1
if prev_idx >= 0:
    prev = new_lines[prev_idx].rstrip()
    nxt = new_lines[start].strip() if start < len(new_lines) else ''
    if prev.endswith(',') and nxt.startswith(']'):
        new_lines[prev_idx] = new_lines[prev_idx].rstrip().rstrip(',') + '\n'

with open(path, 'w') as f:
    f.writelines(new_lines)

print(f'patch-qmd: Removed duplicate qmd entry (lines {start}-{end}) from {path}')
