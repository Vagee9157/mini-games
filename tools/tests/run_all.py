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
    # 退出码和「一条都没过」都要算失败 —— 之前只看 FAIL 行，
    # 结果某个测试文件整个崩掉时这里照样报「全部通过」，比直接红还危险
    broken = r.returncode != 0 or (p == 0 and 'audit' not in f)
    status = 'FAIL' if (fl or err or broken) else ' ok '
    if broken and not fl and not err:
        fl = ['整个文件没跑起来，退出码 ' + str(r.returncode)] + out.strip().split('\n')[-3:]
    print(f'[{status}] {f:34s} 通过 {p}')
    for l in fl + err: print('        ' + l.strip())
    if status != ' ok ': bad += 1
print('\n全部通过' if not bad else f'\n{bad} 个文件有问题')
sys.exit(1 if bad else 0)
