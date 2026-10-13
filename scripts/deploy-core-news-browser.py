"""Install the isolated news browser; preserve every existing production UI asset."""
import hashlib
import json
import os
import re
import sys
import tarfile
import time
from pathlib import Path
import paramiko

base = '/opt/geoskill-news-browser'
stamp = str(int(time.time()))
release = base + '/releases/' + stamp
archive_path = Path('deploy/core-news-browser.tgz')
archive_path.parent.mkdir(exist_ok=True)
packages = set()
def collect(name):
    if name in packages:
        return
    folder = Path('node_modules') / name
    meta = json.loads((folder / 'package.json').read_text(encoding='utf-8'))
    packages.add(name)
    for dep in meta.get('dependencies', {}):
        collect(dep)
for package in ['playwright', 'marked', 'sanitize-html']:
    collect(package)
with tarfile.open(archive_path, 'w:gz') as bundle:
    for name in packages:
        bundle.add(Path('node_modules') / name, arcname='node_modules/' + name)
    for name in ['server/core-news-browser.mjs', 'server/core-news-fields.mjs', 'server/core-news-batches.mjs', 'server/core-news-media.mjs', 'desktop-news/fill-editor.cjs', 'desktop-news/policy.cjs']:
        bundle.add(name, arcname=name)

client = paramiko.SSHClient()
client.load_system_host_keys()
client.connect('geoskill.7chacha.com', username='root', password=os.environ['GEO_DEPLOY_PASSWORD'], timeout=15)
def run(command, timeout=180):
    _, output, error = client.exec_command(command, timeout=timeout)
    result = output.read().decode(errors='replace')
    errors = error.read().decode(errors='replace')
    if output.channel.recv_exit_status():
        raise RuntimeError(result + errors)
    print(result, flush=True)
    return result
def put_text(path, value):
    with client.open_sftp() as sftp:
        with sftp.file(path, 'w') as f:
            f.write(value)
original = None
changed = False
config = '/etc/nginx/conf.d/geoskill.7chacha.com.conf'
try:
    free = int(run("df -B1 --output=avail / | tail -n 1").strip())
    if free < 2 * 1024**3:
        raise RuntimeError('Insufficient free disk')
    run(f'id geo-news >/dev/null 2>&1 || useradd --system --home-dir {base}/data --shell /sbin/nologin geo-news')
    run(f'mkdir -p {release} {base}/data {base}/browsers')
    with client.open_sftp() as sftp:
        sftp.put(str(archive_path), release + '/bundle.tgz')
    run(f'tar -xzf {release}/bundle.tgz -C {release} && chown -R geo-news:geo-news {base}/data {base}/browsers')
    metadata = json.loads(Path('node_modules/playwright-core/browsers.json').read_text())
    version = next(b['browserVersion'] for b in metadata['browsers'] if b['name'] == 'chromium-headless-shell')
    if not re.fullmatch(r'[0-9.]+', version):
        raise RuntimeError('Invalid browser version')
    browser_dir = base + '/browsers/' + version
    executable = browser_dir + '/chrome-headless-shell-linux64/chrome-headless-shell'
    run(f'mkdir -p {browser_dir} && test -x {executable} || (curl -fL --max-time 180 https://cdn.npmmirror.com/binaries/chrome-for-testing/{version}/linux64/chrome-headless-shell-linux64.zip -o {browser_dir}/browser.zip && unzip -qo {browser_dir}/browser.zip -d {browser_dir})', timeout=240)
    run('dnf install -y nss atk at-spi2-atk cups-libs libdrm libXcomposite libXdamage libXfixes libXrandr mesa-libgbm libxkbcommon pango alsa-lib liberation-fonts google-noto-sans-cjk-ttc-fonts', timeout=240)
    run(f'chmod -R a+rX {base}/browsers')
    # Runtime check uses only an empty page, never production accounts or orders.
    smoke = "const{chromium}=require('playwright');(async()=>{const b=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:" + json.dumps(executable) + "});await b.close();console.log('BROWSER_READY')})().catch(e=>{console.error(e);process.exit(1)})"
    put_text(release + '/smoke.cjs', smoke)
    run(f'runuser -u geo-news -- env PLAYWRIGHT_BROWSERS_PATH={base}/browsers node {release}/smoke.cjs')
    unit = f'''[Unit]
Description=GEO isolated core news browser
After=network.target
[Service]
User=geo-news
Group=geo-news
WorkingDirectory={release}
Environment=PLAYWRIGHT_BROWSERS_PATH={base}/browsers
Environment=NEWS_BROWSER_DATA={base}/data
Environment=NEWS_BROWSER_PORT=8792
Environment=NEWS_CHROMIUM_EXECUTABLE={executable}
ExecStart=/usr/bin/node {release}/server/core-news-browser.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths={base}/data
MemoryMax=800M
TasksMax=256
[Install]
WantedBy=multi-user.target
'''
    put_text('/etc/systemd/system/geoskill-news-browser.service', unit)
    run('systemctl daemon-reload && systemctl enable --now geoskill-news-browser.service && systemctl restart geoskill-news-browser.service')
    run('systemctl is-active --quiet geoskill-news-browser.service')
    with client.open_sftp() as sftp:
        with sftp.file(config) as f:
            original = f.read().decode()
    old_dist = re.search(r'\broot\s+(/www/wwwroot/geoskill\.7chacha\.com/releases/[^;]+/dist);', original).group(1)
    ui = '/www/wwwroot/geoskill.7chacha.com/releases/core-news-' + stamp
    run(f'mkdir -p {ui} && cp -a {old_dist} {ui}/dist')
    script = Path('public/core-news-browser.js').read_bytes()
    asset = 'core-news-browser-' + hashlib.sha256(script).hexdigest()[:12] + '.js'
    with client.open_sftp() as sftp:
        sftp.put('public/core-news-browser.js', ui + '/dist/assets/' + asset)
        with sftp.file(ui + '/dist/index.html') as f:
            html = f.read().decode()
    html = re.sub(r'\s*<script type="module" src="/gongju/assets/core-news-browser-[^"]+"></script>', '', html)
    html = html.replace('</body>', f'  <script type="module" src="/gongju/assets/{asset}"></script>\n</body>')
    put_text(ui + '/dist/index.html', html)
    updated = original.replace(old_dist, ui + '/dist')
    location = '''    location ^~ /api/core-news-browser/ {
        proxy_pass http://127.0.0.1:8792;
        proxy_set_header Host $host;
        proxy_read_timeout 180s;
        client_max_body_size 16k;
        add_header Cache-Control "no-store" always;
    }
'''
    if 'location ^~ /api/core-news-browser/' not in updated:
        updated = updated.replace('    location /api/ {', location + '\n    location /api/ {', 1)
    else:
        updated = re.sub(r'    location \^~ /api/core-news-browser/ \{[^}]*\}', location.rstrip(), updated, count=1)
    put_text(ui + '/nginx-before.conf', original)
    put_text(config, updated); changed = True
    run('nginx -t && systemctl reload nginx')
    run(f"test \"$(curl -s -o /dev/null -w '%{{http_code}}' https://geoskill.7chacha.com/gongju/assets/{asset})\" = 200")
    run("test \"$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://geoskill.7chacha.com' -H 'Content-Type: application/json' -d '{}' https://geoskill.7chacha.com/api/core-news-browser/open)\" = 401")
    run('systemctl is-active --quiet geoskill-commercial-api.service')
    print('DEPLOYED ' + ui + '; existing main JS/CSS and article API unchanged', flush=True)
except Exception:
    if changed:
        put_text(config, original)
        run('nginx -t && systemctl reload nginx')
    raise
finally:
    client.close()
