#!/usr/bin/env python3
"""Read-only server inspection. Never reads environment/secret/private-key contents."""
import hashlib
import json
import pathlib
import shutil
import socket
import subprocess
import sys


def command(args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=20)
    return {'code': result.returncode, 'output': (result.stdout + result.stderr).strip()[:12000]}


def inspect():
    conf = pathlib.Path('/etc/nginx/sites-available/tanxun')
    current = pathlib.Path('/var/www/ai-youth-archive/current')
    root = pathlib.Path('/var/lib/ai-youth-archive')
    report = {'python': sys.version.split()[0], 'python_supported': sys.version_info >= (3, 9),
              'nginx_config': str(conf), 'current': str(current),
              'current_target': str(current.resolve()) if current.exists() else None,
              'data_directory_exists': root.exists(),
              'disk_free_bytes': shutil.disk_usage('/var').free}
    if conf.is_file():
        raw = conf.read_bytes()
        report['nginx_sha256'] = hashlib.sha256(raw).hexdigest()
        # Print only this application's route names, never a full config or private headers.
        report['archive_route_lines'] = [line.strip() for line in raw.decode().splitlines()
                                         if 'location' in line and '/ai-youth' in line]
    try:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 8789))
        report['port_8789_available'] = True
    except OSError:
        report['port_8789_available'] = False
    for filename in ('index.html', 'app.js', 'style.css', 'hash.js'):
        path = current / filename
        if path.is_file():
            report.setdefault('live_static_sha256', {})[filename] = hashlib.sha256(path.read_bytes()).hexdigest()
    for name, args in {'memory': ['free', '-m'], 'nginx_test': ['nginx', '-t'],
                       'archive_service': ['systemctl', 'show', 'ai-youth-archive.service',
                                           '--property=LoadState,ActiveState,UnitFileState'],
                       'listeners': ['ss', '-ltn']}.items():
        try:
            report[name] = command(args)
        except (OSError, subprocess.SubprocessError) as exc:
            report[name] = {'error': type(exc).__name__}
    return report


if __name__ == '__main__':
    print(json.dumps(inspect(), ensure_ascii=False, indent=2))
