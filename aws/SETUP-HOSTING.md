# Hosting the IWM frontend on EC2

End-to-end: buy a domain, launch an instance, ship the build, serve it over
HTTPS. Written for a Windows 11 workstation — every local command is
PowerShell — and an **Amazon Linux 2023** instance.

> **On Ubuntu instead?** Three differences, everything else is identical:
> the login user is `ubuntu` not `ec2-user`, packages are `apt install` not
> `dnf install`, and site configs live in `/etc/nginx/sites-available/` with a
> symlink into `sites-enabled/` rather than dropping straight into
> `/etc/nginx/conf.d/`.

**Read step 0 before you start.** Two things there will waste an evening if you
find them out later.

---

## 0. Two things to know first

### Check which Lambdas are current before the site goes live

The frontend calls five Lambda Function URLs. Some of this build's endpoints
may not exist in what is deployed. **Verify rather than assume** — a CORS
preflight tells you a lot without needing a token:

```powershell
curl.exe -s -o NUL -D - -X OPTIONS "<READINGS_FUNCTION_URL>/" `
  -H "Origin: https://example.com" -H "Access-Control-Request-Method: DELETE"
```

`Access-Control-Allow-Methods: GET, DELETE, OPTIONS` means the purge build is
live; `GET, OPTIONS` means it is not. Likewise `POST /auth/credentials`
without a token answers **401** on the current build and **404** on the old
one.

`iwm-api` cannot be probed this way — it checks the token before routing, so
an unauthenticated request is always 401. Test it by loading Scale Management
while signed in: a **500** means it is running the older broken build and must
be redeployed.

What each Lambda needs from this build:

| Lambda | What this build needs from it |
|---|---|
| `iwm-auth` | `POST /auth/credentials` — change password / security question |
| `iwm-readings` | `DELETE /readings` (purge), `GET /readings/count`, `DELETE` in its CORS header, the fleet-clock fix, alerts |
| `iwm-api` | `GET /scales?refresh=1`, multi-assignee scales, **and a NameError fix without which `GET /scales` 500s** |
| `iwm-reports` | Per-email scoping, mixed-case UID fix |
| `iwm-analytics` | Per-email scoping, mixed-case UID fix |

Each is a single self-contained file with no third-party dependencies — open
the function in the AWS console, paste the contents of
`aws/lambdas/<name>/lambda_function.py` over the editor, click **Deploy**.

`iwm-readings`, `iwm-api`, `iwm-reports` and `iwm-analytics` share the switch
from organization-scoped to per-email scoping. **Deploy those four together**
or clients will see one set of scales on the dashboard and a different set in
reports.

### You need HTTPS, not just a domain

Chrome refuses downloads started by a page on a "non-trustworthy" origin.
`http://54.x.x.x` and `http://foodloss.ca` both qualify as untrustworthy —
so **every Excel and PDF export will silently fail** on a plain-HTTP host. This
already bit this project once during development.

Let's Encrypt will not issue a certificate for a bare IP address, which is why
a domain is step 1 rather than an afterthought.

---

## 1. Buy a domain

Any registrar works. Using **Route 53** keeps DNS in the same console as the
instance and avoids a second login, at roughly $12–15/year for a `.com`.

1. AWS console → **Route 53** → **Registered domains** → **Register domains**
2. Search your name, add to cart, complete the contact details
3. Registration takes 10 minutes to a few hours — you will get an email

Route 53 automatically creates a **hosted zone** for the domain. You will add
records to it in step 6.

> Using an existing registrar (Namecheap, GoDaddy)? Skip the purchase. In step
> 6 you will add the same A records in their DNS panel instead.

---

## 2. Launch the EC2 instance

AWS console → **EC2** → **Launch instance**.

| Setting | Value | Why |
|---|---|---|
| Name | `iwm-web` | |
| AMI | **Amazon Linux 2023** | AWS default, free-tier eligible |
| Architecture | 64-bit (x86) | Matches the commands below |
| Instance type | `t3.micro` (or `t2.micro`) | Free-tier eligible; the site is static files |
| Key pair | **Create new** → RSA → `.pem` → name it `iwm-key` | Downloads once. Losing it means losing access |
| Storage | 8 GB gp3 | The build is 2 MB |

### Security group

Create a new one named `iwm-web-sg` with three inbound rules:

| Type | Port | Source | Why |
|---|---|---|---|
| SSH | 22 | **My IP** | Do not use 0.0.0.0/0 — it invites brute-force |
| HTTP | 80 | 0.0.0.0/0 | Certbot validates over port 80; also redirects to HTTPS |
| HTTPS | 443 | 0.0.0.0/0 | The actual site |

Nothing else. The browser talks to DynamoDB through the Lambdas, never through
this instance.

Click **Launch instance**.

### Assign an Elastic IP — do not skip this

A default public IP **changes every time the instance stops and starts**. Your
DNS record would then point at nothing, and the site would go down for no
visible reason.

1. EC2 → **Elastic IPs** → **Allocate Elastic IP address** → Allocate
2. Select it → **Actions** → **Associate Elastic IP address**
3. Resource type **Instance** → pick `iwm-web` → Associate

Write the address down. It is referred to below as `ec2-18-227-188-57.us-east-2.compute.amazonaws.com`.

---

## 3. Connect to the instance (Windows)

Windows 11 ships an OpenSSH client, so `ssh` and `scp` work in PowerShell with
no extra install.

Move the key somewhere stable first:

```powershell
mkdir "$env:USERPROFILE\.ssh" -Force
Move-Item "$env:USERPROFILE\Downloads\iwm-key.pem" "$env:USERPROFILE\.ssh\iwm-key.pem"
```

### Fix the key permissions

SSH refuses a private key that other accounts can read. On Windows that is
`icacls`, not `chmod`:

```powershell
icacls "$env:USERPROFILE\.ssh\iwm-key.pem" /inheritance:r
icacls "$env:USERPROFILE\.ssh\iwm-key.pem" /grant:r "$($env:USERNAME):(R)"
```

Skipping this gives `UNPROTECTED PRIVATE KEY FILE` and the connection is
refused.

### Log in

```powershell
ssh -i "$env:USERPROFILE\.ssh\iwm-key.pem" ec2-user@ec2-18-227-188-57.us-east-2.compute.amazonaws.com
```

Accept the host fingerprint on first connect. The username is `ec2-user` on
Amazon Linux (`ubuntu` on Ubuntu AMIs) — using the wrong one gives
`Permission denied (publickey)` even with a perfectly good key.

---

## 4. Set up the web server

Everything in this section runs **on the instance**.

```bash
sudo dnf update -y
sudo dnf install -y nginx
```

Create the directory the site will be served from, owned by your login so
`scp` can write to it without `sudo`:

```bash
sudo mkdir -p /var/www/iwm
sudo chown -R ec2-user:ec2-user /var/www/iwm
```

Confirm nginx is alive:

```bash
sudo systemctl enable --now nginx
systemctl status nginx --no-pager
```

Visit `http://ec2-18-227-188-57.us-east-2.compute.amazonaws.com` — the default nginx welcome page confirms the
security group and the service are both correct. If it hangs, the port 80 rule
is missing.

---

## 5. Ship the build

Back on **Windows**, in a new PowerShell window.

### Build (only if you have changed anything since)

```powershell
cd "C:\Users\akash_ax3aplg\Desktop\Akash\Waste-Management-main\frontend"
npm run build
```

> `VITE_*` values from `frontend/.env` are **inlined into the bundle at build
> time**, not read at runtime. That is why the build happens here, where the
> file already exists, rather than on the server. It also means the `.env`
> never has to be copied anywhere. **Change `.env` and you must rebuild.**

### Copy it up

```powershell
scp -i "$env:USERPROFILE\.ssh\iwm-key.pem" -r `
  "C:\Users\akash_ax3aplg\Desktop\Akash\Waste-Management-main\frontend\build\*" `
  ec2-user@ec2-18-227-188-57.us-east-2.compute.amazonaws.com:/var/www/iwm/
```

The trailing `\*` matters: it copies the *contents* of `build`, so you get
`/var/www/iwm/index.html`. Without it you get `/var/www/iwm/build/index.html`
and nginx serves a 404.

### Copy the nginx config

```powershell
scp -i "$env:USERPROFILE\.ssh\iwm-key.pem" `
  "C:\Users\akash_ax3aplg\Desktop\Akash\Waste-Management-main\aws\nginx\iwm.conf" `
  ec2-user@ec2-18-227-188-57.us-east-2.compute.amazonaws.com:/tmp/iwm.conf
```

### Install it (on the instance)

Amazon Linux has no `sites-available`/`sites-enabled` convention — anything
in `/etc/nginx/conf.d/*.conf` is included automatically:

```bash
sudo mv /tmp/iwm.conf /etc/nginx/conf.d/iwm.conf

sudo sed -i 's/REPLACE_WITH_YOUR_DOMAIN/foodloss.ca www.foodloss.ca/' \
  /etc/nginx/conf.d/iwm.conf

sudo nginx -t          # must say "syntax is ok" and "test is successful"
sudo systemctl reload nginx
```

The stock welcome page comes from a `server {}` block inside
`/etc/nginx/nginx.conf` itself, not from a file you can delete. It is the
**default server**, so it answers any request whose `Host` header matches no
other block — which is every request until DNS is pointed here. That is
expected; your block takes over once the domain resolves. To serve the app by
raw IP before then, temporarily set `server_name _;` in `iwm.conf` and reload.

Check the files landed where nginx expects:

```bash
ls /var/www/iwm/index.html && ls /var/www/iwm/assets | head -3
```

`http://ec2-18-227-188-57.us-east-2.compute.amazonaws.com` should now show the IWM landing page.

---

## 6. Point the domain at the instance

Route 53 → **Hosted zones** → your domain → **Create record**.

Create two A records:

| Record name | Type | Value | TTL |
|---|---|---|---|
| *(leave blank — the apex)* | A | `ec2-18-227-188-57.us-east-2.compute.amazonaws.com` | 300 |
| `www` | A | `ec2-18-227-188-57.us-east-2.compute.amazonaws.com` | 300 |

Wait for propagation, then verify from PowerShell:

```powershell
nslookup foodloss.ca
```

It must return your Elastic IP. **Do not start step 7 until it does** —
certbot proves domain ownership by fetching a file over HTTP, and it cannot do
that until DNS resolves. Usually a few minutes; occasionally up to an hour.

---

## 7. HTTPS

On the instance:

Amazon Linux 2023 has no snap. Try the package first:

```bash
sudo dnf install -y certbot python3-certbot-nginx
```

If `dnf` cannot find it, use certbot's own recommended install — a self
contained virtualenv, which works on any distro:

```bash
sudo dnf install -y python3 augeas-libs
sudo python3 -m venv /opt/certbot/
sudo /opt/certbot/bin/pip install --upgrade pip
sudo /opt/certbot/bin/pip install certbot certbot-nginx
sudo ln -sf /opt/certbot/bin/certbot /usr/bin/certbot
```

Either way, then:

```bash
sudo certbot --nginx -d foodloss.ca -d www.foodloss.ca
```

Certbot will ask for an email (renewal warnings), agree to the ToS, and offer
to redirect HTTP to HTTPS — **choose redirect**. It rewrites the nginx config
in place, adding the TLS listeners and the redirect.

Confirm auto-renewal is armed:

```bash
sudo certbot renew --dry-run
```

The package install adds a systemd timer automatically. The virtualenv install
does not — add a cron entry for it:

```bash
echo "0 3 * * * root /usr/bin/certbot renew -q" | sudo tee /etc/cron.d/certbot-renew
```

Certificates last 90 days and the timer renews them unattended. If the dry run
fails, fix it now — a silent expiry takes the site down.

Visit `https://foodloss.ca`. Padlock, no warnings.

---

## 8. Verify it actually works

Static files loading is not the same as the app working. Check these
specifically:

- [ ] **Deep link** — go straight to `https://foodloss.ca/login`. If this
      404s, `try_files` is missing from the nginx config.
- [ ] **Refresh on a deep page** — sign in, land on `/dashboard`, press F5.
      Same root cause if it fails.
- [ ] **Client-side navigation** — from the landing page click *Sign in*, then
      *Back to home*. The page must actually change, not just the URL.
- [ ] **Sign in** — proves the browser can reach `iwm-auth` and CORS is fine.
- [ ] **Dashboard loads readings** — proves `iwm-readings`.
- [ ] **Export an Excel report** — the one that fails on plain HTTP. If it is
      blocked, you are not actually on HTTPS.
- [ ] **Scale Management loads** — proves the `iwm-api` NameError fix is
      deployed. A 500 here means it is not.

---

## 9. Redeploying later

Rebuild locally and copy up. Two commands:

```powershell
cd "C:\Users\akash_ax3aplg\Desktop\Akash\Waste-Management-main\frontend"
npm run build

scp -i "$env:USERPROFILE\.ssh\iwm-key.pem" -r `
  ".\build\*" ec2-user@ec2-18-227-188-57.us-east-2.compute.amazonaws.com:/var/www/iwm/
```

No nginx reload needed — it serves whatever is on disk. Hard-refresh once
(Ctrl+F5); `index.html` is served with `no-store` so browsers pick up the new
bundle immediately.

To clear out files deleted between builds, wipe first:

```powershell
ssh -i "$env:USERPROFILE\.ssh\iwm-key.pem" ec2-user@ec2-18-227-188-57.us-east-2.compute.amazonaws.com "rm -rf /var/www/iwm/*"
```

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `UNPROTECTED PRIVATE KEY FILE` | Windows key permissions | Re-run the `icacls` commands in step 3 |
| SSH times out | Port 22 not open, or your IP changed | Update the SSH rule's source to My IP |
| nginx welcome page instead of the app | Request matched the default server — DNS not pointing here yet, or `server_name` wrong | Check `server_name` in `/etc/nginx/conf.d/iwm.conf`; or set `server_name _;` to claim every host |
| `Permission denied (publickey)` | Wrong login user | `ec2-user` on Amazon Linux, `ubuntu` on Ubuntu |
| 404 on `/login` or on refresh | `try_files` missing | Confirm the `location /` block from `aws/nginx/iwm.conf` |
| 403 Forbidden on every page | nginx cannot traverse the path | `sudo chmod -R 755 /var/www/iwm && sudo chmod 755 /var/www` |
| 403 that survives chmod | SELinux labelling on Amazon Linux | `sudo dnf install -y policycoreutils-python-utils && sudo semanage fcontext -a -t httpd_sys_content_t "/var/www/iwm(/.*)?" && sudo restorecon -Rv /var/www/iwm` |
| Blank page, console shows CORS errors | `ALLOWED_ORIGIN` narrowed on a Lambda | Set it to your domain (or `*`) in that Lambda's env vars |
| Downloads blocked as insecure | Site is on HTTP | Finish step 7 |
| Certbot: "challenge failed" | DNS not resolving yet | `nslookup` first; wait and retry |
| `GET /scales` returns 500 | `iwm-api` not redeployed | See step 0 |
| Site dies after a stop/start | No Elastic IP | Allocate and associate one (step 2) |

### Useful commands on the instance

```bash
sudo tail -f /var/log/nginx/error.log     # why a request failed
sudo tail -f /var/log/nginx/access.log    # what is being requested
sudo nginx -t                             # config syntax
sudo systemctl reload nginx               # apply config changes
df -h                                     # disk, if uploads start failing
```

---

## Optional hardening, once it is live

**Tighten CORS.** Every Lambda defaults `ALLOWED_ORIGIN` to `*`, so any site
can call your API with a stolen token. Set it to `https://foodloss.ca` in
all five functions' environment variables.

**Proxy the API through nginx.** Adding `location /api/ { proxy_pass ... }`
blocks and pointing the frontend at relative paths makes everything
same-origin — CORS stops existing as a concept, and the class of bug where a
missing `Access-Control-Allow-Methods` header silently breaks a feature goes
with it. Requires changing `.env` to relative paths and rebuilding.

**Automatic security updates.**

```bash
sudo dnf install -y dnf-automatic
sudo systemctl enable --now dnf-automatic.timer
```
