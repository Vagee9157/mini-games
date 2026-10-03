#!/usr/bin/env python3
"""跑完 tools/tests 下所有 test_*.py，外加 tools/audit.py。"""
import subprocess, sys, glob, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)
bad = 0
for f in ['tools/audit.py'] + sorted(glob.glob('tools/tests/test_*.py')):
    r = subprocess.run([sys.executable, f], capture_output=True, text=True)
    out = r.stdout + r.stderr
    p = len(re.findall(r'^\s+PASS', out, re.M))
    fl = re.findall(r'^\s+FAIL.*$', out, re.M)
    err = re.findall(r'^\s+!.*$', out, re.M)
    status = 'FAIL' if (fl or err or (r.returncode and 'audit' in f)) else ' ok '
    print(f'[{status}] {f:34s} 通过 {p}')
    for l in fl + err: print('        ' + l.strip())
    if status != ' ok ': bad += 1
print('\n全部通过' if not bad else f'\n{bad} 个文件有问题')
sys.exit(1 if bad else 0)
