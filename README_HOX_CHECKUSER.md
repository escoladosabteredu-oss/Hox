# HoxTunnel CheckUser API for user VPS

This package is meant to run on the **user's VPS**, not inside the Hox panel.
It checks Linux users locally and returns the JSON format expected by the Hox app/themes.

## Response format

Example:

```json
{
  "username": "demo",
  "expiration_date": "30/05/2026",
  "expiration_days": 4,
  "deviceId": "",
  "count_connections": "1",
  "limit_connections": "1",
  "exists": true,
  "valid": true,
  "expired": false,
  "status": "active",
  "message": "Usuário ativo",
  "success": true,
  "ok": true
}
```

The important app fields are:

```txt
expiration_date
expiration_days
count_connections
limit_connections
```

## Install

Upload the folder/ZIP to the VPS and run:

```bash
unzip hox_checkuser_vps.zip
cd hox_checkuser_vps
sudo bash install.sh
```

Check logs:

```bash
journalctl -u hox-checkuser -f
```

## Test

```bash
curl http://127.0.0.1:9000/health
curl http://127.0.0.1:9000/check/root
curl "http://127.0.0.1:9000/checkuser?user=root"
```

## URL to use in Hox panel configs

Recommended:

```txt
http://VPS_IP:9000/check/
```

If the app appends the username, it becomes:

```txt
http://VPS_IP:9000/check/myuser
```

Also supported:

```txt
http://VPS_IP:9000/checkuser?user=
```

which becomes:

```txt
http://VPS_IP:9000/checkuser?user=myuser
```

The API also accepts the old style:

```txt
/checkuser?user=/check/myuser
```

## User expiry source

The script uses Linux users and `chage -l USERNAME`.

Create/update user expiry example:

```bash
sudo useradd -M demo
sudo chage -E 2026-05-30 demo
```

For unlimited users:

```bash
sudo chage -E -1 demo
```

## Per-user connection limits

Edit:

```bash
sudo nano /etc/checkuser/limits.json
```

Example:

```json
{
  "demo": 2,
  "vipuser": 5
}
```

Restart:

```bash
sudo systemctl restart hox-checkuser
```

## Firewall

Open the port if needed:

```bash
sudo ufw allow 9000/tcp
```

For production, it is better to put Nginx + SSL in front of it and use HTTPS.
